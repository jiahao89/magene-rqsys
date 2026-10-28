import { createServer } from "node:http";
import { createPool } from "./adapters/postgres/pool.js";
import { PostgresRepositories } from "./adapters/postgres/repositories.js";
import { createPostgresSyncPersistence } from "./adapters/postgres/sync-persistence.js";
import { type ApiDependencies, handleApiRequest } from "./http/app.js";
import { errorBody } from "./http/errors.js";
import { PipelineJobWorker } from "./jobs/worker.js";
import { SyncOrchestrator, shouldProcessSyncDownstream, type SyncJobRunner } from "./sync/service.js";
import { TeambitionClient } from "./adapters/teambition/client.js";
import { createRequirementWorkflow } from "./requirements/processing.js";
import { createDueSyncJobs } from "./scheduler/due-jobs.js";
import { reapOrphanedBatches } from "./scheduler/reap.js";
import { recoverAnalysisPipeline } from "./scheduler/analysis-recovery.js";
import { recheckOwnerMappings } from "./scheduler/owner-recheck.js";
import { FeishuBasePushAdapter } from "./base/client.js";
import { FeishuBitableClient } from "./base/transport.js";
import { RateLimitedBaseClient } from "./base/rate-limit.js";
import { FeishuUserDirectoryClient } from "./adapters/feishu/directory-client.js";
import { PEER_ADDRESS_HEADER, createLocalIdentityProvider, describeLocalIdentity } from "./http/local-identity.js";
import type { SourceProjectConfig } from "./domain/workflow.js";
import { assertFixtureWorkAllowed, createSyntheticFixtureTasks, isSyntheticFixtureSyncJob, readScheduledFixtureSource } from "./sync/test-fixture.js";

