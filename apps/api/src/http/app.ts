import type { Pool } from "pg";
import { normalizeOwnerName } from "../owner/mapping.js";
import { analysisForceDedupeKey, analysisRetryDedupeKey, analysisRunningJobKeys } from "../scheduler/analysis-recovery.js";
import { SourceProjectResolutionError, type FeishuUserDirectory, type FeishuUserSelectionResolver, type IdentityProvider, type TeambitionSourceProjectResolver } from "../application/ports.js";
import { isIntakeComplete, normalizeScheduleTime } from "../domain/workflow.js";
import { stableJson } from "../sync/hashes.js";
import { RICE_CONFIG_VERSION, RICE_EFFORT_UNIT, RICE_IMPACT_LEVELS, RICE_REACH_UNIT, computeRiceScore } from "../beta/rice.js";
import type { AuditEventRepository, AnalysisRunRepository, PipelineJobRepository, SourceConfigRepository, SyncBatchRepository, SyncItemRepository, PersonMappingRepository, RequirementQueryRepository, BasePushRunRepository, ModuleDictionaryRepository, PriorityRuleRepository, SourceSnapshotRepository, TeamDirectoryRepository, RequirementScoringRepository } from "../application/repositories.js";
import type { PersonMappingRecord, AnalysisRunRecord, ModuleDictionaryVersionRecord, PriorityRuleVersionRecord, RequirementRecord, SourceConfigRecord, SyncBatchRecord, PipelineJobRecord } from "../domain/persistence.js";
import type { TeamPersonRecord } from "../domain/team-directory.js";
import { AnalysisContextUpdateSchema, AuditListQuerySchema, OpsJobsQuerySchema, ClearDuplicateDecisionSchema, DuplicateDecisionSchema, PriorityOverrideUpdateSchema, RetryAnalysisRequestSchema, KanoEvidenceImportSchema, KanoRunRequestSchema, AudienceUpdateSchema, BatchListQuerySchema, RiceDraftUpdateSchema, FeishuUserSearchQuerySchema, OwnerMappingUpdateSchema, RequirementIntakeEditSchema, RequirementIntakeSchema, RequirementListQuerySchema, SyncIdempotencyHeaderSchema, SyncRunRequestSchema } from "../contracts/pipeline.js";
import { createHash, randomUUID } from "node:crypto";
import { ApplyAiScoringSchema, ManualScoringUpdateSchema, SCORING_FORMULA_TEXT, SCORING_THRESHOLDS, computeUmcScore } from "../analysis/scoring.js";
import { maskPii } from "../analysis/contract.js";
import { SourceConfigUpdateSchema, normalizeSourceSchedule, type ResolvedSourceConfigUpdate } from "../contracts/source.js";
import { DictionaryCreateSchema, PriorityRuleCreateSchema, TeamModulesSaveSchema, TeamPersonCreateSchema, TeamPersonFeishuBindSchema, TeamPersonRenameSchema } from "../contracts/rules.js";
import { DEFAULT_TEAM_MEMBERS } from "../domain/team-directory.js";
import { isDatabaseReady } from "../adapters/postgres/health.js";
import { EXPECTED_LATEST_MIGRATION } from "../db/expected-migration.js";
import { jsonError } from "./errors.js";
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
  sourceSnapshots?: SourceSnapshotRepository;
  dictionaries?: ModuleDictionaryRepository;
  priorityRules?: PriorityRuleRepository;
  directory?: TeamDirectoryRepository;
  scoring?: RequirementScoringRepository;
}
export interface ApiDependencies {
  database: Pool | null;
  identity: IdentityProvider | undefined;
  repositories: ApiRepositories | undefined;
  teambitionSourceProjects?: TeambitionSourceProjectResolver;
  feishuUsers?: FeishuUserDirectory;
  feishuUserSelections?: FeishuUserSelectionResolver;
  enableTestFixtures?: boolean;
  now: (() => Date) | undefined;
  /** Q2：Base 重复行标记；组合根未注入时判定不触达 Base。 */
  duplicateMarker?: (input: import("../base/duplicate-marker.js").DuplicateMarkInput) => Promise<import("../base/duplicate-marker.js").DuplicateMarkResult>;
}
function json(body: unknown, status = 200): Response { return Response.json(body, { status }); }
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
  return { id: source.id, projectName: source.externalProjectName, enabled: source.enabled, schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, weekdays: source.scheduleWeekdays ?? (source.scheduleWeekday === null ? null : [source.scheduleWeekday]), time: normalizeScheduleTime(source.scheduleLocalTime), timezone: source.scheduleTimezone } };
}
function batchDto(batch: SyncBatchRecord) {
  return { id: batch.id, status: batch.status, triggerType: batch.triggerType, actorId: batch.actorId, totalCount: batch.totalCount, succeededCount: batch.succeededCount, failedCount: batch.failedCount, startedAt: batch.startedAt, completedAt: batch.completedAt, errorSummary: batch.errorSummary };
}
// Teambition 自建站的任务地址规则（由一条真实地址确认：/task/<任务ID>）。
const TEAMBITION_TASK_BASE_URL = process.env.RQSYS_TEAMBITION_TASK_BASE_URL ?? "https://teambition.magene.cn/task";
// Base 记录直达链接：飞书租户域名与 Base app/table 只有部署方知道，代码里不猜。
// 由 RQSYS_BASE_RECORD_URL_TEMPLATE 配置，必须是 https 且包含 {recordId}，例如
// https://<租户>.feishu.cn/base/<app>?table=<table>&record={recordId}。未配置或不合法时返回 null，
// 详情页只提供复制记录 ID。
function baseRecordUrl(recordId: string | null): string | null {
  const template = process.env.RQSYS_BASE_RECORD_URL_TEMPLATE?.trim();
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

function requirementDto(req: RequirementRecord, analysis: Record<string, unknown> | null = null, analyses: unknown[] = [], ownerName: string | null = null, currentScorePriority: RequirementRecord["currentScorePriority"] = null) {
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
    updatedAt: req.updatedAt,
    sourceUrl: req.sourceType === "teambition" ? req.sourceUrl ?? `${TEAMBITION_TASK_BASE_URL}/${req.teambitionRequirementId}` : req.sourceUrl,
    lastPushedAt: req.lastPushedAt,
    ownerName,
    pipeline: { pull: req.pipeline.pull, analysis: req.pipeline.analysis, owner: req.pipeline.owner, push: req.pipeline.push },
    source: req.sourcePayload,
    analysis,
    baseRecordId: req.baseRecordId,
    baseRecordUrl: baseRecordUrl(req.baseRecordId),
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
async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { return undefined; } }
// 人员/模块目录的冲突语义统一：业务冲突 409，其余按依赖不可用处理（不伪装成功）。
function directoryError(cause: unknown): Response {
  return (cause as Error)?.name === "TeamDirectoryConflict" ? jsonError("CONFLICT", (cause as Error).message) : jsonError("DEPENDENCY_UNAVAILABLE");
}
// 人工映射冲突（账号已绑定其他人员）返回 409；其余保持依赖不可用，不伪装成功。
async function mappingConflictResponse(action: () => Promise<PersonMappingRecord>): Promise<PersonMappingRecord | Response> {
  try { return await action(); }
  catch (cause) { return (cause as Error)?.name === "PersonMappingConflict" ? jsonError("CONFLICT", (cause as Error).message) : jsonError("DEPENDENCY_UNAVAILABLE"); }
}

async function resolveSourceConfig(
  update: ReturnType<typeof SourceConfigUpdateSchema.parse>,
  dependencies: ApiDependencies,
  current?: SourceConfigRecord,
): Promise<ResolvedSourceConfigUpdate | Response> {
  if (current && update.projectName === current.externalProjectName) {
    return { ...update, schedule: normalizeSourceSchedule(update.schedule), projectId: current.externalProjectId, requirementTypeId: current.requirementTypeId, ownerNames: current.ownerNames, fieldMap: current.fieldMap };
  }
  if (dependencies.teambitionSourceProjects) {
    try {
      const resolved = await dependencies.teambitionSourceProjects.resolveProject(update.projectName);
      return { ...update, schedule: normalizeSourceSchedule(update.schedule), projectId: resolved.projectId, requirementTypeId: resolved.requirementTypeId, ownerNames: [...DEFAULT_TEAM_MEMBERS], fieldMap: {} };
    } catch (cause) {
      if (cause instanceof SourceProjectResolutionError) return jsonError("VALIDATION_FAILED", cause.message);
      return jsonError("DEPENDENCY_UNAVAILABLE", "无法连接 Teambition 项目配置，请稍后重试。");
    }
  }
  return jsonError("DEPENDENCY_UNAVAILABLE", "Teambition 项目自动识别尚未配置。");
}

export async function handleApiRequest(request: Request, dependencies: ApiDependencies): Promise<Response> {
  const url = new URL(request.url), method = request.method.toUpperCase(), repositories = dependencies.repositories;
  if (method === "GET" && url.pathname === "/api/health") return json({ status: "ok", service: "rq-sys-api" });
  if (method === "GET" && url.pathname === "/api/health/ready") {
    if (!(await isDatabaseReady(dependencies.database))) return json({ status: "not_ready", reason: "database_unavailable_or_not_configured" }, 503);
    // 迁移滞后只提示，不把服务判死：数据库可用即 ready，运维页据此提醒先跑迁移。
    return json({ status: "ready", database: "connected", migrations: await readMigrationStatus(dependencies.database) });
  }
  if (method === "GET" && url.pathname === "/api/overview/metrics") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const counts = await repositories.requirements.getPipelineCounts();
    const rule = await repositories.priorityRules?.getPublished();
    const rulePayload = rule?.rules as { thresholds?: { p0?: number; p1?: number; p2?: number } } | null;
    return json({
      counts: {
        ...counts,
        priorityRule: rule ? {
          version: rule.version,
          thresholds: rulePayload?.thresholds ?? null,
          formulaText: SCORING_FORMULA_TEXT,
        } : null,
      },
    });
  }
  if (method === "GET" && url.pathname === "/api/dev/fixtures/status") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    return json({ enabled: dependencies.enableTestFixtures === true });
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
    // 受控初始化：MVP 只允许一个产品组来源（D-09）。
    const existing = await repositories.sources.list();
    if (existing.length > 0) return jsonError("CONFLICT");
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
    const page = await repositories.batches.list({ limit: parsed.data.limit, ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }), ...(batchCursor === undefined ? {} : { cursor: batchCursor }) }); return json({ items: page.items.map(batchDto), nextCursor: page.nextCursor });
  }
  const batchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (method === "GET" && batchMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const batchId = pathUuid(batchMatch[1]!, dependencies); if (!batchId) return jsonError("NOT_FOUND");
    const batch = await repositories.batches.get(batchId); if (!batch) return jsonError("NOT_FOUND");
    return json({ ...batchDto(batch), items: await repositories.items.listByBatch(batch.id) });
  }
  if (method === "GET" && url.pathname === "/api/audit") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries()); if (query.limit !== undefined) query.limit = String(Number(query.limit));
    const parsed = AuditListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    return json({ items: await repositories.audit.search({ limit: parsed.data.limit, ...(parsed.data.entityId === undefined ? {} : { entityId: parsed.data.entityId }), ...(parsed.data.eventType === undefined ? {} : { eventType: parsed.data.eventType }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }) }) });
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
      repositories.jobs.listFailed(parsed.data.limit),
      repositories.jobs.listExhaustedRunning(now, parsed.data.limit),
    ]);
    return json({ now, items: { failed: failed.map(opsJobDto), stuck: stuck.map(opsJobDto) } });
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
  if (method === "POST" && url.pathname === "/api/requirements") {
    // V02-T04：Web 手工收录。actor、时间、来源类型与平台编号都由服务端生成；
    // 同幂等键同内容返回原结果，同键不同内容明确冲突（AC02/AC03）。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.audit || !repositories.dictionaries) return jsonError("DEPENDENCY_UNAVAILABLE");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const parsedBody = RequirementIntakeSchema.safeParse(await request.json().catch(() => null)); if (!parsedBody.success) return jsonError("VALIDATION_FAILED");
    // 录入模块必须来自已发布词典（G-MODULE：Web 录入模块与 AI 建议分开，但同源受控）。
    if (parsedBody.data.intakeModule) {
      const published = (await repositories.dictionaries.list()).find((version) => version.status === "published");
      const names = (published?.entries ?? []).map((entry) => typeof entry === "string" ? entry : String((entry as { name?: unknown }).name ?? entry));
      if (!names.includes(parsedBody.data.intakeModule)) return jsonError("VALIDATION_FAILED", "功能模块不在已发布词典中。");
    }
    // POST 语义中可选字段 null 与省略等价（下方展开只保留真值）：哈希前归一化，
// 客户端重试时序列化差异（null vs 缺省）不会被误判为“同键不同内容”（复查 #8）。
    const canonicalBody = Object.fromEntries(Object.entries(parsedBody.data).filter(([, value]) => value !== null && value !== undefined));
    const requestHash = createHash("sha256").update(stableJson(canonicalBody)).digest("hex");
    const receipt = await repositories.requirements.findIntakeReceipt(key.data);
    if (receipt) {
      if (receipt.requestHash !== requestHash) return jsonError("CONFLICT", "该幂等键已用于不同的提交内容。");
      const existing = await repositories.requirements.get(receipt.requirementId);
      if (!existing) return jsonError("DEPENDENCY_UNAVAILABLE");
      return json({ requirementId: existing.id, platformRequirementId: existing.platformRequirementId, sourceType: "web_manual", status: "collected" }, 200);
    }
    try {
      const created = await repositories.requirements.createManualRequirement({ idempotencyKey: key.data, actorId: auth.actor.id, requestHash, title: parsedBody.data.title, description: parsedBody.data.description, sourceChannel: parsedBody.data.sourceChannel, ...(parsedBody.data.productModel ? { productModel: parsedBody.data.productModel } : {}), ...(parsedBody.data.requirementType ? { requirementType: parsedBody.data.requirementType } : {}), ...(parsedBody.data.constraintNotes ? { constraintNotes: parsedBody.data.constraintNotes } : {}), ...(parsedBody.data.supplementUrl ? { supplementUrl: parsedBody.data.supplementUrl } : {}), ...(parsedBody.data.intakeModule ? { intakeModule: parsedBody.data.intakeModule } : {}), ...(parsedBody.data.owner ? { owner: { feishuUserId: parsedBody.data.owner.feishuUserId, feishuIdType: parsedBody.data.owner.feishuIdType, ...(parsedBody.data.owner.tbDisplayName ? { name: parsedBody.data.owner.tbDisplayName } : {}) } } : {}) });
      if ("outcome" in created) return jsonError("CONFLICT", "该幂等键已用于不同的提交内容。");
      return json({ requirementId: created.requirementId, platformRequirementId: created.platformRequirementId, sourceType: "web_manual", status: "collected" }, created.replay ? 200 : 201);
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const intakeEditMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "PATCH" && intakeEditMatch) {
    // V02-T07：手工编辑（仅 web_manual）。TB 事实只读；期望源版本 + 幂等键。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(intakeEditMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const parsedBody = RequirementIntakeEditSchema.safeParse(await request.json().catch(() => null)); if (!parsedBody.success) return jsonError("VALIDATION_FAILED");
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
      if (result.outcome === "not_manual") return jsonError("CONFLICT", "Teambition 来源的事实由 Teambition 维护，Web 仅编辑手工需求。");
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
      ...(parsed.data.processingState === undefined ? {} : { processingState: parsed.data.processingState }), ...(parsed.data.priority === undefined ? {} : { priority: parsed.data.priority }), ...(parsed.data.sort === undefined ? {} : { sort: parsed.data.sort }), ...(parsed.data.batchId === undefined ? {} : { batchId: parsed.data.batchId }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }), limit: parsed.data.limit, ...(cursor === undefined ? {} : { cursor }) });
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
      items: page.items.map((item) => ({ ...requirementSearchDto(item), ownerName: manualOwnerName(item) ?? (item.executorUserId && item.sourceConfigId ? nameByTbUser.get(`${item.sourceConfigId}:${item.executorUserId}`) ?? null : null) })),
      nextCursor: page.nextCursor,
    });
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
    const parsed = KanoEvidenceImportSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
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
    const parsed = KanoRunRequestSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
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
    const parsed = RiceDraftUpdateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
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
    const parsed = AudienceUpdateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
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
  const requirementMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "GET" && requirementMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirementId = pathUuid(requirementMatch[1]!, dependencies); if (!requirementId) return jsonError("NOT_FOUND");
    const req = await repositories.requirements.get(requirementId); if (!req) return jsonError("NOT_FOUND");
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
      ...requirementDto(req, latest && latest.status === "analyzed" ? latest.structuredResult : null, history.map(analysisVersionDto), ownerName, currentScore?.priority ?? null),
      duplicates,
      resolution: resolution ?? requirementResolutionDto(req),
      scoring: {
        current: currentScore,
        aiSuggestion: aiScore,
        history: scoreHistory,
        formula: { text: SCORING_FORMULA_TEXT, thresholds: SCORING_THRESHOLDS },
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
        await repositories.jobs.enqueue({ jobType: "base_push", dedupeKey: idempotencyKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, analysisVersion, idempotencyKey, actorId: auth.actor.id }, availableAt: now });
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
      if (dependencies.duplicateMarker) {
        try {
          const marked = await dependencies.duplicateMarker({ recordId: updated?.baseRecordId ?? req.baseRecordId, decision: null });
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
    if (dependencies.duplicateMarker) {
      try {
        const marked = await dependencies.duplicateMarker({
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
