import assert from "node:assert/strict";
import { createHash as createHashForTest } from "node:crypto";
import test from "node:test";
import type { AuditEventRecord, RequirementRecord, SourceConfigRecord, SyncBatchRecord, SyncItemRecord } from "../domain/persistence.js";
import type { ApiDependencies, ApiRepositories } from "./app.js";
import { handleApiRequest, MAX_JSON_BODY_BYTES } from "./app.js";
import { AiProviderError } from "../analysis/provider.js";
import { AssessmentContractError } from "../assessment/service.js";
import { CHAT_PROMPT_VERSION } from "../intake/chat-extract.js";
// AI 状态区读 process.env.AI_API_KEY；测试里显式设置并还原，避免依赖跑测试机器的环境。
async function withAiKey<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.AI_API_KEY;
  if (value === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = value;
  try { return await run(); }
  finally { if (previous === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous; }
}
const emptyCounts = { total: 0, pullSynced: 0, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 0, suppressed: 0, priority: { P0: 0, P1: 0, P2: 0, P3: 0, scored: 0, legacy: 0, unscored: 0 } };
function overviewDependencies() {
  const d = makeDependencies();
  (d.repositories!.requirements as unknown as { getPipelineCounts: () => Promise<unknown> }).getPipelineCounts = async () => emptyCounts;
  return d;
}
import { encodeBatchCursor } from "../application/batch-cursor.js";
import { EXPECTED_LATEST_MIGRATION } from "../db/expected-migration.js";

const source: SourceConfigRecord = { id: "11111111-1111-4111-8111-111111111111", provider: "teambition", externalProjectId: "p1", externalProjectName: "Project", requirementTypeId: "type1", enabled: true, scheduleEnabled: false, scheduleWeekday: null, scheduleLocalTime: null, scheduleTimezone: null, ownerNames: ["Lee"], fieldMap: { title: "name" }, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
const batch: SyncBatchRecord = { id: "22222222-2222-4222-8222-222222222222", sourceConfigId: source.id, triggerType: "manual", actorId: "actor-1", idempotencyKey: "request-key-0001", status: "running", startedAt: "2026-10-08T00:00:00.000Z", completedAt: null, totalCount: 0, succeededCount: 0, failedCount: 0, errorSummary: null, createdAt: "2026-10-08T00:00:00.000Z" };
const item: SyncItemRecord = { id: "33333333-3333-4333-8333-333333333333", batchId: batch.id, requirementId: null, teambitionRequirementId: "tb-1", action: "created", status: "succeeded", errorCode: null, errorDetail: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:00.000Z" };
const auditEvent: AuditEventRecord = { id: "44444444-4444-4444-8444-444444444444", actorId: "actor-1", eventType: "sync.requested", entityType: "sync_batch", entityId: batch.id, result: "succeeded", safeDetails: {}, occurredAt: "2026-10-08T00:00:00.000Z" };
const requirement = { id: "66666666-6666-4666-8666-666666666666", platformRequirementId: "RQ-000001", sourceType: "teambition", sourceChannel: null, productModel: null, requirementType: null, constraintNotes: null, supplementUrl: null, intakeModule: null, audienceTags: [], audienceConfirmed: false, audienceVersion: 0, sourceConfigId: source.id, teambitionRequirementId: "tb-1", teambitionUniqueId: null, title: "Need", description: null, scope: null, acceptanceCriteria: null, proposerUserId: null, proposerName: null, executorUserId: null, executorName: null, sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null, attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "h", substantiveHash: "s", sourceVersion: 1, latestBatchId: batch.id, baseRecordId: null, lastPushedAt: null, pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pending" }, firstSeenAt: "2026-10-08T00:00:00.000Z", lastSeenAt: "2026-10-08T00:00:00.000Z", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
const analysisRun = { id: "run-1", requirementId: source.id, sourceVersion: 1, analysisVersion: 2, status: "analyzed", moduleSuggestion: "报表分析", confidence: "medium", confidenceReason: "理由", priority: "P1", structuredResult: null, provider: "deepseek", model: "m", promptVersion: "p", moduleDictionaryVersion: 1, priorityRuleVersionId: null, safeErrorCode: null, safeErrorSummary: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z" };
function makeDependencies(actor: { id: string } = { id: "actor-1" }): ApiDependencies {
 const batches: SyncBatchRecord[] = [];
 const repositories: ApiRepositories = {
  sources: { list: async () => [source], get: async (id) => id === source.id ? source : null, update: async (id, u) => id === source.id ? { ...source, externalProjectId: u.projectId, externalProjectName: u.projectName, requirementTypeId: u.requirementTypeId, enabled: u.enabled, scheduleEnabled: u.schedule.enabled, scheduleWeekday: u.schedule.weekday, scheduleWeekdays: u.schedule.weekdays ?? (u.schedule.weekday === null ? null : [u.schedule.weekday]), scheduleLocalTime: u.schedule.time, scheduleTimezone: u.schedule.timezone, ownerNames: u.ownerNames, fieldMap: u.fieldMap } : null, create: async () => source },
  batches: { create: async (p) => { const b = { ...batch, ...p, id: `batch-${batches.length + 1}` }; batches.push(b); return b; }, get: async (id) => batches.find((b) => b.id === id) ?? (id === batch.id ? batch : null), findByIdempotencyKey: async (sid, key) => batches.find((b) => b.sourceConfigId === sid && b.idempotencyKey === key) ?? null, list: async ({ status, limit, cursor }) => { const rows = batches.filter((b) => !status || b.status === status); const start = cursor ? rows.findIndex((b) => b.id === cursor.id) + 1 : 0; const items = rows.slice(start, start + limit); return { items, nextCursor: start + limit < rows.length ? items.at(-1)?.id ?? null : null }; }, complete: async () => null },
  items: { upsert: async () => item, get: async () => item, listByBatch: async (id) => id === batch.id ? [item] : [] },
  audit: { append: async () => undefined, search: async () => [auditEvent] },
  jobs: { enqueue: async (p) => ({ ...p, id: "job-1", status: "queued", attemptCount: 0, maxAttempts: p.maxAttempts ?? 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: p.availableAt, updatedAt: p.availableAt }), claimNext: async () => null, reschedule: async () => null, complete: async () => null },
 analyses: { append: async () => analysisRun as never, complete: async () => analysisRun as never, latest: async () => analysisRun as never, listByRequirement: async () => [analysisRun as never] },
 requirements: { get: async (id: string) => id === requirement.id ? requirement : null, search: async () => ({ items: [], nextCursor: null }), findForSync: async () => null, upsertRequirement: async () => { throw new Error("unused"); }, updateAnalysisState: async () => undefined, setOwner: async () => undefined, setBaseRecord: async () => undefined, setPushState: async () => undefined, updateOwnerState: async () => undefined, updatePushState: async () => undefined, listDuplicates: async () => [], listTitleCandidates: async () => [], setDuplicateOf: async () => undefined, markLastPushedOwner: async () => undefined, assignManualOwner: async () => undefined, clearManualOwner: async () => undefined, markManualOwnerPushed: async () => undefined } as never,
 };
 return { database: null, repositories, identity: { requireActor: async () => actor }, now: () => new Date("2026-10-08T00:00:00.000Z") };
}
const unauthenticated: ApiDependencies = { database: null, repositories: undefined, identity: undefined, now: undefined };
test("rejects non-UUID path IDs with 404 before touching uuid repositories", async () => {
  const d = { ...makeDependencies(), database: {} as never };
  const cases: Array<[string, string]> = [
    ["GET", "/api/requirements/not-a-uuid"],
    ["PATCH", "/api/requirements/not-a-uuid"],
    ["GET", "/api/batches/not-a-uuid"],
    ["POST", "/api/items/not-a-uuid/retry"],
    ["POST", "/api/analysis/not-a-uuid/retry"],
    ["POST", "/api/requirements/not-a-uuid/push"],
  ];
  for (const [method, path] of cases) {
    const response = await handleApiRequest(new Request(`http://localhost${path}`, { method }), d);
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});
test("malformed percent-encoding in a path segment returns 4xx instead of throwing", async () => {
  // %E0%A4%A 是无效 UTF-8 序列：decodeURIComponent 会抛 URIError。
  // 路径解码必须把它收敛成客户端错误，不能落到 server.ts 的 500 兜底。
  const d = { ...makeDependencies(), database: {} as never };
  const cases: Array<[string, string]> = [
    ["GET", "/api/requirements/%E0%A4%A"],
    ["GET", "/api/batches/%E0%A4%A"],
    ["POST", "/api/items/%E0%A4%A/retry"],
  ];
  for (const [method, path] of cases) {
    const response = await handleApiRequest(new Request(`http://localhost${path}`, { method }), d);
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});
test("liveness reports the API service", async () => { const r = await handleApiRequest(new Request("http://localhost/api/health"), unauthenticated); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: "ok", service: "rq-sys-api" }); });

test("readiness reports the applied migration without failing when it lags", async () => {
 const makeReady = (rows: Array<{ filename?: string }> | Error) => {
  const d = makeDependencies();
  d.database = {
   query: async (sql: string) => {
    if (sql.includes("schema_migrations")) {
     if (rows instanceof Error) throw rows;
     return { rows, rowCount: rows.length };
    }
    return { rows: [{}], rowCount: 1 };
   },
  } as never;
  return d;
 };
 const current = await handleApiRequest(new Request("http://localhost/api/health/ready"), makeReady([{ filename: EXPECTED_LATEST_MIGRATION }]));
 assert.equal(current.status, 200);
 assert.deepEqual((await current.json() as Record<string, unknown>).migrations, { latest: EXPECTED_LATEST_MIGRATION, expected: EXPECTED_LATEST_MIGRATION, upToDate: true });

 const lagging = await handleApiRequest(new Request("http://localhost/api/health/ready"), makeReady([{ filename: "0019_scoring_v2.sql" }]));
 assert.equal(lagging.status, 200);
 assert.deepEqual((await lagging.json() as Record<string, unknown>).migrations, { latest: "0019_scoring_v2.sql", expected: EXPECTED_LATEST_MIGRATION, upToDate: false });

 const unknown = await handleApiRequest(new Request("http://localhost/api/health/ready"), makeReady(new Error("no schema_migrations")));
 assert.equal(unknown.status, 200);
 const unknownMigrations = (await unknown.json() as { migrations: Record<string, unknown> }).migrations;
 assert.equal(unknownMigrations["error"], "migration_state_unavailable");
 // 未知 ≠ 落后：upToDate 必须为 null，避免目标环境误报“请先应用迁移”。
 assert.equal(unknownMigrations["upToDate"], null);
});

test("readiness reports unavailable when no database is configured", async () => { const r = await handleApiRequest(new Request("http://localhost/api/health/ready"), unauthenticated); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { status: "not_ready", reason: "database_unavailable_or_not_configured" }); });
test("overview metrics return full pipeline counts and require an authenticated actor", async () => {
 const protectedResponse = await handleApiRequest(new Request("http://localhost/api/overview/metrics"), unauthenticated);
 assert.equal(protectedResponse.status, 401);

 const d = makeDependencies();
 (d.repositories!.requirements as unknown as { getPipelineCounts: () => Promise<unknown> }).getPipelineCounts = async () => ({ total: 311, pullSynced: 311, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 0, suppressed: 5, priority: { P0: 0, P1: 0, P2: 0, P3: 0, scored: 0, legacy: 0, unscored: 0 } });
 await withAiKey(undefined, async () => {
   const response = await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d);
   assert.equal(response.status, 200);
   const body = await response.json() as { counts: unknown; ai: { status: string } };
   assert.deepEqual(body.counts, { total: 311, pullSynced: 311, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 0, suppressed: 5, priority: { P0: 0, P1: 0, P2: 0, P3: 0, scored: 0, legacy: 0, unscored: 0 }, priorityRule: null });
   // 没有密钥时状态是未配置，计数区块不受影响。
   assert.equal(body.ai.status, "unconfigured");
 });
});

test("overview AI block reports ok status, call counts and the latest call", async () => {
  const d = overviewDependencies();
  let analysisSince: string | null = null;
  let auditSince: string | null = null;
  (d.repositories!.analyses as unknown as Record<string, unknown>).aiCallStats = async (since: string) => { analysisSince = since; return { total: 12, today: 3, lastAt: "2026-10-08T00:00:00.000Z", lastStatus: "analyzed" }; };
  d.repositories!.audit.countByEntityType = async (query) => {
    auditSince = query.since;
    assert.equal(query.entityType, "intake");
    assert.deepEqual([...query.eventTypes], ["intake.draft_extracted", "intake.draft_failed"]);
    return { total: 5, today: 2, lastAt: "2026-10-07T23:00:00.000Z", lastEventType: "intake.draft_failed" };
  };
  await withAiKey("sk-test", async () => {
    const body = await (await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d)).json() as { ai: unknown };
    assert.deepEqual(body.ai, {
      status: "ok",
      statsAvailable: true,
      pausedUntil: null,
      pauseReason: null,
      analysis: { total: 12, today: 3 },
      chatIntake: { total: 5, today: 2 },
      lastCall: { at: "2026-10-08T00:00:00.000Z", kind: "analysis", result: "succeeded" },
    });
  });
  // 今日按 Asia/Shanghai 自然日：UTC 2026-10-08T00:00Z 是当地 08:00，日界是 UTC 2026-10-07T16:00Z。
  assert.equal(analysisSince, "2026-10-07T16:00:00.000Z");
  assert.equal(auditSince, "2026-10-07T16:00:00.000Z");

  // 当地 23:59 仍然算前一天：UTC 2026-10-07T15:59:59Z → 日界 UTC 2026-10-06T16:00Z。
  d.now = () => new Date("2026-10-07T15:59:59.000Z");
  await withAiKey("sk-test", async () => { await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d); });
  assert.equal(analysisSince, "2026-10-06T16:00:00.000Z");
});

test("overview AI block degrades to unavailable when the statistics aggregation fails while counts still render", async () => {
  const d = overviewDependencies();
  (d.repositories!.requirements as unknown as { getPipelineCounts: () => Promise<unknown> }).getPipelineCounts = async () => ({ total: 7 });
  (d.repositories!.analyses as unknown as Record<string, unknown>).aiCallStats = async () => { throw new Error("db down"); };
  await withAiKey("sk-test", async () => {
    const response = await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d);
    assert.equal(response.status, 200);
    const body = await response.json() as { counts: { total: number }; ai: unknown };
    assert.equal(body.counts.total, 7);
    assert.deepEqual(body.ai, {
      status: "unavailable",
      statsAvailable: false,
      pausedUntil: null,
      pauseReason: null,
      analysis: { total: 0, today: 0 },
      chatIntake: { total: 0, today: 0 },
      lastCall: { at: null, kind: null, result: null },
    });
  });
});

test("overview AI stats failure reports a sanitized error class instead of leaking the query", async () => {
  const d = overviewDependencies();
  const reports: Array<{ event: string; details: Record<string, unknown> }> = [];
  d.diagnostics = { error: (event, details) => { reports.push({ event, details: details as Record<string, unknown> }); } };
  const failure = Object.assign(new Error("SELECT title FROM requirements -- 需求正文"), { code: "42809" });
  (d.repositories!.analyses as unknown as Record<string, unknown>).aiCallStats = async () => { throw failure; };
  await withAiKey("sk-test", async () => {
    const response = await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d);
    assert.equal(response.status, 200);
    const body = await response.json() as { ai: { status: string; statsAvailable: boolean } };
    assert.equal(body.ai.status, "unavailable");
    assert.equal(body.ai.statsAvailable, false);
  });
  assert.deepEqual(reports, [{
    event: "overview_ai_stats_failed",
    details: { phase: "overview_ai_stats", stat: "analysis", errorType: "Error", databaseCode: "42809", causeType: "unknown" },
  }]);
  // 诊断只允许脱敏字段：原始异常消息（可能含 SQL 片段/正文）不得出现在日志里。
  assert.equal(JSON.stringify(reports).includes("需求正文"), false);
});

test("overview AI stats failure in the intake count is attributed to the intake stat", async () => {
  const d = overviewDependencies();
  const reports: string[] = [];
  d.diagnostics = { error: (event, details) => { reports.push(`${event}:${String((details as { stat?: string }).stat)}`); } };
  (d.repositories!.analyses as unknown as Record<string, unknown>).aiCallStats = async () => ({ total: 4, today: 1, lastAt: null, lastStatus: null });
  d.repositories!.audit.countByEntityType = async () => { throw Object.assign(new Error("op ANY/ALL (array) requires array on right side"), { code: "42809" }); };
  await withAiKey("sk-test", async () => {
    const response = await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d);
    assert.equal(response.status, 200);
    const body = await response.json() as { ai: { status: string; statsAvailable: boolean; analysis: { total: number; today: number } } };
    assert.equal(body.ai.status, "unavailable");
    assert.deepEqual(body.ai.analysis, { total: 0, today: 0 });
  });
  assert.deepEqual(reports, ["overview_ai_stats_failed:intake"]);
});

