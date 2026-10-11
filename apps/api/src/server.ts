import { createServer } from "node:http";
import { createPool } from "./adapters/postgres/pool.js";
import { PostgresRepositories } from "./adapters/postgres/repositories.js";
import { createPostgresSyncPersistence } from "./adapters/postgres/sync-persistence.js";
import { type ApiDependencies, handleApiRequest } from "./http/app.js";
import { errorBody } from "./http/errors.js";
import { PipelineJobWorker } from "./jobs/worker.js";
import { SyncOrchestrator, type SyncJobRunner } from "./sync/service.js";
import { TeambitionClient } from "./adapters/teambition/client.js";
import { createDeepSeekProvider } from "./analysis/provider.js";
import { runAnalysis } from "./analysis/service.js";
import { AnalysisRepositoryAdapter } from "./analysis/repository-adapter.js";
import { buildPriorityRule } from "./analysis/priority-rule.js";
import { createDueSyncJobs } from "./scheduler/due-jobs.js";
import { FeishuBasePushAdapter } from "./base/client.js";
import { FeishuBitableClient } from "./base/transport.js";
import { FeishuUserDirectoryClient } from "./adapters/feishu/directory-client.js";
import { createBasePushService } from "./base/push-service.js";
import { basePushIdempotencyKey } from "./application/idempotency-keys.js";
import { createAnalysisAdvancer, createSourceMetadataAdvancer } from "./pipeline/advance.js";
import { createLocalIdentityProvider, describeLocalIdentity } from "./http/local-identity.js";
import type { SourceProjectConfig } from "./domain/workflow.js";

const port = Number(process.env.PORT ?? 8787);
const database = createPool(process.env.DATABASE_URL);
const repositories = database ? new PostgresRepositories(database) : undefined;
// 身份：默认 fail-closed。仅当显式设置 RQSYS_LOCAL_IDENTITY 且非生产环境时才启用本地开发身份，
// 目标环境的可信身份由妙搭 controller 注入 req.userContext 后写入同名请求头。
const localIdentityUserId = process.env.RQSYS_LOCAL_IDENTITY;
const identity = repositories ? (createLocalIdentityProvider({
  userId: localIdentityUserId,
  nodeEnv: process.env.NODE_ENV,
  headerName: process.env.RQSYS_LOCAL_IDENTITY_HEADER,
}) ?? {
  async requireActor(_request: Request): Promise<{ id: string }> {
    // Replace with the deployment's verified token/session identity adapter.
    throw new Error("No verified identity provider is configured");
  },
}) : undefined;
const localIdentityNotice = describeLocalIdentity(localIdentityUserId, process.env.NODE_ENV);
let teambitionSourceProjects: TeambitionClient | undefined;
try { teambitionSourceProjects = new TeambitionClient(); } catch { /* source setup will report the unavailable gateway */ }

