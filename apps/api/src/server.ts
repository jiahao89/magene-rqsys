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
import { createBasePushService } from "./base/push-service.js";
import { createAnalysisAdvancer } from "./pipeline/advance.js";
import type { SourceProjectConfig } from "./domain/workflow.js";

const port = Number(process.env.PORT ?? 8787);
const database = createPool(process.env.DATABASE_URL);
const repositories = database ? new PostgresRepositories(database) : undefined;
const identity = repositories ? {
  async requireActor(_request: Request): Promise<{ id: string; roles: string[] }> {
    // Replace with the deployment's verified token/session identity adapter.
    throw new Error("No verified identity provider is configured");
  },
} : undefined;

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
    for (const touched of persistence.touchedRequirements()) {
      await repositories.jobs.enqueue({
        jobType: "analysis", dedupeKey: `analysis:${touched.id}:v${touched.sourceVersion}`,
        payload: { requirementId: touched.id, actorId: job.actorId }, availableAt: now,
      });
    }
  }
  return result;
} : undefined;

const analysisJobHandler: ((job: { payload: Record<string, unknown> }) => Promise<void>) | undefined = repositories ? async (job) => {
  const requirementId = job.payload.requirementId;
  if (typeof requirementId !== "string") throw new Error("Invalid analysis job payload");
  const requirement = await repositories.requirements.get(requirementId);
  if (!requirement) throw new Error("Analysis requirement was not found");
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
    title: requirement.title, description: requirement.description ?? "", context: requirement.scope ?? "",
    // 文本中可能出现的姓名（配置名单 + 需求 proposer/executor）一律掩码；用户 ID 不进 prompt
    piiMarkers: [...source.ownerNames, requirement.proposerName, requirement.executorName].filter((x): x is string => Boolean(x)),
    dictionary, priorityRule,
  }, { repository: new AnalysisRepositoryAdapter(repositories.analyses), provider });
  await repositories.requirements.updateAnalysisState(requirement.id, run.status === "analyzed" ? "analyzed" : "failed_retryable");
  // 工单 14：首次分析进入可见终态后继续负责人处理与 Base 推送——AI 不是推送门槛。
  // 无负责人 → not_required 直接入队；有负责人且映射唯一 → auto_mapped 入队；未匹配 → 等待人工映射。
  if (advanceAfterAnalysis) {
    await advanceAfterAnalysis(requirement.id, run.status === "analyzed" ? "analyzed" : "failed_retryable", typeof job.payload.actorId === "string" ? job.payload.actorId : null);
  }
} : undefined;

// ---- Feishu Base 推送装配：env 凭证齐全时构建真实 transport（工单 00/W7 目标环境验证）----
const DEFAULT_BASE_FIELDS = {
  projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
  source: { title: "标题", description: "需求说明", scope: "范围说明", acceptanceCriteria: "验收标准", proposerName: "提出人", statusId: "TB状态", sourceUrl: "TB链接" } as Record<string, string>,
  ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" } as Record<string, string>,
  pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"] as string[],
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
    };
  } catch {
    return DEFAULT_BASE_FIELDS;
  }
}
const baseFields = parseBaseFields(process.env.BASE_FIELDS_JSON);
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
const baseProjectId = process.env.BASE_PROJECT_ID ?? null;

const advanceAfterAnalysis = repositories ? createAnalysisAdvancer({
  requirements: repositories.requirements, people: repositories.people, jobs: repositories.jobs, audit: repositories.audit,
}) : undefined;

const basePushJobHandler: ((job: { payload: Record<string, unknown> }) => Promise<void>) | undefined = repositories && baseAdapter && baseProjectId ? async (job) => {
  const requirementId = job.payload.requirementId;
  if (typeof requirementId !== "string") throw new Error("Invalid base_push job payload");
  const requirement = await repositories.requirements.get(requirementId);
  if (!requirement) throw new Error("Base push requirement was not found");
  const service = createBasePushService({
    requirements: repositories.requirements, people: repositories.people, basePushes: repositories.basePushes,
    audit: repositories.audit, analyses: repositories.analyses, base: baseAdapter, baseProjectId, baseFields, actorId: null,
  });
  // 幂等键与 owner handler 的入队键一致：base-push:{reqId}:v{version}
  const outcome = await service.pushRequirement(requirementId, `base-push:${requirementId}:v${requirement.sourceVersion}`);
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
    const dependencies: ApiDependencies = { database, repositories, identity, now: undefined };
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
server.listen(port, "0.0.0.0", () => process.stdout.write(`RQ-Sys API listening on :${port}\n`));

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