test("overview AI block reports paused state with the reason and recovery time", async () => {
  const d = overviewDependencies();
  d.repositories!.flags = { get: async () => ({ value: { until: "2026-10-08T01:00:00.000Z", reason: "ai_rate_limited" }, updatedAt: "2026-10-08T00:00:00.000Z" }), set: async () => undefined };
  await withAiKey("sk-test", async () => {
    const body = await (await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d)).json() as { ai: { status: string; pausedUntil: string | null; pauseReason: string | null } };
    assert.equal(body.ai.status, "paused");
    assert.equal(body.ai.pausedUntil, "2026-10-08T01:00:00.000Z");
    assert.equal(body.ai.pauseReason, "ai_rate_limited");
  });
});

test("overview AI block prefers unconfigured over a paused flag", async () => {
  const d = overviewDependencies();
  d.repositories!.flags = { get: async () => ({ value: { until: "2026-10-08T01:00:00.000Z", reason: "ai_rate_limited" }, updatedAt: "2026-10-08T00:00:00.000Z" }), set: async () => undefined };
  await withAiKey(undefined, async () => {
    const body = await (await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d)).json() as { ai: { status: string; pausedUntil: string | null; pauseReason: string | null } };
    assert.equal(body.ai.status, "unconfigured");
    assert.equal(body.ai.pausedUntil, null);
    assert.equal(body.ai.pauseReason, null);
  });
});

test("overview AI block takes the newer intake call and degrades to zeros when stats are unavailable", async () => {
  const bare = overviewDependencies();
  await withAiKey("sk-test", async () => {
    const body = await (await handleApiRequest(new Request("http://localhost/api/overview/metrics"), bare)).json() as { ai: Record<string, unknown> };
    assert.deepEqual(body.ai.analysis, { total: 0, today: 0 });
    assert.deepEqual(body.ai.chatIntake, { total: 0, today: 0 });
    assert.deepEqual(body.ai.lastCall, { at: null, kind: null, result: null });
  });

  const d = overviewDependencies();
  (d.repositories!.analyses as unknown as Record<string, unknown>).aiCallStats = async () => ({ total: 1, today: 0, lastAt: "2026-10-07T10:00:00.000Z", lastStatus: "failed_retryable" });
  d.repositories!.audit.countByEntityType = async () => ({ total: 2, today: 1, lastAt: "2026-10-08T00:30:00.000Z", lastEventType: "intake.draft_extracted" });
  await withAiKey("sk-test", async () => {
    const body = await (await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d)).json() as { ai: { lastCall: unknown } };
    assert.deepEqual(body.ai.lastCall, { at: "2026-10-08T00:30:00.000Z", kind: "chat_intake", result: "succeeded" });
  });
});

test("overview AI block reports a running analysis with a null result at its start time", async () => {
  const d = overviewDependencies();
  (d.repositories!.analyses as unknown as Record<string, unknown>).aiCallStats = async () => ({ total: 3, today: 1, lastAt: "2026-10-08T02:00:00.000Z", lastStatus: "running" });
  await withAiKey("sk-test", async () => {
    const body = await (await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d)).json() as { ai: { lastCall: unknown } };
    // running 不在终态映射表里：at 取 started_at，result 必须是 null，不能猜成成功/失败。
    assert.deepEqual(body.ai.lastCall, { at: "2026-10-08T02:00:00.000Z", kind: "analysis", result: null });
  });
});

test("lists only user-maintained source settings after injected identity authentication", async () => { const r = await handleApiRequest(new Request("http://localhost/api/sources"), makeDependencies()); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { items: [{ id: source.id, pool: "product", projectName: "Project", enabled: true, executorAllowlist: [], schedule: { enabled: false, weekday: null, weekdays: null, time: null, timezone: null } }] }); });
test("rejects protected routes without an identity provider", async () => { const r = await handleApiRequest(new Request("http://localhost/api/sources"), unauthenticated); assert.equal(r.status, 401); });
test("base links expose both pools without the record parameter and stay null when unconfigured", async () => {
  const previous = {
    product: process.env.RQSYS_BASE_RECORD_URL_TEMPLATE,
    group: process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE,
  };
  try {
    process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = "https://aimagene.feishu.cn/base/GRnEboCIga7Omas8RwgcDmmgnib?table=tbl6Gfi0KJ2a1llK&record={recordId}";
    process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE = "https://aimagene.feishu.cn/base/HZ6NbvXKJa0o5Qs4hgQcSoirnde?table=tblNVlrwYOPU5kuz&record={recordId}";
    const configured = await handleApiRequest(new Request("http://localhost/api/base-links"), makeDependencies());
    assert.equal(configured.status, 200);
    assert.deepEqual(await configured.json(), {
      product: { url: "https://aimagene.feishu.cn/base/GRnEboCIga7Omas8RwgcDmmgnib?table=tbl6Gfi0KJ2a1llK" },
      group: { url: "https://aimagene.feishu.cn/base/HZ6NbvXKJa0o5Qs4hgQcSoirnde?table=tblNVlrwYOPU5kuz" },
    });
    delete process.env.RQSYS_BASE_RECORD_URL_TEMPLATE;
    delete process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE;
    const unconfigured = await handleApiRequest(new Request("http://localhost/api/base-links"), makeDependencies());
    assert.equal(unconfigured.status, 200);
    assert.deepEqual(await unconfigured.json(), { product: { url: null }, group: { url: null } });
  } finally {
    if (previous.product === undefined) delete process.env.RQSYS_BASE_RECORD_URL_TEMPLATE;
    else process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = previous.product;
    if (previous.group === undefined) delete process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE;
    else process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE = previous.group;
  }
});

test("updates source settings by project name while keeping server-owned IDs and metadata", async () => { const d = makeDependencies(); const r = await handleApiRequest(new Request(`http://localhost/api/sources/${source.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName: "Project", enabled: false, schedule: { enabled: true, weekday: 1, time: "09:30", timezone: "Asia/Shanghai" } }) }), d); assert.equal(r.status, 200); const body = await r.json() as Record<string, unknown>; assert.deepEqual(body, { id: source.id, pool: "product", projectName: "Project", enabled: false, executorAllowlist: [], schedule: { enabled: true, weekday: 1, weekdays: [1], time: "09:30", timezone: "Asia/Shanghai" } }); assert.equal(source.externalProjectId, "p1"); assert.equal(source.requirementTypeId, "type1"); assert.deepEqual(source.fieldMap, { title: "name" }); });
test("updates source schedule with a multi-weekday list", async () => {
  const d = makeDependencies();
  const r = await handleApiRequest(new Request(`http://localhost/api/sources/${source.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName: "Project", enabled: false, schedule: { enabled: true, weekday: 1, weekdays: [1, 3, 5], time: "09:30", timezone: "Asia/Shanghai" } }) }), d);
  assert.equal(r.status, 200);
  const body = await r.json() as { schedule: { weekdays: number[]; weekday: number } };
  assert.deepEqual(body.schedule.weekdays, [1, 3, 5]);
  assert.equal(body.schedule.weekday, 1);
});
test("saves a manual score after server-side recomputation", async () => {
  const d = makeDependencies();
  let saved: Record<string, unknown> | null = null;
  d.repositories!.priorityRules = { getPublished: async () => ({ id: "rule-v2", version: 2, status: "published", rules: { formulaType: "umsc_weighted_v2", thresholds: { p0: 45, p1: 25, p2: 10 } }, validationEvidence: [{}], createdBy: null, createdAt: "2026-01-01T00:00:00.000Z", publishedAt: "2026-01-01T00:00:00.000Z" }) } as never;
  d.repositories!.scoring = {
    current: async () => null,
    saveManual: async (input: Record<string, unknown>) => { saved = input; return { outcome: "saved", version: { version: 1 } }; },
    aiSuggestion: async () => null,
    list: async () => [],
    createAi: async () => { throw new Error("unused"); },
    applyAi: async () => { throw new Error("unused"); },
  } as never;
  const response = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/scoring`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 0, reason: "人工复核", inputs: { user: { pain: 3, frequency: 4 }, market: { sellingPoint: 1, competitor: 1 }, strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 3, technicalRisk: 2, resource: 2 } }, alpha: 0.8 }),
  }), d);
  assert.equal(response.status, 200);
  assert.ok(saved);
  assert.equal((saved as { score: number }).score, 6.4);
  assert.equal((saved as { priority: string }).priority, "P3");
  assert.equal((saved as { actorId: string }).actorId, "actor-1");
  assert.equal((saved as { auditEvent: { eventType: string } }).auditEvent.eventType, "scoring.updated");
});

test("applies an AI score suggestion through a versioned confirmation", async () => {
  const d = makeDependencies();
  let applied: Record<string, unknown> | null = null;
  d.repositories!.scoring = {
    current: async () => ({ version: 1, status: "current" }),
    saveManual: async () => ({ outcome: "version_conflict", currentVersion: 1 }),
    aiSuggestion: async () => ({ version: 2 }),
    list: async () => [],
    createAi: async () => { throw new Error("unused"); },
    applyAi: async (input: Record<string, unknown>) => { applied = input; return { outcome: "saved", version: { version: 2 } }; },
  } as never;
  const response = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/scoring/apply-ai`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 1, aiVersion: 2, reason: "采用AI" }),
  }), d);
  assert.equal(response.status, 200);
  assert.ok(applied);
  assert.equal((applied as { aiVersion: number }).aiVersion, 2);
  assert.equal((applied as { actorId: string }).actorId, "actor-1");
  assert.equal((applied as { auditEvent: { eventType: string } }).auditEvent.eventType, "scoring.ai_applied");
});

