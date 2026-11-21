import type { Pool } from "pg";
import { normalizeOwnerName } from "../owner/mapping.js";
import { analysisForceDedupeKey, analysisRetryDedupeKey, analysisRunningJobKeys } from "../scheduler/analysis-recovery.js";
import { SourceProjectResolutionError, type FeishuUserDirectory, type FeishuUserSelectionResolver, type IdentityProvider, type TeambitionMemberDirectory, type TeambitionSourceProjectResolver } from "../application/ports.js";
import { isIntakeComplete, normalizeScheduleTime } from "../domain/workflow.js";
import { stableJson } from "../sync/hashes.js";
import { RICE_CONFIG_VERSION, RICE_EFFORT_UNIT, RICE_IMPACT_LEVELS, RICE_REACH_UNIT, computeRiceScore } from "../beta/rice.js";
import type { AuditEventRepository, AnalysisRunRepository, PipelineJobRepository, SourceConfigRepository, SyncBatchRepository, SyncItemRepository, PersonMappingRepository, RequirementQueryRepository, BasePushRunRepository, ModuleDictionaryRepository, PriorityRuleRepository, SourceSnapshotRepository, TeamDirectoryRepository, RequirementScoringRepository, RequirementAssessmentRepository, RequirementPrdPromptRepository } from "../application/repositories.js";
import type { PersonMappingRecord, AnalysisRunRecord, ModuleDictionaryVersionRecord, PriorityRuleVersionRecord, RequirementRecord, RequirementAssessmentRecord, RequirementPrdPromptRecord, SourceConfigRecord, SourceExecutorBinding, SourcePool, SyncBatchRecord, PipelineJobRecord } from "../domain/persistence.js";
import type { TeamPersonRecord } from "../domain/team-directory.js";
import { AnalysisContextUpdateSchema, AuditListQuerySchema, GateConfirmSchema, OpsJobsQuerySchema, OpsMetricsQuerySchema, RequirementExportQuerySchema, ClearDuplicateDecisionSchema, DuplicateDecisionSchema, PriorityOverrideUpdateSchema, RetryAnalysisRequestSchema, KanoEvidenceImportSchema, KanoRunRequestSchema, AudienceUpdateSchema, BatchListQuerySchema, RiceDraftUpdateSchema, FeishuUserSearchQuerySchema, OwnerMappingUpdateSchema, RequirementIntakeEditSchema, RequirementIntakeSchema, RequirementListQuerySchema, RequirementAssessmentInputSchema, PrdPromptRequestSchema, SyncIdempotencyHeaderSchema, SyncRunRequestSchema } from "../contracts/pipeline.js";
import { createHash, randomUUID } from "node:crypto";
import { ApplyAiScoringSchema, ManualScoringUpdateSchema, SCORING_FORMULA_TEXT, SCORING_THRESHOLDS, computeUmcScore } from "../analysis/scoring.js";
import { maskPii } from "../analysis/contract.js";
import { confirmGate, evaluateGates } from "../ops/gates.js";
import { priorityRuleThresholds } from "../analysis/priority-rule.js";
import { toCsv } from "../application/csv.js";
import { SourceConfigUpdateSchema, normalizeSourceSchedule, normalizeExecutorAllowlistNames, MAX_EXECUTOR_ALLOWLIST_SIZE, type ResolvedSourceConfigUpdate } from "../contracts/source.js";
import { DictionaryCreateSchema, PriorityRuleCreateSchema, TeamModulesSaveSchema, TeamPersonCreateSchema, TeamPersonFeishuBindSchema, TeamPersonRenameSchema } from "../contracts/rules.js";
import { DEFAULT_TEAM_MEMBERS } from "../domain/team-directory.js";
import { BASE_FORM_SYNC_STATE_FLAG } from "../base/form-sync.js";
import { isDatabaseReady } from "../adapters/postgres/health.js";
import { EXPECTED_LATEST_MIGRATION } from "../db/expected-migration.js";
import { jsonError, redactSecrets } from "./errors.js";
import { CHAT_PROMPT_VERSION, ChatDraftRequestSchema, createDraftRateLimiter, type ChatIntakeExtractor, type DraftRateLimit } from "../intake/chat-extract.js";
import { ASSESSMENT_RUNNING_STALE_MS, AssessmentContractError, type AssessmentRunner } from "../assessment/service.js";
import { PRD_PROMPT_RUNNING_STALE_MS, PrdPromptFailure, type PrdPromptRunner } from "../prd-prompt/service.js";
import { createPrdPromptRateLimiter, type PrdPromptRateLimit } from "../prd-prompt/rate-limit.js";
import { analysisPiiMarkers, loadDirectoryRosterNames } from "../requirements/processing.js";
import { readAiPause } from "../ops/ai-pause.js";
import { decodeRequirementCursor } from "../application/requirement-cursor.js";
import { decodeBatchCursor } from "../application/batch-cursor.js";
import { basePushIdempotencyKey } from "../application/idempotency-keys.js";

export interface ApiRepositories {
  sources: SourceConfigRepository;
  batches: SyncBatchRepository;
  items: SyncItemRepository;
  audit: AuditEventRepository;
  jobs: PipelineJobRepository;
  people?: PersonMappingRepository;
  requirements?: RequirementQueryRepository;
  basePushes?: BasePushRunRepository;
  analyses?: AnalysisRunRepository;
  assessments?: RequirementAssessmentRepository;
  prdPrompts?: RequirementPrdPromptRepository;
  sourceSnapshots?: SourceSnapshotRepository;
  dictionaries?: ModuleDictionaryRepository;
  priorityRules?: PriorityRuleRepository;
  directory?: TeamDirectoryRepository;
  scoring?: RequirementScoringRepository;
  ops?: import("../application/repositories.js").OpsMetricsRepository;
  flags?: import("../application/repositories.js").SystemFlagRepository;
}
export interface ApiDependencies {
  database: Pool | null;
  identity: IdentityProvider | undefined;
  repositories: ApiRepositories | undefined;
  teambitionSourceProjects?: TeambitionSourceProjectResolver;
  /** 集团池执行人名单解析：展示名 → TB user_id。未注入时保存集团池名单返回 503。 */
  teambitionMembers?: TeambitionMemberDirectory;
  feishuUsers?: FeishuUserDirectory;
  feishuUserSelections?: FeishuUserSelectionResolver;
  now: (() => Date) | undefined;
  /** Q2：Base 重复行标记；组合根未注入时判定不触达 Base。 */
  duplicateMarker?: (input: import("../base/duplicate-marker.js").DuplicateMarkInput) => Promise<import("../base/duplicate-marker.js").DuplicateMarkResult>;
  /** PRD-26：聊天一键复制的草稿抽取；未注入时接口返回 503，用户仍可手工填写。 */
  chatIntake?: { extractor: ChatIntakeExtractor; limit?: DraftRateLimit };
  /** 0030：按需需求评估；未注入时接口返回 503，详情页不可用。 */
  assessments?: AssessmentRunner;
  /** 2026-11-21：按需 PRD 提示词生成；未注入时接口返回 503。 */
  prdPrompt?: { runner: PrdPromptRunner; limit?: PrdPromptRateLimit };
  /** 目标环境的脱敏诊断通道；未注入时诊断落 stderr。只写错误类、SQLSTATE、状态码、字符数与请求号，不写 SQL、参数或聊天正文。 */
  diagnostics?: {
    error(event: "intake_draft_failed" | "overview_ai_stats_failed" | "assessment_failed", details: {
      errorClass?: string; textLength?: number; httpStatus?: number; requestId?: string;
      phase?: string; stat?: "analysis" | "intake"; errorType?: string; databaseCode?: string; causeType?: string;
      /** 评估输出契约不匹配时的字段路径（只含字段名，不含模型内容）。 */
      fields?: string;
    }): void;
  };
}
// 限流器随 chatIntake 对象缓存：妙搭每次请求展开新的依赖对象，但 chatIntake 引用稳定。
const draftRateLimiters = new WeakMap<object, ReturnType<typeof createDraftRateLimiter>>();
function draftRateLimiterFor(chatIntake: NonNullable<ApiDependencies["chatIntake"]>) {
  let limiter = draftRateLimiters.get(chatIntake);
  if (!limiter) { limiter = createDraftRateLimiter(chatIntake.limit); draftRateLimiters.set(chatIntake, limiter); }
  return limiter;
}
// 2026-11-21：PRD 提示词限流器同样随依赖对象缓存（妙搭每次请求展开新对象，runner 引用稳定）。
const prdPromptRateLimiters = new WeakMap<object, ReturnType<typeof createPrdPromptRateLimiter>>();
function prdPromptRateLimiterFor(dep: NonNullable<ApiDependencies["prdPrompt"]>) {
  let limiter = prdPromptRateLimiters.get(dep);
  if (!limiter) { limiter = createPrdPromptRateLimiter(dep.limit); prdPromptRateLimiters.set(dep, limiter); }
  return limiter;
}
function json(body: unknown, status = 200): Response { return Response.json(body, { status }); }
// 供应商限流时没有下发可用的 Retry-After 就按 60 秒提示；宁可多等，也不要让用户连点消耗额度。
const PROVIDER_RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
function rateLimited(waitSeconds: number, message: string): Response {
  const limited = jsonError("RATE_LIMITED", message);
  limited.headers.set("Retry-After", String(waitSeconds));
  return limited;
}
/** PRD-26：AI 配置类错误要进日志（只写错误类、状态码、字符数与请求号），否则密钥缺失这类事故永远表现为「暂时不可用」。 */
function reportIntakeFailure(dependencies: ApiDependencies, details: { errorClass: string; textLength: number; httpStatus?: number; requestId?: string }): void {
  if (dependencies.diagnostics) {
    try { dependencies.diagnostics.error("intake_draft_failed", details); } catch { /* 诊断失败不影响响应 */ }
    return;
  }
  process.stderr.write(`intake draft failed ${JSON.stringify(details)}\n`);
}
/** 评估输出契约失败：只落字段路径（字段名），不落模型返回内容。 */
function reportAssessmentFailure(dependencies: ApiDependencies, details: { errorClass: string; fields: string }): void {
  if (dependencies.diagnostics) {
    try { dependencies.diagnostics.error("assessment_failed", details); } catch { /* 诊断失败不影响响应 */ }
    return;
  }
  process.stderr.write(`assessment failed ${JSON.stringify(details)}\n`);
}
/** 统计失败诊断只取错误类型与 SQLSTATE（沿 cause 链）；SQL 文本、参数和正文一律不落日志——它们可能含需求正文或 ID。 */
function safeErrorType(error: unknown): string {
  if (typeof error !== "object" || error === null || !("constructor" in error)) return "unknown";
  const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(name) ? name : "unknown";
}
function safeDatabaseCode(error: unknown): string {
  let current = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 6 && typeof current === "object" && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown; originalError?: unknown };
    if (typeof candidate.code === "string" && /^[A-Z0-9]{5}$/.test(candidate.code)) return candidate.code;
    current = candidate.cause ?? candidate.originalError;
  }
  return "unknown";
}
function safeCauseType(error: unknown): string {
  let current = error;
  const seen = new Set<object>();
  let causeType = "unknown";
  for (let depth = 0; depth < 6 && typeof current === "object" && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    const candidate = current as { cause?: unknown; originalError?: unknown };
    const cause = candidate.cause ?? candidate.originalError;
    if (cause === undefined) break;
    causeType = safeErrorType(cause);
    current = cause;
  }
  return causeType;
}
/** 运维展示的 lastError 只保留类别摘要：复用通用脱敏，并把 Base record/table ID 掩码。 */
function redactBaseError(text: string): string {
  return redactSecrets(text)
    .replace(/\brec[A-Za-z0-9]{6,}\b/g, "rec…")
    .replace(/\btbl[A-Za-z0-9]{6,}\b/g, "tbl…")
    .slice(0, 200);
}
/** 数据源页展示收集表分享地址：只读环境变量；未配置/非法 URL 不返回，也不回传表 ID/record ID。 */
function baseFormShareUrl(): string | null {
  const raw = process.env.BASE_FORM_SHARE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}
