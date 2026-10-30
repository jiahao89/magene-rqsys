import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresRepositories } from "./repositories.js";
import { decodeBatchCursor } from "../../application/batch-cursor.js";
import { decodeRequirementCursor } from "../../application/requirement-cursor.js";

// 两仓仓储行为契约测试（R-01）。
//
// 背景：妙搭运行时用 Drizzle 传输层（rq-sys-miaoda/server/rqsys/adapters/postgres/drizzle-pool.ts），
// 它按 SQL 文本出现顺序把每个 `$N` 拆成独立绑定参数；node-postgres 则按编号绑定并让 PostgreSQL
// 从任意一处有类型上下文的使用推断参数类型。两种语义在“重复出现、且只有一处有类型上下文”的
// 写法上表现不同：2026-10-22 线上分配负责人 503（could not determine data type of parameter）
// 就是这样漏过根仓 pg 测试的。
//
// 本文件把同一组仓储用例跑两遍：
//   1. `pg`：原生 node-postgres 语义；
//   2. `drizzle-text-order`：用 TextOrderPlaceholderPool 模拟妙搭的文本顺序重绑语义。
// 这样未加 `::text` 的重复占位符会在根仓测试中直接失败，而不是等到目标环境。
//
// 注意：契约用例刻意只依赖仓储接口 + 真实 PostgreSQL；妙搭仓的 Drizzle 实现要跑同一组用例，
// 需在其 scripts/ 下用等价的 Drizzle 注入复刻（见 FIX-REPORT 的后续项）。

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");

async function getDatabaseUrl(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = await readFile(resolve(root, ".env"), "utf8").catch(() => "");
  const value = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!value) throw new Error("PostgreSQL contract tests require DATABASE_URL in environment or repo .env");
  return value;
}

interface QueryResultLike { rows: Record<string, unknown>[]; rowCount: number | null }
interface QueryableClient {
  query(text: string, values?: unknown[]): Promise<QueryResultLike>;
  release(): void;
}

/**
 * 模拟妙搭 Drizzle 传输层的占位符语义：每个 `$N` 出现都换成顺序编号的新占位符，
 * 值按出现顺序追加。字符串、标识符、注释与 $$ 引用内部不替换（与 drizzle-pool 一致）。
 */
export function rewriteTextOrderPlaceholders(text: string, values: readonly unknown[] = []): { text: string; values: unknown[] } {
  if (!text.includes("$")) return { text, values: [...values] };
  const outValues: unknown[] = [];
  let out = "";
  let cursor = 0;
  let quote: '"' | "'" | null = null;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") { blockCommentDepth += 1; index += 1; }
      else if (char === "*" && next === "/") { blockCommentDepth -= 1; index += 1; }
      continue;
    }
    if (dollarQuote) {
      if (text.startsWith(dollarQuote, index)) { index += dollarQuote.length - 1; dollarQuote = null; }
      continue;
    }
    if (quote === "'") {
      if (char === "'" && next === "'") index += 1;
      else if (char === "\\") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "-" && next === "-") { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockCommentDepth = 1; index += 1; continue; }
    if (char === "'") { quote = "'"; continue; }
    if (char === '"') { quote = '"'; continue; }
    if (char === "$") {
      const delimiter = text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) { dollarQuote = delimiter; index += delimiter.length - 1; continue; }
      const placeholder = text.slice(index).match(/^\$(\d+)/)?.[1];
      if (placeholder) {
        const parameterIndex = Number(placeholder) - 1;
        if (parameterIndex < 0 || parameterIndex >= values.length) throw new Error(`SQL placeholder $${placeholder} has no bound value`);
        out += text.slice(cursor, index) + `$${outValues.length + 1}`;
        outValues.push(values[parameterIndex] ?? null);
        index += placeholder.length;
        cursor = index + 1;
      }
    }
  }
  out += text.slice(cursor);
  return { text: out, values: outValues };
}