test("any authenticated Feishu actor can update source settings without an application role", async () => { const d = makeDependencies({ id: "logged-in-user" }); const r = await handleApiRequest(new Request(`http://localhost/api/sources/${source.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName: "Project", enabled: false, schedule: { enabled: true, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" } }) }), d); assert.equal(r.status, 200); });
test("queues a sync once and returns the batch for an idempotent repeat", async () => { const d = makeDependencies(); const req = () => new Request("http://localhost/api/sync/run", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "request-key-0001" }, body: JSON.stringify({ sourceId: source.id }) }); const first = await handleApiRequest(req(), d); assert.equal(first.status, 202); assert.deepEqual(await first.json(), { batchId: "batch-1", status: "running" }); const dup = await handleApiRequest(req(), d); assert.equal(dup.status, 202); assert.deepEqual(await dup.json(), { batchId: "batch-1", status: "running" }); });
test("queues a source-only sync mode separately and records the mode in the audit", async () => {
 const d = makeDependencies();
 let queued: Record<string, unknown> | null = null;
 let createdKey: string | null = null;
 let auditDetails: Record<string, unknown> | null = null;
 d.repositories!.batches.create = async (input) => {
  createdKey = input.idempotencyKey;
  return { ...batch, ...input, id: "batch-source-only", status: "running" };
 };
 d.repositories!.jobs.enqueue = async (input) => {
  queued = input as unknown as Record<string, unknown>;
  return { ...input, id: "sync-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt };
 };
 d.repositories!.audit.append = async (event) => { auditDetails = event.safeDetails as Record<string, unknown>; };
 const response = await handleApiRequest(new Request("http://localhost/api/sync/run", {
  method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "source-only-0001" },
  body: JSON.stringify({ sourceId: source.id, mode: "source_only" }),
 }), d);
 assert.equal(response.status, 202);
 assert.match(createdKey ?? "", /^source_only:[a-f0-9]{64}$/);
 assert.ok((createdKey ?? "").length <= 128);
 assert.deepEqual((queued as Record<string, unknown> | null)?.payload, { batchId: "batch-source-only", sourceId: source.id, triggerType: "manual", actorId: "actor-1", mode: "source_only" });
 assert.deepEqual(auditDetails, { trigger: "manual", mode: "source_only" });
});
test("scopes the same idempotency token to its sync mode", async () => {
 const keys: string[] = [];
 for (const mode of ["full_pipeline", "source_only"] as const) {
  const d = makeDependencies();
  d.repositories!.batches.create = async (input) => { keys.push(input.idempotencyKey); return { ...batch, ...input, id: `batch-${mode}`, status: "succeeded" }; };
  d.repositories!.jobs.enqueue = async (input) => ({ ...input, id: `job-${mode}`, status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt });
  d.repositories!.audit.append = async () => {};
  const response = await handleApiRequest(new Request("http://localhost/api/sync/run", {
   method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "same-token-123" },
   body: JSON.stringify({ sourceId: source.id, mode }),
  }), d);
  assert.equal(response.status, 202);
 }
 assert.equal(keys.length, 2);
 assert.notEqual(keys[0], keys[1]);
 assert.ok(keys.every((key) => /^(full_pipeline|source_only):[a-f0-9]{64}$/.test(key)));
});
test("queues a Base push retry without an undocumented project ID dependency", async () => {
  const d = makeDependencies();
  let queued: Record<string, unknown> | null = null;
  let auditType: string | null = null;
  d.repositories!.jobs.enqueue = async (input) => { queued = input as unknown as Record<string, unknown>; return { ...input, id: "push-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt }; };
  d.repositories!.audit.append = async (event) => { auditType = event.eventType; };
  const response = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/push`, { method: "POST", headers: { "Idempotency-Key": "retry-key-123" } }), d);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { requirementId: requirement.id, status: "queued" });
  assert.equal((queued as Record<string, unknown> | null)?.jobType, "base_push");
  assert.deepEqual((queued as Record<string, unknown> | null)?.payload, { requirementId: requirement.id, sourceVersion: 1, analysisVersion: 2, idempotencyKey: `base-push:${requirement.id}:sv1:av2:retry:retry-key-123`, actorId: "actor-1" });
  assert.equal(auditType, "base.push.retry_requested");
});
test("queues a retry for a pending analysis when its current queue job is missing", async () => {
  const d = makeDependencies();
  const queued: Record<string, unknown>[] = [];
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "pending" as const } } as RequirementRecord : null;
  d.repositories!.jobs.enqueue = async (input) => {
    queued.push(input as unknown as Record<string, unknown>);
    return { ...input, id: "analysis-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt };
  };
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { requirementId: requirement.id, status: "queued" });
  assert.equal(queued.length, 1);
  // 2026-11-23：人工重新分析缺省 force——真正的重跑必须带 force 键与 payload 标记。
  assert.equal(queued[0]?.dedupeKey, `analysis:${requirement.id}:sv1:after2:force`);
  assert.equal((queued[0]?.payload as Record<string, unknown>).force, true);
});
test("audits an analysis retry request when an existing queued job is reused", async () => {
  const d = makeDependencies();
  const auditEvents: Record<string, unknown>[] = [];
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id
    ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "pending" as const } } as RequirementRecord
    : null;
  d.repositories!.jobs.findByDedupeKey = async (key) => key === `analysis:${requirement.id}:sv1:after2:force`
    ? { id: "analysis-job", jobType: "analysis", dedupeKey: key, payload: {}, status: "queued", attemptCount: 0, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" }
    : null;
  d.repositories!.audit.append = async (event) => { auditEvents.push(event as unknown as Record<string, unknown>); };
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { requirementId: requirement.id, status: "queued" });
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.eventType, "analysis.retry_requested");
  assert.equal(auditEvents[0]?.actorId, "actor-1");
  assert.deepEqual(auditEvents[0]?.safeDetails, { sourceVersion: 1, priorAnalysisVersion: 2, analysisStatus: "reused_existing_job", force: true });
});
test("lists and retrieves batches with items", async () => { const d = makeDependencies(); assert.equal((await handleApiRequest(new Request("http://localhost/api/batches?limit=10"), d)).status, 200); const r = await handleApiRequest(new Request(`http://localhost/api/batches/${batch.id}`), d); assert.equal(r.status, 200); assert.deepEqual((await r.json() as { items: SyncItemRecord[] }).items, [item]); });
test("failed item retry is idempotent across repeated requests", async () => {
  const d = makeDependencies();
  let created = 0, enqueued = 0, audits = 0;
  let enqueuedPayload: Record<string, unknown> | null = null;
  let createdRetryKey: string | null = null;
  let retryBatch: SyncBatchRecord | null = null;
  d.repositories!.items.get = async () => ({ ...item, status: "failed" });
  d.repositories!.batches.create = async (params) => { created += 1; createdRetryKey = params.idempotencyKey; retryBatch = { ...batch, ...params, id: "retry-batch", status: "running" }; return retryBatch; };
  const retryKey = `item-retry:source_only:${createHashForTest("sha256").update(`${item.id}:retry-key-123`).digest("hex")}`;
  d.repositories!.batches.findByIdempotencyKey = async (_sourceId, key) => key === retryKey ? retryBatch : null;
  d.repositories!.batches.get = async () => ({ ...batch, idempotencyKey: "source_only:" + "a".repeat(64) });
  d.repositories!.jobs.enqueue = async (params) => { enqueued += 1; enqueuedPayload = params.payload; return { ...params, id: "retry-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: params.availableAt, updatedAt: params.availableAt }; };
  d.repositories!.jobs.findByDedupeKey = async (key) => {
    const queuedJob = { id: "retry-job", jobType: "sync" as const, dedupeKey: key, payload: { mode: "source_only" }, status: "queued" as const, attemptCount: 0, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
    if (key === `sync:${batch.sourceConfigId}:${batch.idempotencyKey}`) return queuedJob;
    return enqueued ? { ...queuedJob, dedupeKey: "sync:retry-batch", payload: enqueuedPayload ?? {} } : null;
  };
  d.repositories!.audit.append = async () => { audits += 1; };
  const request = () => new Request(`http://localhost/api/items/${item.id}/retry`, { method: "POST", headers: { "Idempotency-Key": "retry-key-123" } });
  const first = await handleApiRequest(request(), d);
  const second = await handleApiRequest(request(), d);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(created, 1);
  assert.equal(enqueued, 1);
  assert.equal(audits, 1);
  assert.equal((enqueuedPayload as unknown as Record<string, unknown> | null)?.mode, "source_only");
  assert.equal(createdRetryKey, retryKey);
});
test("batch and requirement list routes pass time, batch and stable cursor filters to repositories", async () => {
 const d = makeDependencies(); let batchQuery: unknown; let requirementQuery: unknown;
 d.repositories!.batches.list = async (query) => { batchQuery = query; return { items: [], nextCursor: null }; };
 d.repositories!.requirements!.search = async (query) => { requirementQuery = query; return { items: [], nextCursor: null }; };
 const batchCursor = { startedAt: "2026-01-01T00:00:00.000Z", id: batch.id };
 const batchResponse = await handleApiRequest(new Request(`http://localhost/api/batches?since=2026-01-01T00%3A00%3A00Z&until=2026-01-02T00%3A00%3A00Z&cursor=${encodeURIComponent(encodeBatchCursor(batchCursor))}`), d);
 assert.equal(batchResponse.status, 200);
 assert.deepEqual(batchQuery, { limit: 25, pool: "product", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", cursor: batchCursor });
 const requirementResponse = await handleApiRequest(new Request(`http://localhost/api/requirements?batchId=${batch.id}&pullState=synced&since=2026-01-01T00%3A00%3A00Z&until=2026-01-02T00%3A00%3A00Z`), d);
 assert.equal(requirementResponse.status, 200);
 assert.deepEqual(requirementQuery, { batchId: batch.id, pool: "product", pullState: "synced", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", limit: 25, deleted: false });
});
test("requirement list and export forward the source filter to repositories", async () => {
 const d = makeDependencies(); const queries: unknown[] = [];
 d.repositories!.requirements!.search = async (query) => { queries.push(query); return { items: [], nextCursor: null }; };
 const listResponse = await handleApiRequest(new Request("http://localhost/api/requirements?source=chat_paste"), d);
 assert.equal(listResponse.status, 200);
 const exportResponse = await handleApiRequest(new Request("http://localhost/api/requirements/export?source=web_manual"), d);
 assert.equal(exportResponse.status, 200);
 assert.deepEqual(queries, [{ source: "chat_paste", pool: "product", limit: 25, deleted: false }, { source: "web_manual", pool: "product", limit: 5001 }]);
 const invalid = await handleApiRequest(new Request("http://localhost/api/requirements?source=base_form"), d);
 assert.equal(invalid.status, 200);
 assert.deepEqual(queries[2], { source: "base_form", pool: "product", limit: 25, deleted: false });
 const rejected = await handleApiRequest(new Request("http://localhost/api/requirements?source=unknown"), d);
 assert.equal(rejected.status, 400);
});

test("requirement source counts return the five exclusive buckets and degrade when unavailable", async () => {
  const d = makeDependencies();
  const counts = { teambition: 10, web_manual: 2, base_form: 1, chat_paste: 3, all: 16 };
  d.repositories!.requirements!.sourceCounts = async () => counts;
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/source-counts"), d);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { counts });
  // 统计失败或仓储未实现时只让 Tab 计数降级，不能影响需求列表本身。
  d.repositories!.requirements!.sourceCounts = async () => { throw new Error("db down"); };
  assert.equal((await handleApiRequest(new Request("http://localhost/api/requirements/source-counts"), d)).status, 503);
  delete d.repositories!.requirements!.sourceCounts;
  assert.equal((await handleApiRequest(new Request("http://localhost/api/requirements/source-counts"), d)).status, 503);
});

test("requirement assessments list history, create on demand and map provider failures", async () => {
  const d = makeDependencies();
  const record = {
    id: "assessment-1", requirementId: requirement.id, version: 1, status: "succeeded" as const,
    promptVersion: "rq-assessment-v1", model: "m", inputs: { background: "补充" }, output: { verdict: "advance" }, errorCode: null, errorDetail: null,
    createdBy: "actor-1", createdAt: "2026-11-20T00:00:00.000Z", completedAt: "2026-11-20T00:00:10.000Z",
  };
  const runs: unknown[] = [];
  const expirations: string[][] = [];
  d.repositories!.assessments = {
    create: async () => ({ outcome: "created" as const, record }),
    complete: async () => record,
    fail: async () => null,
    list: async () => [record],
    expireStaleRunning: async (id: string, before: string, at: string) => { expirations.push([id, before, at]); return 0; },
  };
  d.assessments = { run: async (input) => { runs.push(input); return record; } };
  const list = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`), d);
  assert.equal(list.status, 200);
  const { createdBy: _createdBy, ...dto } = record;
  assert.deepEqual(await list.json(), { items: [dto] });
  assert.deepEqual(expirations, [[requirement.id, "2026-10-07T23:58:00.000Z", "2026-10-08T00:00:00.000Z"]]);
  const created = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ background: "补充", goal: "", extra: 1 }),
  }), d);
  assert.equal(created.status, 400, "strict schema rejects unknown keys");
  const ok = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ background: "补充背景", scenario: "通勤" }),
  }), d);
  assert.equal(ok.status, 201);
  assert.deepEqual(await ok.json(), dto);
  // 评估与主分析同口径：来源花名册（source.ownerNames）并入 PII 掩码名单。
  assert.deepEqual(runs, [{ requirement, inputs: { background: "补充背景", scenario: "通勤" }, actorId: "actor-1", analysis: analysisRun, piiMarkers: ["Lee"] }]);
  const missing = await handleApiRequest(new Request("http://localhost/api/requirements/77777777-7777-4777-8777-777777777777/assessments"), d);
  assert.equal(missing.status, 404);
  const noRunner = makeDependencies();
  const unavailable = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }), noRunner);
  assert.equal(unavailable.status, 503);
  const limited = { ...d, assessments: { run: async () => { throw Object.assign(new Error("busy"), { code: "rate_limited" }); } } };
  const limitedResponse = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }), limited);
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("retry-after"), "60");
  const timeout = { ...d, assessments: { run: async () => { throw Object.assign(new Error("slow"), { code: "timeout" }); } } };
  const timeoutResponse = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }), timeout);
  assert.equal(timeoutResponse.status, 503);
  // 同需求未超时的 running 版本：409 ASSESSMENT_IN_PROGRESS，不产生新版本。
  const inProgress = { ...d, assessments: { run: async () => { throw Object.assign(new Error("running"), { code: "assessment_in_progress" }); } } };
  const inProgressResponse = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }), inProgress);
  assert.equal(inProgressResponse.status, 409);
  assert.equal((await inProgressResponse.json() as { error: { code: string } }).error.code, "ASSESSMENT_IN_PROGRESS");
  // 契约失败只落字段路径（字段名），不落模型内容。
  const logged: Array<{ event: string; details: Record<string, unknown> }> = [];
  const contract = {
    ...d,
    diagnostics: { error: (event: string, details: Record<string, unknown>) => { logged.push({ event, details }); } },
    assessments: { run: async () => { throw new AssessmentContractError(["background", "feasibility.cost"]); } },
  };
  const contractResponse = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }), contract);
  assert.equal(contractResponse.status, 503);
  assert.deepEqual(logged, [{ event: "assessment_failed", details: { errorClass: "analysis_failure", fields: "background,feasibility.cost" } }]);
  // PRD 输入上限：背景 2,000 / 目标 1,000 / 场景 2,000。
  const tooLong = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal: "x".repeat(1001) }),
  }), d);
  assert.equal(tooLong.status, 400);
});

test("V02-T02 manual requirements read back with source fields and no TB link fallback", async () => {
  const d = makeDependencies();
  const manual = { ...requirement, sourceType: "web_manual", sourceChannel: "售后", sourceConfigId: null, teambitionRequirementId: null, pipeline: { ...requirement.pipeline, pull: "collected" as const }, sourceUrl: null } as unknown as RequirementRecord;
  d.repositories!.requirements!.get = async () => manual;
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/66666666-6666-4666-8666-666666666666"), d);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.sourceType, "web_manual");
  assert.equal(body.sourceChannel, "售后");
  assert.equal(body.sourceRequirementId, null);
  // 手工需求不拼接 TB 地址兜底（AC05）
  assert.equal(body.sourceUrl, null);
  assert.equal((body.pipeline as Record<string, string>).pull, "collected");
  // F1：详情 DTO 必须返回服务端创建时间（四种来源统一），前端不再退回 source.createdAt。
  assert.equal(body.createdAt, requirement.createdAt);
  assert.equal(body.updatedAt, requirement.updatedAt);
});

test("empty requirement search returns an empty page without querying mappings with an empty source id", async () => {
 const d = makeDependencies();
 let mappingQueries = 0;
 d.repositories!.people = {
  listActive: async (sourceConfigId: string) => { mappingQueries += 1; assert.notEqual(sourceConfigId, ""); return []; },
 } as never;
 const response = await handleApiRequest(new Request("http://localhost/api/requirements?q=no-such-requirement"), d);
 assert.equal(response.status, 200);
 assert.deepEqual(await response.json(), { items: [], nextCursor: null });
 assert.equal(mappingQueries, 0);
});
test("audit list forwards an event-type filter and rejects malformed event types", async () => {
 const d = makeDependencies();
 const seen: Array<Record<string, unknown>> = [];
 d.repositories!.audit.search = async (query) => { seen.push(query as unknown as Record<string, unknown>); return []; };
 const ok = await handleApiRequest(new Request("http://localhost/api/audit?eventType=analysis.retry_requested&entityId=foo&limit=5"), d);
 assert.equal(ok.status, 200);
 assert.deepEqual(seen[0], { limit: 5, entityId: "foo", eventType: "analysis.retry_requested" });
 const none = await handleApiRequest(new Request("http://localhost/api/audit"), d);
 assert.equal(none.status, 200);
 assert.equal("eventType" in seen[1]!, false);
 for (const bad of ["Analysis.Retry", "analysis..retry", "drop table", "a".repeat(101)]) {
  const r = await handleApiRequest(new Request(`http://localhost/api/audit?eventType=${encodeURIComponent(bad)}`), d);
  assert.equal(r.status, 400, bad);
 }
 assert.equal(seen.length, 2);
});
test("exports the filtered requirement pool as CSV with escaping and a 5000-row cap", async () => {
 const base = { platformRequirementId: "RQ-000001", teambitionRequirementId: "tb-1", title: '=HYPERLINK("x,y")', executorName: "张三", currentScorePriority: "P1", priorityOverride: null, processingState: "active", pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" }, sourceType: "teambition", sourceVersion: 2, baseRecordId: "rec-1", sourceMissingSince: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" };
 const seen: Array<Record<string, unknown>> = [];
 const d = makeDependencies();
 const requirementsRepo = d.repositories!.requirements!;
 requirementsRepo.search = (async (query: Parameters<typeof requirementsRepo.search>[0]) => {
  seen.push(query as unknown as Record<string, unknown>);
  const rows = Array.from({ length: 2 }, () => ({ ...base }));
  return { items: rows, nextCursor: null };
 }) as unknown as typeof requirementsRepo.search;
 const response = await handleApiRequest(new Request("http://localhost/api/requirements/export?q=报表&priority=P1"), d);
 assert.equal(response.status, 200);
 assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
 assert.match(response.headers.get("content-disposition") ?? "", /rq-sys-requirements-2026-10-08\.csv/);
 // TextDecoder 默认会吞掉 BOM；用原始字节确认 Excel 兼容的 UTF-8 BOM。
 const bytes = new Uint8Array(await response.arrayBuffer());
 assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
 const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
 assert.match(text, /平台ID,TB需求ID,标题/);
 assert.match(text, /'"'=HYPERLINK\(""x,y""\)"|"'=HYPERLINK/);
 assert.equal(seen[0]?.q, "报表");
 assert.equal(seen[0]?.priority, "P1");
 assert.equal(response.headers.get("x-rq-truncated"), null);

 const big = makeDependencies();
 const bigRepo = big.repositories!.requirements!;
 bigRepo.search = (async () => ({ items: Array.from({ length: 5001 }, () => ({ ...base })), nextCursor: null })) as unknown as typeof bigRepo.search;
 const truncated = await handleApiRequest(new Request("http://localhost/api/requirements/export"), big);
 assert.equal(truncated.status, 200);
 assert.equal(truncated.headers.get("x-rq-truncated"), "true");
 assert.equal((await truncated.text()).split("\r\n").length, 5001);

 assert.equal((await handleApiRequest(new Request("http://localhost/api/requirements/export"), unauthenticated)).status, 401);
});

test("ops gate status evaluates automatic checks and records manual evidence", async () => {
 const d = makeDependencies();
 const stored = new Map<string, Record<string, unknown>>();
 d.repositories!.flags = { get: async (name: string) => stored.has(name) ? { value: stored.get(name)!, updatedAt: "2026-10-08T00:00:00.000Z" } : null, set: async (name: string, value: Record<string, unknown>) => { stored.set(name, value); } } as never;
 d.repositories!.priorityRules = { getPublished: async () => ({ version: 2, rules: { formulaType: "umsc_weighted_v2" } }) } as never;
 const requirements = d.repositories!.requirements as unknown as { getPipelineCounts: () => Promise<unknown>; search: () => Promise<unknown> };
 requirements.getPipelineCounts = async () => ({ pushPushed: 279, total: 284 });
 requirements.search = async () => ({ items: [], nextCursor: null });
 const previous = { ...process.env };
 process.env.BASE_APP_TOKEN = "app"; process.env.BASE_TABLE_ID = "tbl"; process.env.RQSYS_ALERT_WEBHOOK_URL = "https://hook";
 try {
  const response = await handleApiRequest(new Request("http://localhost/api/ops/gates"), d);
  assert.equal(response.status, 200);
  const body = await response.json() as { ready: boolean; gates: Array<{ id: string; status: string; auto: { status: string } }> };
  assert.equal(body.gates.length, 8);
  assert.equal(body.gates.find((gate) => gate.id === "G1")?.auto.status, "pass");
  assert.equal(body.gates.find((gate) => gate.id === "G2")?.status, "fail");

  const confirmed = await handleApiRequest(new Request("http://localhost/api/ops/gates/G1", {
   method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true, evidence: "通知截图 2026-11-12" }),
  }), d);
  assert.equal(confirmed.status, 200);
  assert.equal((stored.get("gate:G1") as Record<string, unknown>)["confirmed"], true);

  assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/gates/G1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) }), d)).status, 400);
  assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/gates/G3", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true, evidence: "x" }) }), d)).status, 404);
  assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/gates"), unauthenticated)).status, 401);
 } finally {
  for (const key of ["BASE_APP_TOKEN", "BASE_TABLE_ID", "RQSYS_ALERT_WEBHOOK_URL"]) {
   if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
 }
});

test("ops metrics default to a 7-day window and validate the range", async () => {
 const d = makeDependencies();
 const seen: Array<{ days: number; now: string }> = [];
 d.repositories!.ops = { getOpsMetrics: async (input) => { seen.push(input); return { window: { days: input.days, since: input.now } } as never; } };
 const ok = await handleApiRequest(new Request("http://localhost/api/ops/metrics"), d);
 assert.equal(ok.status, 200);
 assert.equal(seen[0]?.days, 7);
 const custom = await handleApiRequest(new Request("http://localhost/api/ops/metrics?days=30"), d);
 assert.equal(custom.status, 200);
 assert.equal(seen[1]?.days, 30);
 assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/metrics?days=0"), d)).status, 400);
 assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/metrics?days=91"), d)).status, 400);
 assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/metrics"), unauthenticated)).status, 401);
});

test("ops metrics expose the base form sync state without leaking the table id", async () => {
  const d = makeDependencies();
  d.repositories!.ops = { getOpsMetrics: async (input) => ({ window: { days: input.days, since: input.now } } as never) };
  d.repositories!.flags = {
    get: async (name) => name === "base_form_sync_state"
      ? { value: { tableId: "tbl_internal", lastRunAt: "2026-11-19T02:00:00.000Z", pages: 1, scanned: 3, skipped: 0, created: 2, recorded: 0, rejected: 1, writeBackFailed: 0, readFailed: false, lastError: null }, updatedAt: "2026-11-19T02:00:00.000Z" }
      : null,
    set: async () => undefined,
  };
  const response = await handleApiRequest(new Request("http://localhost/api/ops/metrics"), d);
  assert.equal(response.status, 200);
  const body = await response.json() as { metrics: { baseForm: Record<string, unknown> } };
  assert.deepEqual(body.metrics.baseForm, { lastRunAt: "2026-11-19T02:00:00.000Z", pages: 1, scanned: 3, skipped: 0, created: 2, recorded: 0, rejected: 1, writeBackFailed: 0, readFailed: false, lastError: null });
  // 表 ID 是内部标识，不回传；其它运营指标不受影响。
  assert.equal(JSON.stringify(body.metrics.baseForm).includes("tbl_internal"), false);

  const withoutFlags = makeDependencies();
  withoutFlags.repositories!.ops = { getOpsMetrics: async (input) => ({ window: { days: input.days, since: input.now } } as never) };
  const degraded = await (await handleApiRequest(new Request("http://localhost/api/ops/metrics"), withoutFlags)).json() as { metrics: { baseForm: unknown } };
  assert.equal(degraded.metrics.baseForm, null);
});