/** 5b：收集表同步的运维状态只读 system_flags；字段做类型收敛，读不到时 baseForm 为 null 不影响其它指标。 */
function baseFormOpsState(value: Record<string, unknown>) {
  const num = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
  const shareUrl = baseFormShareUrl();
  return {
    ...(shareUrl === null ? {} : { shareUrl }),
    lastRunAt: typeof value.lastRunAt === "string" ? value.lastRunAt : null,
    pages: num(value.pages),
    scanned: num(value.scanned),
    skipped: num(value.skipped),
    created: num(value.created),
    recorded: num(value.recorded),
    rejected: num(value.rejected),
    writeBackFailed: num(value.writeBackFailed),
    readFailed: value.readFailed === true,
    lastError: typeof value.lastError === "string" ? redactBaseError(value.lastError) : null,
  };
}
function reportAiStatsFailure(dependencies: ApiDependencies, stat: "analysis" | "intake", error: unknown): void {
  const details = { phase: "overview_ai_stats", stat, errorType: safeErrorType(error), databaseCode: safeDatabaseCode(error), causeType: safeCauseType(error) };
  if (dependencies.diagnostics) {
    try { dependencies.diagnostics.error("overview_ai_stats_failed", details); } catch { /* 诊断失败不影响响应 */ }
    return;
  }
  process.stderr.write(`overview ai stats failed ${JSON.stringify(details)}\n`);
}
// 总览 AI 区：今日按 Asia/Shanghai 自然日切分（UTC+8，无夏令时）。计数口径是「调用次数」，不含 token。
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
function shanghaiDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - SHANGHAI_OFFSET_MS);
}
const AI_ANALYSIS_RESULTS: Record<string, "succeeded" | "failed"> = { analyzed: "succeeded", failed_retryable: "failed" };
const AI_INTAKE_RESULTS: Record<string, "succeeded" | "failed"> = { "intake.draft_extracted": "succeeded", "intake.draft_failed": "failed" };
const EMPTY_AI_ANALYSIS = { total: 0, today: 0, lastAt: null as string | null, lastStatus: null as string | null };
const EMPTY_AI_INTAKE = { total: 0, today: 0, lastAt: null as string | null, lastEventType: null as string | null };
/** 总览 AI 状态：未配置优先于暂停，暂停优先于正常；最近一次调用取分析与聊天抽取里更新的那条。 */
async function aiOverview(dependencies: ApiDependencies, repositories: ApiRepositories, now: Date) {
  const since = shanghaiDayStart(now).toISOString();
  const configured = Boolean(process.env.AI_API_KEY);
  let analysis = EMPTY_AI_ANALYSIS;
  let intake = EMPTY_AI_INTAKE;
  let statsAvailable = true;
  try {
    // 总览固定产品池：AI 调用统计也只看产品池，避免集团池数字混入。
    analysis = (await repositories.analyses?.aiCallStats?.(since, "product")) ?? EMPTY_AI_ANALYSIS;
  } catch (error) {
    // 统计失败只降级 AI 卡片：接口仍回 200 和 counts，不让整页总览跟着挂；错误类型与 SQLSTATE 进诊断日志。
    statsAvailable = false;
    reportAiStatsFailure(dependencies, "analysis", error);
  }
  if (statsAvailable) {
    try {
      intake = (await repositories.audit?.countByEntityType?.({ entityType: "intake", eventTypes: ["intake.draft_extracted", "intake.draft_failed"], since })) ?? EMPTY_AI_INTAKE;
    } catch (error) {
      statsAvailable = false;
      reportAiStatsFailure(dependencies, "intake", error);
    }
  }
  if (!statsAvailable) {
    return {
      status: "unavailable" as const,
      statsAvailable: false,
      pausedUntil: null,
      pauseReason: null,
      analysis: { total: 0, today: 0 },
      chatIntake: { total: 0, today: 0 },
      lastCall: { at: null, kind: null, result: null },
    };
  }
  const pause = await readAiPause(repositories.flags, now);
  const latest: { at: string; kind: "analysis" | "chat_intake"; result: "succeeded" | "failed" | null }[] = [];
  if (analysis.lastAt) latest.push({ at: analysis.lastAt, kind: "analysis", result: analysis.lastStatus ? AI_ANALYSIS_RESULTS[analysis.lastStatus] ?? null : null });
  if (intake.lastAt) latest.push({ at: intake.lastAt, kind: "chat_intake", result: intake.lastEventType ? AI_INTAKE_RESULTS[intake.lastEventType] ?? null : null });
  latest.sort((a, b) => b.at.localeCompare(a.at));
  const last = latest[0] ?? null;
  const status = !configured ? "unconfigured" : pause.paused ? "paused" : "ok";
  return {
    status,
    statsAvailable: true,
    pausedUntil: status === "paused" ? pause.until : null,
    pauseReason: status === "paused" ? pause.reason : null,
    analysis: { total: analysis.total, today: analysis.today },
    chatIntake: { total: intake.total, today: intake.today },
    lastCall: { at: last?.at ?? null, kind: last?.kind ?? null, result: last?.result ?? null },
  };
}
async function readMigrationStatus(database: Pool | null): Promise<{ latest: string | null; expected: string; upToDate: boolean | null; error?: string }> {
  try {
    const { rows } = await database!.query("SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1");
    const latest = typeof rows[0]?.filename === "string" ? rows[0].filename : null;
    return { latest, expected: EXPECTED_LATEST_MIGRATION, upToDate: latest === EXPECTED_LATEST_MIGRATION };
  } catch {
    // 空库、或目标平台不暴露应用迁移记录（Miaoda 迁移由平台回放，不写 schema_migrations）时不能判定。
    // upToDate=null 表示「未知」，不是「落后」；调用方不得据此提示用户去执行迁移。
    return { latest: null, expected: EXPECTED_LATEST_MIGRATION, upToDate: null, error: "migration_state_unavailable" };
  }
}
// PostgreSQL 的 uuid 列不接受任意字符串；路径里的非法 ID 必须在进入仓储层前收敛成 404，
// 否则查询会抛 22P02 并被兜底成 500（PRD 8.5 EQ-02）。只有真实数据库组合根强制 UUID；
// HTTP 单测使用短 ID 夹具，仓储替身不做 uuid 转换。
const UUID_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 路径里的畸形百分号编码（如 %E0%A4%A）会让 decodeURIComponent 抛 URIError；
// 这是客户端输入错误，必须收敛为 4xx，不能落进 server.ts 的 500 兜底。
function safeDecodePath(raw: string): string | null {
  try { return decodeURIComponent(raw); } catch { return null; }
}
function pathUuid(raw: string, dependencies: ApiDependencies): string | null {
  const value = safeDecodePath(raw);
  if (value === null) return null;
  if (dependencies.database && !UUID_PATH_RE.test(value)) return null;
  return value;
}
function sourceDto(source: SourceConfigRecord) {
  const pool: SourcePool = source.pool ?? "product";
  return {
    id: source.id,
    pool,
    projectName: source.externalProjectName,
    enabled: source.enabled,
    // 名单只回传展示名：TB user_id 是服务端解析细节，不下发浏览器。
    executorAllowlist: (source.executorAllowlist ?? []).map((binding) => binding.name),
    schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, weekdays: source.scheduleWeekdays ?? (source.scheduleWeekday === null ? null : [source.scheduleWeekday]), time: normalizeScheduleTime(source.scheduleLocalTime), timezone: source.scheduleTimezone },
  };
}
function batchDto(batch: SyncBatchRecord, pool: SourcePool = "product") {
  return { id: batch.id, pool, status: batch.status, triggerType: batch.triggerType, actorId: batch.actorId, totalCount: batch.totalCount, succeededCount: batch.succeededCount, failedCount: batch.failedCount, filteredCount: batch.filteredCount ?? 0, startedAt: batch.startedAt, completedAt: batch.completedAt, errorSummary: batch.errorSummary };
}
// Teambition 自建站的任务地址规则（由一条真实地址确认：/task/<任务ID>）。
const TEAMBITION_TASK_BASE_URL = process.env.RQSYS_TEAMBITION_TASK_BASE_URL ?? "https://teambition.magene.cn/task";
// Base 记录直达链接：飞书租户域名与 Base app/table 只有部署方知道，代码里不猜。
// 由 RQSYS_BASE_RECORD_URL_TEMPLATE 配置，必须是 https 且包含 {recordId}，例如
// https://<租户>.feishu.cn/base/<app>?table=<table>&record={recordId}。未配置或不合法时返回 null，
// 详情页只提供复制记录 ID。
// 集团池有自己的 Base，模板必须按池取；配错模板只会让人点开空表，所以缺配置时宁可返回 null。
function baseRecordUrl(recordId: string | null, pool: SourcePool = "product"): string | null {
  const envKey = pool === "group" ? "RQSYS_GROUP_BASE_RECORD_URL_TEMPLATE" : "RQSYS_BASE_RECORD_URL_TEMPLATE";
  const template = process.env[envKey]?.trim();
  if (!recordId || !template || !template.startsWith("https://") || !template.includes("{recordId}")) return null;
  return template.replaceAll("{recordId}", encodeURIComponent(recordId));
}
// 运维视图只回传作业元数据与安全错误摘要；payload 可能含 actorId/hash 等运行细节，
// dedupeKey 也可能内嵌 owner open_id 等人员标识，两者都不下发。
function opsJobDto(job: PipelineJobRecord) {
  return {
    id: job.id, jobType: job.jobType, status: job.status,
    attemptCount: job.attemptCount, maxAttempts: job.maxAttempts,
    availableAt: job.availableAt, lockedUntil: job.lockedUntil,
    lastErrorCode: job.lastErrorCode, lastErrorSummary: job.lastErrorSummary,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
    requirementId: typeof job.payload.requirementId === "string" ? job.payload.requirementId : null,
  };
}
function requirementResolutionDto(req: RequirementRecord) {
  const state = req.processingState ?? "active";
  if (state === "active") return null;
  return {
    decision: state === "suppressed_duplicate" ? "duplicate" as const : "ignored" as const,
    reviewState: "confirmed" as const,
    canonicalRequirementId: req.duplicateOfRequirementId ?? null,
    canonicalPlatformRequirementId: null,
    reason: null,
  };
}

function requirementDto(req: RequirementRecord, analysis: Record<string, unknown> | null = null, analyses: unknown[] = [], ownerName: string | null = null, currentScorePriority: RequirementRecord["currentScorePriority"] = null, pool: SourcePool | null = null) {
  // 展示字段：详情页 L1 需要标题/描述/负责人/更新时间；只加不改，避免破坏既有调用方。
  // ownerName 仅在详情接口注入（列表逐行查映射会 N+1），解析不到时为 null。
  return {
    id: req.id,
    // 重复决策派生的处理状态；active 时链路行为与旧版完全一致。
    processingState: req.processingState ?? "active",
    resolution: requirementResolutionDto(req),
    // V02-T26：人工优先级覆盖优先于当前评分版本；effectivePriority 供列表/详情直接展示（无覆盖/无评分时为 null）。
    priorityOverride: req.priorityOverride ? { priority: req.priorityOverride.priority, reason: req.priorityOverride.reason, actorId: req.priorityOverride.actorId, at: req.priorityOverride.at } : null,
    effectivePriority: req.priorityOverride?.priority ?? currentScorePriority ?? req.currentScorePriority ?? null,
    // V02-T26：人工补充上下文（详情/列表同构返回；不写 Base）。
    analysisContext: req.analysisContext ? { note: req.analysisContext.note, updatedAt: req.analysisContext.updatedAt, updatedBy: req.analysisContext.updatedBy } : null,
    // Q4：全量同步未再出现该需求的时间；只做提示，不影响处理/推送状态。
    sourceMissingSince: req.sourceMissingSince ?? null,
    sourceRequirementId: req.teambitionRequirementId,
    // V02-T02 加法：来源类型（teambition/web_manual）与业务渠道；TB 显示不变，手工预留已收录语义。
    sourceType: req.sourceType,
    // 0031：只读的池归属（详情接口注入；列表不带，页面按自己的 pool 参数区分）。
    ...(pool === null ? {} : { pool }),
    sourceChannel: req.sourceChannel,
    productModel: req.productModel,
    requirementType: req.requirementType,
    constraintNotes: req.constraintNotes,
    supplementUrl: req.supplementUrl,
    intakeModule: req.intakeModule,
    audience: { tags: req.audienceTags, confirmed: req.audienceConfirmed, version: req.audienceVersion },
    platformRequirementId: req.platformRequirementId ?? null,
    title: req.title,
    description: req.description,
    // PR-05：TB 执行人原始姓名（未映射时用于“待匹配负责人”分组；不替代映射后的 ownerName）。
    executorName: req.executorName ?? null,
    sourceVersion: req.sourceVersion,
    // 0030/F1：详情页「创建时间」读服务端字段；四种来源统一返回（加法，不替代 updatedAt）。
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
    sourceUrl: req.sourceType === "teambition" ? req.sourceUrl ?? `${TEAMBITION_TASK_BASE_URL}/${req.teambitionRequirementId}` : req.sourceUrl,
    lastPushedAt: req.lastPushedAt,
    ownerName,
    pipeline: { pull: req.pipeline.pull, analysis: req.pipeline.analysis, owner: req.pipeline.owner, push: req.pipeline.push },
    source: req.sourcePayload,
    analysis,
    baseRecordId: req.baseRecordId,
    baseRecordUrl: baseRecordUrl(req.baseRecordId, pool ?? "product"),
    manualOwner: req.manualOwner ? { feishuUserId: req.manualOwner.feishuUserId, feishuIdType: req.manualOwner.feishuIdType, name: req.manualOwner.name, assignedAt: req.manualOwner.assignedAt, assignmentVersion: req.manualOwner.assignmentVersion } : null,
    duplicateOf: req.duplicateOfRequirementId ?? null,
    analyses,
  };
}
// 历史分析版本摘要（Spec 02「prior versions as permitted」）：不含 structuredResult 正文，只留可追溯元数据；
// confidence 从存储枚举（high/medium/low，DDL CHECK）转回展示层中文，与详情 structuredResult 口径一致
function analysisVersionDto(r: AnalysisRunRecord) {
  return { analysisVersion: r.analysisVersion, status: r.status, moduleSuggestion: r.moduleSuggestion, confidence: r.confidence === "high" ? "高" : r.confidence === "medium" ? "中" : r.confidence === "low" ? "低" : null, priority: r.priority, provider: r.provider, model: r.model, promptVersion: r.promptVersion, moduleDictionaryVersion: r.moduleDictionaryVersion, priorityRuleVersionId: r.priorityRuleVersionId, startedAt: r.startedAt, completedAt: r.completedAt, safeErrorSummary: r.safeErrorSummary };
}
// 负责人映射展示：只含映射关系与匹配方式，不含个人联系方式
function mappingDto(m: PersonMappingRecord) {
  return { id: m.id, teambitionUserId: m.teambitionUserId, teambitionDisplayName: m.teambitionDisplayName, feishuUserId: m.feishuUserId, feishuIdType: m.feishuIdType, matchMethod: m.matchMethod, createdBy: m.createdBy, updatedAt: m.updatedAt };
}
// 人员页展示：名单 + 飞书账号绑定关系；bindingConflict 表示同名映射指向多个账号，需人工核对。
function personDto(person: TeamPersonRecord) {
  return { name: person.name, feishuUserId: person.binding?.feishuUserId ?? null, feishuIdType: person.binding?.feishuIdType ?? null, boundAt: person.binding?.boundAt ?? null, bindingConflict: person.bindingConflict };
}
function assessmentDto(r: RequirementAssessmentRecord) {
  return { id: r.id, requirementId: r.requirementId, version: r.version, status: r.status, promptVersion: r.promptVersion, model: r.model, inputs: r.inputs, output: r.output, errorCode: r.errorCode, createdAt: r.createdAt, completedAt: r.completedAt };
}
function prdPromptDto(r: RequirementPrdPromptRecord) {
  return {
    id: r.id, requirementId: r.requirementId, version: r.version, status: r.status,
    promptVersion: r.promptVersion, model: r.model, output: r.output, errorCode: r.errorCode,
    // 版本回填要还原当时的调研结论与评估版本；其它 inputs（需求快照、分析摘要）不回传。
    investigationNotes: typeof r.inputs.investigationNotes === "string" ? r.inputs.investigationNotes : "",
    assessmentVersion: typeof r.inputs.assessmentVersion === "number" ? r.inputs.assessmentVersion : null,
    createdAt: r.createdAt, completedAt: r.completedAt,
  };
}
function requirementSearchDto(req: RequirementRecord) { return requirementDto(req); }
// 逐条人工负责人优先于 TB 执行人映射；两者都没有时为空。
function manualOwnerName(req: RequirementRecord): string | null { return req.manualOwner?.name ?? null; }
function dictionaryDto(d: ModuleDictionaryVersionRecord) { return { version: d.version, status: d.status, entries: d.entries, createdBy: d.createdBy, createdAt: d.createdAt, publishedAt: d.publishedAt }; }
function priorityRuleDto(r: PriorityRuleVersionRecord) { return { id: r.id, version: r.version, status: r.status, rules: r.rules, validationEvidence: r.validationEvidence, createdBy: r.createdBy, createdAt: r.createdAt, publishedAt: r.publishedAt }; }
async function actorFor(request: Request, dependencies: ApiDependencies) {
  if (!dependencies.identity) return { response: jsonError("UNAUTHORIZED") } as const;
  try { return { actor: await dependencies.identity.requireActor(request) } as const; }
  catch { return { response: jsonError("UNAUTHORIZED") } as const; }
}