class TextOrderPlaceholderPool {
  constructor(private readonly pool: Pool) {}
  query(text: string, values: unknown[] = []) {
    const rewritten = rewriteTextOrderPlaceholders(text, values);
    return this.pool.query(rewritten.text, rewritten.values);
  }
  async connect(): Promise<QueryableClient> {
    const client = await this.pool.connect();
    return {
      query: (text: string, values: unknown[] = []) => {
        const rewritten = rewriteTextOrderPlaceholders(text, values);
        return client.query(rewritten.text, rewritten.values) as Promise<QueryResultLike>;
      },
      release: () => client.release(),
    };
  }
}

type ContractMode = "pg" | "drizzle-text-order";

interface ContractContext {
  plain: Pool;
  admin: Pool;
  schema: string;
  repositories: PostgresRepositories;
}

async function setup(mode: ContractMode): Promise<ContractContext> {
  const connectionString = await getDatabaseUrl();
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  const schema = `rq_contract_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const plain = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 5 });
  try {
    const migrationsDir = resolve(root, "database/migrations");
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) await plain.query(await readFile(resolve(migrationsDir, file), "utf8"));
    const pool = mode === "pg" ? plain : new TextOrderPlaceholderPool(plain);
    return { plain, admin, schema, repositories: new PostgresRepositories(pool as never) };
  } catch (error) {
    await plain.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw error;
  }
}

async function cleanup(ctx: ContractContext): Promise<void> {
  await ctx.plain.end();
  await ctx.admin.query(`DROP SCHEMA "${ctx.schema}" CASCADE`);
  await ctx.admin.end();
}

const sourceConfig = {
  projectId: "tb-project",
  projectName: "Product",
  requirementTypeId: "req-type",
  enabled: true,
  schedule: { enabled: true, weekday: 1, time: "09:30", timezone: "Asia/Shanghai" },
  ownerNames: ["贾浩", "刘媛媛"],
  fieldMap: {},
};

function requirementWrite(sourceConfigId: string, latestBatchId: string, overrides: Partial<import("./repositories.js").RequirementRowWrite> = {}) {
  return {
    sourceConfigId, teambitionRequirementId: "task-1", title: "Requirement", description: null, scope: null,
    acceptanceCriteria: null, proposerUserId: null, proposerName: null, executorUserId: null, executorName: null,
    statusId: null, createdAt: null, updatedAt: null, sourceUrl: null, uniqueId: null, attachmentRefs: [],
    customFields: [], payload: {}, sourceHash: "a".repeat(64), substantiveHash: "b".repeat(64),
    sourceVersion: 1, latestBatchId, ...overrides,
  };
}

function auditEvent(id: string, eventType = "contract.test") {
  return {
    id, actorId: "contract-actor", eventType, entityType: "contract", entityId: id,
    result: "succeeded" as const, safeDetails: {}, occurredAt: "2026-10-28T00:00:00.000Z",
  };
}

const MODES: readonly ContractMode[] = ["pg", "drizzle-text-order"];

for (const mode of MODES) {
  test(`repository contract [${mode}]: requirement upsert keeps source identity and issues sequential RQ IDs`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      const batch = await ctx.repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: `contract-batch-${randomUUID()}`, startedAt: "2026-10-28T00:00:00Z" });
      const first = await ctx.repositories.requirements.upsertRequirement(source.id, "task-1", requirementWrite(source.id, batch.id));
      const replay = await ctx.repositories.requirements.upsertRequirement(source.id, "task-1", requirementWrite(source.id, batch.id));
      assert.equal(replay.id, first.id, "the TB identity must stay the upsert key");
      assert.equal(replay.created, false);
      assert.equal((await ctx.repositories.requirements.get(first.id))?.platformRequirementId, "RQ-000001");
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: manual owner upsert accepts a null Teambition user id (2026-10-22 503 path)`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      const now = "2026-10-28T00:00:00.000Z";
      const params = { sourceConfigId: source.id, teambitionUserId: null, teambitionDisplayName: "贾浩", feishuUserId: "ou-jia", feishuIdType: "open_id" as const, createdBy: "contract-actor", now };
      const mapping = await ctx.repositories.people.upsertManual(params);
      assert.equal(mapping.normalizedName, "贾浩");
      assert.equal(mapping.matchMethod, "manual");
      const replay = await ctx.repositories.people.upsertManual(params);
      assert.equal(replay.id, mapping.id);
      assert.equal((await ctx.repositories.people.resolveActive(source.id, { normalizedName: "贾浩" }))?.feishuUserId, "ou-jia");
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: person binding adopts an unnamed mapping and refuses a second person`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      await ctx.repositories.people.upsertManual({
        sourceConfigId: source.id, teambitionUserId: null, teambitionDisplayName: null,
        feishuUserId: "ou-jia", feishuIdType: "open_id", createdBy: "contract-actor", now: "2026-10-28T00:00:00.000Z",
      });
      const bound = await ctx.repositories.directory.bindPersonFeishu("贾浩", { feishuUserId: "ou-jia", feishuIdType: "open_id" }, auditEvent(randomUUID(), "team_person.feishu_bound"));
      assert.equal(bound.find((person) => person.name === "贾浩")?.binding?.feishuUserId, "ou-jia");
      await assert.rejects(
        () => ctx.repositories.directory.bindPersonFeishu("刘媛媛", { feishuUserId: "ou-jia", feishuIdType: "open_id" }, auditEvent(randomUUID(), "team_person.feishu_bound")),
        { name: "TeamDirectoryConflict" },
      );
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: analysis completion persists provider provenance`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      const batch = await ctx.repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: `contract-analysis-${randomUUID()}`, startedAt: "2026-10-28T00:00:00Z" });
      const requirement = await ctx.repositories.requirements.upsertRequirement(source.id, "task-analysis", requirementWrite(source.id, batch.id, { teambitionRequirementId: "task-analysis" }));
      const run = await ctx.repositories.analyses.append({ requirementId: requirement.id, sourceVersion: 1, analysisVersion: 1, startedAt: "2026-10-28T00:00:01Z" });
      const completed = await ctx.repositories.analyses.complete(run.id, {
        status: "analyzed", priority: "P1", provider: "deepseek", model: "deepseek-chat",
        promptVersion: "rq-analysis-v3", moduleDictionaryVersion: 3, completedAt: "2026-10-28T00:00:02Z",
      });
      assert.equal(completed?.provider, "deepseek");
      assert.equal(completed?.model, "deepseek-chat");
      assert.equal(completed?.promptVersion, "rq-analysis-v3");
      assert.equal((await ctx.repositories.analyses.latest(requirement.id))?.provider, "deepseek");
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: batch listing tolerates omitted typed time filters`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      for (let index = 0; index < 2; index += 1) {
        const batch = await ctx.repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: `contract-list-${index}-${randomUUID()}`, startedAt: `2026-10-28T00:00:0${index}Z` });
        await ctx.repositories.batches.complete(batch.id, { status: "succeeded", totalCount: 0, succeededCount: 0, failedCount: 0, errorSummary: null, completedAt: `2026-10-28T00:00:1${index}Z` });
      }
      const unfiltered = await ctx.repositories.batches.list({ limit: 10 });
      assert.equal(unfiltered.items.length, 2);
      const firstPage = await ctx.repositories.batches.list({ limit: 1 });
      assert.equal(firstPage.items.length, 1);
      assert.ok(firstPage.nextCursor);
      const secondPage = await ctx.repositories.batches.list({ limit: 1, cursor: decodeBatchCursor(firstPage.nextCursor)! });
      assert.equal(secondPage.items.length, 1);
      assert.notEqual(secondPage.items[0]?.id, firstPage.items[0]?.id);
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: requirement search applies filters and keyset pagination without skipping rows`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      const batch = await ctx.repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: `contract-search-${randomUUID()}`, startedAt: "2026-10-28T00:00:00Z" });
      // 同一批内创建 3 条：游标必须按 (created_at, id) 稳定推进，不能因时间相同而漏行。
      for (const index of [1, 2, 3]) {
        await ctx.repositories.requirements.upsertRequirement(source.id, `task-search-${index}`, requirementWrite(source.id, batch.id, { teambitionRequirementId: `task-search-${index}`, title: `查询需求 ${index}` }));
      }
      const filtered = await ctx.repositories.requirements.search({ q: "查询需求", limit: 10 });
      assert.equal(filtered.items.length, 3);
      const byState = await ctx.repositories.requirements.search({ pullState: "running", limit: 10 });
      assert.equal(byState.items.length, 0, "过滤条件未命中时返回空集，而不是报错");
      const seen = new Set<string>();
      let cursor = undefined as ReturnType<typeof decodeRequirementCursor> | undefined;
      for (let page = 0; page < 4; page += 1) {
        const result = await ctx.repositories.requirements.search({ q: "查询需求", limit: 1, ...(cursor ? { cursor } : {}) });
        for (const item of result.items) seen.add(item.id);
        if (!result.nextCursor) break;
        cursor = decodeRequirementCursor(result.nextCursor)!;
      }
      assert.equal(seen.size, 3, "分页遍历必须覆盖全部 3 条，不能漏行或重复");
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: duplicate hints are persisted without merging or deleting rows`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      const batch = await ctx.repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: `contract-dup-${randomUUID()}`, startedAt: "2026-10-28T00:00:00Z" });
      const first = await ctx.repositories.requirements.upsertRequirement(source.id, "task-dup-1", requirementWrite(source.id, batch.id, { teambitionRequirementId: "task-dup-1", title: "同标题需求" }));
      const second = await ctx.repositories.requirements.upsertRequirement(source.id, "task-dup-2", requirementWrite(source.id, batch.id, { teambitionRequirementId: "task-dup-2", title: "同标题需求" }));
      await ctx.repositories.requirements.setDuplicateOf(second.id, first.id);
      const candidates = await ctx.repositories.requirements.listTitleCandidates(source.id);
      assert.equal(candidates.length, 2, "重复标题只是提示：两条需求都必须保留");
      assert.equal(candidates.find((row) => row.id === second.id)?.duplicateOfRequirementId, first.id);
      // 决策表按稳定身份保存，读取时要带出主记录的平台编号，界面才不用显示裸 UUID。
      await ctx.repositories.requirements.decideResolution({ requirementId: second.id, decision: "duplicate", canonicalRequirementId: first.id, reason: "同标题同需求", actorId: "contract", expectedVersion: 0, now: "2026-10-28T00:00:01Z" });
      const resolution = await ctx.repositories.requirements.getResolution?.(second.id);
      assert.equal(resolution?.canonicalRequirementId, first.id);
      assert.equal(resolution?.canonicalPlatformRequirementId, (await ctx.repositories.requirements.get(first.id))?.platformRequirementId);
      assert.equal((await ctx.repositories.requirements.get(second.id))?.processingState, "suppressed_duplicate");
      await ctx.repositories.requirements.setDuplicateOf(second.id, null);
      assert.equal((await ctx.repositories.requirements.get(second.id))?.duplicateOfRequirementId, null, "撤销提示也必须生效");
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: job claim uses a lease and only the current attempt can complete`, async () => {
    const ctx = await setup(mode);
    try {
      const job = await ctx.repositories.jobs.enqueue({ jobType: "analysis", dedupeKey: `contract-job-${randomUUID()}`, payload: { requirementId: "x" }, availableAt: "2026-10-28T00:00:00Z" });
      const claimed = await ctx.repositories.jobs.claimNext("worker-a", 60_000, "2026-10-28T00:00:01Z");
      assert.equal(claimed?.id, job.id);
      assert.equal(claimed?.status, "running");
      assert.equal(claimed?.attemptCount, 1);
      assert.equal(await ctx.repositories.jobs.claimNext("worker-b", 60_000, "2026-10-28T00:00:02Z"), null, "租约有效期内不能被第二个 worker 认领");
      // fencing：旧 attempt 的结果必须被拒绝
      assert.equal(await ctx.repositories.jobs.complete(job.id, { expectedAttempt: 0, status: "succeeded", now: "2026-10-28T00:00:03Z" }), null);
      const completed = await ctx.repositories.jobs.complete(job.id, { expectedAttempt: 1, status: "succeeded", now: "2026-10-28T00:00:03Z" });
      assert.equal(completed?.status, "succeeded");
      // 租约过期且次数用尽后由回收器查询返回
      const exhausted = await ctx.repositories.jobs.enqueue({ jobType: "base_push", dedupeKey: `contract-job-exhausted-${randomUUID()}`, payload: { requirementId: "x" }, availableAt: "2026-10-28T00:00:00Z", maxAttempts: 1 });
      await ctx.repositories.jobs.claimNext("worker-a", 0, "2026-10-28T00:00:04Z");
      const reclaimed = await ctx.repositories.jobs.listExhaustedRunning?.("2026-10-28T01:00:00Z", 10) ?? [];
      assert.ok(reclaimed.some((row) => row.id === exhausted.id), "次数用尽且租约过期的作业必须能被回收器查到");
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: settling a failed sync job also closes its running batch atomically`, async () => {
    const ctx = await setup(mode);
    try {
      const source = await ctx.repositories.sources.create(sourceConfig);
      const batch = await ctx.repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: `contract-settle-${randomUUID()}`, startedAt: "2026-10-28T00:00:00Z" });
      await ctx.repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${batch.id}`, payload: { batchId: batch.id, sourceId: source.id, triggerType: "manual", actorId: null }, availableAt: "2026-10-28T00:00:00Z" });
      const claimed = await ctx.repositories.jobs.claimNext("worker-a", 60_000, "2026-10-28T00:00:01Z");
      assert.ok(claimed);
      await ctx.repositories.jobs.complete(claimed!.id, { expectedAttempt: claimed!.attemptCount, status: "failed", errorCode: "worker_handler_failed", errorSummary: "boom", now: "2026-10-28T00:00:02Z", settleSyncBatch: true });
      assert.equal((await ctx.repositories.batches.get(batch.id))?.status, "failed", "失败的 sync 作业必须把批次一并收敛，否则来源被并发守卫锁死");
    } finally {
      await cleanup(ctx);
    }
  });

  test(`repository contract [${mode}]: publishing a dictionary retires the previously published version`, async () => {
    const ctx = await setup(mode);
    try {
      const first = await ctx.repositories.dictionaries.create({ entries: ["需求澄清"], createdBy: "contract", now: "2026-10-28T00:00:00Z" });
      await ctx.repositories.dictionaries.publish(first.version, "2026-10-28T00:00:01Z");
      const second = await ctx.repositories.dictionaries.create({ entries: ["需求澄清", "缺陷修复"], createdBy: "contract", now: "2026-10-28T00:00:02Z" });
      await ctx.repositories.dictionaries.publish(second.version, "2026-10-28T00:00:03Z");
      const all = await ctx.repositories.dictionaries.list();
      assert.equal(all.filter((row) => row.status === "published").length, 1, "任何时刻只能有一个 published 版本");
      assert.equal((await ctx.repositories.dictionaries.get(first.version))?.status, "retired");
      assert.deepEqual((await ctx.repositories.dictionaries.get(second.version))?.entries, ["需求澄清", "缺陷修复"]);
    } finally {
      await cleanup(ctx);
    }
  });
}