test("ops metrics expose the configured base form share url read-only and reject invalid values", async () => {
  const previous = process.env.BASE_FORM_SHARE_URL;
  const d = makeDependencies();
  d.repositories!.ops = { getOpsMetrics: async (input) => ({ window: { days: input.days, since: input.now } } as never) };
  d.repositories!.flags = {
    get: async () => ({ value: { tableId: "tbl_internal", lastRunAt: "2026-11-20T09:00:00.000Z", scanned: 0, created: 0, rejected: 0, readFailed: false, lastError: null }, updatedAt: "2026-11-20T09:00:00.000Z" }),
    set: async () => undefined,
  };
  const read = async () => {
    const response = await handleApiRequest(new Request("http://localhost/api/ops/metrics"), d);
    return (await response.json() as { metrics: { baseForm: Record<string, unknown> } }).metrics.baseForm;
  };
  try {
    process.env.BASE_FORM_SHARE_URL = "https://aimagene.feishu.cn/share/base/shrcn-test";
    const configured = await read();
    assert.equal(configured.shareUrl, "https://aimagene.feishu.cn/share/base/shrcn-test");
    assert.equal(JSON.stringify(configured).includes("tbl_internal"), false);

    // lastError 只保留类别摘要：rec/tbl ID 必须掩码。
    const withError = makeDependencies();
    withError.repositories!.ops = d.repositories!.ops;
    withError.repositories!.flags = {
      get: async () => ({ value: { lastRunAt: "2026-11-20T09:00:00.000Z", scanned: 0, created: 0, rejected: 0, readFailed: false, lastError: "record reczz28brz00SUAx missing in tbl6Gfi0KJ2a1llK" }, updatedAt: "2026-11-20T09:00:00.000Z" }),
      set: async () => undefined,
    };
    const errored = await (await handleApiRequest(new Request("http://localhost/api/ops/metrics"), withError)).json() as { metrics: { baseForm: Record<string, unknown> } };
    assert.match(String(errored.metrics.baseForm.lastError), /rec…/);
    assert.match(String(errored.metrics.baseForm.lastError), /tbl…/);
    assert.equal(String(errored.metrics.baseForm.lastError).includes("reczz28"), false);
    assert.equal(String(errored.metrics.baseForm.lastError).includes("tbl6Gfi"), false);

    // 只配了 shareUrl、没有同步状态：仍返回 baseForm，统计按 0/null。
    const withoutState = makeDependencies();
    withoutState.repositories!.ops = d.repositories!.ops;
    const fallback = await (await handleApiRequest(new Request("http://localhost/api/ops/metrics"), withoutState)).json() as { metrics: { baseForm: Record<string, unknown> } };
    assert.equal(fallback.metrics.baseForm.shareUrl, "https://aimagene.feishu.cn/share/base/shrcn-test");
    assert.equal(fallback.metrics.baseForm.lastRunAt, null);
    assert.equal(fallback.metrics.baseForm.scanned, 0);

    process.env.BASE_FORM_SHARE_URL = "javascript:alert(1)";
    assert.equal((await read()).shareUrl, undefined, "非 http(s) 地址不返回");

    delete process.env.BASE_FORM_SHARE_URL;
    assert.equal((await read()).shareUrl, undefined, "未配置不返回");
  } finally {
    if (previous === undefined) delete process.env.BASE_FORM_SHARE_URL;
    else process.env.BASE_FORM_SHARE_URL = previous;
  }
});

test("ops job view lists failed and stuck jobs without leaking payload", async () => {
 const base = { jobType: "base_push", dedupeKey: "base-push:req-1", payload: { requirementId: "req-1", actorId: "actor-1", substantiveHash: "secret-ish" }, attemptCount: 5, maxAttempts: 5, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: null, lastErrorCode: "BASE_TIMEOUT", lastErrorSummary: "upstream timed out", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T01:00:00.000Z" };
 const d = makeDependencies();
 d.repositories!.jobs.listFailed = async () => [{ ...base, id: "job-failed", status: "failed" } as never];
 d.repositories!.jobs.listExhaustedRunning = async () => [{ ...base, id: "job-stuck", status: "running" } as never];
 const response = await handleApiRequest(new Request("http://localhost/api/ops/jobs?limit=20"), d);
 assert.equal(response.status, 200);
 const body = await response.json() as { now: string; items: { failed: Array<Record<string, unknown>>; stuck: Array<Record<string, unknown>> } };
 assert.equal(body.items.failed[0]?.id, "job-failed");
 assert.equal(body.items.failed[0]?.requirementId, "req-1");
 assert.equal(body.items.stuck[0]?.id, "job-stuck");
 assert.equal("payload" in body.items.failed[0]!, false);
 assert.equal("dedupeKey" in body.items.failed[0]!, false);
 assert.equal(body.now, "2026-10-08T00:00:00.000Z");
 assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/jobs?limit=0"), d)).status, 400);
 assert.equal((await handleApiRequest(new Request("http://localhost/api/ops/jobs"), unauthenticated)).status, 401);
});

test("lists audit events", async () => { const r = await handleApiRequest(new Request("http://localhost/api/audit?entityId=foo&limit=10"), makeDependencies()); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { items: [auditEvent] }); });
test("requirement detail returns the full analysis version history (spec 02 prior versions)", async () => {
  const r = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), makeDependencies());
  assert.equal(r.status, 200);
  const body = await r.json() as { analyses: { analysisVersion: number; status: string; moduleSuggestion: string | null; priority: string | null; confidence: string | null; provider: string }[] };
  assert.equal(body.analyses.length, 1);
  // 存储枚举 high/medium/low 转回展示层中文；provenance 字段随版本暴露（spec 02 L44）
  assert.deepEqual(body.analyses[0], { analysisVersion: 2, status: "analyzed", moduleSuggestion: "报表分析", confidence: "中", priority: "P1", provider: "deepseek", model: "m", promptVersion: "p", moduleDictionaryVersion: 1, priorityRuleVersionId: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z", safeErrorSummary: null });
});

test("retries a requirement stranded in running by a crashed analysis handler", async () => {
  // 回归：handler 先置 analysis=running 再调模型，进程死在这两步之间时状态停在 running，
  // 且作业已终态。此前端点只接受 pending/failed_retryable → 该需求只能手工改库。
  const d = makeDependencies();
  const queued: Record<string, unknown>[] = [];
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id
    ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "running" as const } } as RequirementRecord
    : null;
  d.repositories!.jobs.findByDedupeKey = async (key) => key === `analysis:${requirement.id}:sv1:after2`
    ? { id: "crashed-job", jobType: "analysis", dedupeKey: key, payload: {}, status: "failed", attemptCount: 3, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: null, lastErrorCode: "max_attempts_reached", lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" }
    : null;
  d.repositories!.jobs.enqueue = async (input) => {
    queued.push(input as unknown as Record<string, unknown>);
    return { ...input, id: "analysis-job-2", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
  };
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 202);
  assert.equal(queued.length, 1);
});

test("still rejects a retry while the analysis job is genuinely running", async () => {
  const d = makeDependencies();
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id
    ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "running" as const } } as RequirementRecord
    : null;
  d.repositories!.jobs.findByDedupeKey = async (key) => key === `analysis:${requirement.id}:sv1:after2`
    ? { id: "live-job", jobType: "analysis", dedupeKey: key, payload: {}, status: "running", attemptCount: 1, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: "2026-10-08T00:05:00.000Z", lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" }
    : null;
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 409);
});

test("V02-T04 web manual intake: server-side actor, idempotent replay, payload-bound key", async () => {
  const d = makeDependencies();
  const receipts = new Map<string, { requestHash: string; requirementId: string; actorId: string }>();
  const createdInputs: Array<{ actorId: string; requestHash: string; title: string }> = [];
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  requirements.findIntakeReceipt = async (key: string) => receipts.get(key) ?? null;
  (d.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => [{ version: 3, status: "published", entries: [{ name: "报表分析", personName: "贾浩" }] }] };
  requirements.createManualRequirement = async (input: { idempotencyKey: string; requestHash: string; actorId: string; title: string }) => {
    createdInputs.push(input);
    receipts.set(input.idempotencyKey, { requestHash: input.requestHash, requirementId: requirement.id, actorId: input.actorId });
    return { requirementId: requirement.id, platformRequirementId: "RQ-000001", replay: false };
  };
  const body = JSON.stringify({ title: "售后反馈", description: "用户希望导出报表", sourceChannel: "售后", productModel: "码表 C606", requirementType: "体验优化", constraintNotes: "需兼容旧表带", supplementUrl: "https://example.com/ticket/1", intakeModule: "报表分析", owner: { feishuUserId: "u-assignee", feishuIdType: "user_id", tbDisplayName: "贾浩" } });
  const post = (payload: string, key = "intake-key-123") => new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: payload });
  const first = await handleApiRequest(post(body), d);
  assert.equal(first.status, 201);
  const firstBody = await first.json() as Record<string, unknown>;
  assert.equal(firstBody.requirementId, requirement.id);
  assert.equal(firstBody.platformRequirementId, "RQ-000001");
  assert.equal(firstBody.status, "collected");
  // actor、来源类型、编号都由服务端生成（AC02）
  assert.equal(createdInputs[0]!.actorId, "actor-1");
  // V02-T05：可选上下文原样传递，未知留空
  assert.equal((createdInputs[0] as unknown as { productModel?: string }).productModel, "码表 C606");
  assert.equal((createdInputs[0] as unknown as { requirementType?: string }).requirementType, "体验优化");
  // V02-T06：受控词典模块与需求级负责人原样传递（不写 TB 人员映射）
  assert.equal((createdInputs[0] as unknown as { intakeModule?: string }).intakeModule, "报表分析");
  assert.deepEqual((createdInputs[0] as unknown as { owner?: unknown }).owner, { feishuUserId: "u-assignee", feishuIdType: "user_id", name: "贾浩" });
  // 同键同内容重放：200 同一需求，不再创建（AC03/AC07）
  const replay = await handleApiRequest(post(body), d);
  assert.equal(replay.status, 200);
  assert.equal(createdInputs.length, 1);
  // 同键不同内容：明确冲突
  const conflict = await handleApiRequest(post(JSON.stringify({ title: "另一个诉求", description: "不同内容", sourceChannel: "售后" })), d);
  assert.equal(conflict.status, 409);
});

test("PRD-26 chat-paste origin and proposer name reach the manual create path without new source types", async () => {
  const d = makeDependencies();
  const createdInputs: Array<Record<string, unknown>> = [];
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  requirements.findIntakeReceipt = async () => null;
  requirements.createManualRequirement = async (input: Record<string, unknown>) => { createdInputs.push(input); return { requirementId: requirement.id, platformRequirementId: "RQ-000001", replay: false }; };
  (d.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => [{ version: 3, status: "published", entries: [] }] };
  const post = (body: Record<string, unknown>, key: string) => new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
  const response = await handleApiRequest(post({ title: "t", description: "d", sourceChannel: "售后", intakeOrigin: "chat_paste", proposerName: "小王" }, "intake-key-701"), d);
  assert.equal(response.status, 201);
  assert.equal(createdInputs[0]!.intakeOrigin, "chat_paste");
  assert.equal(createdInputs[0]!.proposerName, "小王");
  // 来源类型仍是 web_manual（由服务端写死），请求体不接受别的取值。
  assert.equal("sourceType" in createdInputs[0]!, false);
  const badOrigin = await handleApiRequest(post({ title: "t", description: "d", sourceChannel: "售后", intakeOrigin: "teambition" }, "intake-key-702"), d);
  assert.equal(badOrigin.status, 400);
  const longName = await handleApiRequest(post({ title: "t", description: "d", sourceChannel: "售后", proposerName: "名".repeat(101) }, "intake-key-703"), d);
  assert.equal(longName.status, 400);
  assert.equal(createdInputs.length, 1);
});

test("web manual intake returns 503 instead of 500 when the dictionary or the receipt read fails", async () => {
  const body = JSON.stringify({ title: "t", description: "d", sourceChannel: "售后", intakeModule: "报表分析" });
  const post = (d: ReturnType<typeof makeDependencies>) => handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-811" }, body }), d);

  const dictionaryDown = makeDependencies();
  (dictionaryDown.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => { throw new Error("db down"); } };
  assert.equal((await post(dictionaryDown)).status, 503);

  const receiptDown = makeDependencies();
  (receiptDown.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => [{ version: 3, status: "published", entries: [{ name: "报表分析" }] }] };
  (receiptDown.repositories!.requirements as unknown as Record<string, unknown>).findIntakeReceipt = async () => { throw new Error("db down"); };
  assert.equal((await post(receiptDown)).status, 503);
});

test("oversized request bodies are rejected with 413 before any route logic runs", async () => {
  const d = makeDependencies();
  (d.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => [{ version: 3, status: "published", entries: [] }] };
  (d.repositories!.requirements as unknown as Record<string, unknown>).findIntakeReceipt = async () => { throw new Error("must not reach the receipt lookup"); };
  const oversized = JSON.stringify({ title: "t", description: "x".repeat(MAX_JSON_BODY_BYTES), sourceChannel: "售后" });
  const streamed = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-801" }, body: oversized }), d);
  assert.equal(streamed.status, 413);
  // Content-Length 预检：声明就超限时连 body 都不读。
  const declared = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-802", "content-length": String(MAX_JSON_BODY_BYTES + 1) }, body: "{}" }), d);
  assert.equal(declared.status, 413);
});

test("V02-T04 intake rejects a missing idempotency key, an unknown channel, or an empty description", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  requirements.findIntakeReceipt = async () => null;
  requirements.createManualRequirement = async () => { throw new Error("must not create"); };
  (d.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => [{ version: 3, status: "published", entries: [{ name: "报表分析", personName: null }] }] };
  const noKey = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "售后" }) }), d);
  assert.equal(noKey.status, 400);
  const badChannel = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-456" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "未知渠道" }) }), d);
  assert.equal(badChannel.status, 400);
  const noDescription = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-457" }, body: JSON.stringify({ title: "t", sourceChannel: "售后" }) }), d);
  assert.equal(noDescription.status, 400);
  const badUrl = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-458" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "售后", supplementUrl: "not-a-url" }) }), d);
  assert.equal(badUrl.status, 400);
  const badType = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-459" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "售后", requirementType: "未知类型" }) }), d);
  assert.equal(badType.status, 400);
  const unknownModule = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-460" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "售后", intakeModule: "不存在的模块" }) }), d);
  assert.equal(unknownModule.status, 400);
});

test("V02-T07 PATCH edits manual requirements with version and idempotency semantics", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  requirements.updateManualRequirement = async (input: { expectedSourceVersion: number }) => input.expectedSourceVersion === 1
    ? { outcome: "updated", sourceVersion: 2, substantiveChanged: true, replay: false }
    : input.expectedSourceVersion === 99
      ? { outcome: "version_conflict", currentSourceVersion: 2 }
      : { outcome: "not_manual" };
  const request = (body: unknown, key = "edit-key-123", expected = 1) => new Request(`http://localhost/api/requirements/${requirement.id}`, { method: "PATCH", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ expectedSourceVersion: expected, ...typeof body === "object" && body !== null ? body : {} }) });
  const ok = await handleApiRequest(request({ title: "改后的诉求" }), d);
  assert.equal(ok.status, 200);
  const okBody = await ok.json() as Record<string, unknown>;
  assert.equal(okBody.outcome, "updated");
  assert.equal(okBody.sourceVersion, 2);
  assert.equal(okBody.substantiveChanged, true);
  const stale = await handleApiRequest(request({ title: "旧版本" }, "edit-key-124", 99), d);
  assert.equal(stale.status, 409);
  assert.match(await stale.text(), /源版本 2/);
  const tbRow = await handleApiRequest(request({ title: "x" }, "edit-key-125", 3), d);
  assert.equal(tbRow.status, 409);
  const noKey = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedSourceVersion: 1 }) }), d);
  assert.equal(noKey.status, 400);
  const badBody = await handleApiRequest(request({ title: "" }, "edit-key-126"), d);
  assert.equal(badBody.status, 400);
});

test("V02-T09 audience tags route saves with optimistic version and rejects unknown levels", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  let saved: { tags: string[]; expectedVersion: number } | null = null;
  requirements.setAudienceTags = async (_id: string, input: { tags: string[]; expectedVersion: number }) => {
    saved = input;
    return input.expectedVersion === 0 ? { outcome: "updated", version: 1 } : { outcome: "version_conflict", currentVersion: 1 };
  };
  const put = (body: unknown) => new Request(`http://localhost/api/requirements/${requirement.id}/audience`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const ok = await handleApiRequest(put({ tags: ["L2", "L5"], expectedVersion: 0 }), d);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { requirementId: requirement.id, audienceVersion: 1, confirmed: true, tags: ["L2", "L5"] });
  assert.deepEqual(saved, { tags: ["L2", "L5"], expectedVersion: 0, actorId: "actor-1" });
  const stale = await handleApiRequest(put({ tags: ["L1"], expectedVersion: 5 }), d);
  assert.equal(stale.status, 409);
  assert.match(await stale.text(), /版本 1/);
  const badLevel = await handleApiRequest(put({ tags: ["L9"], expectedVersion: 0 }), d);
  assert.equal(badLevel.status, 400);
});