// ---- Worker composition：认领 pipeline_jobs 并分发到对应执行器 ----
const syncJobRunner: SyncJobRunner | undefined = repositories ? async (job) => {
  const source = await repositories.sources.get(job.sourceConfigId);
  if (!source) throw new Error("Sync source configuration was not found");
  const config: SourceProjectConfig = {
    id: source.id, projectId: source.externalProjectId, projectName: source.externalProjectName,
    requirementTypeId: source.requirementTypeId, enabled: source.enabled,
    schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, time: source.scheduleLocalTime, timezone: source.scheduleTimezone },
    ownerNames: source.ownerNames, fieldMap: source.fieldMap,
  };
  const client = new TeambitionClient();
  const persistence = createPostgresSyncPersistence(repositories, job.sourceConfigId);
  const orchestrator = new SyncOrchestrator(
    { async listRequirements(cfg) { return { items: await client.listRequirementTasks(cfg), hasMore: false, nextCursor: null }; } },
    persistence,
  );
  const result = await orchestrator.run({ batchId: job.batchId, sourceConfigId: job.sourceConfigId, config, ...(job.onlyIds === undefined ? {} : { onlyIds: job.onlyIds }) });
  // 打通同步 → AI 分析链路：为新建/实质变更的需求创建分析任务（按源版本幂等去重）
  if (result.status !== "failed") {
    const now = new Date().toISOString();
    // 本地开发专用上限：只限制「入队分析」的数量，不同步范围。导入与快照始终覆盖全部需求，
    // 因此验收时不会看到"只同步了一部分"的假象。默认 0 = 不限制；目标环境不要设置。
    const analysisCap = Number(process.env.RQSYS_MAX_ANALYSIS_PER_SYNC ?? 0);
    let queued = 0;
    for (const touched of persistence.touchedRequirements()) {
      if (touched.analysisRequired) {
        if (analysisCap > 0 && queued >= analysisCap) continue;
        queued += 1;
        await repositories.jobs.enqueue({
          jobType: "analysis", dedupeKey: `analysis:${touched.id}:v${touched.sourceVersion}`,
          payload: { requirementId: touched.id, sourceVersion: touched.sourceVersion, substantiveHash: touched.substantiveHash, actorId: job.actorId }, availableAt: now,
        });
      } else {
        const latestAnalysis = await repositories.analyses.latest(touched.id);
        await advanceAfterMetadataSync?.(touched.id, job.actorId, latestAnalysis?.analysisVersion ?? 0);
      }
    }
  }
  return result;
} : undefined;

const analysisJobHandler: ((job: { payload: Record<string, unknown> }) => Promise<void>) | undefined = repositories ? async (job) => {
  const requirementId = job.payload.requirementId;
  if (typeof requirementId !== "string") throw new Error("Invalid analysis job payload");
  const requirement = await repositories.requirements.get(requirementId);
  if (!requirement) throw new Error("Analysis requirement was not found");
  const targetSubstantiveHash = job.payload.substantiveHash;
  if (typeof targetSubstantiveHash === "string" && targetSubstantiveHash !== requirement.substantiveHash) return;
  const source = await repositories.sources.get(requirement.sourceConfigId);
  if (!source) throw new Error("Analysis source configuration was not found");
  const published = (await repositories.dictionaries.list()).find((version) => version.status === "published");
  const dictionary = { version: published?.version ?? 0, modules: (published?.entries ?? []).map((entry) => typeof entry === "string" ? entry : String((entry as { name?: unknown }).name ?? entry)) };
  // 已发布规则接入确定性计算；规则 JSON 不符合契约时 buildPriorityRule 返回 null（priority 保持为空）
  const ruleRecord = await repositories.priorityRules.getPublished();
  const priorityRule = ruleRecord ? buildPriorityRule(ruleRecord) : null;
  const provider = createDeepSeekProvider();
  await repositories.requirements.updateAnalysisState(requirement.id, "running");
  const run = await runAnalysis({
    requirementId: requirement.id, sourceVersion: requirement.sourceVersion, sourcePersisted: true,
    title: requirement.title, description: requirement.description ?? "", context: [requirement.scope, requirement.acceptanceCriteria].filter((value): value is string => Boolean(value)).join("\n\n"),
    // 文本中可能出现的姓名（配置名单 + 需求 proposer/executor）一律掩码；用户 ID 不进 prompt
    piiMarkers: [...source.ownerNames, requirement.proposerName, requirement.executorName].filter((x): x is string => Boolean(x)),
    dictionary, priorityRule,
  }, { repository: new AnalysisRepositoryAdapter(repositories.analyses), provider });
  const current = await repositories.requirements.get(requirement.id);
  if (!current || current.substantiveHash !== requirement.substantiveHash) return;
  await repositories.requirements.updateAnalysisState(requirement.id, run.status === "analyzed" ? "analyzed" : "failed_retryable");
  // 工单 14：首次分析进入可见终态后继续负责人处理与 Base 推送——AI 不是推送门槛。
  // 无负责人 → not_required 直接入队；有负责人且映射唯一 → auto_mapped 入队；未匹配 → 等待人工映射。
  if (advanceAfterAnalysis) {
    await advanceAfterAnalysis(requirement.id, run.status === "analyzed" ? "analyzed" : "failed_retryable", typeof job.payload.actorId === "string" ? job.payload.actorId : null, run.analysisVersion);
  }
} : undefined;