const port = Number(process.env.PORT ?? 8787);
const database = createPool(process.env.DATABASE_URL);
const repositories = database ? new PostgresRepositories(database) : undefined;
const fixtureEnvironment = { RQSYS_ENABLE_TEST_FIXTURES: process.env.RQSYS_ENABLE_TEST_FIXTURES, BASE_APP_TOKEN: process.env.BASE_APP_TOKEN, BASE_TABLE_ID: process.env.BASE_TABLE_ID, RQSYS_SCHEDULE_FIXTURE: process.env.RQSYS_SCHEDULE_FIXTURE };
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
try {
  teambitionSourceProjects = new TeambitionClient();
} catch (error) {
  // 不阻断启动（来源配置页会报告网关不可用），但必须留下可定位原因；只打印变量键名，绝不打印密钥值。
  process.stderr.write(`Teambition gateway is unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
}

// ---- Worker composition：认领 pipeline_jobs 并分发到对应执行器 ----
// 三个作业体（同步后推进 / analysis / base_push）的业务行为在 requirements/processing.ts
// 与妙搭仓共用；本文件只负责平台装配（env、worker 生命周期、日志出口）。
const syncJobRunner: SyncJobRunner | undefined = repositories ? async (job) => {
  const fixture = isSyntheticFixtureSyncJob(job);
  assertFixtureWorkAllowed({ sourceId: job.sourceConfigId, fixture }, fixtureEnvironment, new Date());
  const source = await repositories.sources.get(job.sourceConfigId);
  if (!source) throw new Error("Sync source configuration was not found");
  const config: SourceProjectConfig = {
    id: source.id, projectId: source.externalProjectId, projectName: source.externalProjectName,
    requirementTypeId: source.requirementTypeId, enabled: source.enabled,
    schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, weekdays: source.scheduleWeekdays ?? (source.scheduleWeekday === null ? null : [source.scheduleWeekday]), time: source.scheduleLocalTime, timezone: source.scheduleTimezone },
    ownerNames: source.ownerNames, fieldMap: source.fieldMap,
  };
  const persistence = createPostgresSyncPersistence(repositories, job.sourceConfigId);
  const taskSource = fixture
    ? { async listRequirements(cfg: SourceProjectConfig) { return { items: createSyntheticFixtureTasks(job.batchId, cfg.requirementTypeId, job.onlyIds), hasMore: false, nextCursor: null }; } }
    : { async listRequirements(cfg: SourceProjectConfig) { return { items: await new TeambitionClient().listRequirementTasks(cfg), hasMore: false, nextCursor: null }; } };
  const orchestrator = new SyncOrchestrator(taskSource, persistence);
  const result = await orchestrator.run({ batchId: job.batchId, sourceConfigId: job.sourceConfigId, config, ...(job.mode === undefined ? {} : { mode: job.mode }), ...(job.onlyIds === undefined ? {} : { onlyIds: job.onlyIds }) });
  // 打通同步 → AI 分析链路：下游推进（入队首分析 / 元数据推进）收敛在共用 workflow 模块。
  if (result.status !== "failed" && shouldProcessSyncDownstream(job.mode)) {
    if (!requirementWorkflow) throw new Error("Requirement workflow is not assembled");
    await requirementWorkflow.dispatchAfterSync({ touched: persistence.touchedRequirements(), actorId: job.actorId });
  }
  return result;
} : undefined;

const analysisJobHandler: ((job: { payload: Record<string, unknown> }) => Promise<void>) | undefined = repositories ? async (job) => {
  if (!requirementWorkflow) throw new Error("Requirement workflow is not assembled");
  await requirementWorkflow.handleAnalysisJob(job);
} : undefined;

// ---- Feishu Base 推送装配：env 凭证齐全时构建真实 transport（工单 00/W7 目标环境验证）----
const DEFAULT_BASE_FIELDS = {
  requirementId: "TB需求ID", platformRequirementId: "需求平台ID", owner: "执行人",
  // The selected TB project's custom-field type/binding is unverified. Only map
  // standard fields whose semantics and the Base column type are verified.
  source: { title: "标题", createdAt: "TB创建时间", sourceUrl: "TB地址" } as Record<string, string>,
  ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" } as Record<string, string>,
  pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"] as string[],
  metadata: { sourceVersion: "源版本", pushState: "推送状态", lastPushedAt: "最后推送时间" } as Record<string, string>,
  // 通知由 Base 自动化规则发送；应用只写四个通知「系统字段」，外加一个给 PM 点击的需求深链字段。
  // requirementLink 每次推送都写，与通知事件无关（首推静默也写）。
  // 用精确形状而不是 Record<string,string>，以便直接满足 BaseFieldMap.notification 的结构类型。
  notification: { eventId: "系统通知事件ID", eventType: "系统通知类型", recipient: "系统通知收件人", ownerMergeValue: "系统负责人通知归并值", requirementLink: "系统需求链接" },
  selectOptions: {
    // Verified against the safe POC Base schema; override via BASE_FIELDS_JSON
    // together with Base options when the product module dictionary changes.
    module: ["需求澄清", "方案设计", "缺陷修复", "其他"], priority: ["P0", "P1", "P2", "P3"],
  } as Record<string, string[]>,
};
function parseBaseFields(raw: string | undefined): typeof DEFAULT_BASE_FIELDS {
  if (!raw) return DEFAULT_BASE_FIELDS;
  try {
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_BASE_FIELDS>;
    const source = { ...DEFAULT_BASE_FIELDS.source, ...(parsed.source ?? {}) };
    if (source.sourceUrl === "TB链接") source.sourceUrl = "TB地址";
    return {
      requirementId: parsed.requirementId ?? DEFAULT_BASE_FIELDS.requirementId,
      platformRequirementId: parsed.platformRequirementId ?? DEFAULT_BASE_FIELDS.platformRequirementId,
      owner: parsed.owner ?? DEFAULT_BASE_FIELDS.owner,
      source,
      ai: { ...DEFAULT_BASE_FIELDS.ai, ...(parsed.ai ?? {}) },
      pm: Array.isArray(parsed.pm) ? parsed.pm : DEFAULT_BASE_FIELDS.pm,
      metadata: { ...DEFAULT_BASE_FIELDS.metadata, ...(parsed.metadata ?? {}) },
      // 缺省回落默认值：notification 整段缺失（或部分缺失）时仍指向 POC 验证过的四个通知字段与需求链接字段。
      notification: { ...DEFAULT_BASE_FIELDS.notification, ...(parsed.notification ?? {}) },
      selectOptions: { ...DEFAULT_BASE_FIELDS.selectOptions, ...(parsed.selectOptions ?? {}) },
    };
  } catch {
    return DEFAULT_BASE_FIELDS;
  }
}
const baseFields = parseBaseFields(process.env.BASE_FIELDS_JSON);
const feishuUserDirectory = process.env.FEISHU_USER_ACCESS_TOKEN
  ? new FeishuUserDirectoryClient({ userAccessToken: async () => process.env.FEISHU_USER_ACCESS_TOKEN ?? "" })
  : undefined;
const baseClient = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.BASE_APP_TOKEN && process.env.BASE_TABLE_ID
  ? new RateLimitedBaseClient(new FeishuBitableClient({
      appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET,
      appToken: process.env.BASE_APP_TOKEN, tableId: process.env.BASE_TABLE_ID,
      keyFields: { requirementId: baseFields.requirementId, ...(baseFields.platformRequirementId ? { platformRequirementId: baseFields.platformRequirementId } : {}) },
    }), {
      // 全量同步逐条写 Base（311 条 ≈ 数百次连续调用）。默认 100ms ≈ 10 次/秒，
      // 用 BASE_MIN_INTERVAL_MS 覆盖；设为 0 可关闭（仅保留串行化）。
      minIntervalMs: Number(process.env.BASE_MIN_INTERVAL_MS ?? 100),
    })
  : undefined;
const baseAdapter = baseClient && repositories
  ? new FeishuBasePushAdapter(baseClient, baseFields, {
      async savePmSnapshot(input) { await repositories.pmSnapshots.append({ ...input, capturedAt: new Date().toISOString() }); },
    })
  : undefined;
// 共用收录后主流程（V02-T01）：Base 凭据缺失时仍可分析与推进，仅推送作业不注册。
const requirementWorkflow = repositories
  ? createRequirementWorkflow({
      repositories,
      ...(baseAdapter ? { base: baseAdapter } : {}),
      baseFields,
      fixtureEnvironment,
      // 本地开发专用上限：只限制「入队分析」的数量，不同步范围。默认 0 = 不限制；目标环境不要设置。
      ...(Number(process.env.RQSYS_MAX_ANALYSIS_PER_SYNC ?? 0) > 0 ? { analysisEnqueueCap: Number(process.env.RQSYS_MAX_ANALYSIS_PER_SYNC) } : {}),
    })
  : undefined;
const basePushJobHandler: ((job: { payload: Record<string, unknown> }) => Promise<void>) | undefined = repositories && baseAdapter ? async (job) => {
  if (!requirementWorkflow) throw new Error("Requirement workflow is not assembled");
  await requirementWorkflow.handleBasePushJob(job);
  // conflict：等待人工映射不是失败，人工映射持久化后会重新入队（见 requirements/processing.ts）
} : undefined;

const worker = repositories ? new PipelineJobWorker({
  jobs: repositories.jobs, ...(syncJobRunner ? { sync: syncJobRunner } : {}),
  handlers: {
    ...(analysisJobHandler ? { analysis: analysisJobHandler } : {}),
    ...(basePushJobHandler ? { base_push: basePushJobHandler } : {}),
      ...(requirementWorkflow ? { kano_run: async (job: { payload: Record<string, unknown> }) => { await requirementWorkflow.handleKanoRunJob(job); } } : {}),
  },
  workerId: process.env.WORKER_ID ?? "local-worker",
  // 租约 120s + worker 心跳续约（每 1/3 租约时长）。此前 30s 且无心跳：
  // 一次 314 条同步或限流中的 Base 批量就会超过租约，另一个实例可能重复认领同一作业，
  // 而 fencing 只保护最终写入，挡不住重复的 AI 调用与 Base 写入。
  leaseMs: Number(process.env.WORKER_LEASE_MS ?? 120_000),
}) : undefined;

const server = createServer(async (incoming, outgoing) => {
  try {
    // 请求体上限：防止异常/恶意的超大 body 拖垮本地 dev server。
    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    for await (const chunk of incoming) {
      bodyBytes += chunk.length;
      if (bodyBytes > 1_048_576) {
        outgoing.statusCode = 413;
        outgoing.setHeader("content-type", "application/json; charset=utf-8");
        outgoing.end(JSON.stringify(errorBody("PAYLOAD_TOO_LARGE")));
        incoming.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(key, value.join(", "));
      else if (value !== undefined) headers.set(key, value);
    }
    // 对端地址只由这里从 socket 覆盖写入（客户端同名头不可信），供本地身份适配器做环回边界。
    headers.set(PEER_ADDRESS_HEADER, incoming.socket.remoteAddress ?? "");
    const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
      method: incoming.method ?? "GET", headers, ...(body.length > 0 ? { body } : {}),
    });
    const dependencies: ApiDependencies = { database, repositories, identity, ...(teambitionSourceProjects ? { teambitionSourceProjects } : {}), ...(feishuUserDirectory ? { feishuUsers: feishuUserDirectory } : {}), now: undefined };
    const response = await handleApiRequest(request, dependencies);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    // 未捕获异常此前直接变成裸 500、服务端零痕迹：没有路由、没有 actor、没有错误类，
    // 线上排障只能靠复现。这里只记录脱敏字段（路由 + 错误类名 + 结构化状态码），不写消息原文。
    const route = `${incoming.method ?? "GET"} ${String(incoming.url ?? "/").split("?")[0]}`;
    const kind = error instanceof Error ? error.name : typeof error;
    const status = (error as { statusCode?: number } | null)?.statusCode;
    process.stderr.write(`unhandled request error ${route} kind=${kind}${typeof status === "number" ? ` status=${status}` : ""}\n`);
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
      const now = new Date();
      const fixtureSourceId = readScheduledFixtureSource(fixtureEnvironment, now);
      // 先回收孤儿批次再建新批次：历史遗留的 running 批次会让并发守卫持续拒绝，
      // 来源被静默锁死。回收失败不阻断本轮调度。
      try {
        const reaped = await reapOrphanedBatches({ batches: repositories.batches, jobs: repositories.jobs, now });
        if (reaped.length > 0) {
          process.stdout.write(`reaped ${reaped.length} orphaned batch(es): ${reaped.map((row) => `${row.batchId}(${row.reason})`).join(", ")}\n`);
        }
      } catch (error) {
        process.stderr.write(`batch reaper failed: ${String(error)}\n`);
      }
      // createDueSyncJobs 内部按来源隔离失败；这里再兜一层，防止单个来源的未分类异常
      // 跳过本轮的分析恢复、负责人重查与 worker 消费。
      let outcomes: Awaited<ReturnType<typeof createDueSyncJobs>> = [];
      try {
        outcomes = await createDueSyncJobs({ sources: repositories.sources, batches: repositories.batches, jobs: repositories.jobs, now, ...(fixtureSourceId ? { fixtureSourceId } : {}) });
      } catch (error) {
        process.stderr.write(`due sync job creation failed: ${String(error)}\n`);
      }
      // 每个来源的失败原因必须落地：此前 error 字段被算出来又丢掉，来源静默不同步，
      // 批次/审计/UI 都看不到任何痕迹。
      for (const outcome of outcomes) {
        if (outcome.error) {
          process.stderr.write(`scheduled sync failed for source ${outcome.sourceConfigId}: ${outcome.error}\n`);
        }
      }
      // 分析阶段自动恢复：先收敛 running 崩溃残留（回退 failed_retryable），再补排可重试失败；
      // 本轮入队的重试作业会被随后的 worker 直接消费。恢复失败不阻断本轮调度。
      try {
        const recovery = await recoverAnalysisPipeline({
          requirements: repositories.requirements, analyses: repositories.analyses,
          jobs: repositories.jobs, audit: repositories.audit, now,
        });
        const retried = recovery.retried.filter((row) => row.action === "enqueued");
        const reverted = recovery.recovered.filter((row) => row.action === "reverted");
        const exhausted = recovery.retried.filter((row) => row.action === "exhausted" && row.reason === "retry_budget_exhausted");
        if (retried.length > 0) process.stdout.write(`auto-retried ${retried.length} failed analysis(es)\n`);
        if (reverted.length > 0) {
          process.stdout.write(`recovered ${reverted.length} stranded analysis(es): ${reverted.map((row) => `${row.requirementId}(${row.reason})`).join(", ")}\n`);
        }
        if (exhausted.length > 0) process.stderr.write(`gave up auto-retrying ${exhausted.length} analysis(es): retry budget exhausted\n`);
        for (const error of recovery.errors) process.stderr.write(`analysis recovery item failed: ${error}\n`);
      } catch (error) {
        process.stderr.write(`analysis recovery failed: ${String(error)}\n`);
      }
      // 负责人映射重新评估：人员映射补齐后，已分析完成但停在 pending_mapping 的需求
      // 不会自己前进。本轮只处理能解析出映射的需求（limit 25），按正常链路入队 base_push；
      // 解析不到的跳过且不写审计。失败不阻断本轮调度。
      try {
        const recheck = await recheckOwnerMappings({
          requirements: repositories.requirements, people: repositories.people,
          analyses: repositories.analyses, jobs: repositories.jobs, audit: repositories.audit, now,
        });
        if (recheck.enqueued > 0) process.stdout.write(`requeued ${recheck.enqueued} owner-mapped requirement(s) for Base push\n`);
        for (const error of recheck.errors) process.stderr.write(`owner mapping recheck item failed: ${error}\n`);
      } catch (error) {
        process.stderr.write(`owner mapping recheck failed: ${String(error)}\n`);
      }
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