test("V02-T11 RICE draft routes: read defaults, save with optimistic version, conflict carries current", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  let stored: { editVersion: number } = { editVersion: 0 };
  requirements.getRiceDraft = async () => stored.editVersion === 0 ? null : { requirementId: requirement.id, reachInput: "200", impactInput: "3", confidenceInput: "80", effortInput: "4", notes: "依据", sourceVersion: 1, editVersion: stored.editVersion, updatedBy: "actor-1", updatedAt: "2026-10-25T00:00:00.000Z" };
  requirements.saveRiceDraft = async (input: { expectedEditVersion: number }) => input.expectedEditVersion === stored.editVersion
    ? { outcome: "saved", editVersion: (stored = { editVersion: input.expectedEditVersion + 1 }).editVersion }
    : { outcome: "version_conflict", currentEditVersion: stored.editVersion };
  const empty = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/rice-draft`), d);
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json() as Record<string, unknown>;
  assert.equal(emptyBody.status, "待补充");
  assert.equal(emptyBody.score, null);
  const save = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/rice-draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reach: "200/月", notes: "依据", expectedEditVersion: 0 }) }), d);
  assert.equal(save.status, 200);
  assert.equal((await save.json() as Record<string, unknown>).editVersion, 1);
  // V02-T12：量纲已确认（rice-v1）：完整合法输入给出可复算分数（200×3×0.8÷4=120）
  const read = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/rice-draft`), d);
  const readBody = await read.json() as Record<string, unknown>;
  assert.equal(readBody.status, "已计算");
  assert.equal(readBody.score, 120);
  assert.equal(readBody.configVersion, "rice-v1");
  const stale = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/rice-draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reach: "x", expectedEditVersion: 0 }) }), d);
  assert.equal(stale.status, 409);
});

test("V02-T11 RICE draft save reports a stale source baseline as a conflict", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  // 仓储判定草稿基线源版本（3）落后于当前需求源版本（5）：返回 source_version_conflict。
  requirements.saveRiceDraft = async () => ({ outcome: "source_version_conflict", currentSourceVersion: 3 });
  const res = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/rice-draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reach: "200", expectedEditVersion: 2 }) }), d);
  assert.equal(res.status, 409);
  assert.match(await res.text(), /源版本 3/);
});

test("V02-T13 Kano evidence routes: import validates, approve rejects flagged material", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  const imported: unknown[] = [];
  requirements.createKanoEvidence = async (input: { summary: string }) => {
    const record = { id: "ev-1", version: 1, status: "draft", piiFlagged: input.summary.includes("13800138000") };
    imported.push(input);
    return record;
  };
  requirements.approveKanoEvidence = async () => ({ outcome: "pii_flagged" });
  const badUrl = await handleApiRequest(new Request("http://localhost/api/kano/evidence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "t", summary: "s", evidenceFragments: [], sourceUrl: "not-a-url" }) }), d);
  assert.equal(badUrl.status, 400);
  const importOk = await handleApiRequest(new Request("http://localhost/api/kano/evidence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "访谈总结", summary: "含 13800138000 的总结", evidenceFragments: [{ ref: "S1", text: "片段" }] }) }), d);
  assert.equal(importOk.status, 201);
  assert.equal((await importOk.json() as Record<string, unknown>).piiFlagged, true);
  const approve = await handleApiRequest(new Request("http://localhost/api/kano/evidence/ev-1/approve", { method: "POST" }), d);
  assert.equal(approve.status, 409);
});

test("V02-T14 Kano run routes: trigger guards and stale flags", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  requirements.listKanoEvidence = async () => [
    { id: "ev-ok", version: 2, title: "t", sourceUrl: null, sourceSection: null, summary: "s", evidenceFragments: [], coverageNotes: null, knownAudiences: [], knownScenes: null, interviewDate: null, status: "approved", piiFlagged: false, createdBy: "m", createdAt: "2026-10-25T00:00:00.000Z", approvedBy: null, approvedAt: null },
    { id: "ev-draft", version: 3, title: "t", sourceUrl: null, sourceSection: null, summary: "s", evidenceFragments: [], coverageNotes: null, knownAudiences: [], knownScenes: null, interviewDate: null, status: "draft", piiFlagged: false, createdBy: "m", createdAt: "2026-10-25T00:00:00.000Z", approvedBy: null, approvedAt: null },
  ];
  let active = false;
  requirements.createKanoRun = async () => active ? { outcome: "active_run_exists" } : { outcome: "created", run: { id: "run-1", runVersion: 1 } };
  requirements.listKanoRuns = async () => [{ id: "run-1", requirementId: requirement.id, runVersion: 1, status: "succeeded", sourceVersion: 1, audienceSnapshot: { tags: [], confirmed: false }, evidenceVersion: 2, promptVersion: "rq-kano-v1", model: null, result: null, safeErrorCode: null, safeErrorSummary: null, createdBy: "actor-1", createdAt: "2026-10-25T00:00:00.000Z", completedAt: null }];
  const post = (evidenceVersion: number) => new Request(`http://localhost/api/requirements/${requirement.id}/kano-runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidenceVersion }) });
  const draft = await handleApiRequest(post(3), d);
  assert.equal(draft.status, 409);
  const ok = await handleApiRequest(post(2), d);
  assert.equal(ok.status, 202);
  active = true;
  const activeConflict = await handleApiRequest(post(2), d);
  assert.equal(activeConflict.status, 409);
  const list = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/kano-runs`), d);
  const body = await list.json() as { items: Array<{ staleInputs: boolean }> };
  // 源版本一致但最新已批准资料是 v2 且报告引用 v2 → 不过期；此处 run.sourceVersion=1 与 requirement 一致
  assert.equal(typeof body.items[0]?.staleInputs, "boolean");
});

// ---- PRD-26 / 5a：聊天一键复制草稿接口 ----
type DraftExtractor = NonNullable<ApiDependencies["chatIntake"]>["extractor"];
function draftDependencies(extract: DraftExtractor["extract"], options: { limit?: { perMinute: number; perDay: number } } = {}) {
  const d = makeDependencies();
  (d.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => [{ version: 3, status: "published", entries: [{ name: "报表分析" }, "导航"] }] };
  const audits: { eventType: string; result: string; entityId: string; safeDetails: Record<string, unknown> }[] = [];
  d.repositories!.audit.append = async (event) => { audits.push(event as never); };
  const created: unknown[] = [];
  (d.repositories!.requirements as unknown as Record<string, unknown>).createManualRequirement = async (input: unknown) => { created.push(input); return { requirementId: requirement.id, platformRequirementId: "RQ-000001", replay: false }; };
  d.chatIntake = { extractor: { extract }, ...(options.limit ? { limit: options.limit } : {}) };
  return { d, audits, created };
}
const sampleDraft = { title: "导出骑行报表", description: "售后反馈用户希望导出报表", sourceChannel: "售后" as const, requirementType: null, productModel: null, constraintNotes: null, intakeModule: "报表分析", proposer: "小王", aiFilled: ["title", "description", "sourceChannel", "intakeModule", "proposer"] as never };
// 抽取结果：草稿 + 是否兜底（fallback=true 表示标题/描述取自掩码原文）。
const extraction = (draft: typeof sampleDraft, fallback = false) => ({ draft, fallback });
const draftRequest = (text: unknown) => new Request("http://localhost/api/requirements/intake-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });

test("intake-draft returns a draft without creating a requirement and audits only the text length", async () => {
  let seen: { text: string; modules: readonly string[] } | null = null;
  const { d, audits, created } = draftDependencies(async (input) => { seen = input; return extraction(sampleDraft); });
  const chat = "客户小王说：希望能导出骑行报表，电话 13812345678";
  const response = await handleApiRequest(draftRequest(chat), d);
  assert.equal(response.status, 200);
  const body = await response.json() as { draft: { title: string }; similar: unknown[]; fallback: boolean; aiFilledCount: number };
  assert.equal(body.draft.title, "导出骑行报表");
  assert.deepEqual(body.similar, []);
  // 兜底标记与 AI 填充数量必须显式返回，客户端据此提示与统计。
  assert.equal(body.fallback, false);
  assert.equal(body.aiFilledCount, 5);
  assert.equal(created.length, 0);
  assert.deepEqual(seen!.modules, ["报表分析", "导航"]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.eventType, "intake.draft_extracted");
  assert.equal(audits[0]!.safeDetails.textLength, Array.from(chat).length);
  assert.equal(audits[0]!.safeDetails.fallback, false);
  assert.equal(audits[0]!.safeDetails.aiFilledCount, 5);
  // 一次抽取的审计要能串联：请求号既在 safeDetails 也做 entityId，并带提示词版本。
  assert.match(String(audits[0]!.safeDetails.requestId), /^[0-9a-f-]{36}$/);
  assert.equal(audits[0]!.safeDetails.promptVersion, CHAT_PROMPT_VERSION);
  assert.equal(audits[0]!.entityId, audits[0]!.safeDetails.requestId);
  assert.equal(JSON.stringify(audits[0]).includes("13812345678"), false);
  assert.equal(JSON.stringify(audits[0]).includes("小王"), false);
});

test("intake-draft rejects empty or oversized text and unauthenticated callers", async () => {
  let calls = 0;
  const { d } = draftDependencies(async () => { calls += 1; return extraction(sampleDraft); });
  assert.equal((await handleApiRequest(draftRequest("   "), d)).status, 400);
  assert.equal((await handleApiRequest(draftRequest("x".repeat(20_001)), d)).status, 400);
  assert.equal((await handleApiRequest(new Request("http://localhost/api/requirements/intake-draft", { method: "POST", body: "not json" }), d)).status, 400);
  const anonymous = { ...unauthenticated, chatIntake: d.chatIntake! };
  assert.equal((await handleApiRequest(draftRequest("hi"), anonymous)).status, 401);
  assert.equal(calls, 0);
});

test("intake-draft returns 503 when the extractor is not configured", async () => {
  const { d } = draftDependencies(async () => extraction(sampleDraft));
  delete (d as { chatIntake?: unknown }).chatIntake;
  assert.equal((await handleApiRequest(draftRequest("hi"), d)).status, 503);
});

test("intake-draft does not call the model while AI is paused for quota", async () => {
  let calls = 0;
  const { d } = draftDependencies(async () => { calls += 1; return extraction(sampleDraft); });
  d.repositories!.flags = { get: async () => ({ value: { until: "2026-10-08T01:00:00.000Z", reason: "rate_limited" }, updatedAt: "2026-10-08T00:00:00.000Z" }), set: async () => undefined };
  const response = await handleApiRequest(draftRequest("hi"), d);
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("intake-draft limits each actor to the per-minute cap and sets Retry-After", async () => {
  let calls = 0;
  const { d } = draftDependencies(async () => { calls += 1; return extraction(sampleDraft); }, { limit: { perMinute: 2, perDay: 100 } });
  assert.equal((await handleApiRequest(draftRequest("a"), d)).status, 200);
  assert.equal((await handleApiRequest(draftRequest("b"), d)).status, 200);
  const limited = await handleApiRequest(draftRequest("c"), d);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) >= 1);
  assert.equal(calls, 2);
});

test("intake-draft maps provider rate limiting to 429 with Retry-After and audits only the error class", async () => {
  const { d, audits } = draftDependencies(async () => { throw Object.assign(new Error("sk-secret-key-1234567890 upstream said no"), { code: "rate_limited" }); });
  const response = await handleApiRequest(draftRequest("需要导出"), d);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) >= 1);
  const text = await response.text();
  assert.equal(text.includes("sk-secret"), false);
  assert.equal(audits[0]!.eventType, "intake.draft_failed");
  assert.equal(audits[0]!.result, "failed");
  assert.equal(audits[0]!.safeDetails.errorClass, "rate_limited");
  assert.equal(JSON.stringify(audits[0]).includes("sk-secret"), false);
});

test("intake-draft maps provider config errors to 500 and reports them to diagnostics without leaking secrets", async () => {
  const reported: Array<{ event: string; details: Record<string, unknown> }> = [];
  const { d, audits } = draftDependencies(async () => { throw new AiProviderError("auth_error", "AI provider authentication failed (HTTP 401).", 401); });
  d.diagnostics = { error: (event, details) => { reported.push({ event, details }); } };
  const response = await handleApiRequest(draftRequest("需要导出"), d);
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text.includes("sk-secret"), false);
  assert.equal(audits[0]!.safeDetails.errorClass, "auth_error");
  assert.equal(audits[0]!.safeDetails.httpStatus, 401);
  assert.equal(reported.length, 1);
  assert.equal(reported[0]!.event, "intake_draft_failed");
  assert.equal(reported[0]!.details.errorClass, "auth_error");
  assert.equal(reported[0]!.details.textLength, 4);
  // 供应商状态码可以进诊断，供应商正文和密钥不行。
  assert.equal(reported[0]!.details.httpStatus, 401);
  assert.match(String(reported[0]!.details.requestId), /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(reported).includes("sk-secret"), false);
  assert.equal(JSON.stringify(reported).includes("upstream"), false);
});

test("intake-draft maps timeouts and unusable model output to a retryable 503", async () => {
  for (const code of ["timeout", "network_error", "analysis_failure"]) {
    const { d, audits } = draftDependencies(async () => { throw Object.assign(new Error("upstream"), { code }); });
    const response = await handleApiRequest(draftRequest("需要导出"), d);
    assert.equal(response.status, 503, code);
    assert.equal(audits[0]!.safeDetails.errorClass, code);
  }
});

test("intake-draft ties every attempt to one requestId and records the prompt version on failure too", async () => {
  const ok = draftDependencies(async () => extraction(sampleDraft));
  assert.equal((await handleApiRequest(draftRequest("需要导出"), ok.d)).status, 200);
  const failed = draftDependencies(async () => { throw new AiProviderError("timeout", "AI provider request timed out."); });
  assert.equal((await handleApiRequest(draftRequest("需要导出"), failed.d)).status, 503);
  for (const attempt of [ok, failed]) {
    assert.match(String(attempt.audits[0]!.safeDetails.requestId), /^[0-9a-f-]{36}$/);
    assert.equal(attempt.audits[0]!.safeDetails.promptVersion, CHAT_PROMPT_VERSION);
    assert.equal(attempt.audits[0]!.entityId, attempt.audits[0]!.safeDetails.requestId);
  }
  assert.notEqual(ok.audits[0]!.entityId, failed.audits[0]!.entityId);
});

test("intake-draft returns 503 instead of 500 when the module dictionary cannot be read", async () => {
  let calls = 0;
  const { d } = draftDependencies(async () => { calls += 1; return extraction(sampleDraft); });
  (d.repositories as unknown as Record<string, unknown>).dictionaries = { list: async () => { throw new Error("db down"); } };
  const response = await handleApiRequest(draftRequest("需要导出"), d);
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("intake-draft reports the fallback draft honestly in the response and the audit", async () => {
  const { d, audits } = draftDependencies(async () => extraction({ ...sampleDraft, title: "张伟 2026-11-18 09:12", description: "客户电话（手机号已掩码）", aiFilled: [] as never }, true));
  const response = await handleApiRequest(draftRequest("张伟 2026-11-18 09:12\n手机 13812345678"), d);
  assert.equal(response.status, 200);
  const body = await response.json() as { fallback: boolean; aiFilledCount: number; draft: { aiFilled: string[] } };
  assert.equal(body.fallback, true);
  assert.equal(body.aiFilledCount, 0);
  assert.deepEqual(body.draft.aiFilled, []);
  assert.equal(audits[0]!.eventType, "intake.draft_extracted");
  assert.equal(audits[0]!.safeDetails.fallback, true);
  assert.equal(audits[0]!.safeDetails.aiFilledCount, 0);
});

test("intake-draft lists similar requirements and falls back to a title prefix", async () => {
  const queries: string[] = [];
  const { d } = draftDependencies(async () => extraction({ ...sampleDraft, title: "导出骑行报表到表格文件" }));
  (d.repositories!.requirements as unknown as Record<string, unknown>).search = async (query: { q?: string }) => {
    queries.push(query.q ?? "");
    return { items: query.q === "导出骑行报表到表" ? [{ ...requirement, id: "r-1", platformRequirementId: "RQ-000009", title: "导出骑行报表", sourceType: "teambition" }] : [], nextCursor: null };
  };
  const body = await (await handleApiRequest(draftRequest("需要导出"), d)).json() as { similar: { platformRequirementId: string; title: string }[] };
  assert.deepEqual(queries, ["导出骑行报表到表格文件", "导出骑行报表到表"]);
  assert.equal(body.similar.length, 1);
  assert.equal(body.similar[0]!.platformRequirementId, "RQ-000009");
});

test("intake-draft still returns the draft when the similar-requirement search or audit fails", async () => {
  const { d } = draftDependencies(async () => extraction(sampleDraft));
  (d.repositories!.requirements as unknown as Record<string, unknown>).search = async () => { throw new Error("db down"); };
  d.repositories!.audit.append = async () => { throw new Error("audit down"); };
  const response = await handleApiRequest(draftRequest("需要导出"), d);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { similar: unknown[] }).similar, []);
});

