import type { Pool } from "pg";
import { normalizeOwnerName } from "../owner/mapping.js";
import { canTransition } from "../domain/transitions.js";
import { analysisRunningJobKeys } from "../scheduler/analysis-recovery.js";
import { SourceProjectResolutionError, type FeishuUserDirectory, type FeishuUserSelectionResolver, type IdentityProvider, type TeambitionSourceProjectResolver } from "../application/ports.js";
import { isIntakeComplete, normalizeScheduleTime } from "../domain/workflow.js";
import { stableJson } from "../sync/hashes.js";
import type { AuditEventRepository, AnalysisRunRepository, PipelineJobRepository, SourceConfigRepository, SyncBatchRepository, SyncItemRepository, PersonMappingRepository, RequirementQueryRepository, BasePushRunRepository, ModuleDictionaryRepository, PriorityRuleRepository, SourceSnapshotRepository, TeamDirectoryRepository } from "../application/repositories.js";
import type { PersonMappingRecord, AnalysisRunRecord, ModuleDictionaryVersionRecord, PriorityRuleVersionRecord, RequirementRecord, SourceConfigRecord, SyncBatchRecord } from "../domain/persistence.js";
import type { TeamPersonRecord } from "../domain/team-directory.js";
import { AuditListQuerySchema, AudienceUpdateSchema, BatchListQuerySchema, RiceDraftUpdateSchema, FeishuUserSearchQuerySchema, OwnerMappingUpdateSchema, RequirementIntakeEditSchema, RequirementIntakeSchema, RequirementListQuerySchema, SyncIdempotencyHeaderSchema, SyncRunRequestSchema } from "../contracts/pipeline.js";
import { createHash, randomUUID } from "node:crypto";
import { SourceConfigUpdateSchema, type ResolvedSourceConfigUpdate } from "../contracts/source.js";
import { DictionaryCreateSchema, PriorityRuleCreateSchema, TeamModulesSaveSchema, TeamPersonCreateSchema, TeamPersonFeishuBindSchema, TeamPersonRenameSchema } from "../contracts/rules.js";
import { DEFAULT_TEAM_MEMBERS } from "../domain/team-directory.js";
import { isDatabaseReady } from "../adapters/postgres/health.js";
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
}
function json(body: unknown, status = 200): Response { return Response.json(body, { status }); }
function sourceDto(source: SourceConfigRecord) {
  return { id: source.id, projectName: source.externalProjectName, enabled: source.enabled, schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, time: normalizeScheduleTime(source.scheduleLocalTime), timezone: source.scheduleTimezone } };
}
function batchDto(batch: SyncBatchRecord) {
  return { id: batch.id, status: batch.status, triggerType: batch.triggerType, actorId: batch.actorId, totalCount: batch.totalCount, succeededCount: batch.succeededCount, failedCount: batch.failedCount, startedAt: batch.startedAt, completedAt: batch.completedAt, errorSummary: batch.errorSummary };
}
// Teambition 自建站的任务地址规则（由一条真实地址确认：/task/<任务ID>）。
const TEAMBITION_TASK_BASE_URL = process.env.RQSYS_TEAMBITION_TASK_BASE_URL ?? "https://teambition.magene.cn/task";
function requirementDto(req: RequirementRecord, analysis: Record<string, unknown> | null = null, analyses: unknown[] = [], ownerName: string | null = null) {
  // 展示字段：详情页 L1 需要标题/描述/负责人/更新时间；只加不改，避免破坏既有调用方。
  // ownerName 仅在详情接口注入（列表逐行查映射会 N+1），解析不到时为 null。
  return {
    id: req.id,
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
    sourceVersion: req.sourceVersion,
    updatedAt: req.updatedAt,
    sourceUrl: req.sourceType === "teambition" ? req.sourceUrl ?? `${TEAMBITION_TASK_BASE_URL}/${req.teambitionRequirementId}` : req.sourceUrl,
    lastPushedAt: req.lastPushedAt,
    ownerName,
    pipeline: { pull: req.pipeline.pull, analysis: req.pipeline.analysis, owner: req.pipeline.owner, push: req.pipeline.push },
    source: req.sourcePayload,
    analysis,
    baseRecordId: req.baseRecordId,
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
    return { ...update, projectId: current.externalProjectId, requirementTypeId: current.requirementTypeId, ownerNames: current.ownerNames, fieldMap: current.fieldMap };
  }
  if (dependencies.teambitionSourceProjects) {
    try {
      const resolved = await dependencies.teambitionSourceProjects.resolveProject(update.projectName);
      return { ...update, projectId: resolved.projectId, requirementTypeId: resolved.requirementTypeId, ownerNames: [...DEFAULT_TEAM_MEMBERS], fieldMap: {} };
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
    return await isDatabaseReady(dependencies.database) ? json({ status: "ready", database: "connected" }) : json({ status: "not_ready", reason: "database_unavailable_or_not_configured" }, 503);
  }
  if (method === "GET" && url.pathname === "/api/overview/metrics") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ counts: await repositories.requirements.getPipelineCounts() });
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
    const sourceId = decodeURIComponent(sourceMatch[1]!);
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
    const page = await repositories.batches.list({ limit: parsed.data.limit, ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }), ...(batchCursor === undefined ? {} : { cursor: batchCursor }) }); return json({ items: page.items.map(batchDto), nextCursor: page.nextCursor });
  }
  const batchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (method === "GET" && batchMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const batch = await repositories.batches.get(decodeURIComponent(batchMatch[1]!)); if (!batch) return jsonError("NOT_FOUND");
    return json({ ...batchDto(batch), items: await repositories.items.listByBatch(batch.id) });
  }
  if (method === "GET" && url.pathname === "/api/audit") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries()); if (query.limit !== undefined) query.limit = String(Number(query.limit));
    const parsed = AuditListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    return json({ items: await repositories.audit.search({ limit: parsed.data.limit, ...(parsed.data.entityId === undefined ? {} : { entityId: parsed.data.entityId }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }) }) });
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
    const name = decodeURIComponent(personFeishuMatch[1]!);
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const items = await repositories.directory.bindPersonFeishu(name, body.data, { id: randomUUID(), actorId: auth.actor.id, eventType: "team_person.feishu_bound", entityType: "team_person", result: "succeeded", safeDetails: {}, occurredAt: now });
      return json({ items: items.map(personDto) });
    } catch (cause) { return directoryError(cause); }
  }
  if (method === "DELETE" && personFeishuMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const name = decodeURIComponent(personFeishuMatch[1]!);
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
    const oldName = decodeURIComponent(personMatch[1]!);
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const items = await repositories.directory.renamePerson(oldName, body.data.name, { id: randomUUID(), actorId: auth.actor.id, eventType: "team_person.renamed", entityType: "team_person", result: "succeeded", safeDetails: {}, occurredAt: now });
      return json({ items: items.map(personDto) });
    } catch (cause) { return directoryError(cause); }
  }
  if (method === "DELETE" && personMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.directory) return jsonError("DEPENDENCY_UNAVAILABLE");
    const name = decodeURIComponent(personMatch[1]!);
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
    const id = decodeURIComponent(rulePublishMatch[1]!);
    const existing = await repositories.priorityRules.get(id);
    if (!existing) return jsonError("NOT_FOUND");
    if (existing.status !== "draft") return jsonError("CONFLICT");
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
    const requestHash = createHash("sha256").update(stableJson(parsedBody.data)).digest("hex");
    const receipt = await repositories.requirements.findIntakeReceipt(key.data);
    if (receipt) {
      if (receipt.requestHash !== requestHash) return jsonError("CONFLICT", "该幂等键已用于不同的提交内容。");
      const existing = await repositories.requirements.get(receipt.requirementId);
      if (!existing) return jsonError("DEPENDENCY_UNAVAILABLE");
      return json({ requirementId: existing.id, platformRequirementId: existing.platformRequirementId, sourceType: "web_manual", status: "collected" }, 200);
    }
    try {
      const created = await repositories.requirements.createManualRequirement({ idempotencyKey: key.data, actorId: auth.actor.id, requestHash, title: parsedBody.data.title, description: parsedBody.data.description, sourceChannel: parsedBody.data.sourceChannel, ...(parsedBody.data.productModel ? { productModel: parsedBody.data.productModel } : {}), ...(parsedBody.data.requirementType ? { requirementType: parsedBody.data.requirementType } : {}), ...(parsedBody.data.constraintNotes ? { constraintNotes: parsedBody.data.constraintNotes } : {}), ...(parsedBody.data.supplementUrl ? { supplementUrl: parsedBody.data.supplementUrl } : {}), ...(parsedBody.data.intakeModule ? { intakeModule: parsedBody.data.intakeModule } : {}), ...(parsedBody.data.owner ? { owner: { feishuUserId: parsedBody.data.owner.feishuUserId, feishuIdType: parsedBody.data.owner.feishuIdType, ...(parsedBody.data.owner.tbDisplayName ? { name: parsedBody.data.owner.tbDisplayName } : {}) } } : {}) });
      return json({ requirementId: created.requirementId, platformRequirementId: created.platformRequirementId, sourceType: "web_manual", status: "collected" }, created.replay ? 200 : 201);
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const intakeEditMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "PATCH" && intakeEditMatch) {
    // V02-T07：手工编辑（仅 web_manual）。TB 事实只读；期望源版本 + 幂等键。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const parsedBody = RequirementIntakeEditSchema.safeParse(await request.json().catch(() => null)); if (!parsedBody.success) return jsonError("VALIDATION_FAILED");
    const requestHash = createHash("sha256").update(stableJson(parsedBody.data)).digest("hex");
    const body = parsedBody.data;
    try {
      const result = await repositories.requirements.updateManualRequirement({
        requirementId: decodeURIComponent(intakeEditMatch[1]!), expectedSourceVersion: body.expectedSourceVersion, idempotencyKey: key.data, actorId: auth.actor.id, requestHash,
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
      return json({ requirementId: decodeURIComponent(intakeEditMatch[1]!), outcome: result.outcome, sourceVersion: result.sourceVersion, ...(result.outcome === "updated" || result.outcome === "replay" ? { substantiveChanged: result.substantiveChanged } : {}) }, 200);
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  if (method === "GET" && url.pathname === "/api/requirements") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = RequirementListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const cursor = decodeRequirementCursor(parsed.data.cursor);
    const page = await repositories.requirements.search({ ...(parsed.data.q === undefined ? {} : { q: parsed.data.q }), ...(parsed.data.executorName === undefined ? {} : { executorName: parsed.data.executorName }), ...(parsed.data.pullState === undefined ? {} : { pullState: parsed.data.pullState }), ...(parsed.data.analysisState === undefined ? {} : { analysisState: parsed.data.analysisState }), ...(parsed.data.ownerState === undefined ? {} : { ownerState: parsed.data.ownerState }), ...(parsed.data.pushState === undefined ? {} : { pushState: parsed.data.pushState }), ...(parsed.data.batchId === undefined ? {} : { batchId: parsed.data.batchId }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }), limit: parsed.data.limit, ...(cursor === undefined ? {} : { cursor }) });
    // 列表一次取回全部有效映射再按 TB 用户查名，避免逐行查询。
    // 空页时不能把空字符串传给 uuid 列：PostgreSQL 会以 22P02 拒绝，接口变成 500。
    const firstItem = page.items[0];
    // 手工需求 sourceConfigId 为空：不查 TB 人员映射（V02-T02 起可空）。
    const mappings = repositories.people && firstItem?.sourceConfigId ? await repositories.people.listActive(firstItem.sourceConfigId) : [];
    const nameByTbUser = new Map(mappings.filter((m) => m.teambitionUserId && m.teambitionDisplayName).map((m) => [m.teambitionUserId as string, m.teambitionDisplayName as string]));
    return json({
      items: page.items.map((item) => ({ ...requirementSearchDto(item), ownerName: manualOwnerName(item) ?? (item.executorUserId ? nameByTbUser.get(item.executorUserId) ?? null : null) })),
      nextCursor: page.nextCursor,
    });
  }
  const riceMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/rice-draft$/);
  if ((method === "GET" || method === "PUT") && riceMatch) {
    // V02-T11：RICE Beta 草稿。保存只落草稿与历史：不入主队列、不触发 AI/推送/通知、
    // 不改主分析/优先级/PM 状态。量纲未获批 → 一律显示“待配置”，不出分数或排名。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const requirement = await repositories.requirements.get(decodeURIComponent(riceMatch[1]!)); if (!requirement) return jsonError("NOT_FOUND");
    if (method === "GET") {
      const draft = await repositories.requirements.getRiceDraft?.(requirement.id) ?? null;
      const inputs = draft ? { reach: draft.reachInput, impact: draft.impactInput, confidence: draft.confidenceInput, effort: draft.effortInput } : { reach: null, impact: null, confidence: null, effort: null };
      const complete = Object.values(inputs).every((value) => typeof value === "string" && value.trim().length > 0);
      // RICE 量纲配置未获批（G-RICE，T12 前）：有草稿也只显示待配置。
      return json({ requirementId: requirement.id, inputs, notes: draft?.notes ?? null, sourceVersion: draft?.sourceVersion ?? requirement.sourceVersion, editVersion: draft?.editVersion ?? 0, updatedBy: draft?.updatedBy ?? null, updatedAt: draft?.updatedAt ?? null, status: draft ? (complete ? "待配置" : "待补充") : "待补充", score: null });
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
      return json({ requirementId: requirement.id, editVersion: result.editVersion, status: "待配置" });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const audienceMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/audience$/);
  if (method === "PUT" && audienceMatch) {
    // V02-T09：人工人群标签。只落库与审计：不改优先级、不重置 Base PM 状态、不触发 AI/推送/通知。
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = AudienceUpdateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    try {
      const result = await repositories.requirements.setAudienceTags(decodeURIComponent(audienceMatch[1]!), { tags: parsed.data.tags, expectedVersion: parsed.data.expectedVersion, actorId: auth.actor.id });
      if (result.outcome === "not_found") return jsonError("NOT_FOUND");
      if (result.outcome === "version_conflict") return jsonError("CONFLICT", `人群标签已被他人更新到版本 ${result.currentVersion}，请刷新后重试。`);
      return json({ requirementId: decodeURIComponent(audienceMatch[1]!), audienceVersion: result.version, confirmed: true, tags: parsed.data.tags });
    } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  const requirementMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "GET" && requirementMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const req = await repositories.requirements.get(decodeURIComponent(requirementMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
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
    return json({ ...requirementDto(req, latest && latest.status === "analyzed" ? latest.structuredResult : null, history.map(analysisVersionDto), ownerName), duplicates });
  }
  const itemRetryMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/retry$/);
  if (method === "POST" && itemRetryMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.items || !repositories.batches || !repositories.jobs) return jsonError("DEPENDENCY_UNAVAILABLE");
    const item = await repositories.items.get(decodeURIComponent(itemRetryMatch[1]!)); if (!item) return jsonError("NOT_FOUND");
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
    const req = await repositories.requirements.get(decodeURIComponent(analysisRetryMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
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
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const dedupeKey = `analysis:${req.id}:sv${req.sourceVersion}:after${priorAnalysisVersion}`;
    const currentJob = await repositories.jobs.findByDedupeKey?.(dedupeKey);
    const auditRetry = (result: "succeeded" | "failed" | "denied", analysisStatus: string) => appendAudit(repositories, {
      id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "analysis.retry_requested", entityType: "requirement", entityId: req.id,
      result, safeDetails: { sourceVersion: req.sourceVersion, priorAnalysisVersion, analysisStatus }, occurredAt: now,
    });
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
    try { await repositories.jobs.enqueue({ jobType: "analysis", dedupeKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, actorId: auth.actor.id }, availableAt: now }); }
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
    const req = await repositories.requirements.get(decodeURIComponent(ownerMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    if (!isIntakeComplete(req.pipeline.pull)) return jsonError("CONFLICT");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const latestAnalysis = await repositories.analyses?.latest(req.id) ?? null;
    const analysisVersion = latestAnalysis?.analysisVersion ?? 0;
    if (method === "DELETE") {
      // 恢复默认负责人：清除本条需求的人工指定，再按 TB 执行人映射重新解析。
      if (!req.manualOwner) return jsonError("CONFLICT", "该需求没有单独指定的负责人。");
      const hasTbOwner = Boolean(req.executorUserId || req.executorName);
      const mapping = req.sourceConfigId && req.executorUserId
        ? await repositories.people.resolveActive(req.sourceConfigId, { tbUserId: req.executorUserId })
        : req.sourceConfigId && req.executorName ? await repositories.people.resolveActive(req.sourceConfigId, { normalizedName: normalizeOwnerName(req.executorName) }) : null;
      const targetState = mapping ? "auto_mapped" : hasTbOwner ? "pending_mapping" : "not_required";
      try {
        await repositories.requirements.clearManualOwner(req.id);
        // manually_mapped 没有到 not_required/auto_mapped 的直接迁移：先退回 pending_mapping 再落目标。
        // 否则清除人工负责人后 setOwner 抛 InvalidTransitionError，需求永久卡在 manually_mapped
        // （每次重试 409，后续推送记账也会持续失败）。
        if (req.pipeline.owner !== targetState && !canTransition("owner", req.pipeline.owner, targetState)) {
          await repositories.requirements.setOwner(req.id, null, "pending_mapping");
        }
        if (req.pipeline.owner !== targetState) {
          await repositories.requirements.setOwner(req.id, mapping?.feishuUserId ?? null, targetState);
        }
      } catch (cause) {
        return (cause as Error)?.name === "InvalidTransitionError" ? jsonError("CONFLICT") : jsonError("DEPENDENCY_UNAVAILABLE");
      }
      if (mapping || !hasTbOwner) {
        const idempotencyKey = basePushIdempotencyKey(req.id, req.sourceVersion, analysisVersion, `owner-reset:${crypto.randomUUID()}`);
        try {
          await repositories.jobs.enqueue({ jobType: "base_push", dedupeKey: idempotencyKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, analysisVersion, idempotencyKey, actorId: auth.actor.id }, availableAt: now });
        } catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
      }
      const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "owner.manual_cleared", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { sourceVersion: req.sourceVersion }, occurredAt: now });
      if (auditFailure) return auditFailure;
      return json({ requirementId: req.id, ownerState: targetState, status: mapping || !hasTbOwner ? "queued" : "waiting_mapping" });
    }
    const body = OwnerMappingUpdateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    // 逐条负责人：只写需求本身，绝不改写 person_mappings（否则会改掉同 TB 执行人名下全部需求）。
    const idempotencyKey = basePushIdempotencyKey(req.id, req.sourceVersion, analysisVersion, `owner:${crypto.randomUUID()}`);
    try {
      await repositories.requirements.assignManualOwner(req.id, { feishuUserId: body.data.feishuUserId, feishuIdType: body.data.feishuIdType, name: body.data.tbDisplayName ?? null, assignedBy: auth.actor.id, assignedAt: now });
    } catch (cause) {
      return (cause as Error)?.name === "InvalidTransitionError" ? jsonError("CONFLICT") : jsonError("DEPENDENCY_UNAVAILABLE");
    }
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
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const req = await repositories.requirements.get(decodeURIComponent(pushMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
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
  return jsonError("ROUTE_NOT_IMPLEMENTED");
}