// ---- Feishu Base 推送装配：env 凭证齐全时构建真实 transport（工单 00/W7 目标环境验证）----
const DEFAULT_BASE_FIELDS = {
  projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
  // The selected TB project's custom-field type/binding is unverified. Only map
  // standard fields whose semantics and the Base column type are verified.
  source: { title: "标题", createdAt: "TB创建时间" } as Record<string, string>,
  ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" } as Record<string, string>,
  pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"] as string[],
  metadata: { sourceVersion: "源版本", pushState: "推送状态", lastPushedAt: "最后推送时间" } as Record<string, string>,
  selectOptions: {
    // Verified against the safe POC Base schema; override via BASE_FIELDS_JSON
    // together with Base options when the product module dictionary changes.
    module: ["需求澄清", "方案设计", "缺陷修复", "其他"], priority: ["P0", "P1", "P2"],
  } as Record<string, string[]>,
};
function parseBaseFields(raw: string | undefined): typeof DEFAULT_BASE_FIELDS {
  if (!raw) return DEFAULT_BASE_FIELDS;
  try {
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_BASE_FIELDS>;
    return {
      projectId: parsed.projectId ?? DEFAULT_BASE_FIELDS.projectId,
      requirementId: parsed.requirementId ?? DEFAULT_BASE_FIELDS.requirementId,
      owner: parsed.owner ?? DEFAULT_BASE_FIELDS.owner,
      source: { ...DEFAULT_BASE_FIELDS.source, ...(parsed.source ?? {}) },
      ai: { ...DEFAULT_BASE_FIELDS.ai, ...(parsed.ai ?? {}) },
      pm: Array.isArray(parsed.pm) ? parsed.pm : DEFAULT_BASE_FIELDS.pm,
      metadata: { ...DEFAULT_BASE_FIELDS.metadata, ...(parsed.metadata ?? {}) },
      selectOptions: { ...DEFAULT_BASE_FIELDS.selectOptions, ...(parsed.selectOptions ?? {}) },
    };
  } catch {
    return DEFAULT_BASE_FIELDS;
  }
}
const baseFields = parseBaseFields(process.env.BASE_FIELDS_JSON);
const feishuUserDirectory = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET
  ? new FeishuUserDirectoryClient({ appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET })
  : undefined;
const baseClient = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.BASE_APP_TOKEN && process.env.BASE_TABLE_ID
  ? new FeishuBitableClient({
      appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET,
      appToken: process.env.BASE_APP_TOKEN, tableId: process.env.BASE_TABLE_ID,
      keyFields: { projectId: baseFields.projectId, requirementId: baseFields.requirementId },
    })
  : undefined;
const baseAdapter = baseClient && repositories
  ? new FeishuBasePushAdapter(baseClient, baseFields, {
      async savePmSnapshot(input) { await repositories.pmSnapshots.append({ ...input, capturedAt: new Date().toISOString() }); },
    })
  : undefined;
const advanceAfterAnalysis = repositories ? createAnalysisAdvancer({
  requirements: repositories.requirements, people: repositories.people, jobs: repositories.jobs, audit: repositories.audit,
}) : undefined;
const advanceAfterMetadataSync = repositories ? createSourceMetadataAdvancer({
  requirements: repositories.requirements, people: repositories.people, jobs: repositories.jobs, audit: repositories.audit,
}) : undefined;