// ---- 0031 集团需求池：pool 作用域、详情守卫、执行人名单 ----
const groupSource: SourceConfigRecord = { ...source, id: "77777777-7777-4777-8777-777777777777", pool: "group", executorAllowlist: [{ userId: "tb-user-1", name: "张三" }] };
const groupRequirement = { ...requirement, id: "88888888-8888-4888-8888-888888888888", sourceConfigId: groupSource.id };
const sourceBody = (extra: Record<string, unknown> = {}) => ({ projectName: "集团需求收集", enabled: true, schedule: { enabled: false, time: null, timezone: null }, ...extra });
const postSource = (d: ApiDependencies, body: Record<string, unknown>) => handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), d);
function poolDependencies() {
  const d = makeDependencies();
  d.repositories!.sources.get = async (id) => id === groupSource.id ? groupSource : id === source.id ? source : null;
  d.repositories!.sources.list = async () => [source, groupSource];
  d.repositories!.requirements!.get = (async (id: string) => id === groupRequirement.id ? groupRequirement : id === requirement.id ? requirement : null) as never;
  return d;
}
test("requirement detail derives the pool from the id and returns it read-only", async () => {
  const d = poolDependencies();
  const group = await handleApiRequest(new Request(`http://localhost/api/requirements/${groupRequirement.id}`), d);
  assert.equal(group.status, 200);
  assert.equal((await group.json() as { pool?: string }).pool, "group");
  const product = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), d);
  assert.equal(product.status, 200);
  assert.equal((await product.json() as { pool?: string }).pool, "product");
});
test("an explicit pool that disagrees with the requirement answers 404, and anonymous stays 401", async () => {
  const d = poolDependencies();
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}?pool=group`), d)).status, 404);
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${groupRequirement.id}?pool=product`), d)).status, 404);
  // 先认证后判池：未登录请求不能被守卫降级成 404（那样会泄露 UUID 是否存在）。
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}?pool=group`), unauthenticated)).status, 401);
});
test("source listing exposes the pool and allowlist display names without TB user ids", async () => {
  const d = makeDependencies();
  d.repositories!.sources.list = async () => [groupSource];
  const body = await (await handleApiRequest(new Request("http://localhost/api/sources"), d)).json() as { items: Array<Record<string, unknown>> };
  assert.equal(body.items[0]!.pool, "group");
  assert.deepEqual(body.items[0]!.executorAllowlist, ["张三"]);
  assert.equal(JSON.stringify(body).includes("tb-user-1"), false);
});
test("group source creation resolves names to bindings and rejects unusable allowlists", async () => {
  const build = (members?: Array<{ userId: string; name: string }>) => {
    const d = makeDependencies();
    d.teambitionSourceProjects = { resolveProject: async () => ({ projectId: "p2", requirementTypeId: "t2" }) };
    if (members) d.teambitionMembers = { listOrganizationMembers: async () => members };
    d.repositories!.sources.list = async () => [];
    let saved: unknown;
    d.repositories!.sources.create = (async (input: unknown) => { saved = input; return { ...source, pool: "group", externalProjectId: "p2", executorAllowlist: (input as { executorAllowlist?: unknown }).executorAllowlist }; }) as never;
    return { d, saved: () => saved as { executorAllowlist?: unknown } | undefined };
  };
  // 未注入成员目录：不能假装保存成功。
  assert.equal((await postSource(build().d, sourceBody({ pool: "group", executorAllowlist: ["张三"] }))).status, 503);
  // 未解析姓名 → 400 + 独立字段，供卡片列出并保留输入。
  const unresolved = await postSource(build([{ userId: "tb-user-2", name: "李四" }]).d, sourceBody({ pool: "group", executorAllowlist: ["张三"] }));
  assert.equal(unresolved.status, 400);
  assert.deepEqual((await unresolved.json() as { error: { details?: { unresolvedExecutorNames?: string[] } } }).error.details?.unresolvedExecutorNames, ["张三"]);
  // 空名单不能启用；21 个姓名超上限。
  assert.equal((await postSource(build([{ userId: "tb-user-1", name: "张三" }]).d, sourceBody({ pool: "group", executorAllowlist: [] }))).status, 400);
  assert.equal((await postSource(build([{ userId: "tb-user-1", name: "张三" }]).d, sourceBody({ pool: "group", executorAllowlist: Array.from({ length: 21 }, (_, i) => `人${i}`) }))).status, 400);
  // 产品池传名单直接拒绝，避免“看起来过滤了其实没有”。
  assert.equal((await postSource(build([{ userId: "tb-user-1", name: "张三" }]).d, sourceBody({ executorAllowlist: ["张三"] }))).status, 400);
  // 正常路径：trim/去重后解析为 {userId,name}，只保存绑定，不回传 user_id。
  const ok = build([{ userId: "tb-user-1", name: "张三" }]);
  const created = await postSource(ok.d, sourceBody({ pool: "group", executorAllowlist: [" 张三 ", "张三"] }));
  assert.equal(created.status, 201);
  assert.deepEqual(ok.saved()?.executorAllowlist, [{ userId: "tb-user-1", name: "张三" }]);
  assert.deepEqual((await created.json() as { executorAllowlist?: string[] }).executorAllowlist, ["张三"]);
});
test("each pool keeps one source: a second product source conflicts while a group source is allowed", async () => {
  const d = makeDependencies();
  d.teambitionSourceProjects = { resolveProject: async () => ({ projectId: "p2", requirementTypeId: "t2" }) };
  d.teambitionMembers = { listOrganizationMembers: async () => [{ userId: "tb-user-1", name: "张三" }] };
  d.repositories!.sources.create = (async (input: { pool?: string }) => ({ ...source, id: "99999999-9999-4999-8999-999999999999", pool: input.pool ?? "product", externalProjectId: "p2" })) as never;
  assert.equal((await postSource(d, sourceBody())).status, 409);
  const group = await postSource(d, sourceBody({ pool: "group", executorAllowlist: ["张三"] }));
  assert.equal(group.status, 201);
  assert.equal((await group.json() as { pool?: string }).pool, "group");
});
test("updating a source cannot move it between pools", async () => {
  const d = makeDependencies();
  const response = await handleApiRequest(new Request(`http://localhost/api/sources/${source.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody({ pool: "group", executorAllowlist: ["张三"] })) }), d);
  assert.equal(response.status, 400);
});

test("集团池详情的 Base 记录链接按集团模板生成，产品池仍用产品模板", async () => {
  const d = poolDependencies();
  d.repositories!.sources.get = (async (id: string) => id === groupSource.id ? groupSource : id === source.id ? source : null) as never;
  process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = "https://x.feishu.cn/base/PRODUCT?table=tblP&record={recordId}";
  process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE = "https://x.feishu.cn/base/GROUP?table=tblG&record={recordId}";
  try {
    const groupRow = { ...groupRequirement, baseRecordId: "rec-group-1" };
    d.repositories!.requirements!.get = (async (id: string) => id === groupRow.id ? groupRow : requirement) as never;
    const groupDetail = await (await handleApiRequest(new Request(`http://localhost/api/requirements/${groupRow.id}`), d)).json() as { baseRecordUrl?: string };
    assert.equal(groupDetail.baseRecordUrl, "https://x.feishu.cn/base/GROUP?table=tblG&record=rec-group-1");
    const productRow = { ...requirement, baseRecordId: "rec-product-1" };
    d.repositories!.requirements!.get = (async (id: string) => id === productRow.id ? productRow : groupRow) as never;
    const productDetail = await (await handleApiRequest(new Request(`http://localhost/api/requirements/${productRow.id}`), d)).json() as { baseRecordUrl?: string };
    assert.equal(productDetail.baseRecordUrl, "https://x.feishu.cn/base/PRODUCT?table=tblP&record=rec-product-1");
  } finally {
    delete process.env.RQSYS_BASE_RECORD_URL_TEMPLATE;
    delete process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE;
  }
});

test("列表行的池标签与 Base 链接都按行自己的来源取，集团池未配模板时为 null 而不是回落产品模板", async () => {
  const d = poolDependencies();
  const groupRow = { ...groupRequirement, baseRecordId: "rec-group-1" };
  (d.repositories!.requirements as unknown as Record<string, unknown>).search = async () => ({ items: [groupRow], nextCursor: null });
  process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = "https://x.feishu.cn/base/PRODUCT?table=tblP&record={recordId}";
  process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE = "https://x.feishu.cn/base/GROUP?table=tblG&record={recordId}";
  try {
    const list = async (query: string) => (await (await handleApiRequest(new Request(`http://localhost/api/requirements${query}`), d)).json() as { items: Array<{ baseRecordUrl?: string | null; pool?: string }> }).items[0]!;
    const group = await list("?pool=group");
    assert.equal(group.baseRecordUrl, "https://x.feishu.cn/base/GROUP?table=tblG&record=rec-group-1");
    // 每行必须带归属池：前端靠它显示池标签（2026-11-25 妙搭缺这个字段导致集团 Tab 全标产品池）。
    assert.equal(group.pool, "group");
    // 行自己的来源是集团池：请求缺省 product 也不能把它说成产品池、更不能用产品池模板。
    const byDefault = await list("");
    assert.equal(byDefault.baseRecordUrl, "https://x.feishu.cn/base/GROUP?table=tblG&record=rec-group-1");
    assert.equal(byDefault.pool, "group");
    delete process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE;
    assert.equal((await list("?pool=group")).baseRecordUrl, null);
  } finally {
    delete process.env.RQSYS_BASE_RECORD_URL_TEMPLATE;
    delete process.env.RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE;
  }
});

// ---- 2026-11-21：PRD 提示词（POST/GET /api/requirements/:id/prd-prompts） ----

