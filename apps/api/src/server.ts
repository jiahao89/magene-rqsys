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
  const published = (await repositories.moduleDictionaries.list()).find((version) => version.status === "published");
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
} : undefined;

const worker = repositories ? new PipelineJobWorker({
  jobs: repositories.jobs, ...(syncJobRunner ? { sync: syncJobRunner } : {}),
  handlers: { ...(analysisJobHandler ? { analysis: analysisJobHandler } : {}) },
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