const basePushJobHandler: ((job: { payload: Record<string, unknown> }) => Promise<void>) | undefined = repositories && baseAdapter ? async (job) => {
  const requirementId = job.payload.requirementId;
  if (typeof requirementId !== "string") throw new Error("Invalid base_push job payload");
  const requirement = await repositories.requirements.get(requirementId);
  if (!requirement) throw new Error("Base push requirement was not found");
  const source = await repositories.sources.get(requirement.sourceConfigId);
  if (!source?.externalProjectId) throw new Error("Base push source project is not configured");
  const expectedSourceVersion = job.payload.sourceVersion;
  if (typeof expectedSourceVersion === "number" && expectedSourceVersion !== requirement.sourceVersion) return;
  const latestAnalysis = await repositories.analyses.latest(requirement.id);
  const expectedAnalysisVersion = job.payload.analysisVersion;
  if (typeof expectedAnalysisVersion === "number" && expectedAnalysisVersion !== (latestAnalysis?.analysisVersion ?? 0)) return;
  const service = createBasePushService({
    requirements: repositories.requirements, people: repositories.people, basePushes: repositories.basePushes,
    audit: repositories.audit, analyses: repositories.analyses, sourceSnapshots: repositories.sourceSnapshots, base: baseAdapter, sourceProjectId: source.externalProjectId, baseFields, actorId: typeof job.payload.actorId === "string" ? job.payload.actorId : null,
  });
  const idempotencyKey = typeof job.payload.idempotencyKey === "string"
    ? job.payload.idempotencyKey
    : basePushIdempotencyKey(requirementId, requirement.sourceVersion, latestAnalysis?.analysisVersion ?? 0);
  const outcome = await service.pushRequirement(requirementId, idempotencyKey);
  if (outcome.kind === "error") throw new Error("Base push failed; retry is available.");
  // conflict：pull 未同步或等待人工映射——等待不是失败，人工映射持久化后会重新入队
} : undefined;

const worker = repositories ? new PipelineJobWorker({
  jobs: repositories.jobs, ...(syncJobRunner ? { sync: syncJobRunner } : {}),
  handlers: {
    ...(analysisJobHandler ? { analysis: analysisJobHandler } : {}),
    ...(basePushJobHandler ? { base_push: basePushJobHandler } : {}),
  },
  workerId: process.env.WORKER_ID ?? "local-worker", leaseMs: 30_000,
}) : undefined;

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(key, value.join(", "));
      else if (value !== undefined) headers.set(key, value);
    }
    const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
      method: incoming.method ?? "GET", headers, ...(body.length > 0 ? { body } : {}),
    });
    const dependencies: ApiDependencies = { database, repositories, identity, ...(teambitionSourceProjects ? { teambitionSourceProjects } : {}), ...(feishuUserDirectory ? { feishuUsers: feishuUserDirectory } : {}), now: undefined };
    const response = await handleApiRequest(request, dependencies);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "application/json; charset=utf-8");
    outgoing.end(JSON.stringify(errorBody("INTERNAL")));
  }
});
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`RQ-Sys API listening on :${port}\n`);
  if (localIdentityNotice) process.stdout.write(`${localIdentityNotice}\n`);
});

// 本地开发轮询循环：WORKER_POLL_MS 未设置时不启动（不作为生产调度证据；目标环境定时触发由妙搭 automation 承担）
const workerPollMs = Number(process.env.WORKER_POLL_MS ?? 0);
let workerTimer: NodeJS.Timeout | undefined;
if (worker && repositories && workerPollMs > 0) {
  workerTimer = setInterval(() => {
    void (async () => {
      await createDueSyncJobs({ sources: repositories.sources, batches: repositories.batches, jobs: repositories.jobs, now: new Date() });
      await worker.runOnce();
    })().catch((error) => process.stderr.write(`worker tick failed: ${String(error)}\n`));
  }, workerPollMs);
  process.stdout.write(`Pipeline worker polling every ${workerPollMs}ms\n`);
}

async function shutdown(): Promise<void> {
  if (workerTimer) clearInterval(workerTimer);
  server.close();
  await database?.end();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