test("PRD 提示词：无成功评估 409、生成 201、GET 列版本、单飞与超时映射", async () => {
  const d = makeDependencies();
  const repositories = d.repositories as unknown as Record<string, unknown>;
  const assessments = [{ id: "assessment-1", requirementId: requirement.id, version: 3, status: "succeeded", promptVersion: "rq-assessment-v1", model: "m", inputs: {}, output: {}, errorCode: null, errorDetail: null, createdAt: "2026-10-07T00:00:00.000Z", completedAt: "2026-10-07T00:00:01.000Z" }];
  let expired: Array<[string, string, string]> = [];
  repositories.assessments = {
    list: async () => assessments,
    expireStaleRunning: async (id: string, before: string, at: string) => { expired.push([id, before, at]); return 0; },
  };
  const listed: Array<{ id: string; version: number }> = [assessments[0]!];
  repositories.prdPrompts = {
    list: async () => [{ id: "prd-1", requirementId: requirement.id, version: 1, status: "succeeded", promptVersion: "rq-prd-prompt-v1", model: "stub", inputs: { investigationNotes: "第一版调研", assessmentVersion: 3 }, output: { prompt: "x", assumptions: [], openQuestions: [] }, errorCode: null, createdAt: "2026-10-07T00:00:00.000Z", completedAt: "2026-10-07T00:00:10.000Z" }],
    expireStaleRunning: async (id: string, before: string, at: string) => { expired.push([id, before, at]); return 0; },
    create: async () => { throw new Error("unused"); },
    complete: async () => null,
    fail: async () => null,
  };
  const runs: Array<Record<string, unknown>> = [];
  const record = {
    id: "prd-2", requirementId: requirement.id, version: 2, status: "succeeded" as const, promptVersion: "rq-prd-prompt-v1", model: "stub",
    inputs: { investigationNotes: "访谈 5 位用户", assessmentVersion: 3 }, output: { prompt: "## 角色与任务", assumptions: [], openQuestions: [] },
    errorCode: null, createdAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:30.000Z",
  };
  d.prdPrompt = { runner: { run: async (input: Record<string, unknown>) => { runs.push(input); return record; } } as never };

  // GET：先清理过期 running，再按版本倒序列出；只回传回填需要的字段。
  const list = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/prd-prompts`), d);
  assert.equal(list.status, 200);
  const items = (await list.json() as { items: Array<Record<string, unknown>> }).items;
  assert.equal(items.length, 1);
  assert.deepEqual(Object.keys(items[0]!).sort(), ["assessmentVersion", "completedAt", "createdAt", "errorCode", "id", "investigationNotes", "model", "output", "promptVersion", "requirementId", "status", "version"]);
  assert.equal(items[0]!.investigationNotes, "第一版调研");
  assert.deepEqual(expired[0], [requirement.id, "2026-10-07T23:58:00.000Z", "2026-10-08T00:00:00.000Z"]);

  // POST：201 裸对象；评估与调研结论都传入 runner。
  const ok = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/prd-prompts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ investigationNotes: "访谈 5 位用户" }),
  }), d);
  assert.equal(ok.status, 201);
  const body = await ok.json() as Record<string, unknown>;
  assert.equal(body.id, "prd-2");
  assert.equal(body.version, 2);
  assert.equal(body.investigationNotes, "访谈 5 位用户");
  assert.equal(runs[0]!.assessment instanceof Object, true);
  assert.equal(runs[0]!.investigationNotes, "访谈 5 位用户");

  // 无成功评估：409 ASSESSMENT_REQUIRED，不调模型。
  repositories.assessments = { list: async () => [], expireStaleRunning: async () => 0 };
  const required = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/prd-prompts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ investigationNotes: "" }),
  }), d);
  assert.equal(required.status, 409);
  assert.equal((await required.json() as { error: { code: string } }).error.code, "ASSESSMENT_REQUIRED");
  assert.equal(runs.length, 1);

  // 显式指定不属于本需求的评估：400（先恢复一条成功评估）。
  repositories.assessments = { list: async () => assessments, expireStaleRunning: async () => 0 };
  const foreign = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/prd-prompts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assessmentId: "99999999-9999-4999-8999-999999999999" }),
  }), d);
  assert.equal(foreign.status, 400);
});

test("PRD §4.7.5：duplicateCandidates 只保留同标题候选，duplicates 语义不变", async () => {
  const d = makeDependencies();
  const repositories = d.repositories as unknown as { requirements: Record<string, unknown> };
  repositories.requirements.listDuplicateCandidates = async () => [
    { id: "req-2", title: requirement.title, platformRequirementId: "RQ-000002", teambitionRequirementId: "tb-2" },
    { id: "req-3", title: `  ${requirement.title}  `, platformRequirementId: "RQ-000003", teambitionRequirementId: null },
    { id: "req-4", title: "完全不同的标题", platformRequirementId: "RQ-000004", teambitionRequirementId: "tb-4" },
  ];
  const response = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), d);
  assert.equal(response.status, 200);
  const body = await response.json() as { duplicateCandidates: Array<{ id: string }>; duplicates: unknown[] };
  // 同标题（含首尾空白）保留；不同标题丢弃；duplicates 仍是「以本需求为主记录的子记录」。
  assert.deepEqual(body.duplicateCandidates.map((item) => item.id), ["req-2", "req-3"]);
  assert.deepEqual(body.duplicates, []);

  // 无候选返回空数组而不是 null/缺字段。
  const none = makeDependencies();
  (none.repositories as unknown as { requirements: Record<string, unknown> }).requirements.listDuplicateCandidates = async () => [];
  const empty = await (await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), none)).json() as { duplicateCandidates: unknown };
  assert.deepEqual(empty.duplicateCandidates, []);

  // 仓储未实现该方法（旧桩/旧适配器）时降级为空数组，不影响详情。
  const legacy = makeDependencies();
  delete (legacy.repositories as unknown as { requirements: Record<string, unknown> }).requirements.listDuplicateCandidates;
  const fallback = await (await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), legacy)).json() as { duplicateCandidates: unknown };
  assert.deepEqual(fallback.duplicateCandidates, []);
});

test("重新分析已分析过的需求缺省强制重跑，显式 force:false 才走轻量重试", async () => {
  // 回归：此前不带 body 时 force=false，已分析需求被 handler 的同源幂等守卫短路——只入队不执行。
  const d = makeDependencies();
  const queued: Record<string, unknown>[] = [];
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id
    ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "analyzed" as const } } as RequirementRecord
    : null;
  d.repositories!.jobs.enqueue = async (input) => {
    queued.push(input as unknown as Record<string, unknown>);
    return { ...input, id: "analysis-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt };
  };
  const forced = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(forced.status, 202);
  assert.equal(queued[0]?.dedupeKey, `analysis:${requirement.id}:sv1:after2:force`);
  assert.equal((queued[0]?.payload as Record<string, unknown>).force, true);

  const light = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: false }),
  }), d);
  assert.equal(light.status, 202);
  assert.equal(queued[1]?.dedupeKey, `analysis:${requirement.id}:sv1:after2`);
  assert.equal((queued[1]?.payload as Record<string, unknown>).force, undefined);
});

// 0034：「我的需求」/回收站：平台身份先换成飞书 user_id，再按负责人口径过滤。
test("0034 mine list and counts resolve the platform actor to a Feishu user_id", async () => {
  const d = makeDependencies();
  const searches: unknown[] = [];
  d.feishuUserSelections = { resolve: async (platformUserId: string) => platformUserId === "actor-1" ? { feishuUserId: "feishu-1", feishuIdType: "user_id", name: "我" } : null };
  d.repositories!.requirements!.search = async (query) => { searches.push(query); return { items: [], nextCursor: null }; };
  (d.repositories!.requirements as unknown as { mineCounts: (owner: string) => Promise<unknown> }).mineCounts = async (owner: string) => {
    assert.equal(owner, "feishu-1");
    return { product: 3, group: 2, total: 5, suppressed: 1 };
  };

  const mine = await handleApiRequest(new Request("http://localhost/api/requirements/mine?pool=group"), d);
  assert.equal(mine.status, 200);
  assert.deepEqual(await mine.json(), { items: [], nextCursor: null, identityResolved: true });
  assert.deepEqual(searches[0], { pool: "group", ownerFeishuUserId: "feishu-1", deleted: false, limit: 25 });

  const counts = await handleApiRequest(new Request("http://localhost/api/requirements/mine/counts"), d);
  assert.equal(counts.status, 200);
  assert.deepEqual(await counts.json(), { identityResolved: true, product: 3, group: 2, total: 5, suppressed: 1 });

  // M4：身份服务缺失/调用失败是可重试故障，必须 503，不能伪装成「未绑定」空态。
  const unavailable = makeDependencies();
  unavailable.repositories!.requirements!.search = async () => { throw new Error("search must not run without identity"); };
  const failed = await handleApiRequest(new Request("http://localhost/api/requirements/mine"), unavailable);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json() as { error: { code: string } }).error.code, "DEPENDENCY_UNAVAILABLE");
  const countsFailed = await handleApiRequest(new Request("http://localhost/api/requirements/mine/counts"), unavailable);
  assert.equal(countsFailed.status, 503);

  // 未绑定飞书才是 200 空态（identityResolved=false），前端显示可解释的空页。
  const unlinked = makeDependencies();
  unlinked.feishuUserSelections = { resolve: async () => null };
  unlinked.repositories!.requirements!.search = async () => ({ items: [], nextCursor: null });
  const empty = await handleApiRequest(new Request("http://localhost/api/requirements/mine"), unlinked);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { items: [], nextCursor: null, identityResolved: false });
});

test("0034 delete and restore go through the Feishu identity and map lifecycle outcomes", async () => {
  const d = makeDependencies();
  const calls: unknown[] = [];
  const nowIso = "2026-10-08T00:00:00.000Z";
  d.feishuUserSelections = { resolve: async () => ({ feishuUserId: "feishu-1", feishuIdType: "user_id", name: "我" }) };
  (d.repositories!.requirements as unknown as { markDeleted: (input: unknown) => Promise<unknown> }).markDeleted = async (input) => { calls.push(input); return { outcome: "deleted", requirement: { ...requirement, deletedAt: nowIso, deletedBy: "feishu-1" } }; };
  (d.repositories!.requirements as unknown as { restoreDeleted: (input: unknown) => Promise<unknown> }).restoreDeleted = async (input) => { calls.push(input); return { outcome: "restored", requirement: { ...requirement, deletedAt: null, deletedBy: null } }; };

  const deleted = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`, { method: "DELETE" }), d);
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { requirementId: requirement.id, deletedAt: nowIso, deletedBy: "actor-1", replayed: false });
  const deleteCall = calls[0] as { requirementId: string; ownerFeishuUserId: string; deletedBy: string; at: string; audit: { actorId: string; occurredAt: string } };
  assert.equal(deleteCall.requirementId, requirement.id);
  assert.equal(deleteCall.ownerFeishuUserId, "feishu-1", "负责人匹配仍用飞书 user_id");
  assert.equal(deleteCall.deletedBy, "actor-1", "deleted_by 存登录身份（妙搭 userId）");
  assert.equal(deleteCall.at, nowIso);
  // M7：审计随删除一起传给仓储，在同一事务里写；审计 id 由仓储生成，调用方不传。
  assert.equal(deleteCall.audit.actorId, "actor-1");
  assert.equal(deleteCall.audit.occurredAt, nowIso);
  assert.equal("id" in deleteCall.audit, false);

  const restored = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/restore`, { method: "POST" }), d);
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), { requirementId: requirement.id, deletedAt: null, deletedBy: null, replayed: false });
  const restoreCall = calls[1] as { requirementId: string; deleterUserId: string; audit: { actorId: string; occurredAt: string } };
  assert.equal(restoreCall.requirementId, requirement.id);
  assert.equal(restoreCall.deleterUserId, "actor-1");
  assert.equal(restoreCall.audit.actorId, "actor-1");
  assert.equal(restoreCall.audit.occurredAt, nowIso);

  // M10：本来就不在回收站 → 409，不是幂等 200；且还原不依赖飞书身份服务。
  const notDeleted = makeDependencies();
  (notDeleted.repositories!.requirements as unknown as { restoreDeleted: () => Promise<unknown> }).restoreDeleted = async () => ({ outcome: "not_deleted", requirement });
  const gone = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/restore`, { method: "POST" }), notDeleted);
  assert.equal(gone.status, 409);
  assert.equal((await gone.json() as { error: { code: string } }).error.code, "CONFLICT");

  // 不是当前负责人 → 403；身份无法解析 → 403/503（不拿平台 id 猜归属）。
  const forbidden = makeDependencies();
  forbidden.feishuUserSelections = { resolve: async () => ({ feishuUserId: "feishu-1", feishuIdType: "user_id", name: "我" }) };
  (forbidden.repositories!.requirements as unknown as { markDeleted: () => Promise<unknown> }).markDeleted = async () => ({ outcome: "forbidden" });
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`, { method: "DELETE" }), forbidden)).status, 403);

  const unresolved = makeDependencies();
  unresolved.feishuUserSelections = { resolve: async () => null };
  (unresolved.repositories!.requirements as unknown as { markDeleted: () => Promise<unknown> }).markDeleted = async () => ({ outcome: "deleted", requirement });
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`, { method: "DELETE" }), unresolved)).status, 403);

  const noService = makeDependencies();
  (noService.repositories!.requirements as unknown as { markDeleted: () => Promise<unknown> }).markDeleted = async () => ({ outcome: "deleted", requirement });
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`, { method: "DELETE" }), noService)).status, 503);
});

test("0034 a deleted requirement's detail only reveals deletedBy to the deleter and always reports canRestore", async () => {
  // deleted_by 存登录身份（妙搭 userId），与 auth.actor.id 同口径比较，不需要飞书身份解析。
  const deletedRecord = { ...requirement, deletedAt: "2026-10-08T00:00:00.000Z", deletedBy: "actor-1" } as unknown as RequirementRecord;
  const mine = makeDependencies();
  mine.repositories!.requirements!.get = async (id: string) => id === requirement.id ? deletedRecord : null;
  const self = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), mine);
  assert.equal(self.status, 200);
  const selfBody = await self.json() as { deletedBy: string | null; canRestore: boolean };
  assert.equal(selfBody.deletedBy, "actor-1");
  assert.equal(selfBody.canRestore, true);

  const other = makeDependencies({ id: "actor-2" });
  other.repositories!.requirements!.get = async (id: string) => id === requirement.id ? deletedRecord : null;
  const stranger = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), other);
  assert.equal(stranger.status, 200);
  const strangerBody = await stranger.json() as { deletedBy: string | null; canRestore: boolean };
  assert.equal(strangerBody.deletedBy, null);
  assert.equal(strangerBody.canRestore, false);
});

test("0034 recycle bin uses the signed-in Miaoda user id and aggregates both pools", async () => {
  const d = makeDependencies();
  const searches: unknown[] = [];
  d.feishuUserSelections = { resolve: async () => ({ feishuUserId: "feishu-1", feishuIdType: "user_id", name: "我" }) };
  d.repositories!.requirements!.search = async (query) => { searches.push(query); return { items: [], nextCursor: null }; };
  // 不带 pool：聚合两池，deleted_by=妙搭 userId，不解析飞书身份。
  const bin = await handleApiRequest(new Request("http://localhost/api/requirements?deleted=true"), d);
  assert.equal(bin.status, 200);
  assert.deepEqual(await bin.json(), { items: [], nextCursor: null, identityResolved: true });
  assert.deepEqual(searches[0], { pool: "all", limit: 25, deleted: true, deletedBy: "actor-1" });

  // 显式 pool 才按池过滤。
  await handleApiRequest(new Request("http://localhost/api/requirements?deleted=true&pool=group"), d);
  assert.deepEqual(searches[1], { pool: "group", limit: 25, deleted: true, deletedBy: "actor-1" });

  // mine 别名仍按负责人口径，需要飞书身份。
  const mine = await handleApiRequest(new Request("http://localhost/api/requirements?mine=true"), d);
  assert.equal(mine.status, 200);
  assert.deepEqual(searches[2], { pool: "product", limit: 25, deleted: false, ownerFeishuUserId: "feishu-1" });

  // 回收站不依赖身份服务：没有解析器也照常返回（只认登录身份）。
  const anonymous = makeDependencies();
  const anonymousSearches: unknown[] = [];
  anonymous.repositories!.requirements!.search = async (query) => { anonymousSearches.push(query); return { items: [], nextCursor: null }; };
  const binWithoutIdentity = await handleApiRequest(new Request("http://localhost/api/requirements?deleted=true"), anonymous);
  assert.equal(binWithoutIdentity.status, 200);
  assert.equal((anonymousSearches[0] as { deletedBy: string }).deletedBy, "actor-1");

  // 「我的需求」没有身份服务是可重试故障 → 503。
  const mineUnavailable = await handleApiRequest(new Request("http://localhost/api/requirements?mine=true"), anonymous);
  assert.equal(mineUnavailable.status, 503);
});

test("0034 list rows carry the per-row pool label, including my-requirements", async () => {
  // 2026-11-25 线上缺陷：妙搭 /mine 列表项缺 pool，集团 Tab 全被渲染成「产品池」。
  // 这里锁住契约：列表行必须带归属池，且按来源解析，不能只看请求的 pool 参数。
  const groupSource = { ...source, id: "99999999-9999-4999-8999-999999999999", pool: "group" as const };
  const d = makeDependencies();
  d.feishuUserSelections = { resolve: async () => ({ feishuUserId: "feishu-1", feishuIdType: "user_id", name: "我" }) };
  d.repositories!.sources = { ...d.repositories!.sources, list: async () => [source, groupSource] };
  d.repositories!.requirements!.search = async () => ({ items: [{ ...requirement, sourceConfigId: groupSource.id } as unknown as RequirementRecord], nextCursor: null });
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/mine?pool=group"), d);
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { items: Array<{ pool?: string }> }).items[0]?.pool, "group");
});

test("0034 M14 every requirement-scoped write rejects a deleted requirement with 409", async () => {
  const deletedRecord = { ...requirement, deletedAt: "2026-10-08T00:00:00.000Z", deletedBy: "feishu-1" } as unknown as RequirementRecord;
  const d = makeDependencies();
  d.feishuUserSelections = { resolve: async () => ({ feishuUserId: "feishu-1", feishuIdType: "user_id", name: "我" }) };
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id ? deletedRecord : null;

  // 统一守卫在分发前拦截：这些路由都没有各自加 deleted 判断，仍然全部 409。
  const writes: Array<[string, string]> = [
    ["PATCH", `/api/requirements/${requirement.id}`],
    ["PUT", `/api/requirements/${requirement.id}/owner`],
    ["PUT", `/api/requirements/${requirement.id}/audience`],
    ["PUT", `/api/requirements/${requirement.id}/scoring`],
    ["PUT", `/api/requirements/${requirement.id}/priority-override`],
    ["PUT", `/api/requirements/${requirement.id}/analysis-context`],
    ["POST", `/api/requirements/${requirement.id}/assessments`],
    ["POST", `/api/requirements/${requirement.id}/prd-prompts`],
    ["POST", `/api/requirements/${requirement.id}/push`],
    ["POST", `/api/requirements/${requirement.id}/kano-runs`],
    ["POST", `/api/analysis/${requirement.id}/retry`],
  ];
  for (const [method, path] of writes) {
    const response = await handleApiRequest(new Request(`http://localhost${path}`, { method }), d);
    assert.equal(response.status, 409, `${method} ${path}`);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "REQUIREMENT_DELETED", `${method} ${path}`);
  }

  // 已删除详情按 UUID 仍可只读打开；评估历史这类 GET 不能被写闸口误伤。
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), d)).status, 200);
  assert.notEqual((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`), d)).status, 409);

  // DELETE 幂等重放与还原必须放行，否则回收站按钮会被自己的闸口挡住。
  (d.repositories!.requirements as unknown as { markDeleted: () => Promise<unknown> }).markDeleted = async () => ({ outcome: "replayed", requirement: deletedRecord });
  const replay = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`, { method: "DELETE" }), d);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { replayed: boolean }).replayed, true);

  (d.repositories!.requirements as unknown as { restoreDeleted: () => Promise<unknown> }).restoreDeleted = async () => ({ outcome: "restored", requirement });
  const restored = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/restore`, { method: "POST" }), d);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json() as { replayed: boolean }).replayed, false);
});

test("Wave 2: manual scoring supports umsc_weighted_v3 thresholds and publish blocks v1 over v3", async () => {
  const d = makeDependencies();
  let saved: Record<string, unknown> | null = null;
  const v3Rule = {
    id: "rule-v3", version: 3, status: "published" as const,
    rules: { formulaType: "umsc_weighted_v3", thresholds: { p0: 10, p1: 7, p2: 4 } },
    validationEvidence: [{ calibratedAt: "2026-11-01" }], createdBy: null,
    createdAt: "2026-11-01T00:00:00.000Z", publishedAt: "2026-11-01T00:00:00.000Z",
  };
  const v1Draft = {
    id: "88888888-8888-4888-8888-888888888888", version: 4, status: "draft" as const,
    rules: { scoring: { user: { 高: 3 }, market: { 高: 3 }, business: { 高: 3 }, technology: { 高: 3 } }, thresholds: { p0: 10, p1: 7, p2: 4 } },
    validationEvidence: [{ sample: 1 }], createdBy: "u", createdAt: "2026-11-02T00:00:00.000Z", publishedAt: null,
  };
  d.repositories!.priorityRules = {
    getPublished: async () => v3Rule,
    get: async (id: string) => id === v1Draft.id ? v1Draft : null,
    list: async () => [v1Draft, v3Rule],
    create: async () => v1Draft,
    publish: async () => v1Draft,
  } as never;
  d.repositories!.scoring = {
    current: async () => null,
    saveManual: async (input: Record<string, unknown>) => { saved = input; return { outcome: "saved", version: { version: 1, score: input.score, priority: input.priority } }; },
    aiSuggestion: async () => null,
    list: async () => [],
  } as never;
  // inputs: U=4*3=12, M=1*1=1, S=1*1=1, C=2, alpha=1 -> score = 12 * 2 / 2 = 12.0 -> P0 under v3 (p0=10), would be P2 under v2 (p0=45)!
  const scoreRes = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/scoring`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersion: 0, alpha: 1, reason: "v3 calibration check",
      inputs: { user: { pain: 4, frequency: 3 }, market: { sellingPoint: 1, competitor: 1 }, strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 2, technicalRisk: 1, resource: 1 } },
    }),
  }), d);
  assert.equal(scoreRes.status, 200);
  assert.equal(saved!.score, 12);
  assert.equal(saved!.priority, "P0");

  const publishBlocked = await handleApiRequest(new Request(`http://localhost/api/rules/priority/${v1Draft.id}/publish`, { method: "POST" }), d);
  assert.equal(publishBlocked.status, 409);
});

test("Wave 2: detail and CSV export preserve manualOwner precedence over TB executor", async () => {
  const d = makeDependencies();
  const withManual = {
    ...requirement,
    executorUserId: "tb-user-1",
    executorName: "TB执行人",
    manualOwner: { feishuUserId: "u-manual", feishuIdType: "user_id" as const, name: "人工负责人", assignedBy: "op", assignedAt: "2026-10-08T00:00:00.000Z", pushedFeishuUserId: null, assignmentVersion: 1 },
  } as unknown as RequirementRecord;
  d.repositories!.requirements!.get = async () => withManual;
  d.repositories!.requirements!.search = async () => ({ items: [withManual], nextCursor: null });
  d.repositories!.people = {
    upsertManual: async () => { throw new Error("unused"); },
    listActive: async () => [],
    resolveActive: async () => ({ id: "m1", sourceConfigId: source.id, teambitionUserId: "tb-user-1", teambitionDisplayName: "TB映射名", normalizedName: "tb映射名", feishuUserId: "u-tb", feishuIdType: "user_id", matchMethod: "manual", active: true, createdBy: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" }),
  };
  const detail = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), d);
  assert.equal(detail.status, 200);
  assert.equal(((await detail.json()) as { ownerName: string }).ownerName, "人工负责人");

  const csv = await handleApiRequest(new Request("http://localhost/api/requirements/export"), d);
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /人工负责人/);
  assert.doesNotMatch(text, /,TB执行人,/);
});

test("Wave 2: requirementPoolGuard skips /mine and invalid UUIDs before hitting requirements.get", async () => {
  const d = makeDependencies();
  const getCalls: string[] = [];
  d.database = {} as never;
  d.feishuUserSelections = { resolve: async () => ({ feishuUserId: "feishu-1", feishuIdType: "user_id", name: "我" }) };
  d.repositories!.requirements!.get = async (id: string) => { getCalls.push(id); return null; };
  const mineRes = await handleApiRequest(new Request("http://localhost/api/requirements/mine?pool=group"), d);
  assert.equal(mineRes.status, 200);
  assert.deepEqual(getCalls, []);

  const badUuid = await handleApiRequest(new Request("http://localhost/api/requirements/not-a-uuid?pool=product"), d);
  assert.equal(badUuid.status, 404);
  assert.deepEqual(getCalls, []);
});