// 审计与业务写入保持一致：审计写失败时不返回虚假成功（工单 12 验收）。
async function appendAudit(repositories: ApiRepositories, event: Parameters<ApiRepositories["audit"]["append"]>[0]): Promise<Response | null> {
  try { await repositories.audit.append(event); return null; }
  catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
}
// 请求体传输上限：比任何合法 schema 都宽（最重的 Kano 资料导入约 1.3 MB），又不让我们无限缓冲。
// 超限在读取阶段就中断，不再把剩余字节拉进内存；schema 级上限（如 20,000 字）在校验阶段仍然生效。
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
class PayloadTooLargeError extends Error {
  constructor() { super("request body too large"); this.name = "PayloadTooLargeError"; }
}
async function readBodyText(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_JSON_BODY_BYTES) throw new PayloadTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BODY_BYTES) throw new PayloadTooLargeError();
      chunks.push(value);
    }
  } finally { try { await reader.cancel(); } catch { /* 已读完或已取消 */ } }
  if (chunks.length === 0) return "";
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}
async function readJson(request: Request): Promise<unknown> {
  try { const text = await readBodyText(request); return text ? JSON.parse(text) : undefined; }
  catch (error) { if (error instanceof PayloadTooLargeError) throw error; return undefined; }
}
// 人员/模块目录的冲突语义统一：业务冲突 409，其余按依赖不可用处理（不伪装成功）。
function directoryError(cause: unknown): Response {
  return (cause as Error)?.name === "TeamDirectoryConflict" ? jsonError("CONFLICT", (cause as Error).message) : jsonError("DEPENDENCY_UNAVAILABLE");
}
// 人工映射冲突（账号已绑定其他人员）返回 409；其余保持依赖不可用，不伪装成功。
async function mappingConflictResponse(action: () => Promise<PersonMappingRecord>): Promise<PersonMappingRecord | Response> {
  try { return await action(); }
  catch (cause) { return (cause as Error)?.name === "PersonMappingConflict" ? jsonError("CONFLICT", (cause as Error).message) : jsonError("DEPENDENCY_UNAVAILABLE"); }
}

/**
 * 集团池执行人姓名 → TB user_id。
 * 已解析过的名字直接复用当前来源的绑定（网关临时不可用时未改名单仍能保存）；
 * 其余名字走组织成员目录精确匹配；name 不区分大小写，同一名字多个账号按“未解析”处理。
 */