test("text-order placeholder shim reproduces the target-transport failure that plain pg tolerates", async () => {
  const ctx = await setup("pg");
  const client = await ctx.plain.connect();
  try {
    // 复刻 2026-10-22 事故写法：$2 出现两次，其中一次只出现在无类型上下文的 IS NOT NULL 里。
    // 原生 node-postgres 会按“编号”把两处绑定到同一个参数节点，PostgreSQL 从列比较处推出类型，因此能够通过；
    // 妙搭 Drizzle 传输层把每个出现拆成独立参数后，IS NOT NULL 那一个没有类型上下文，目标环境报 503。
    await client.query("CREATE TEMP TABLE contract_pm(id int, active bool, teambition_user_id text, normalized_name text, updated_at timestamptz)");
    const preFixShape = "UPDATE contract_pm SET active=false,updated_at=$1 WHERE teambition_user_id IS NOT DISTINCT FROM $2 AND ($2 IS NOT NULL OR normalized_name IS NOT DISTINCT FROM $3)";
    const params = ["2026-10-28T00:00:00Z", null, "贾浩"];
    await client.query(preFixShape, params);
    const rewritten = rewriteTextOrderPlaceholders(preFixShape, params);
    await assert.rejects(
      () => client.query(rewritten.text, rewritten.values),
      /could not determine data type of parameter/,
    );
  } finally {
    client.release();
    await cleanup(ctx);
  }
});