test("Wave 2: POST /api/analysis/:id/retry enforces MAX_JSON_BODY_BYTES with 413", async () => {
  const d = makeDependencies();
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(3 * 1024 * 1024) },
    body: "{}",
  }), d);
  assert.equal(response.status, 413);
});

test("Wave 2: assessments and prd-prompts honor AI pause, rate limits, and audit trail", async () => {
  const d = makeDependencies();
  const audited: Array<Record<string, unknown>> = [];
  d.repositories!.audit = { append: async (ev) => { audited.push(ev as unknown as Record<string, unknown>); }, search: async () => [] };
  d.repositories!.flags = {
    get: async (name: string) => name === "ai_analysis_pause" ? { value: { until: "2026-10-08T01:00:00.000Z", reason: "rate_limited" }, updatedAt: "2026-10-08T00:00:00.000Z" } : null,
    set: async () => undefined,
  };
  const assessmentRecord = {
    id: "assess-1", requirementId: requirement.id, version: 1, status: "succeeded" as const,
    promptVersion: "rq-assessment-v1", model: "m", inputs: {}, output: {}, errorCode: null, errorDetail: null,
    createdBy: "actor-1", createdAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z",
  };
  d.repositories!.assessments = {
    create: async () => ({ outcome: "created" as const, record: assessmentRecord }),
    complete: async () => assessmentRecord, fail: async () => null,
    list: async () => [assessmentRecord], expireStaleRunning: async () => 0,
  };
  d.repositories!.prdPrompts = {
    create: async () => { throw new Error("unused"); },
    complete: async () => null, fail: async () => null,
    list: async () => [], expireStaleRunning: async () => 0,
  };
  d.assessments = { run: async () => assessmentRecord };
  d.assessmentRateLimit = { perMinute: 1, perDay: 10 };
  d.prdPrompt = {
    runner: {
      run: async () => ({
        id: "prd-1", requirementId: requirement.id, version: 1, status: "succeeded" as const,
        promptVersion: "rq-prd-prompt-v1", model: "m", inputs: { assessmentVersion: 1, investigationNotes: "notes" },
        output: { prompt: "x", assumptions: [], openQuestions: [] }, errorCode: null,
        createdBy: "actor-1", createdAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:02.000Z",
      }),
    },
  };
  // AI pause blocks both endpoints with 503
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), d)).status, 503);
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/prd-prompts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ investigationNotes: "ok" }) }), d)).status, 503);

  // Clear AI pause -> assessment rate limit (perMinute=1) allows 1st, 429 on 2nd; prd-prompt succeeds and writes audit
  d.repositories!.flags = { get: async () => null, set: async () => undefined };
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), d)).status, 201);
  const limited = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/assessments`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), d);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);

  const prdOk = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/prd-prompts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ investigationNotes: "调研" }) }), d);
  assert.equal(prdOk.status, 201);
  assert.equal(audited.some((e) => e.eventType === "prd_prompt.generated"), true);
});

test("Wave 2: transient database errors across routes return 503 DEPENDENCY_UNAVAILABLE", async () => {
  const d = makeDependencies();
  d.repositories!.sources.list = async () => { throw Object.assign(new Error("cannot connect now"), { code: "57P03" }); };
  const res = await handleApiRequest(new Request("http://localhost/api/sources"), d);
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "DEPENDENCY_UNAVAILABLE");
});

test("Wave 2: POST /api/sync/run checks running batches within the target source's pool", async () => {
  const d = makeDependencies();
  const groupSource = { ...source, id: "99999999-9999-4999-8999-999999999999", pool: "group" as const };
  let queriedPool: string | undefined;
  d.repositories!.sources.get = async (id: string) => id === groupSource.id ? groupSource : null;
  d.repositories!.batches.list = async (q) => {
    queriedPool = q.pool;
    return { items: [{ id: "b-run", sourceConfigId: groupSource.id, triggerType: "manual", actorId: "u", idempotencyKey: "k", status: "running", startedAt: "2026-10-08T00:00:00.000Z", completedAt: null, totalCount: 0, succeededCount: 0, failedCount: 0, errorSummary: null, createdAt: "2026-10-08T00:00:00.000Z" }], nextCursor: null };
  };
  const res = await handleApiRequest(new Request("http://localhost/api/sync/run", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "sync-group-conflict-0001" },
    body: JSON.stringify({ sourceId: groupSource.id, mode: "full_pipeline" }),
  }), d);
  assert.equal(res.status, 409);
  assert.equal(queriedPool, "group");
});

test("Perf Wave 1: GET /api/requirements/:id deduplicates analyses/scoring queries, passes titleKey, and keeps full source", async () => {
  const d = makeDependencies();
  let latestCalled = 0;
  let currentScoreCalled = 0;
  let aiSuggestionCalled = 0;
  let candidateTitleKey: string | undefined;
  const v1Run = { ...analysisRun, analysisVersion: 1, structuredResult: null };
  const v2Run = { ...analysisRun, analysisVersion: 2, structuredResult: { summary: "v2" } };
  const confirmedScore = {
    id: "s-2", requirementId: requirement.id, version: 2, status: "confirmed" as const, origin: "manual" as const,
    sourceVersion: 1, analysisVersion: 2, ruleVersionId: null, inputs: {}, alpha: 1, score: 12, priority: "P0" as const,
    scoreConfidence: "高", scoreConfidenceReason: "r", safetyFlag: false, basis: {}, rationale: "ok", actorId: "u", changeReason: "ok", createdAt: "2026-10-08T00:00:00.000Z",
  };
  const aiSuggestedScore = { ...confirmedScore, id: "s-3", version: 3, status: "ai_suggested" as const, origin: "ai" as const, priority: "P1" as const };
  d.repositories!.analyses = {
    append: async () => v2Run as never,
    complete: async () => v2Run as never,
    latest: async () => { latestCalled += 1; return v2Run as never; },
    listByRequirement: async () => [v1Run, v2Run] as never,
  };
  d.repositories!.scoring = {
    current: async () => { currentScoreCalled += 1; return confirmedScore as never; },
    aiSuggestion: async () => { aiSuggestionCalled += 1; return aiSuggestedScore as never; },
    list: async () => [aiSuggestedScore, confirmedScore] as never,
    createAi: async () => confirmedScore as never,
    saveManual: async () => ({ outcome: "saved", version: confirmedScore } as never),
    applyAi: async () => ({ outcome: "saved", version: confirmedScore } as never),
  };
  (d.repositories!.requirements as unknown as Record<string, unknown>).listDuplicateCandidates = async (input: { titleKey?: string }) => {
    candidateTitleKey = input.titleKey;
    return [];
  };
  const withFullSource = { ...requirement, sourcePayload: { rawNote: "full-detail-only", intakeOrigin: "chat_paste" } } as unknown as RequirementRecord;
  d.repositories!.requirements!.get = async () => withFullSource;

  const res = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(latestCalled, 0, "must derive latest from listByRequirement without redundant query");
  assert.equal(currentScoreCalled, 0, "must derive currentScore from scoring.list without redundant query");
  assert.equal(aiSuggestionCalled, 0, "must derive aiScore from scoring.list without redundant query");
  assert.equal(candidateTitleKey, requirement.title.toLowerCase());
  const body = await res.json() as { analysis: { summary: string }; source: Record<string, unknown>; scoring: { current: { id: string }; aiSuggestion: { id: string } } };
  assert.deepEqual(body.analysis, { summary: "v2" });
  assert.deepEqual(body.source, { rawNote: "full-detail-only", intakeOrigin: "chat_paste" });
  assert.equal(body.scoring.current.id, "s-2");
  assert.equal(body.scoring.aiSuggestion.id, "s-3");
});

test("Perf Wave 1: GET /api/requirements slims list item source, degrades people.listActive failures, and sets no-store", async () => {
  const d = makeDependencies();
  const fatRow = {
    ...requirement,
    sourcePayload: { intakeOrigin: "chat_paste", hugeRawText: "x".repeat(5000), nested: { a: 1 } },
  } as unknown as RequirementRecord;
  d.repositories!.requirements!.search = async () => ({ items: [fatRow], nextCursor: null });
  d.repositories!.people = {
    upsertManual: async () => { throw new Error("unused"); },
    resolveActive: async () => null,
    listActive: async () => { throw new Error("people query glitch"); },
  };
  const res = await handleApiRequest(new Request("http://localhost/api/requirements?limit=10"), d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json() as { items: Array<{ source: Record<string, unknown>; ownerName: string | null }> };
  assert.deepEqual(body.items[0]?.source, { intakeOrigin: "chat_paste" });
  assert.equal(body.items[0]?.ownerName, null);
});

test("Perf Wave 1: GET /api/health/ready caches schema_migrations for 20s and excludes Cache-Control: no-store", async () => {
  let migrationQueries = 0;
  let nowMs = Date.parse("2026-11-27T00:00:00.000Z");
  const mockDb = {
    query: async (sql: string) => {
      if (sql.includes("schema_migrations")) {
        migrationQueries += 1;
        return { rows: [{ filename: EXPECTED_LATEST_MIGRATION }], rowCount: 1 };
      }
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    },
  } as never;
  const d: ApiDependencies = { database: mockDb, repositories: undefined, identity: undefined, now: () => new Date(nowMs) };
  const first = await handleApiRequest(new Request("http://localhost/api/health/ready"), d);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), null);
  assert.equal(migrationQueries, 1);

  nowMs += 10_000;
  const second = await handleApiRequest(new Request("http://localhost/api/health/ready"), d);
  assert.equal(second.status, 200);
  assert.equal(migrationQueries, 1, "within 20s TTL must reuse cached migration status");

  nowMs += 15_000;
  const third = await handleApiRequest(new Request("http://localhost/api/health/ready"), d);
  assert.equal(third.status, 200);
  assert.equal(migrationQueries, 2, "after 20s TTL must re-query schema_migrations");
});

test("Perf Wave 1: handleApiRequest maps PG 22P02 to 400 and deletedRequirementWriteGate fails closed with 503", async () => {
  const d = makeDependencies();
  d.repositories!.requirements!.search = async () => { throw Object.assign(new Error("invalid input syntax for type uuid"), { code: "22P02" }); };
  const badParam = await handleApiRequest(new Request("http://localhost/api/requirements?limit=10"), d);
  assert.equal(badParam.status, 400);
  assert.equal(((await badParam.json()) as { error: { code: string } }).error.code, "VALIDATION_FAILED");

  const dWrite = makeDependencies();
  dWrite.repositories!.requirements!.get = async () => { throw Object.assign(new Error("cannot connect now"), { code: "57P03" }); };
  const gateFailed = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/priority-override`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ priority: "P0", reason: "x" }),
  }), dWrite);
  assert.equal(gateFailed.status, 503);
  assert.equal(((await gateFailed.json()) as { error: { code: string } }).error.code, "DEPENDENCY_UNAVAILABLE");
});

test("Pragmatic Triage v4: rules creation, GET detail similarRequirements, PUT /triage with costTier, and PUT /scoring v4", async () => {
  const d = makeDependencies();
  const storedRules: Array<{ id: string; version: number; status: "draft" | "published" | "retired"; rules: Record<string, unknown>; validationEvidence: unknown[]; createdBy: string | null; createdAt: string; publishedAt: string | null }> = [];
  d.repositories!.priorityRules = {
    async list() { return storedRules; },
    async get(id) { return storedRules.find((r) => r.id === id) ?? null; },
    async getPublished() { return storedRules.find((r) => r.status === "published") ?? null; },
    async create(input) {
      const rec = { id: "77777777-7777-4777-8777-777777777777", version: storedRules.length + 1, status: "draft" as const, rules: input.rules, validationEvidence: input.validationEvidence, createdBy: input.createdBy, createdAt: input.now, publishedAt: null };
      storedRules.push(rec);
      return rec;
    },
    async publish(id, now) {
      for (const r of storedRules) if (r.status === "published") r.status = "retired";
      const target = storedRules.find((r) => r.id === id)!;
      target.status = "published";
      target.publishedAt = now;
      return target;
    },
  };
  // 1) Create & publish pragmatic_triage_v4 rule with quarterlyFocus
  const createRuleRes = await handleApiRequest(new Request("http://localhost/api/rules/priority", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rules: {
        formulaType: "pragmatic_triage_v4",
        thresholds: { p0: 80, p1: 60, p2: 40 },
        quarterlyFocus: ["导航稳定性", "功率计生态"],
      },
    }),
  }), d);
  assert.equal(createRuleRes.status, 201);
  const createdRule = (await createRuleRes.json()) as { id: string; rules: { formulaType?: string; quarterlyFocus?: string[] } };
  assert.equal(createdRule.rules.formulaType, "pragmatic_triage_v4");
  assert.deepEqual(createdRule.rules.quarterlyFocus, ["导航稳定性", "功率计生态"]);
  const publishRes = await handleApiRequest(new Request(`http://localhost/api/rules/priority/${createdRule.id}/publish`, { method: "POST" }), d);
  assert.equal(publishRes.status, 200);

  // 2) Mock similarRequirements + v4 aiSuggestion
  d.repositories!.requirements!.listSimilarRequirements = async () => [
    { id: "99999999-9999-4999-8999-999999999999", platformRequirementId: "RQ-000099", title: "类似导航崩溃", similarity: 0.62, createdAt: "2026-11-20T00:00:00.000Z" },
  ];
  const v4AiScore = {
    id: "88888888-8888-4888-8888-888888888888",
    requirementId: requirement.id,
    version: 1,
    status: "ai_suggested" as const,
    origin: "ai" as const,
    sourceVersion: 1,
    analysisVersion: 1,
    ruleVersionId: createdRule.id,
    inputs: { version: "v4", impact: 3, urgency: 3, costTier: null, strategicMatch: false, guardrail: null },
    alpha: 1.0,
    score: 60,
    priority: "P1" as const,
    scoreConfidence: "中",
    scoreConfidenceReason: "缺少频次",
    safetyFlag: false,
    basis: {
      impact: { reason: "中度影响", evidence: ["导航"], assumption: false },
      urgency: { reason: "中性默认", evidence: [], assumption: true },
    },
    rationale: "中性初筛",
    actorId: null,
    changeReason: null,
    createdAt: "2026-11-28T00:00:00.000Z",
  };
  let savedManualScore: Record<string, unknown> | null = null;
  let savedOverride: Record<string, unknown> | null = null;
  d.repositories!.scoring = {
    async list() { return [v4AiScore]; },
    async current() { return null; },
    async aiSuggestion() { return v4AiScore; },
    async createAi() { return v4AiScore; },
    async saveManual(input) {
      savedManualScore = input as unknown as Record<string, unknown>;
      return { outcome: "saved" as const, version: { ...v4AiScore, version: 2, status: "current" as const, origin: "manual" as const, inputs: input.inputs, score: input.score, priority: input.priority } };
    },
    async applyAi() { return { outcome: "ai_not_found" as const }; },
  };
  d.repositories!.requirements!.setPriorityOverride = async (_id, input) => {
    savedOverride = input as unknown as Record<string, unknown>;
    return { outcome: "saved" as const, override: input.priority ? { priority: input.priority, reason: input.reason ?? "", actorId: input.actorId, at: input.at } : null };
  };

  // 3) GET detail includes similarRequirements + v4 formulaType
  const detailRes = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), d);
  assert.equal(detailRes.status, 200);
  const detailBody = (await detailRes.json()) as {
    similarRequirements?: { count90d: number; items: Array<{ platformRequirementId: string }> };
    scoring?: { formula: { formulaType?: string; thresholds: { p0: number; p1: number; p2: number } } };
  };
  assert.equal(detailBody.similarRequirements?.count90d, 1);
  assert.equal(detailBody.similarRequirements?.items[0]?.platformRequirementId, "RQ-000099");
  assert.equal(detailBody.scoring?.formula.formulaType, "pragmatic_triage_v4");
  assert.deepEqual(detailBody.scoring?.formula.thresholds, { p0: 80, p1: 60, p2: 40 });

  // 4) PUT /triage sets priorityOverride + costTier S (+5 -> 65)
  const triageRes = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/triage`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ priority: "P0", costTier: "S", reason: "本周紧急修复" }),
  }), d);
  assert.equal(triageRes.status, 200);
  const triageBody = (await triageRes.json()) as { effectivePriority: string; scoring?: { score: number } };
  assert.equal(triageBody.effectivePriority, "P0");
  assert.equal(triageBody.scoring?.score, 65);
  assert.ok(savedOverride);
  assert.ok(savedManualScore);

  // 5) PUT /scoring v4 directly
  const scoreV4Res = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/scoring`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 0, version: "v4", impact: 5, urgency: 4, costTier: "L", reason: "高影响但大工作量" }),
  }), d);
  assert.equal(scoreV4Res.status, 200);
  const scoreV4Body = (await scoreV4Res.json()) as { scoring: { score: number; priority: string } };
  // 5*12 + 4*8 - 10 = 82 >= 80 -> P0
  assert.equal(scoreV4Body.scoring.score, 82);
  assert.equal(scoreV4Body.scoring.priority, "P0");
});