async function resolveExecutorAllowlist(
  names: string[],
  dependencies: ApiDependencies,
  existing: SourceExecutorBinding[] = [],
): Promise<SourceExecutorBinding[] | Response> {
  if (names.length === 0) return [];
  const byName = new Map(existing.map((binding) => [binding.name.normalize("NFC").toLocaleLowerCase(), binding]));
  const key = (value: string) => value.normalize("NFC").trim().toLocaleLowerCase();
  const pending = names.filter((name) => !byName.has(key(name)));
  if (pending.length > 0) {
    if (!dependencies.teambitionMembers) return jsonError("DEPENDENCY_UNAVAILABLE", "Teambition 成员目录未配置，暂时无法解析执行人名单。");
    let members: Array<{ userId: string; name: string }>;
    try { members = await dependencies.teambitionMembers.listOrganizationMembers(); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE", "无法读取 Teambition 组织成员，请稍后重试。"); }
    for (const name of pending) {
      const matches = members.filter((member) => key(member.name) === key(name));
      if (matches.length === 1) byName.set(key(name), { userId: String(matches[0]!.userId), name: matches[0]!.name });
    }
  }
  const unresolved = names.filter((name) => !byName.has(key(name)));
  if (unresolved.length > 0) {
    return jsonError("VALIDATION_FAILED", `以下执行人未在 Teambition 组织成员中唯一找到：${unresolved.join("、")}`, undefined, { unresolvedExecutorNames: unresolved });
  }
  return names.map((name) => byName.get(key(name))!);
}

async function resolveSourceConfig(
  update: ReturnType<typeof SourceConfigUpdateSchema.parse>,
  dependencies: ApiDependencies,
  current?: SourceConfigRecord,
): Promise<ResolvedSourceConfigUpdate | Response> {
  // 0031：池在创建时确定，更新不可改池（同一来源的批次/需求归属不能中途漂移）。
  const pool: SourcePool = current ? (current.pool ?? "product") : (update.pool ?? "product");
  if (current && update.pool !== undefined && update.pool !== pool) return jsonError("VALIDATION_FAILED", "来源所属池不可修改。");
  // 名单按“未传 = 保持现状”处理，避免旧客户端/局部更新把集团池名单清空。
  const requestedNames = update.executorAllowlist === undefined && current
    ? (current.executorAllowlist ?? []).map((binding) => binding.name)
    : normalizeExecutorAllowlistNames(update.executorAllowlist ?? []);
  if (pool === "product" && requestedNames.length > 0) return jsonError("VALIDATION_FAILED", "产品池不支持执行人名单。");
  if (requestedNames.length > MAX_EXECUTOR_ALLOWLIST_SIZE) return jsonError("VALIDATION_FAILED", `执行人名单最多 ${MAX_EXECUTOR_ALLOWLIST_SIZE} 个。`);
  if (pool === "group" && requestedNames.length === 0 && update.enabled) return jsonError("VALIDATION_FAILED", "请至少填写 1 个执行人后再启用同步。");
  const allowlist = await resolveExecutorAllowlist(requestedNames, dependencies, current?.executorAllowlist ?? []);
  if (allowlist instanceof Response) return allowlist;
  if (current && update.projectName === current.externalProjectName) {
    return { ...update, pool, executorAllowlist: allowlist, schedule: normalizeSourceSchedule(update.schedule), projectId: current.externalProjectId, requirementTypeId: current.requirementTypeId, ownerNames: current.ownerNames, fieldMap: current.fieldMap };
  }
  if (dependencies.teambitionSourceProjects) {
    try {
      // 集团池允许多候选里精确取「需求」，所以池要随解析请求一起传下去。
      const resolved = await dependencies.teambitionSourceProjects.resolveProject(update.projectName, { pool });
      return { ...update, pool, executorAllowlist: allowlist, schedule: normalizeSourceSchedule(update.schedule), projectId: resolved.projectId, requirementTypeId: resolved.requirementTypeId, ownerNames: [...DEFAULT_TEAM_MEMBERS], fieldMap: {} };
    } catch (cause) {
      if (cause instanceof SourceProjectResolutionError) return jsonError("VALIDATION_FAILED", cause.message);
      return jsonError("DEPENDENCY_UNAVAILABLE", "无法连接 Teambition 项目配置，请稍后重试。");
    }
  }
  return jsonError("DEPENDENCY_UNAVAILABLE", "Teambition 项目自动识别尚未配置。");
}

function sourcePool(source: SourceConfigRecord | null): SourcePool {
  return (source?.pool ?? "product");
}

/** 需求归属池：手工/多维表格需求没有来源配置，恒属产品池。 */
async function requirementPoolOf(repositories: ApiRepositories, requirement: RequirementRecord): Promise<SourcePool> {
  if (!requirement.sourceConfigId) return "product";
  return sourcePool(await repositories.sources.get(requirement.sourceConfigId));
}

/**
 * Q2 重复标记只对产品池生效：集团池 Base 是另一张表，产品池标记器写不过去，
 * 也不应该跨表写（跨池隔离优先于这个附加能力）。
 */
async function duplicateMarkerFor(
  dependencies: ApiDependencies,
  repositories: ApiRepositories,
  requirement: RequirementRecord,
): Promise<ApiDependencies["duplicateMarker"] | null> {
  if (!dependencies.duplicateMarker) return null;
  return (await requirementPoolOf(repositories, requirement)) === "product" ? dependencies.duplicateMarker : null;
}

// 集合/导出接口的路径段不是需求 ID；详情与写接口才是 UUID 推导作用域的对象。
const REQUIREMENT_COLLECTION_SEGMENTS = new Set(["export", "source-counts", "intake-draft"]);
/**
 * 详情/写接口显式带 pool 时的跨池守卫：与 UUID 归属不符固定 404（不返回 200 空数据/对方数据），
 * 不带 pool 时不拦截——服务端按 UUID 推导，返回只读 pool 供页面守卫。
 */
async function requirementPoolGuard(request: Request, url: URL, dependencies: ApiDependencies): Promise<Response | null> {
  const explicit = url.searchParams.get("pool");
  if (explicit === null) return null;
  if (!url.pathname.startsWith("/api/requirements/")) return null;
  const segment = url.pathname.slice("/api/requirements/".length).split("/")[0] ?? "";
  if (!segment || REQUIREMENT_COLLECTION_SEGMENTS.has(segment)) return null;
  const repositories = dependencies.repositories;
  if (!repositories?.requirements) return null;
  // 先认证再判池：未登录请求保持 401，不能靠守卫把“是否存在”泄露给匿名调用方。
  const auth = await actorFor(request, dependencies);
  if ("response" in auth) return auth.response;
  if (explicit !== "product" && explicit !== "group") return jsonError("VALIDATION_FAILED");
  let requirement: RequirementRecord | null;
  try { requirement = await repositories.requirements.get(segment); } catch { return null; }
  // 不存在时交给原处理器返回 404，避免守卫与业务路径给出不同错误体。
  if (!requirement) return null;
  return (await requirementPoolOf(repositories, requirement)) === explicit ? null : jsonError("NOT_FOUND");
}

export async function handleApiRequest(request: Request, dependencies: ApiDependencies): Promise<Response> {
  try { return await routeApiRequest(request, dependencies); }
  catch (error) {
    // 请求体超限是客户端可控的输入问题，回 413，不要漏成 500。
    if (error instanceof PayloadTooLargeError) return jsonError("PAYLOAD_TOO_LARGE", "请求体过大，请缩短后重试。");
    throw error;
  }
}
async function routeApiRequest(request: Request, dependencies: ApiDependencies): Promise<Response> {
  const url = new URL(request.url), method = request.method.toUpperCase(), repositories = dependencies.repositories;
  // 详情/写接口的显式 pool 与归属不符 → 404；不带 pool 的请求不受影响（零额外查询）。
  const poolGuardFailure = await requirementPoolGuard(request, url, dependencies);
  if (poolGuardFailure) return poolGuardFailure;
  if (method === "GET" && url.pathname === "/api/health") return json({ status: "ok", service: "rq-sys-api" });
  if (method === "GET" && url.pathname === "/api/health/ready") {
    if (!(await isDatabaseReady(dependencies.database))) return json({ status: "not_ready", reason: "database_unavailable_or_not_configured" }, 503);
    // 迁移滞后只提示，不把服务判死：数据库可用即 ready，运维页据此提醒先跑迁移。
    return json({ status: "ready", database: "connected", migrations: await readMigrationStatus(dependencies.database) });
  }
  if (method === "GET" && url.pathname === "/api/overview/metrics") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    // 总览固定产品池（Chief 决定 2026-11-21）：集团池数字只在其自身页头显示，不进入总览。
    const counts = await repositories.requirements.getPipelineCounts("product");
    const rule = await repositories.priorityRules?.getPublished();
    const rulePayload = rule?.rules as { thresholds?: { p0?: number; p1?: number; p2?: number } } | null;
    const ai = await aiOverview(dependencies, repositories, (dependencies.now ?? (() => new Date()))());
    return json({
      counts: {
        ...counts,
        priorityRule: rule ? {
          version: rule.version,
          thresholds: rulePayload?.thresholds ?? null,
          formulaText: SCORING_FORMULA_TEXT,
        } : null,
      },
      ai,
    });
  }
  if (method === "GET" && url.pathname === "/api/sources") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ items: (await repositories.sources.list()).map(sourceDto) });
  }
  if (method === "POST" && url.pathname === "/api/sources") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = SourceConfigUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    // 0031 起 D-09 的单来源约束改为“每个池最多一个来源”（(provider, pool) 唯一索引）。
    const requestedPool: SourcePool = parsed.data.pool ?? "product";
    const existing = await repositories.sources.list();
    if (existing.some((source) => (source.pool ?? "product") === requestedPool)) return jsonError("CONFLICT");
    const resolved = await resolveSourceConfig(parsed.data, dependencies); if (resolved instanceof Response) return resolved;
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    let created: SourceConfigRecord;
    try { created = await repositories.sources.create({ ...resolved, auditEvent: { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "source.created", entityType: "source_config", result: "succeeded", safeDetails: { sourceProjectId: resolved.projectId }, occurredAt: now } }); }
    catch (cause) { return cause && typeof cause === "object" && "code" in cause && cause.code === "23505" && "constraint" in cause && typeof cause.constraint === "string" && cause.constraint.startsWith("source_configs_") ? jsonError("CONFLICT") : jsonError("DEPENDENCY_UNAVAILABLE"); }
    return json(sourceDto(created), 201);
  }
  const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (method === "PUT" && sourceMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = SourceConfigUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const sourceId = pathUuid(sourceMatch[1]!, dependencies);
    if (!sourceId) return jsonError("NOT_FOUND");
    const current = await repositories.sources.get(sourceId);
    if (!current) return jsonError("NOT_FOUND");
    const resolved = await resolveSourceConfig(parsed.data, dependencies, current);
    if (resolved instanceof Response) return resolved;
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    let updated: SourceConfigRecord | null;
    try { updated = await repositories.sources.update(sourceId, resolved, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "source.config_updated", entityType: "source_config", result: "succeeded", safeDetails: { sourceProjectId: resolved.projectId }, occurredAt: now }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    if (!updated) return jsonError("NOT_FOUND");
    return json(sourceDto(updated));
  }
  if (method === "POST" && url.pathname === "/api/sync/run") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = SyncRunRequestSchema.safeParse(await readJson(request)), key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key"));
    if (!body.success || !key.success) return jsonError("VALIDATION_FAILED");
    const idempotencyKey = `${body.data.mode}:${createHash("sha256").update(key.data).digest("hex")}`;
    const source = await repositories.sources.get(body.data.sourceId); if (!source) return jsonError("NOT_FOUND");
    const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const previous = await repositories.batches.findByIdempotencyKey(source.id, idempotencyKey);
    if (previous) {
      // 已有活跃批次：幂等重放。已有终态批次（如入队失败被标 failed）：同一幂等键重新入队恢复，不制造孤儿/重复批次
      if (previous.status === "running") return json({ batchId: previous.id, status: previous.status }, 202);
      try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${source.id}:${idempotencyKey}`, payload: { batchId: previous.id, sourceId: source.id, triggerType: "manual", actorId: auth.actor.id, mode: body.data.mode }, availableAt: startedAt }); }
      catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
      const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "sync.retry_requested", entityType: "sync_batch", entityId: previous.id, result: "succeeded", safeDetails: { trigger: "manual", mode: body.data.mode }, occurredAt: startedAt });
      if (auditFailure) return auditFailure;
      return json({ batchId: previous.id, status: previous.status }, 202);
    }
    const active = await repositories.batches.list({ status: "running", limit: 100 });
    if (active.items.some((batch) => batch.sourceConfigId === source.id)) return jsonError("CONFLICT");
    let created: SyncBatchRecord;
    try { created = await repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: auth.actor.id, idempotencyKey, startedAt }); }
    catch {
      const raced = await repositories.batches.findByIdempotencyKey(source.id, idempotencyKey);
      return raced ? json({ batchId: raced.id, status: raced.status }, 202) : jsonError("CONFLICT");
    }
    try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${source.id}:${idempotencyKey}`, payload: { batchId: created.id, sourceId: source.id, triggerType: "manual", actorId: auth.actor.id, mode: body.data.mode }, availableAt: startedAt }); }
    catch {
      // 入队失败恢复（工单 15）：批次标记 failed，不留「running 且无 job」的孤儿；同幂等键重试可恢复
      await repositories.batches.complete(created.id, { status: "failed", totalCount: 0, succeededCount: 0, failedCount: 0, errorSummary: "Job enqueue failed; repeat the same idempotent request to recover.", completedAt: startedAt });
      return jsonError("DEPENDENCY_UNAVAILABLE");
    }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "sync.requested", entityType: "sync_batch", entityId: created.id, result: "succeeded", safeDetails: { trigger: "manual", mode: body.data.mode }, occurredAt: startedAt });
    if (auditFailure) return auditFailure;
    return json({ batchId: created.id, status: "running" }, 202);
  }
  if (method === "GET" && url.pathname === "/api/batches") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries()); if (query.limit !== undefined) query.limit = String(Number(query.limit));
    const parsed = BatchListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const batchCursor = decodeBatchCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && batchCursor === undefined) return jsonError("VALIDATION_FAILED", "Invalid cursor.");
    const page = await repositories.batches.list({ limit: parsed.data.limit, pool: parsed.data.pool, ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }), ...(batchCursor === undefined ? {} : { cursor: batchCursor }) }); return json({ items: page.items.map((item) => batchDto(item, parsed.data.pool)), nextCursor: page.nextCursor });
  }
  const batchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (method === "GET" && batchMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const batchId = pathUuid(batchMatch[1]!, dependencies); if (!batchId) return jsonError("NOT_FOUND");
    const batch = await repositories.batches.get(batchId); if (!batch) return jsonError("NOT_FOUND");
    const batchSource = batch.sourceConfigId ? await repositories.sources.get(batch.sourceConfigId) : null;
    return json({ ...batchDto(batch, sourcePool(batchSource)), items: await repositories.items.listByBatch(batch.id) });
  }
  if (method === "GET" && url.pathname === "/api/audit") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries()); if (query.limit !== undefined) query.limit = String(Number(query.limit));
    const parsed = AuditListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    return json({ items: await repositories.audit.search({ limit: parsed.data.limit, ...(parsed.data.entityId === undefined ? {} : { entityId: parsed.data.entityId }), ...(parsed.data.eventType === undefined ? {} : { eventType: parsed.data.eventType }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }) }) });
  }
  // PR-15：上线 Gate 当前状态（自动检查 + 人工确认），供状态页与发布判断使用。
  if (method === "GET" && url.pathname === "/api/ops/gates") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    const now = (dependencies.now ?? (() => new Date()))();
    return json(await evaluateGates({
      flags: repositories?.flags, requirements: repositories?.requirements,
      priorityRules: repositories?.priorityRules, env: process.env, now,
    }));
  }
  const opsGateMatch = url.pathname.match(/^\/api\/ops\/gates\/([A-Za-z0-9]+)$/);
  if (method === "PUT" && opsGateMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.flags || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = GateConfirmSchema.safeParse(await readJson(request).catch(() => null));
    if (!parsed.success) return jsonError("VALIDATION_FAILED");
    if (parsed.data.confirmed && !parsed.data.evidence) return jsonError("VALIDATION_FAILED", "确认通过时必须填写证据。");
    const now = (dependencies.now ?? (() => new Date()))();
    const result = await confirmGate({
      flags: repositories.flags, audit: repositories.audit, id: opsGateMatch[1]!,
      confirmed: parsed.data.confirmed, ...(parsed.data.evidence ? { evidence: parsed.data.evidence } : {}),
      actorId: auth.actor.id, now,
    });
    if (result.outcome === "invalid") return jsonError("NOT_FOUND");
    if (result.outcome === "unavailable") return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ gateId: opsGateMatch[1], confirmed: parsed.data.confirmed });
  }
  // 只读运维视图：失败的作业 + 尝试次数用尽且租约过期的运行中作业。
  // 不提供重试/清理动作，避免绕过状态机；修复由各自的恢复器/人工重试完成。
  if (method === "GET" && url.pathname === "/api/ops/jobs") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.jobs?.listFailed || !repositories.jobs.listExhaustedRunning) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries()); if (query.limit !== undefined) query.limit = String(Number(query.limit));
    const parsed = OpsJobsQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const [failed, stuck] = await Promise.all([
      repositories.jobs.listFailed(parsed.data.limit, parsed.data.pool),
      repositories.jobs.listExhaustedRunning(now, parsed.data.limit, parsed.data.pool),
    ]);
    return json({ now, items: { failed: failed.map(opsJobDto), stuck: stuck.map(opsJobDto) } });
  }
  // 运营指标（PRD §10）：窗口内的同步/分析/推送成功率与耗时 + 当前快照；只读。
  if (method === "GET" && url.pathname === "/api/ops/metrics") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.ops) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = OpsMetricsQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const metrics = await repositories.ops.getOpsMetrics({ days: parsed.data.days, now, pool: parsed.data.pool });
    let baseForm = null;
    if (repositories.flags) {
      try {
        const state = await repositories.flags.get(BASE_FORM_SYNC_STATE_FLAG);
        if (state && state.value && typeof state.value === "object") baseForm = baseFormOpsState(state.value);
      } catch { /* 同步状态不可用只让这一块为空，不影响其它运营指标 */ }
    }
    // 地址与统计解耦：配了 shareUrl 但同步状态缺失时仍返回 baseForm（统计按 0/null），两者都无才为 null。
    if (!baseForm && baseFormShareUrl()) baseForm = baseFormOpsState({});
    return json({ metrics: { ...metrics, baseForm } });
  }
  if (method === "GET" && url.pathname === "/api/rules/dictionary") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.dictionaries) return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ items: (await repositories.dictionaries.list()).map(dictionaryDto) });
  }
  if (method === "POST" && url.pathname === "/api/rules/dictionary") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.dictionaries) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = DictionaryCreateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const created = await repositories.dictionaries.create({ entries: body.data.entries, createdBy: auth.actor.id, now, auditEvent: { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "dictionary.created", entityType: "module_dictionary", result: "succeeded", safeDetails: { entryCount: body.data.entries.length }, occurredAt: now } });
    return json(dictionaryDto(created), 201);
  }
  if (method === "GET" && url.pathname === "/api/people") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ items: (await repositories.directory.listPeople()).map(personDto) });
  }
  if (method === "POST" && url.pathname === "/api/people") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = TeamPersonCreateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const items = await repositories.directory.addPerson(body.data.name, { id: randomUUID(), actorId: auth.actor.id, eventType: "team_person.created", entityType: "team_person", result: "succeeded", safeDetails: {}, occurredAt: now });
      return json({ items: items.map(personDto) }, 201);
    } catch (cause) { return directoryError(cause); }
  }
  const personFeishuMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/feishu$/);
  if (method === "PUT" && personFeishuMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = TeamPersonFeishuBindSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const name = safeDecodePath(personFeishuMatch[1]!); if (name === null) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const items = await repositories.directory.bindPersonFeishu(name, body.data, { id: randomUUID(), actorId: auth.actor.id, eventType: "team_person.feishu_bound", entityType: "team_person", result: "succeeded", safeDetails: {}, occurredAt: now });
      return json({ items: items.map(personDto) });
    } catch (cause) { return directoryError(cause); }
  }
  if (method === "DELETE" && personFeishuMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const name = safeDecodePath(personFeishuMatch[1]!); if (name === null) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const items = await repositories.directory.unbindPersonFeishu(name, { id: randomUUID(), actorId: auth.actor.id, eventType: "team_person.feishu_unbound", entityType: "team_person", result: "succeeded", safeDetails: {}, occurredAt: now });
      return json({ items: items.map(personDto) });
    } catch (cause) { return directoryError(cause); }
  }
  const personMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
  if (method === "PUT" && personMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = TeamPersonRenameSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const oldName = safeDecodePath(personMatch[1]!); if (oldName === null) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const items = await repositories.directory.renamePerson(oldName, body.data.name, { id: randomUUID(), actorId: auth.actor.id, eventType: "team_person.renamed", entityType: "team_person", result: "succeeded", safeDetails: {}, occurredAt: now });
      return json({ items: items.map(personDto) });
    } catch (cause) { return directoryError(cause); }
  }
  if (method === "DELETE" && personMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const name = safeDecodePath(personMatch[1]!); if (name === null) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const items = await repositories.directory.deletePerson(name, { id: randomUUID(), actorId: auth.actor.id, eventType: "team_person.deleted", entityType: "team_person", result: "succeeded", safeDetails: {}, occurredAt: now });
      return json({ items: items.map(personDto) });
    } catch (cause) { return directoryError(cause); }
  }
  if (method === "GET" && url.pathname === "/api/modules") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    return json(await repositories.directory.listModules());
  }
  if (method === "PUT" && url.pathname === "/api/modules") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = TeamModulesSaveSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      return json(await repositories.directory.saveModules(body.data.version, body.data.items.map((item) => ({ name: item.name, personName: item.personName ?? null })), auth.actor.id, now, { id: randomUUID(), actorId: auth.actor.id, eventType: "module_dictionary.updated", entityType: "module_dictionary", result: "succeeded", safeDetails: { entryCount: body.data.items.length }, occurredAt: now }));
    } catch (cause) { return directoryError(cause); }
  }
  const dictionaryPublishMatch = url.pathname.match(/^\/api\/rules\/dictionary\/(\d+)\/publish$/);
  if (method === "POST" && dictionaryPublishMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.dictionaries) return jsonError("DEPENDENCY_UNAVAILABLE");
    const version = Number(dictionaryPublishMatch[1]);
    const existing = await repositories.dictionaries.get(version);
    if (!existing) return jsonError("NOT_FOUND");
    if (existing.status !== "draft") return jsonError("CONFLICT");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const published = await repositories.dictionaries.publish(version, now, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "dictionary.published", entityType: "module_dictionary", result: "succeeded", safeDetails: { entryCount: existing.entries.length }, occurredAt: now });
    return json(dictionaryDto(published));
  }
  if (method === "GET" && url.pathname === "/api/rules/priority") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.priorityRules) return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ items: (await repositories.priorityRules.list()).map(priorityRuleDto) });
  }
  if (method === "POST" && url.pathname === "/api/rules/priority") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.priorityRules) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = PriorityRuleCreateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const created = await repositories.priorityRules.create({ rules: body.data.rules, validationEvidence: body.data.validationEvidence ?? [], createdBy: auth.actor.id, now, auditEvent: { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "priority_rule.created", entityType: "priority_rule", result: "succeeded", safeDetails: {}, occurredAt: now } });
    return json(priorityRuleDto(created), 201);
  }
  const rulePublishMatch = url.pathname.match(/^\/api\/rules\/priority\/([^/]+)\/publish$/);
  if (method === "POST" && rulePublishMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.priorityRules) return jsonError("DEPENDENCY_UNAVAILABLE");
    const id = pathUuid(rulePublishMatch[1]!, dependencies);
    if (!id) return jsonError("NOT_FOUND");
    const existing = await repositories.priorityRules.get(id);
    if (!existing) return jsonError("NOT_FOUND");
    if (existing.status !== "draft") return jsonError("CONFLICT");
    // V02-S06：v2 是用户已确认的固定公式（0019 迁移写入并退休旧规则），而本端点请求契约仍只接受 v1 形态。
    // v2 生效期间发布 v1 规则会让优先级回退到未校准的四维求和，因此拒绝发布（沿用已有冲突码 409）。
    const activeRule = await repositories.priorityRules.getPublished();
    const activeFormula = (activeRule?.rules as { formulaType?: unknown } | null | undefined)?.formulaType;
    const draftFormula = (existing.rules as { formulaType?: unknown } | null | undefined)?.formulaType;
    if (activeFormula === "umsc_weighted_v2" && draftFormula !== "umsc_weighted_v2") {
      return jsonError("CONFLICT", "A confirmed v2 scoring rule is published; legacy v1 rules cannot be published over it.");
    }
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const published = await repositories.priorityRules.publish(id, now, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "priority_rule.published", entityType: "priority_rule", result: "succeeded", safeDetails: {}, occurredAt: now });
    return json(priorityRuleDto(published));
  }
  if (method === "GET" && url.pathname === "/api/mappings") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.people || !repositories.sources) return jsonError("DEPENDENCY_UNAVAILABLE");
    // 单一来源（D-09）：返回当前来源的活跃映射；来源未配置时为空列表
    const source = (await repositories.sources.list())[0] ?? null;
    const items = source ? await repositories.people.listActive(source.id) : [];
    return json({ items: items.map(mappingDto) });
  }
  if (method === "GET" && url.pathname === "/api/feishu/users/resolve") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    const platformUserId = url.searchParams.get("platformUserId") ?? "";
    if (!/^\d{1,30}$/.test(platformUserId)) return jsonError("VALIDATION_FAILED");
    if (!dependencies.feishuUserSelections) return jsonError("DEPENDENCY_UNAVAILABLE");
    try {
      const user = await dependencies.feishuUserSelections.resolve(platformUserId);
      if (!user) return jsonError("NOT_FOUND", "所选成员尚未关联本企业飞书账号，请重新选择。");
      return json({ feishuUserId: user.feishuUserId, feishuIdType: user.feishuIdType, name: user.name });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE", "飞书人员身份转换暂不可用，请稍后重试。"); }
  }
  if (method === "GET" && url.pathname === "/api/feishu/users") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!dependencies.feishuUsers) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = FeishuUserSearchQuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
    if (!parsed.success) return jsonError("VALIDATION_FAILED");
    try { return json({ items: (await dependencies.feishuUsers.search(parsed.data.q)).slice(0, 20) }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  if (method === "POST" && url.pathname === "/api/requirements/intake-draft") {
    // PRD-26 / 5a：聊天文本 → 需求草稿。草稿不入库，确认后仍由 POST /api/requirements 创建。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.audit || !repositories.dictionaries) return jsonError("DEPENDENCY_UNAVAILABLE");
    if (!dependencies.chatIntake) return jsonError("DEPENDENCY_UNAVAILABLE", "聊天抽取暂不可用，请手工填写需求。");
    const draftBody = ChatDraftRequestSchema.safeParse(await readJson(request)); if (!draftBody.success) return jsonError("VALIDATION_FAILED");
    // 一次抽取一个请求号：成功与失败事件共用它，排障时能把两条审计串成一次操作。
    const requestId = randomUUID();
    const draftNow = (dependencies.now ?? (() => new Date()))();
    if ((await readAiPause(repositories.flags, draftNow)).paused) return jsonError("DEPENDENCY_UNAVAILABLE", "AI 额度暂时受限，请手工填写需求。");
    const wait = draftRateLimiterFor(dependencies.chatIntake).take(auth.actor.id, draftNow.getTime());
    if (wait !== null) return rateLimited(wait, "操作太频繁，请稍后再试。");
    // 词典是模型提示的一部分：读不到就回 503，不要把 DB 抖动漏成 500，也不要先花钱调一次模型。
    let draftModules: string[];
    try {
      const publishedModules = (await repositories.dictionaries.list()).find((version) => version.status === "published");
      draftModules = (publishedModules?.entries ?? []).map((entry) => typeof entry === "string" ? entry : String((entry as { name?: unknown }).name ?? entry));
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE", "功能模块词典暂时不可用，请稍后重试。"); }
    // 审计只记发起动作、字符数与请求号，不记聊天内容；写失败不阻断草稿（草稿不改变业务状态）。
    const auditDraft = async (result: "succeeded" | "failed", details: Record<string, unknown>) => {
      try { await repositories.audit.append({ id: randomUUID(), actorId: auth.actor.id, eventType: result === "succeeded" ? "intake.draft_extracted" : "intake.draft_failed", entityType: "intake", entityId: requestId, result, safeDetails: { requestId, promptVersion: CHAT_PROMPT_VERSION, textLength: Array.from(draftBody.data.text).length, ...details }, occurredAt: draftNow.toISOString() }); }
      catch { /* best effort */ }
    };
    let extraction: Awaited<ReturnType<ChatIntakeExtractor["extract"]>>;
    try { extraction = await dependencies.chatIntake.extractor.extract({ text: draftBody.data.text, modules: draftModules }); }
    catch (cause) {
      const errorClass = String((cause as { code?: unknown })?.code ?? "unknown");
      const rawStatus = (cause as { httpStatus?: unknown })?.httpStatus;
      const httpStatus = typeof rawStatus === "number" ? rawStatus : undefined;
      await auditDraft("failed", { errorClass, ...(httpStatus === undefined ? {} : { httpStatus }) });
      // 供应商限流可重试：给 429 + Retry-After，和「每用户限流」共用状态码但文案区分。
      if (errorClass === "rate_limited") return rateLimited(PROVIDER_RATE_LIMIT_RETRY_AFTER_SECONDS, "AI 服务当前限流，请稍后重试或手工填写需求。");
      // 密钥缺失/请求被拒是配置事故，不是临时故障：回 500 并落一条脱敏日志（错误类＋状态码，不含正文）。
      if (errorClass === "auth_error" || errorClass === "request_error") {
        reportIntakeFailure(dependencies, { errorClass, textLength: Array.from(draftBody.data.text).length, requestId, ...(httpStatus === undefined ? {} : { httpStatus }) });
        return jsonError("INTERNAL", "AI 整理服务异常，请手工填写需求。");
      }
      // timeout / network_error / analysis_failure：依赖暂不可用，可稍后重试。
      return jsonError("DEPENDENCY_UNAVAILABLE", "AI 暂时无法整理聊天内容，请手工填写需求。");
    }
    const { draft, fallback } = extraction;
    // 兜底也要如实记录：否则模型返回垃圾时审计同样显示成功，AI 真实成功率统计不出来。
    await auditDraft("succeeded", { fallback, aiFilledCount: draft.aiFilled.length });
    // 相似需求提示：标题是子串匹配（不是语义相似），先用完整标题，无结果再用标题前 8 个字。
    let similar: { id: string; platformRequirementId: string; title: string; sourceType: string }[] = [];
    try {
      const titleChars = Array.from(draft.title);
      let found = (await repositories.requirements.search({ q: draft.title, limit: 5 })).items;
      if (found.length === 0 && titleChars.length > 8) found = (await repositories.requirements.search({ q: titleChars.slice(0, 8).join(""), limit: 5 })).items;
      similar = found.slice(0, 5).map((item) => ({ id: item.id, platformRequirementId: item.platformRequirementId, title: item.title, sourceType: item.sourceType }));
    } catch { similar = []; }
    return json({ draft, similar, fallback, aiFilledCount: draft.aiFilled.length });
  }
  if (method === "POST" && url.pathname === "/api/requirements") {
    // V02-T04：Web 手工收录。actor、时间、来源类型与平台编号都由服务端生成；
    // 同幂等键同内容返回原结果，同键不同内容明确冲突（AC02/AC03）。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.audit || !repositories.dictionaries) return jsonError("DEPENDENCY_UNAVAILABLE");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const parsedBody = RequirementIntakeSchema.safeParse(await readJson(request)); if (!parsedBody.success) return jsonError("VALIDATION_FAILED");
    // 录入模块必须来自已发布词典（G-MODULE：Web 录入模块与 AI 建议分开，但同源受控）。
    if (parsedBody.data.intakeModule) {
      let names: string[];
      try {
        const published = (await repositories.dictionaries.list()).find((version) => version.status === "published");
        names = (published?.entries ?? []).map((entry) => typeof entry === "string" ? entry : String((entry as { name?: unknown }).name ?? entry));
      } catch { return jsonError("DEPENDENCY_UNAVAILABLE", "功能模块词典暂时不可用，请稍后重试。"); }
      if (!names.includes(parsedBody.data.intakeModule)) return jsonError("VALIDATION_FAILED", "功能模块不在已发布词典中。");
    }
    // POST 语义中可选字段 null 与省略等价（下方展开只保留真值）：哈希前归一化，
// 客户端重试时序列化差异（null vs 缺省）不会被误判为“同键不同内容”（复查 #8）。
    const canonicalBody = Object.fromEntries(Object.entries(parsedBody.data).filter(([, value]) => value !== null && value !== undefined));
    const requestHash = createHash("sha256").update(stableJson(canonicalBody)).digest("hex");
    let receipt: { requirementId: string; requestHash: string; actorId: string } | null;
    try { receipt = await repositories.requirements.findIntakeReceipt(key.data); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    if (receipt) {
      if (receipt.requestHash !== requestHash) return jsonError("CONFLICT", "该幂等键已用于不同的提交内容。");
      try {
        const existing = await repositories.requirements.get(receipt.requirementId);
        if (!existing) return jsonError("DEPENDENCY_UNAVAILABLE");
        return json({ requirementId: existing.id, platformRequirementId: existing.platformRequirementId, sourceType: "web_manual", status: "collected" }, 200);
      } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    }
    try {
      const created = await repositories.requirements.createManualRequirement({ idempotencyKey: key.data, actorId: auth.actor.id, requestHash, title: parsedBody.data.title, description: parsedBody.data.description, sourceChannel: parsedBody.data.sourceChannel, ...(parsedBody.data.productModel ? { productModel: parsedBody.data.productModel } : {}), ...(parsedBody.data.requirementType ? { requirementType: parsedBody.data.requirementType } : {}), ...(parsedBody.data.constraintNotes ? { constraintNotes: parsedBody.data.constraintNotes } : {}), ...(parsedBody.data.supplementUrl ? { supplementUrl: parsedBody.data.supplementUrl } : {}), ...(parsedBody.data.intakeModule ? { intakeModule: parsedBody.data.intakeModule } : {}), ...(parsedBody.data.intakeOrigin ? { intakeOrigin: parsedBody.data.intakeOrigin } : {}), ...(parsedBody.data.proposerName ? { proposerName: parsedBody.data.proposerName } : {}), ...(parsedBody.data.owner ? { owner: { feishuUserId: parsedBody.data.owner.feishuUserId, feishuIdType: parsedBody.data.owner.feishuIdType, ...(parsedBody.data.owner.tbDisplayName ? { name: parsedBody.data.owner.tbDisplayName } : {}) } } : {}) });
      if ("outcome" in created) return jsonError("CONFLICT", "该幂等键已用于不同的提交内容。");
      return json({ requirementId: created.requirementId, platformRequirementId: created.platformRequirementId, sourceType: "web_manual", status: "collected" }, created.replay ? 200 : 201);
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const intakeEditMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "PATCH" && intakeEditMatch) {
    // V02-T07/PRD-30：手工与多维表格编辑（base_form 只改平台侧，不回写收集表）。TB 事实只读；期望源版本 + 幂等键。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(intakeEditMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const parsedBody = RequirementIntakeEditSchema.safeParse(await readJson(request)); if (!parsedBody.success) return jsonError("VALIDATION_FAILED");
    const requestHash = createHash("sha256").update(stableJson(parsedBody.data)).digest("hex");
    const body = parsedBody.data;
    try {
      const result = await repositories.requirements.updateManualRequirement({
        requirementId, expectedSourceVersion: body.expectedSourceVersion, idempotencyKey: key.data, actorId: auth.actor.id, requestHash,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.sourceChannel !== undefined ? { sourceChannel: body.sourceChannel } : {}),
        ...(body.productModel !== undefined ? { productModel: body.productModel } : {}),
        ...(body.requirementType !== undefined ? { requirementType: body.requirementType } : {}),
        ...(body.constraintNotes !== undefined ? { constraintNotes: body.constraintNotes } : {}),
        ...(body.supplementUrl !== undefined ? { supplementUrl: body.supplementUrl } : {}),
      });
      if (result.outcome === "not_found") return jsonError("NOT_FOUND");
      if (result.outcome === "not_manual") return jsonError("CONFLICT", "Teambition 来源的事实由 Teambition 维护，Web 仅编辑手工/多维表格需求。");
      if (result.outcome === "key_conflict") return jsonError("CONFLICT", "该幂等键已用于不同的提交内容。");
      if (result.outcome === "version_conflict") return jsonError("CONFLICT", `版本冲突：该需求已被更新到源版本 ${result.currentSourceVersion}，请刷新后重试。`);
      return json({ requirementId, outcome: result.outcome, sourceVersion: result.sourceVersion, ...(result.outcome === "updated" || result.outcome === "replay" ? { substantiveChanged: result.substantiveChanged } : {}) }, 200);
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  if (method === "GET" && url.pathname === "/api/requirements") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = RequirementListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    // 优先级分诊视图（sort=priority_asc）按生效优先级排序且不分页：忽略游标，最多返回 100 条。
    const cursor = parsed.data.sort === "priority_asc" ? undefined : decodeRequirementCursor(parsed.data.cursor);
    if (parsed.data.sort !== "priority_asc" && parsed.data.cursor !== undefined && cursor === undefined) return jsonError("VALIDATION_FAILED", "Invalid cursor.");
    const page = await repositories.requirements.search({ ...(parsed.data.q === undefined ? {} : { q: parsed.data.q }), ...(parsed.data.executorName === undefined ? {} : { executorName: parsed.data.executorName }), ...(parsed.data.pullState === undefined ? {} : { pullState: parsed.data.pullState }), ...(parsed.data.analysisState === undefined ? {} : { analysisState: parsed.data.analysisState }), ...(parsed.data.ownerState === undefined ? {} : { ownerState: parsed.data.ownerState }), ...(parsed.data.pushState === undefined ? {} : { pushState: parsed.data.pushState }),
      ...(parsed.data.processingState === undefined ? {} : { processingState: parsed.data.processingState }), ...(parsed.data.priority === undefined ? {} : { priority: parsed.data.priority }), ...(parsed.data.source === undefined ? {} : { source: parsed.data.source }), pool: parsed.data.pool, ...(parsed.data.sort === undefined ? {} : { sort: parsed.data.sort }), ...(parsed.data.batchId === undefined ? {} : { batchId: parsed.data.batchId }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }), limit: parsed.data.limit, ...(cursor === undefined ? {} : { cursor }) });
    // 列表一次取回全部有效映射再按 TB 用户查名，避免逐行查询。
    // 空页时不能把空字符串传给 uuid 列：PostgreSQL 会以 22P02 拒绝，接口变成 500，
    // 因此只对页内真实出现过的来源查询映射。
    // 手工需求 sourceConfigId 为空：不查 TB 人员映射（V02-T02 起可空）。
    // 同一页可能混有手工需求与多个来源的需求：按页内出现的每个来源分别取映射，
    // 只用首行的 sourceConfigId 会让页首是手工需求时整页姓名都丢失。
    const pageSourceIds = [...new Set(page.items.map((item) => item.sourceConfigId).filter((id): id is string => Boolean(id)))];
    const mappings = repositories.people ? (await Promise.all(pageSourceIds.map((id) => repositories.people!.listActive(id)))).flat() : [];
    const nameByTbUser = new Map(mappings.filter((m) => m.teambitionUserId && m.teambitionDisplayName).map((m) => [`${m.sourceConfigId}:${m.teambitionUserId}`, m.teambitionDisplayName as string]));
    return json({
      items: page.items.map((item) => ({ ...requirementSearchDto(item), baseRecordUrl: baseRecordUrl(item.baseRecordId, parsed.data.pool), ownerName: manualOwnerName(item) ?? (item.executorUserId && item.sourceConfigId ? nameByTbUser.get(`${item.sourceConfigId}:${item.executorUserId}`) ?? null : null) })),
      nextCursor: page.nextCursor,
    });
  }
  // I3-2：需求池 CSV 导出。复用列表筛选（q/负责人/状态/优先级/批次/时间），忽略分页，上限 5000 条。
  if (method === "GET" && url.pathname === "/api/requirements/export") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = RequirementExportQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const exportLimit = 5000;
    const page = await repositories.requirements.search({
      ...(parsed.data.q === undefined ? {} : { q: parsed.data.q }), ...(parsed.data.executorName === undefined ? {} : { executorName: parsed.data.executorName }), pool: parsed.data.pool,
      ...(parsed.data.pullState === undefined ? {} : { pullState: parsed.data.pullState }), ...(parsed.data.analysisState === undefined ? {} : { analysisState: parsed.data.analysisState }),
      ...(parsed.data.ownerState === undefined ? {} : { ownerState: parsed.data.ownerState }), ...(parsed.data.pushState === undefined ? {} : { pushState: parsed.data.pushState }),
      ...(parsed.data.processingState === undefined ? {} : { processingState: parsed.data.processingState }), ...(parsed.data.priority === undefined ? {} : { priority: parsed.data.priority }),
      ...(parsed.data.source === undefined ? {} : { source: parsed.data.source }),
      ...(parsed.data.sort === undefined ? {} : { sort: parsed.data.sort }), ...(parsed.data.batchId === undefined ? {} : { batchId: parsed.data.batchId }),
      ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }),
      limit: exportLimit + 1,
    });
    const truncated = page.items.length > exportLimit;
    const rows = page.items.slice(0, exportLimit);
    const header = ["平台ID", "TB需求ID", "标题", "负责人", "生效优先级", "处理状态", "拉取", "分析", "负责人状态", "推送", "来源类型", "源版本", "Base记录ID", "来源已移除", "创建时间", "更新时间"];
    const body = rows.map((item) => [
      item.platformRequirementId, item.teambitionRequirementId ?? "", item.title,
      item.executorName ?? item.manualOwner?.name ?? "",
      item.priorityOverride?.priority ?? item.currentScorePriority ?? "",
      item.processingState ?? "active",
      item.pipeline.pull, item.pipeline.analysis, item.pipeline.owner, item.pipeline.push,
      item.sourceType, item.sourceVersion, item.baseRecordId ?? "", item.sourceMissingSince ?? "",
      item.createdAt, item.updatedAt,
    ]);
    const nowIso = (dependencies.now ?? (() => new Date()))().toISOString();
    return new Response("\uFEFF" + toCsv([header, ...body]), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rq-sys-requirements-${nowIso.slice(0, 10)}.csv"`,
        ...(truncated ? { "x-rq-truncated": "true" } : {}),
      },
    });
  }
  // 5c-2：来源 Tab 计数。与列表默认范围一致（只统计 active），四种来源互斥；失败时前端隐藏计数，不影响列表。
  if (method === "GET" && url.pathname === "/api/requirements/source-counts") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements?.sourceCounts) return jsonError("DEPENDENCY_UNAVAILABLE");
    const poolParam = url.searchParams.get("pool");
    if (poolParam !== null && poolParam !== "product" && poolParam !== "group") return jsonError("VALIDATION_FAILED");
    try {
      // 集团池页面只取 all 一个数字，不渲染五来源 Tab；接口仍按池统计。
      const counts = await repositories.requirements.sourceCounts((poolParam ?? "product") as SourcePool);
      return json({ counts });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  if (url.pathname === "/api/kano/evidence" && method === "GET") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const versions = await repositories.requirements.listKanoEvidence?.() ?? [];
    // 读取可见全部状态；只有 approved 且未标记 PII 的版本可被 T14 运行引用（模型输入门禁）。
    return json({ items: versions.map((v) => ({ id: v.id, version: v.version, title: v.title, sourceUrl: v.sourceUrl, sourceSection: v.sourceSection, summary: v.piiFlagged ? maskPii(v.summary, []) : v.summary, evidenceFragments: v.piiFlagged ? v.evidenceFragments.map((fragment) => ({ ...fragment, text: maskPii(fragment.text, []) })) : v.evidenceFragments, coverageNotes: v.coverageNotes, knownAudiences: v.knownAudiences, knownScenes: v.knownScenes, interviewDate: v.interviewDate, status: v.status, piiFlagged: v.piiFlagged, createdAt: v.createdAt, approvedAt: v.approvedAt })) });
  }
  if (url.pathname === "/api/kano/evidence" && method === "POST") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = KanoEvidenceImportSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    try {
      const created = await repositories.requirements.createKanoEvidence({ ...parsed.data, createdBy: auth.actor.id } as Parameters<NonNullable<typeof repositories.requirements.createKanoEvidence>>[0]);
      return json({ id: created.id, version: created.version, status: created.status, piiFlagged: created.piiFlagged }, 201);
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const kanoApproveMatch = url.pathname.match(/^\/api\/kano\/evidence\/([^/]+)\/approve$/);
  if (method === "POST" && kanoApproveMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    try {
      const evidenceId = pathUuid(kanoApproveMatch[1]!, dependencies); if (!evidenceId) return jsonError("NOT_FOUND");
      const result = await repositories.requirements.approveKanoEvidence?.(evidenceId, auth.actor.id);
      if (!result) return jsonError("DEPENDENCY_UNAVAILABLE");
      if (result.outcome === "not_found") return jsonError("NOT_FOUND");
      if (result.outcome === "pii_flagged") return jsonError("CONFLICT", "资料包含疑似个人信息，去标识化后重新导入再批准。");
      return json({ outcome: "approved" });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const kanoRunsMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/kano-runs$/);
  if ((method === "POST" || method === "GET") && kanoRunsMatch) {
    // V02-T14：手动触发 Kano 假设报告。仅引用已批准且未标记 PII 的资料版本；同需求同时只允许一个
    // 运行中的报告；运行独立入队（kano_run），失败不触碰主分析/推送/通知。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const kanoRequirementId = pathUuid(kanoRunsMatch[1]!, dependencies); if (!kanoRequirementId) return jsonError("NOT_FOUND");
    const requirement = await repositories.requirements.get(kanoRequirementId); if (!requirement) return jsonError("NOT_FOUND");
    if (method === "GET") {
      const runs = await repositories.requirements.listKanoRuns?.(requirement.id) ?? [];
      // 旧报告标明过期依据（AC08）：输入源版本或资料版本落后于当前时提示复核。
      const latestEvidence = ((await repositories.requirements.listKanoEvidence?.() ?? []).filter((v) => v.status === "approved").sort((a, b) => b.version - a.version)[0]?.version) ?? null;
      return json({ items: runs.map((run) => ({ ...run, staleInputs: run.sourceVersion !== requirement.sourceVersion || (latestEvidence !== null && run.evidenceVersion !== latestEvidence) })) });
    }
    const parsed = KanoRunRequestSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const evidence = ((await repositories.requirements.listKanoEvidence?.() ?? []).find((version) => version.version === parsed.data.evidenceVersion)) ?? null;
    if (!evidence || evidence.status !== "approved" || evidence.piiFlagged) return jsonError("CONFLICT", "资料版本未批准或包含未脱敏内容，不能作为 Kano 输入。");
    try {
      const result = await repositories.requirements.createKanoRun({
        requirementId: requirement.id, sourceVersion: requirement.sourceVersion,
        audienceSnapshot: { tags: requirement.audienceTags, confirmed: requirement.audienceConfirmed },
        evidenceVersion: evidence.version, promptVersion: "rq-kano-v1", createdBy: auth.actor.id,
      });
      if (result.outcome === "active_run_exists") return jsonError("CONFLICT", "该需求已有运行中的 Kano 报告，请等待完成后再重跑。");
      return json({ requirementId: requirement.id, runVersion: result.run.runVersion, status: "queued" }, 202);
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const riceMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/rice-draft$/);
  if ((method === "GET" || method === "PUT") && riceMatch) {
    // V02-T11：RICE Beta 草稿。保存只落草稿与历史：不入主队列、不触发 AI/推送/通知、
    // 不改主分析/优先级/PM 状态。量纲未获批 → 一律显示“待配置”，不出分数或排名。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const riceRequirementId = pathUuid(riceMatch[1]!, dependencies); if (!riceRequirementId) return jsonError("NOT_FOUND");
    const requirement = await repositories.requirements.get(riceRequirementId); if (!requirement) return jsonError("NOT_FOUND");
    if (method === "GET") {
      const draft = await repositories.requirements.getRiceDraft?.(requirement.id) ?? null;
      const inputs = draft ? { reach: draft.reachInput, impact: draft.impactInput, confidence: draft.confidenceInput, effort: draft.effortInput } : { reach: null, impact: null, confidence: null, effort: null };
      // V02-T12：量纲已确认（rice-v1，2026-10-25）。完整且合法的输入给出可复算分数；
      // 缺项/非法值一律待补充，不输出 NaN/Infinity/0 分兜底。
      const scored = computeRiceScore(inputs);
      return json({ requirementId: requirement.id, inputs, notes: draft?.notes ?? null, sourceVersion: draft?.sourceVersion ?? requirement.sourceVersion, editVersion: draft?.editVersion ?? 0, updatedBy: draft?.updatedBy ?? null, updatedAt: draft?.updatedAt ?? null, status: scored.status === "computed" ? "已计算" : "待补充", score: scored.score, configVersion: RICE_CONFIG_VERSION, units: { reach: RICE_REACH_UNIT, effort: RICE_EFFORT_UNIT }, impactLevels: RICE_IMPACT_LEVELS });
    }
    const parsed = RiceDraftUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    try {
      const result = await repositories.requirements.saveRiceDraft({
        requirementId: requirement.id, expectedEditVersion: parsed.data.expectedEditVersion, actorId: auth.actor.id, sourceVersion: requirement.sourceVersion,
        ...(parsed.data.reach !== undefined ? { reachInput: parsed.data.reach } : {}),
        ...(parsed.data.impact !== undefined ? { impactInput: parsed.data.impact } : {}),
        ...(parsed.data.confidence !== undefined ? { confidenceInput: parsed.data.confidence } : {}),
        ...(parsed.data.effort !== undefined ? { effortInput: parsed.data.effort } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      });
      if (result.outcome === "version_conflict") return jsonError("CONFLICT", `草稿已被他人更新到版本 ${result.currentEditVersion}，请刷新后重试。`);
      // 需求源内容在编辑期间前进：草稿基于过期基线，拒绝以免按旧输入出分；提示刷新后按当前源重填。
      if (result.outcome === "source_version_conflict") return jsonError("CONFLICT", `需求内容已更新到源版本 ${result.currentSourceVersion}，请刷新后重试。`);
      // 保存后按落库结果重算状态，避免响应写死“待配置”而紧接着的 GET 显示“已计算”。
      const savedDraft = await repositories.requirements.getRiceDraft?.(requirement.id) ?? null;
      const savedInputs = savedDraft ? { reach: savedDraft.reachInput, impact: savedDraft.impactInput, confidence: savedDraft.confidenceInput, effort: savedDraft.effortInput } : { reach: null, impact: null, confidence: null, effort: null };
      const scored = computeRiceScore(savedInputs);
      return json({ requirementId: requirement.id, editVersion: result.editVersion, status: scored.status === "computed" ? "已计算" : "待补充", score: scored.score, configVersion: RICE_CONFIG_VERSION });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const audienceMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/audience$/);
  if (method === "PUT" && audienceMatch) {
    // V02-T09：人工人群标签。只落库与审计：不改优先级、不重置 Base PM 状态、不触发 AI/推送/通知。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = AudienceUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    try {
      const audienceRequirementId = pathUuid(audienceMatch[1]!, dependencies); if (!audienceRequirementId) return jsonError("NOT_FOUND");
      const result = await repositories.requirements.setAudienceTags(audienceRequirementId, { tags: parsed.data.tags, expectedVersion: parsed.data.expectedVersion, actorId: auth.actor.id });
      if (result.outcome === "not_found") return jsonError("NOT_FOUND");
      if (result.outcome === "version_conflict") return jsonError("CONFLICT", `人群标签已被他人更新到版本 ${result.currentVersion}，请刷新后重试。`);
      return json({ requirementId: audienceRequirementId, audienceVersion: result.version, confirmed: true, tags: parsed.data.tags });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const scoringMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/scoring$/);
  if (scoringMatch && method === "PUT") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.scoring || !repositories.priorityRules) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(scoringMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const parsed = ManualScoringUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const requirement = await repositories.requirements.get(requirementId); if (!requirement) return jsonError("NOT_FOUND");
    const rule = await repositories.priorityRules.getPublished();
    if (!rule || (rule.rules as Record<string, unknown>).formulaType !== "umsc_weighted_v2") return jsonError("CONFLICT", "评分规则未发布");
    const latest = await repositories.analyses?.latest(requirement.id) ?? null;
    let computed: ReturnType<typeof computeUmcScore>;
    try { computed = computeUmcScore(parsed.data.inputs, parsed.data.alpha); } catch { return jsonError("VALIDATION_FAILED"); }
    const current = await repositories.scoring.current(requirement.id);
    const aiSuggestion = await repositories.scoring.aiSuggestion(requirement.id);
    const sourceScore = current ?? aiSuggestion;
    const auditEvent = { id: randomUUID(), actorId: auth.actor.id, eventType: "scoring.updated", entityType: "requirement", result: "succeeded" as const, safeDetails: { fromVersion: current?.version ?? 0, score: computed.score, priority: computed.priority }, occurredAt: (dependencies.now?.() ?? new Date()).toISOString() };
    const result = await repositories.scoring.saveManual({
      requirementId: requirement.id,
      expectedVersion: parsed.data.expectedVersion,
      sourceVersion: requirement.sourceVersion,
      analysisVersion: latest?.analysisVersion ?? null,
      ruleVersionId: rule.id,
      inputs: parsed.data.inputs as unknown as Record<string, unknown>,
      alpha: parsed.data.alpha,
      score: computed.score,
      priority: computed.priority,
      scoreConfidence: sourceScore?.scoreConfidence ?? null,
      scoreConfidenceReason: sourceScore?.scoreConfidenceReason ?? null,
      safetyFlag: parsed.data.safetyFlag ?? sourceScore?.safetyFlag ?? false,
      basis: sourceScore?.basis ?? {},
      rationale: parsed.data.reason,
      actorId: auth.actor.id,
      reason: parsed.data.reason,
      auditEvent,
    });
    if (result.outcome === "version_conflict") return jsonError("CONFLICT", `评分版本冲突，当前版本 ${result.currentVersion}`);
    return json({ scoring: result.version });
  }
  const applyAiMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/scoring\/apply-ai$/);
  if (applyAiMatch && method === "POST") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.scoring) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(applyAiMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const parsed = ApplyAiScoringSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const requirement = await repositories.requirements.get(requirementId); if (!requirement) return jsonError("NOT_FOUND");
    const current = await repositories.scoring.current(requirement.id);
    const auditEvent = { id: randomUUID(), actorId: auth.actor.id, eventType: "scoring.ai_applied", entityType: "requirement", result: "succeeded" as const, safeDetails: { fromVersion: current?.version ?? 0, aiVersion: parsed.data.aiVersion }, occurredAt: (dependencies.now?.() ?? new Date()).toISOString() };
    const result = await repositories.scoring.applyAi({ requirementId: requirement.id, expectedVersion: parsed.data.expectedVersion, aiVersion: parsed.data.aiVersion, actorId: auth.actor.id, reason: parsed.data.reason ?? null, auditEvent });
    if (result.outcome === "version_conflict") return jsonError("CONFLICT", `评分版本冲突，当前版本 ${result.currentVersion}`);
    if (result.outcome === "ai_not_found") return jsonError("NOT_FOUND");
    return json({ scoring: result.version });
  }
  // V02-T26：人工优先级覆盖（只影响应用内列表/详情/总览，不回写 Base）。
  const priorityOverrideMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/priority-override$/);
  if (method === "PUT" && priorityOverrideMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(priorityOverrideMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const parsed = PriorityOverrideUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const req = await repositories.requirements.get(requirementId); if (!req) return jsonError("NOT_FOUND");
    // 已压制需求不参与处理链路：人工优先级也不允许写入，避免“看起来已生效”。
    if ((req.processingState ?? "active") !== "active") return jsonError("CONFLICT", "该需求已被压制，请先撤销判定再设置人工优先级。");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const cleared = parsed.data.priority === null;
    const result = await repositories.requirements.setPriorityOverride(req.id, { priority: parsed.data.priority, reason: cleared ? null : parsed.data.reason, actorId: auth.actor.id, at: now });
    if (result.outcome === "not_found") return jsonError("NOT_FOUND");
    const auditFailure = await appendAudit(repositories, { id: randomUUID(), actorId: auth.actor.id, eventType: cleared ? "requirement.priority_override_cleared" : "requirement.priority_override_set", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { priority: parsed.data.priority, at: now }, occurredAt: now });
    if (auditFailure) return auditFailure;
    const currentScore = repositories.scoring ? await repositories.scoring.current(req.id) : null;
    return json({ requirementId: req.id, priorityOverride: result.override, effectivePriority: result.override?.priority ?? currentScore?.priority ?? null });
  }
  // V02-T26：分析补充上下文（只进入下一次分析请求，不写 Base）。
  const analysisContextMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/analysis-context$/);
  if (method === "PUT" && analysisContextMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(analysisContextMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const parsed = AnalysisContextUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const req = await repositories.requirements.get(requirementId); if (!req) return jsonError("NOT_FOUND");
    if ((req.processingState ?? "active") !== "active") return jsonError("CONFLICT", "该需求已被压制，请先撤销判定再补充上下文。");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const result = await repositories.requirements.setAnalysisContext(req.id, { context: parsed.data.context, actorId: auth.actor.id, at: now });
    if (result.outcome === "not_found") return jsonError("NOT_FOUND");
    const auditFailure = await appendAudit(repositories, { id: randomUUID(), actorId: auth.actor.id, eventType: "requirement.analysis_context_updated", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { cleared: parsed.data.context === null, at: now }, occurredAt: now });
    if (auditFailure) return auditFailure;
    return json({ requirementId: req.id, analysisContext: result.context });
  }
  // 0030：需求评估（按需生成）。GET 列历史版本；POST 生成一条新版本（同步调用模型，失败也保留 failed 版本）。
  const assessmentMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/assessments$/);
  if (assessmentMatch && (method === "GET" || method === "POST")) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const assessmentRequirementId = pathUuid(assessmentMatch[1]!, dependencies); if (!assessmentRequirementId) return jsonError("NOT_FOUND");
    let assessmentRequirement: RequirementRecord | null;
    try { assessmentRequirement = await repositories.requirements.get(assessmentRequirementId); } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    if (!assessmentRequirement) return jsonError("NOT_FOUND");
    if (method === "GET") {
      if (!repositories.assessments) return jsonError("DEPENDENCY_UNAVAILABLE");
      try {
        // PRD §4.10.5：running 超过 2 分钟不允许永久停在「生成中」，读取时兜底转 failed/timeout。
        const listNow = (dependencies.now ?? (() => new Date()))().toISOString();
        await repositories.assessments.expireStaleRunning(assessmentRequirementId, new Date(Date.parse(listNow) - ASSESSMENT_RUNNING_STALE_MS).toISOString(), listNow);
        return json({ items: (await repositories.assessments.list(assessmentRequirementId)).map(assessmentDto) });
      } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    }
    if (!dependencies.assessments) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsedAssessmentBody = RequirementAssessmentInputSchema.safeParse(await readJson(request)); if (!parsedAssessmentBody.success) return jsonError("VALIDATION_FAILED");
    const inputs = {
      ...(typeof parsedAssessmentBody.data.background === "string" && parsedAssessmentBody.data.background !== "" ? { background: parsedAssessmentBody.data.background } : {}),
      ...(typeof parsedAssessmentBody.data.goal === "string" && parsedAssessmentBody.data.goal !== "" ? { goal: parsedAssessmentBody.data.goal } : {}),
      ...(typeof parsedAssessmentBody.data.scenario === "string" && parsedAssessmentBody.data.scenario !== "" ? { scenario: parsedAssessmentBody.data.scenario } : {}),
    };
    try {
      // 评估在现有 AI 分析之上做判断；分析读取失败不阻塞评估，按「未提供」处理。
      const assessmentAnalysis = repositories.analyses
        ? await repositories.analyses.latest(assessmentRequirementId).catch(() => null)
        : null;
      // 与主分析同口径的 PII 名单：来源花名册 + 目录花名册 + 提出人/执行人。
      // 目录读取失败会写审计（loadDirectoryRosterNames），不再静默降级为空名单。
      const assessmentRosterNames: string[] = [];
      if (assessmentRequirement.sourceConfigId) {
        try { assessmentRosterNames.push(...(await repositories.sources.get(assessmentRequirement.sourceConfigId))?.ownerNames ?? []); }
        catch { /* 来源读取失败只降低掩码覆盖，不阻断评估 */ }
      }
      assessmentRosterNames.push(...await loadDirectoryRosterNames({ directory: repositories.directory, audit: repositories.audit }));
      const assessmentMarkers = analysisPiiMarkers(assessmentRequirement, assessmentRosterNames);
      return json(assessmentDto(await dependencies.assessments.run({ requirement: assessmentRequirement, inputs, actorId: auth.actor.id, analysis: assessmentAnalysis, piiMarkers: assessmentMarkers })), 201);
    } catch (cause) {
      // 与 intake 口径一致：单飞 409；限流 429 + Retry-After；密钥/请求配置事故 500；其余按依赖暂不可用。
      const errorClass = String((cause as { code?: unknown })?.code ?? "unknown");
      if (cause instanceof AssessmentContractError) reportAssessmentFailure(dependencies, { errorClass, fields: cause.fields.join(",") || "root" });
      if (errorClass === "assessment_in_progress") return jsonError("ASSESSMENT_IN_PROGRESS");
      if (errorClass === "rate_limited") return rateLimited(PROVIDER_RATE_LIMIT_RETRY_AFTER_SECONDS, "AI 评估请求太频繁，请稍后再试。");
      if (errorClass === "auth_error" || errorClass === "request_error") return jsonError("INTERNAL", "AI 评估服务异常，请稍后重试。");
      return jsonError("DEPENDENCY_UNAVAILABLE", "AI 评估暂时不可用，请稍后重试。");
    }
  }
  // 2026-11-21：PRD 提示词（按需生成）。GET 列版本；POST 生成一条新版本（同步调模型，失败也保留 failed 版本）。
  // 契约：requirement_prd_prompts / /prd-prompts / investigationNotes；不接收 pool，按需求 UUID 推导，两池都可用。
  const prdPromptMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/prd-prompts$/);
  if (prdPromptMatch && (method === "GET" || method === "POST")) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const prdRequirementId = pathUuid(prdPromptMatch[1]!, dependencies); if (!prdRequirementId) return jsonError("NOT_FOUND");
    let prdRequirement: RequirementRecord | null;
    try { prdRequirement = await repositories.requirements.get(prdRequirementId); } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    if (!prdRequirement) return jsonError("NOT_FOUND");
    if (!repositories.prdPrompts) return jsonError("DEPENDENCY_UNAVAILABLE");
    const prdNow = (dependencies.now ?? (() => new Date()))().toISOString();
    if (method === "GET") {
      try {
        // 规格 §4：running 超过 2 分钟不允许永久停在「生成中」，读取时兜底转 failed/timeout。
        await repositories.prdPrompts.expireStaleRunning(prdRequirementId, new Date(Date.parse(prdNow) - PRD_PROMPT_RUNNING_STALE_MS).toISOString(), prdNow);
        return json({ items: (await repositories.prdPrompts.list(prdRequirementId)).map(prdPromptDto) });
      } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    }
    if (!dependencies.prdPrompt) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsedPrdBody = PrdPromptRequestSchema.safeParse(await readJson(request)); if (!parsedPrdBody.success) return jsonError("VALIDATION_FAILED");
    if (!repositories.assessments) return jsonError("DEPENDENCY_UNAVAILABLE");
    let prdAssessment: RequirementAssessmentRecord | null;
    try {
      await repositories.assessments.expireStaleRunning(prdRequirementId, new Date(Date.parse(prdNow) - ASSESSMENT_RUNNING_STALE_MS).toISOString(), prdNow);
      const versions = await repositories.assessments.list(prdRequirementId);
      prdAssessment = parsedPrdBody.data.assessmentId
        ? versions.find((item) => item.id === parsedPrdBody.data.assessmentId) ?? null
        : versions.find((item) => item.status === "succeeded") ?? null;
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    // 显式指定评估：必须属于本需求且成功；不指定：用最新成功版本。
    if (parsedPrdBody.data.assessmentId && prdAssessment?.status !== "succeeded") return jsonError("VALIDATION_FAILED", "所选评估不存在或不是成功版本。");
    if (!prdAssessment) return jsonError("ASSESSMENT_REQUIRED");
    // 限流先于创建版本：超限不落库、不调模型。
    const prdLimit = prdPromptRateLimiterFor(dependencies.prdPrompt).check(auth.actor.id);
    if (!prdLimit.ok) return rateLimited(prdLimit.retryAfterSeconds ?? 60, "PRD 提示词生成太频繁，请稍后再试。");
    try {
      const prdAnalysis = repositories.analyses
        ? await repositories.analyses.latest(prdRequirementId).catch(() => null)
        : null;
      // 与评估同口径的 PII 名单：来源花名册 + 目录花名册 + 提出人/执行人。
      const prdRosterNames: string[] = [];
      if (prdRequirement.sourceConfigId) {
        try { prdRosterNames.push(...(await repositories.sources.get(prdRequirement.sourceConfigId))?.ownerNames ?? []); }
        catch { /* 来源读取失败只降低掩码覆盖，不阻断生成 */ }
      }
      prdRosterNames.push(...await loadDirectoryRosterNames({ directory: repositories.directory, audit: repositories.audit }));
      const prdMarkers = analysisPiiMarkers(prdRequirement, prdRosterNames);
      const record = await dependencies.prdPrompt.runner.run({
        requirement: prdRequirement,
        assessment: prdAssessment,
        investigationNotes: parsedPrdBody.data.investigationNotes,
        actorId: auth.actor.id,
        analysis: prdAnalysis,
        piiMarkers: prdMarkers,
      });
      return json(prdPromptDto(record), 201);
    } catch (cause) {
      const errorClass = String((cause as { code?: unknown })?.code ?? "unknown");
      if (errorClass === "prd_prompt_in_progress") return jsonError("PRD_PROMPT_IN_PROGRESS");
      if (cause instanceof PrdPromptFailure) {
        // 失败版本已落库（timeout / provider_error / invalid_output）；这里只回稳定错误码，不回显模型输出。
        if (errorClass === "timeout") return jsonError("DEPENDENCY_UNAVAILABLE", "PRD 提示词生成超时，请重试。");
        if (errorClass === "invalid_output") return jsonError("DEPENDENCY_UNAVAILABLE", "AI 返回的提示词不合规，请重试。");
        return jsonError("DEPENDENCY_UNAVAILABLE", "AI 暂时不可用，请稍后重试。");
      }
      return jsonError("DEPENDENCY_UNAVAILABLE", "PRD 提示词暂时不可用，请稍后重试。");
    }
  }
  const requirementMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "GET" && requirementMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(requirementMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const req = await repositories.requirements.get(requirementId); if (!req) return jsonError("NOT_FOUND");
    // 0031：详情按 UUID 推导池归属并只读返回；客户端不传 pool（显式不符已在上方守卫返回 404）。
    const detailPool = await requirementPoolOf(repositories, req);
    const latest = await repositories.analyses?.latest(req.id) ?? null;
    const history = await repositories.analyses?.listByRequirement(req.id) ?? [];
    // 负责人姓名：详情单条解析一次，解析不到返回 null；前端会退回只显示映射状态。
    let ownerName: string | null = manualOwnerName(req);
    if (req.sourceConfigId && (req.executorUserId || req.executorName)) {
      try {
        const mapping = await repositories.people?.resolveActive(req.sourceConfigId, req.executorUserId ? { tbUserId: req.executorUserId } : { normalizedName: normalizeOwnerName(req.executorName!) });
        ownerName = mapping?.teambitionDisplayName ?? null;
      } catch { /* 姓名是展示增强，解析失败不影响详情返回 */ }
    }
    const duplicates = await repositories.requirements.listDuplicates(req.id);
    const resolution = await repositories.requirements.getResolution?.(req.id) ?? null;
    const currentScore = repositories.scoring ? await repositories.scoring.current(req.id) : null;
    const aiScore = repositories.scoring ? await repositories.scoring.aiSuggestion(req.id) : null;
    const scoreHistory = repositories.scoring ? await repositories.scoring.list(req.id) : [];
    return json({
      ...requirementDto(req, latest && latest.status === "analyzed" ? latest.structuredResult : null, history.map(analysisVersionDto), ownerName, currentScore?.priority ?? null, detailPool),
      duplicates,
      resolution: resolution ?? requirementResolutionDto(req),
      scoring: {
        current: currentScore,
        aiSuggestion: aiScore,
        history: scoreHistory,
        formula: { text: SCORING_FORMULA_TEXT, thresholds: priorityRuleThresholds(await repositories.priorityRules?.getPublished()) ?? SCORING_THRESHOLDS },
      },
    });
  }
  const itemRetryMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/retry$/);
  if (method === "POST" && itemRetryMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.items || !repositories.batches || !repositories.jobs) return jsonError("DEPENDENCY_UNAVAILABLE");
    const itemId = pathUuid(itemRetryMatch[1]!, dependencies); if (!itemId) return jsonError("NOT_FOUND");
    const item = await repositories.items.get(itemId); if (!item) return jsonError("NOT_FOUND");
    if (item.status !== "failed") return jsonError("CONFLICT");
    const batch = await repositories.batches.get(item.batchId); if (!batch) return jsonError("NOT_FOUND");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    // A retry may arrive from a retry batch (`sync:<batchId>`) or the original
    // batch (`sync:<sourceId>:<idempotencyKey>`). Carry its mode forward.
    const originalJob = (await repositories.jobs.findByDedupeKey?.(`sync:${batch.id}`))
      ?? (await repositories.jobs.findByDedupeKey?.(`sync:${batch.sourceConfigId}:${batch.idempotencyKey}`));
    // The original job can be missing after retention/cleanup. The source batch
    // key is mode-namespaced, so use it as a durable fallback for safe retries.
    const mode = originalJob?.payload.mode === "source_only"
      || batch.idempotencyKey.startsWith("source_only:")
      || batch.idempotencyKey.startsWith("item-retry:source_only:")
      ? "source_only"
      : "full_pipeline";
    const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    // 键命名空间与 /api/sync/run 分开，并把条目 ID 纳入哈希：否则与同步键撞车会把重试
    // 挂到原批次上覆盖其计数，用同一键重试另一条也会静默复用旧批次。
    const retryIdempotencyKey = `item-retry:${mode}:${createHash("sha256").update(`${item.id}:${key.data}`).digest("hex")}`;
    let retryBatch = await repositories.batches.findByIdempotencyKey(batch.sourceConfigId, retryIdempotencyKey);
    if (!retryBatch) {
      try { retryBatch = await repositories.batches.create({ sourceConfigId: batch.sourceConfigId, triggerType: "manual", actorId: auth.actor.id, idempotencyKey: retryIdempotencyKey, startedAt }); }
      catch {
        retryBatch = await repositories.batches.findByIdempotencyKey(batch.sourceConfigId, retryIdempotencyKey);
        if (!retryBatch) return jsonError("CONFLICT");
      }
    }
    const retryDedupeKey = `sync:${retryBatch.id}`;
    const priorJob = await repositories.jobs.findByDedupeKey?.(retryDedupeKey);
    if (priorJob && ["queued", "running"].includes(priorJob.status)) return json({ batchId: retryBatch.id, status: "queued" }, 202);
    if (priorJob?.status === "succeeded") return json({ batchId: retryBatch.id, status: retryBatch.status }, 202);
    try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${retryBatch.id}`, payload: { batchId: retryBatch.id, sourceId: batch.sourceConfigId, triggerType: "manual", actorId: auth.actor.id, onlyIds: [item.teambitionRequirementId], mode }, availableAt: startedAt }); }
    catch {
      await repositories.batches.complete(retryBatch.id, { status: "failed", totalCount: 1, succeededCount: 0, failedCount: 1, errorSummary: "Job enqueue failed; repeat the retry to recover.", completedAt: startedAt });
      return jsonError("DEPENDENCY_UNAVAILABLE");
    }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "sync.item.retry_requested", entityType: "sync_item", entityId: item.id, result: "succeeded", safeDetails: { sourceRequirementId: item.teambitionRequirementId, trigger: "manual", mode }, occurredAt: startedAt });
    if (auditFailure) return auditFailure;
    return json({ batchId: retryBatch.id, status: "queued" }, 202);
  }
  const analysisRetryMatch = url.pathname.match(/^\/api\/analysis\/([^/]+)\/retry$/);
  if (method === "POST" && analysisRetryMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.jobs || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const analysisRequirementId = pathUuid(analysisRetryMatch[1]!, dependencies); if (!analysisRequirementId) return jsonError("NOT_FOUND");
    const req = await repositories.requirements.get(analysisRequirementId); if (!req) return jsonError("NOT_FOUND");
    const latestAnalysis = await repositories.analyses?.latest(req.id) ?? null;
    const priorAnalysisVersion = latestAnalysis?.analysisVersion ?? 0;
    let retryAllowed = ["pending", "failed_retryable", "analyzed"].includes(req.pipeline.analysis);
    if (!retryAllowed && req.pipeline.analysis === "running") {
      // 崩溃残留：handler 已把状态置为 running，但作业已终态或从未入队。
      // 放行重试（配合状态机的 running→running 自迁移），否则该需求只能手工改库。
      // running 的作业可能挂在三种键的任意一种上（首轮 v 键 / after prior / after prior-1），
      // 只查一种会把活着的分析误判成崩溃残留，造成双份 AI 调用与分析版本。
      const keys = analysisRunningJobKeys(req, priorAnalysisVersion);
      const jobs = await Promise.all(keys.map((key) => repositories.jobs.findByDedupeKey?.(key)));
      retryAllowed = !jobs.some((job) => job && ["queued", "running"].includes(job.status));
    }
    if (!isIntakeComplete(req.pipeline.pull) || !retryAllowed) return jsonError("CONFLICT");
    // V02-T26：可选 body { force?: boolean }。force=true 用于“保存补充上下文后立即重跑”，
    // 需要唯一 dedupe key 越过同源版本已分析的幂等短路（分析作业侧再按 payload.force 跳过守卫）。
    // 显式读 body 以区分“无 body”和“非法 JSON”：非法 JSON 返回 400，而不是静默按 false 处理。
    const retryText = await request.text().catch(() => "");
    let force = false;
    if (retryText.trim().length > 0) {
      let retryBody: unknown;
      try { retryBody = JSON.parse(retryText); } catch { return jsonError("VALIDATION_FAILED"); }
      const retryParsed = RetryAnalysisRequestSchema.safeParse(retryBody);
      if (!retryParsed.success) return jsonError("VALIDATION_FAILED");
      force = retryParsed.data.force === true;
    }
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    // force 键是确定性的（同一 sourceVersion/prior 只有一个）：重复点击、并发请求命中同一键而复用活作业，
    // 不会各自入队一份 AI 调用；作业 failed/cancelled 后同键入队由仓储重置。
    const dedupeKey = force ? analysisForceDedupeKey(req, priorAnalysisVersion) : analysisRetryDedupeKey(req, priorAnalysisVersion);
    const currentJob = await repositories.jobs.findByDedupeKey?.(dedupeKey);
    const auditRetry = (result: "succeeded" | "failed" | "denied", analysisStatus: string) => appendAudit(repositories, {
      id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "analysis.retry_requested", entityType: "requirement", entityId: req.id,
      result, safeDetails: { sourceVersion: req.sourceVersion, priorAnalysisVersion, analysisStatus, ...(force ? { force: true } : {}) }, occurredAt: now,
    });
    // force 不叠加第二条活跃分析：任一可能的分析作业（首轮/重试/force）仍 queued/running 时沿用它。
    if (force) {
      const liveJobs = await Promise.all(analysisRunningJobKeys(req, priorAnalysisVersion).map((key) => repositories.jobs.findByDedupeKey?.(key)));
      if (liveJobs.some((live) => live && ["queued", "running"].includes(live.status))) {
        const auditFailure = await auditRetry("succeeded", "reused_existing_job");
        if (auditFailure) return auditFailure;
        return json({ requirementId: req.id, status: "queued" }, 202);
      }
    }
    if (currentJob?.status === "queued" || currentJob?.status === "running") {
      const auditFailure = await auditRetry("succeeded", "reused_existing_job");
      if (auditFailure) return auditFailure;
      return json({ requirementId: req.id, status: "queued" }, 202);
    }
    if (currentJob?.status === "succeeded") {
      const auditFailure = await auditRetry("denied", "conflict_succeeded_job_pending_state");
      if (auditFailure) return auditFailure;
      return jsonError("CONFLICT");
    }
    try { await repositories.jobs.enqueue({ jobType: "analysis", dedupeKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, actorId: auth.actor.id, ...(force ? { force: true } : {}) }, availableAt: now }); }
    catch {
      const auditFailure = await auditRetry("failed", "enqueue_failed");
      if (auditFailure) return auditFailure;
      return jsonError("DEPENDENCY_UNAVAILABLE");
    }
    const auditFailure = await auditRetry("succeeded", "queued_new_job");
    if (auditFailure) return auditFailure;
    return json({ requirementId: req.id, status: "queued" }, 202);
  }
  const ownerMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/owner$/);
  if ((method === "PUT" || method === "DELETE") && ownerMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.people || !repositories.requirements || !repositories.jobs || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const ownerRequirementId = pathUuid(ownerMatch[1]!, dependencies); if (!ownerRequirementId) return jsonError("NOT_FOUND");
    const req = await repositories.requirements.get(ownerRequirementId); if (!req) return jsonError("NOT_FOUND");
    if (!isIntakeComplete(req.pipeline.pull)) return jsonError("CONFLICT");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const latestAnalysis = await repositories.analyses?.latest(req.id) ?? null;
    const analysisVersion = latestAnalysis?.analysisVersion ?? 0;
    if (method === "DELETE") {
      // 恢复默认负责人：清除本条需求的人工指定，再按 TB 执行人映射重新解析。
      // 历史上两步写入（先清除、后迁状态）中途失败会留下 manually_mapped 却没有人工负责人的行，
      // 这里不能再用 409 把它永远挡住：状态仍是 manually_mapped 时允许继续，借此自愈。
      if (!req.manualOwner && req.pipeline.owner !== "manually_mapped") return jsonError("CONFLICT", "该需求没有单独指定的负责人。");
      const hasTbOwner = Boolean(req.executorUserId || req.executorName);
      const mapping = req.sourceConfigId && req.executorUserId
        ? await repositories.people.resolveActive(req.sourceConfigId, { tbUserId: req.executorUserId })
        : req.sourceConfigId && req.executorName ? await repositories.people.resolveActive(req.sourceConfigId, { normalizedName: normalizeOwnerName(req.executorName) }) : null;
      const targetState = mapping ? "auto_mapped" : hasTbOwner ? "pending_mapping" : "not_required";
      try {
        await repositories.requirements.releaseManualOwner(req.id, targetState);
      } catch (cause) {
        return (cause as Error)?.name === "InvalidTransitionError" ? jsonError("CONFLICT") : jsonError("DEPENDENCY_UNAVAILABLE");
      }
      // Q1：即使 TB 执行人暂无映射也照常入队（空负责人推送），状态保持 pending_mapping；
      // 映射补齐后由 owner-recheck 用独立 intent 键重推并补负责人。
      const idempotencyKey = basePushIdempotencyKey(req.id, req.sourceVersion, analysisVersion, `owner-reset:v${req.manualOwner?.assignmentVersion ?? 0}:${targetState}`);
      try {
        // clearOwner：撤销人工负责人后 Base「执行人」必须清空，不能继续挂着旧负责人和旧收件人。
        await repositories.jobs.enqueue({ jobType: "base_push", dedupeKey: idempotencyKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, analysisVersion, idempotencyKey, actorId: auth.actor.id, clearOwner: true }, availableAt: now });
      } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
      const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "owner.manual_cleared", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { sourceVersion: req.sourceVersion }, occurredAt: now });
      if (auditFailure) return auditFailure;
      return json({ requirementId: req.id, ownerState: targetState, status: "queued" });
    }
    const body = OwnerMappingUpdateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    // 逐条负责人：只写需求本身，绝不改写 person_mappings（否则会改掉同 TB 执行人名下全部需求）。
    try {
      await repositories.requirements.assignManualOwner(req.id, { feishuUserId: body.data.feishuUserId, feishuIdType: body.data.feishuIdType, name: body.data.tbDisplayName ?? null, assignedBy: auth.actor.id, assignedAt: now });
    } catch (cause) {
      return (cause as Error)?.name === "InvalidTransitionError" ? jsonError("CONFLICT") : jsonError("DEPENDENCY_UNAVAILABLE");
    }
    // 分配成功后再取新的 assignmentVersion：同一分配请求的 HTTP 重试命中同一 dedupe key，不会多入队。
    const assigned = await repositories.requirements.get(req.id);
    const idempotencyKey = basePushIdempotencyKey(req.id, req.sourceVersion, analysisVersion, `owner:av${assigned?.manualOwner?.assignmentVersion ?? 0}:${body.data.feishuUserId}:${body.data.feishuIdType}`);
    try {
      await repositories.jobs.enqueue({ jobType: "base_push", dedupeKey: idempotencyKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, analysisVersion, idempotencyKey, actorId: auth.actor.id }, availableAt: now });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "owner.manually_mapped", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { reason: "per_requirement", sourceVersion: req.sourceVersion }, occurredAt: now });
    if (auditFailure) return auditFailure;
    return json({ requirementId: req.id, ownerState: "manually_mapped", status: "queued" });
  }
  const pushMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/push$/);
  if (method === "POST" && pushMatch) {
    const auth = await actorFor(request,dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.jobs || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const pushRequirementId = pathUuid(pushMatch[1]!, dependencies); if (!pushRequirementId) return jsonError("NOT_FOUND");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const req = await repositories.requirements.get(pushRequirementId); if (!req) return jsonError("NOT_FOUND");
    if (!isIntakeComplete(req.pipeline.pull) || req.pipeline.owner === "pending_mapping" || !["pending", "failed"].includes(req.pipeline.push)) return jsonError("CONFLICT");
    const latestAnalysis = await repositories.analyses?.latest(req.id) ?? null;
    const analysisVersion = latestAnalysis?.analysisVersion ?? 0;
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const idempotencyKey = basePushIdempotencyKey(req.id, req.sourceVersion, analysisVersion, `retry:${key.data}`);
    try { await repositories.jobs.enqueue({ jobType: "base_push", dedupeKey: idempotencyKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, analysisVersion, idempotencyKey, actorId: auth.actor.id }, availableAt: now }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "base.push.retry_requested", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { sourceVersion: req.sourceVersion, analysisVersion }, occurredAt: now });
    if (auditFailure) return auditFailure;
    return json({ requirementId: req.id, status: "queued" }, 202);
  }
  // V02-T25：重复/忽略决策（人工确认）。PUT=确认；DELETE=撤销。
  const duplicateDecisionMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/duplicate-decision$/);
  if (duplicateDecisionMatch && (method === "PUT" || method === "DELETE")) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements?.decideResolution || !repositories.requirements.clearResolution) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(duplicateDecisionMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const req = await repositories.requirements.get(requirementId); if (!req) return jsonError("NOT_FOUND");
    const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
    if (method === "DELETE") {
      const parsed = ClearDuplicateDecisionSchema.safeParse(await readJson(request).catch(() => null));
      if (!parsed.success) return jsonError("VALIDATION_FAILED");
      const result = await repositories.requirements.clearResolution({ requirementId: req.id, expectedVersion: parsed.data.expectedVersion });
      if (result.outcome === "version_conflict") return jsonError("CONFLICT", `决策版本冲突，当前版本 ${result.version}`);
      if (result.outcome === "not_found") return jsonError("NOT_FOUND");
      const auditFailure = await appendAudit(repositories, { id: randomUUID(), actorId: auth.actor.id, eventType: "duplicate.revoked", entityType: "requirement", result: "succeeded", entityId: req.id, safeDetails: { previous: req.processingState ?? "active" }, occurredAt: nowIso });
      if (auditFailure) return auditFailure;
      const updated = await repositories.requirements.get(req.id);
      // Q2：撤销判定后清除 Base 标记；失败只留审计，不影响撤销结果。
      const clearMarker = await duplicateMarkerFor(dependencies, repositories, req);
      if (clearMarker) {
        try {
          const marked = await clearMarker({ recordId: updated?.baseRecordId ?? req.baseRecordId, decision: null });
          if (marked.outcome === "failed" || marked.outcome === "field_missing") {
            await appendAudit(repositories, { id: randomUUID(), actorId: auth.actor.id, eventType: "requirement.duplicate_mark_failed", entityType: "requirement", entityId: req.id, result: "failed", safeDetails: { reason: marked.outcome, ...(marked.outcome === "failed" ? { errorClass: marked.errorCode } : {}) }, occurredAt: nowIso });
          }
        } catch { /* 标记是附加能力，不能回滚已成功的撤销 */ }
      }
      return json({ requirementId: req.id, processingState: updated?.processingState ?? "active", decision: null, version: 0 });
    }
    const parsed = DuplicateDecisionSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError("VALIDATION_FAILED");
    if (parsed.data.decision === "duplicate" && !parsed.data.canonicalRequirementId) return jsonError("VALIDATION_FAILED");
    if (parsed.data.canonicalRequirementId === req.id) return jsonError("VALIDATION_FAILED");
    let canonicalRecord: RequirementRecord | null = null;
    if (parsed.data.canonicalRequirementId) {
      canonicalRecord = await repositories.requirements.get(parsed.data.canonicalRequirementId);
      if (!canonicalRecord || canonicalRecord.id === req.id) return jsonError("NOT_FOUND");
    }
    const result = await repositories.requirements.decideResolution({
      requirementId: req.id, decision: parsed.data.decision,
      canonicalRequirementId: parsed.data.canonicalRequirementId ?? null,
      reason: parsed.data.reason, actorId: auth.actor.id,
      expectedVersion: parsed.data.expectedVersion, now: nowIso,
    });
    if (result.outcome === "version_conflict") return jsonError("CONFLICT", `决策版本冲突，当前版本 ${result.version}`);
    if (result.outcome === "not_found") return jsonError("NOT_FOUND");
    const auditFailure = await appendAudit(repositories, { id: randomUUID(), actorId: auth.actor.id, eventType: parsed.data.decision === "duplicate" ? "duplicate.confirmed" : "duplicate.reviewed", entityType: "requirement", result: "succeeded", entityId: req.id, safeDetails: { decision: parsed.data.decision, version: result.version }, occurredAt: nowIso });
    if (auditFailure) return auditFailure;
    // Q2：把判定写进 Base 的专用标记字段（不通知）；失败只留审计，不影响判定结果。
    const setMarker = await duplicateMarkerFor(dependencies, repositories, req);
    if (setMarker) {
      try {
        const marked = await setMarker({
          recordId: req.baseRecordId,
          // confirmed_unique = 确认非重复：清除既有标记，而不是写「重复」
          decision: parsed.data.decision === "confirmed_unique" ? null : parsed.data.decision,
          canonicalRequirementId: canonicalRecord?.id ?? null,
          canonicalPlatformRequirementId: canonicalRecord?.platformRequirementId ?? null,
        });
        if (marked.outcome === "failed" || marked.outcome === "field_missing") {
          await appendAudit(repositories, { id: randomUUID(), actorId: auth.actor.id, eventType: "requirement.duplicate_mark_failed", entityType: "requirement", entityId: req.id, result: "failed", safeDetails: { reason: marked.outcome, ...(marked.outcome === "failed" ? { errorClass: marked.errorCode } : {}) }, occurredAt: nowIso });
        }
      } catch { /* 标记是附加能力，不能回滚已成功的判定 */ }
    }
    const updated = await repositories.requirements.get(req.id);
    return json({ requirementId: req.id, processingState: updated?.processingState ?? "active", decision: parsed.data.decision, reviewState: "confirmed", version: result.version });
  }
  // 未注册路径返回 404；ROUTE_NOT_IMPLEMENTED 保留给“契约有、实现未接”的端点（当前无）。
  return jsonError("NOT_FOUND");
}
