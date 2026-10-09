import { createServer } from "node:http";
import { createPool } from "./adapters/postgres/pool.js";
import { PostgresRepositories } from "./adapters/postgres/repositories.js";
import { type ApiDependencies, handleApiRequest } from "./http/app.js";
import { errorBody } from "./http/errors.js";
import { PipelineJobWorker } from "./jobs/worker.js";
import { SyncOrchestrator, type SyncJobRunner } from "./sync/service.js";
import { TeambitionClient } from "./adapters/teambition/client.js";
import { createDeepSeekProvider } from "./analysis/provider.js";
import { runAnalysis } from "./analysis/service.js";
import { AnalysisRepositoryAdapter } from "./analysis/repository-adapter.js";
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
  const orchestrator = new SyncOrchestrator(
    { async listRequirements(cfg) { return { items: await client.listRequirementTasks(cfg), hasMore: false, nextCursor: null }; } },
    {
      async findRequirement(sourceConfigId, sourceRequirementId) { return repositories.requirements.findForSync(sourceConfigId, sourceRequirementId); },
      async upsertRequirement(input) { return repositories.requirements.upsertRequirement(job.sourceConfigId, input.sourceRequirementId, { sourceHash: input.sourceHash, substantiveHash: input.substantiveHash, title: input.title, uniqueId: input.sourceUniqueId, description: input.mappedFields.description ?? null, scope: input.mappedFields.scope ?? null, acceptanceCriteria: input.mappedFields.acceptanceCriteria ?? null, proposerUserId: input.sourceCreatorId, proposerName: input.mappedFields.proposerName ?? null, executorUserId: input.sourceExecutorId, executorName: input.mappedFields.executorName ?? null, statusId: input.sourceStatusId, createdAt: input.sourceCreatedAt, updatedAt: input.sourceUpdatedAt, url: input.mappedFields.sourceUrl ?? null, payload: input.sourcePayload, attachmentRefs: input.mappedFields.attachmentRefs ?? [], customFields: input.mappedFields.customFields ?? [] }); },
      async appendSourceSnapshot(input) { await repositories.sourceSnapshots.append(input); },
      async writeSyncItem(input) { await repositories.items.upsert({ batchId: input.batchId, requirementId: input.requirementId, teambitionRequirementId: input.teambitionRequirementId, action: input.action, status: input.status, ...(input.errorCode === null ? {} : { errorCode: input.errorCode }), ...(input.errorDetail === null ? {} : { errorDetail: input.errorDetail }), completedAt: input.completedAt }); },
      async completeBatch(batchId, result) { await repositories.batches.complete(batchId, result); },
    },
  );
  return orchestrator.run({ batchId: job.batchId, sourceConfigId: job.sourceConfigId, config, ...(job.onlyIds === undefined ? {} : { onlyIds: job.onlyIds }) });
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
  // 优先级规则语义待首个已发布版本定义；未接入前 priority 保持为空（规则未发布时优先级为空）
  await repositories.priorityRules.getPublished();
  const provider = createDeepSeekProvider();
  await repositories.requirements.updateAnalysisState(requirement.id, "running");
  const run = await runAnalysis({
    requirementId: requirement.id, sourceVersion: requirement.sourceVersion, sourcePersisted: true,
    title: requirement.title, description: requirement.description ?? "", context: requirement.scope ?? "",
    piiMarkers: source.ownerNames, dictionary, priorityRule: null,
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

// 本地开发轮询循环：WORKER_POLL_MS 未设置时不启动（不作为生产调度证据）
const workerPollMs = Number(process.env.WORKER_POLL_MS ?? 0);
let workerTimer: NodeJS.Timeout | undefined;
if (worker && workerPollMs > 0) {
  workerTimer = setInterval(() => { void worker.runOnce().catch((error) => process.stderr.write(`worker runOnce failed: ${String(error)}\n`)); }, workerPollMs);
  process.stdout.write(`Pipeline worker polling every ${workerPollMs}ms\n`);
}

async function shutdown(): Promise<void> {
  if (workerTimer) clearInterval(workerTimer);
  server.close();
  await database?.end();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
