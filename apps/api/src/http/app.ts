import type { Pool } from "pg";
import type { FeishuUserDirectory, IdentityProvider } from "../application/ports.js";
import type { AuditEventRepository, AnalysisRunRepository, PipelineJobRepository, SourceConfigRepository, SyncBatchRepository, SyncItemRepository, PersonMappingRepository, RequirementQueryRepository, BasePushRunRepository, ModuleDictionaryRepository, PriorityRuleRepository, SourceSnapshotRepository } from "../application/repositories.js";
import type { PersonMappingRecord, AnalysisRunRecord, ModuleDictionaryVersionRecord, PriorityRuleVersionRecord, RequirementRecord, SourceConfigRecord, SyncBatchRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "../base/client.js";
import { AuditListQuerySchema, BatchListQuerySchema, FeishuUserSearchQuerySchema, OwnerMappingUpdateSchema, RequirementListQuerySchema, SyncIdempotencyHeaderSchema, SyncRunRequestSchema } from "../contracts/pipeline.js";
import { randomUUID } from "node:crypto";
import { SourceConfigUpdateSchema } from "../contracts/source.js";
import { DictionaryCreateSchema, PriorityRuleCreateSchema } from "../contracts/rules.js";
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
}
export interface ApiDependencies {
  database: Pool | null;
  identity: IdentityProvider | undefined;
  repositories: ApiRepositories | undefined;
  base?: FeishuBasePushAdapter;
  baseProjectId?: string;
  baseFields?: { projectId: string; requirementId: string; owner: string; source: Record<string,string>; ai: Record<string,string>; pm: string[] };
  feishuUsers?: FeishuUserDirectory;
  now: (() => Date) | undefined;
}
function json(body: unknown, status = 200): Response { return Response.json(body, { status }); }
function sourceDto(source: SourceConfigRecord) {
  return { id: source.id, projectId: source.externalProjectId, projectName: source.externalProjectName, requirementTypeId: source.requirementTypeId, enabled: source.enabled, schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, time: source.scheduleLocalTime, timezone: source.scheduleTimezone }, ownerNames: source.ownerNames, fieldMap: source.fieldMap };
}
function batchDto(batch: SyncBatchRecord) {
  return { id: batch.id, status: batch.status, triggerType: batch.triggerType, actorId: batch.actorId, totalCount: batch.totalCount, succeededCount: batch.succeededCount, failedCount: batch.failedCount, startedAt: batch.startedAt, completedAt: batch.completedAt, errorSummary: batch.errorSummary };
}
function requirementDto(req: RequirementRecord, analysis: Record<string, unknown> | null = null, analyses: unknown[] = []) {
  return { id: req.id, sourceRequirementId: req.teambitionRequirementId, title: req.title, sourceVersion: req.sourceVersion, pipeline: { pull: req.pipeline.pull, analysis: req.pipeline.analysis, owner: req.pipeline.owner, push: req.pipeline.push }, source: req.sourcePayload, analysis, baseRecordId: req.baseRecordId, analyses };
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
function requirementSearchDto(req: RequirementRecord) { return requirementDto(req); }
function dictionaryDto(d: ModuleDictionaryVersionRecord) { return { version: d.version, status: d.status, entries: d.entries, createdBy: d.createdBy, createdAt: d.createdAt, publishedAt: d.publishedAt }; }
function priorityRuleDto(r: PriorityRuleVersionRecord) { return { id: r.id, version: r.version, status: r.status, rules: r.rules, validationEvidence: r.validationEvidence, createdBy: r.createdBy, createdAt: r.createdAt, publishedAt: r.publishedAt }; }
async function actorFor(request: Request, dependencies: ApiDependencies) {
  if (!dependencies.identity) return { response: jsonError("UNAUTHORIZED") } as const;
  try { return { actor: await dependencies.identity.requireActor(request) } as const; }
  catch { return { response: jsonError("UNAUTHORIZED") } as const; }
}

// 服务端角色矩阵（Spec 04 角色表）：授权必须在这里发生，不能只靠隐藏 Web 控件。
// manage_config：来源配置写（Administrator）；manage_rules：词典/规则维护与发布（Administrator、PM Leader）；
// operate：手动同步、批次重试、分析重试、负责人映射与推送（Administrator、PM Leader、Designated operator）。
type RoleAction = "manage_config" | "manage_rules" | "operate";
const ROLE_MATRIX: Record<RoleAction, readonly string[]> = {
  manage_config: ["administrator"],
  manage_rules: ["administrator", "pm_leader"],
  operate: ["administrator", "pm_leader", "operator"],
};
function forbid(actor: { id: string; roles: string[] }, action: RoleAction): boolean {
  return !actor.roles.some((role) => ROLE_MATRIX[action].includes(role));
}
// 审计与业务写入保持一致：审计写失败时不返回虚假成功（工单 12 验收）。
async function appendAudit(repositories: ApiRepositories, event: Parameters<ApiRepositories["audit"]["append"]>[0]): Promise<Response | null> {
  try { await repositories.audit.append(event); return null; }
  catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
}
async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { return undefined; } }

export async function handleApiRequest(request: Request, dependencies: ApiDependencies): Promise<Response> {
  const url = new URL(request.url), method = request.method.toUpperCase(), repositories = dependencies.repositories;
  if (method === "GET" && url.pathname === "/api/health") return json({ status: "ok", service: "rq-sys-api" });
  if (method === "GET" && url.pathname === "/api/health/ready") {
    return await isDatabaseReady(dependencies.database) ? json({ status: "ready", database: "connected" }) : json({ status: "not_ready", reason: "database_unavailable_or_not_configured" }, 503);
  }
  if (method === "GET" && url.pathname === "/api/sources") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ items: (await repositories.sources.list()).map(sourceDto) });
  }
  if (method === "POST" && url.pathname === "/api/sources") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "manage_config")) return jsonError("FORBIDDEN");
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = SourceConfigUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    // 受控初始化：MVP 只允许一个产品组来源（D-09）。
    const existing = await repositories.sources.list();
    if (existing.length > 0) return jsonError("CONFLICT");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    let created: SourceConfigRecord;
    try { created = await repositories.sources.create({ ...parsed.data, auditEvent: { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "source.created", entityType: "source_config", result: "succeeded", safeDetails: { sourceProjectId: parsed.data.projectId }, occurredAt: now } }); }
    catch (cause) { return cause && typeof cause === "object" && "code" in cause && cause.code === "23505" && "constraint" in cause && typeof cause.constraint === "string" && cause.constraint.startsWith("source_configs_") ? jsonError("CONFLICT") : jsonError("DEPENDENCY_UNAVAILABLE"); }
    return json(sourceDto(created), 201);
  }
  const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (method === "PUT" && sourceMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "manage_config")) return jsonError("FORBIDDEN");
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = SourceConfigUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const sourceId = decodeURIComponent(sourceMatch[1]!);
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    let updated: SourceConfigRecord | null;
    try { updated = await repositories.sources.update(sourceId, parsed.data, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "source.updated", entityType: "source_config", result: "succeeded", safeDetails: { sourceProjectId: parsed.data.projectId }, occurredAt: now }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    if (!updated) return jsonError("NOT_FOUND");
    return json(sourceDto(updated));
  }
  if (method === "POST" && url.pathname === "/api/sync/run") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "operate")) return jsonError("FORBIDDEN");
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = SyncRunRequestSchema.safeParse(await readJson(request)), key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key"));
    if (!body.success || !key.success) return jsonError("VALIDATION_FAILED");
    const source = await repositories.sources.get(body.data.sourceId); if (!source) return jsonError("NOT_FOUND");
    const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const previous = await repositories.batches.findByIdempotencyKey(source.id, key.data);
    if (previous) {
      // 已有活跃批次：幂等重放。已有终态批次（如入队失败被标 failed）：同一幂等键重新入队恢复，不制造孤儿/重复批次
      if (previous.status === "running") return json({ batchId: previous.id, status: previous.status }, 202);
      try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${source.id}:${key.data}`, payload: { batchId: previous.id, sourceId: source.id, triggerType: "manual", actorId: auth.actor.id }, availableAt: startedAt }); }
      catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
      const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "sync.retry_requested", entityType: "sync_batch", entityId: previous.id, result: "succeeded", safeDetails: { trigger: "manual" }, occurredAt: startedAt });
      if (auditFailure) return auditFailure;
      return json({ batchId: previous.id, status: previous.status }, 202);
    }
    const active = await repositories.batches.list({ status: "running", limit: 100 });
    if (active.items.some((batch) => batch.sourceConfigId === source.id)) return jsonError("CONFLICT");
    let created: SyncBatchRecord;
    try { created = await repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: auth.actor.id, idempotencyKey: key.data, startedAt }); }
    catch {
      const raced = await repositories.batches.findByIdempotencyKey(source.id, key.data);
      return raced ? json({ batchId: raced.id, status: raced.status }, 202) : jsonError("CONFLICT");
    }
    try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${source.id}:${key.data}`, payload: { batchId: created.id, sourceId: source.id, triggerType: "manual", actorId: auth.actor.id }, availableAt: startedAt }); }
    catch {
      // 入队失败恢复（工单 15）：批次标记 failed，不留「running 且无 job」的孤儿；同幂等键重试可恢复
      await repositories.batches.complete(created.id, { status: "failed", totalCount: 0, succeededCount: 0, failedCount: 0, errorSummary: "Job enqueue failed; repeat the same idempotent request to recover.", completedAt: startedAt });
      return jsonError("DEPENDENCY_UNAVAILABLE");
    }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "sync.requested", entityType: "sync_batch", entityId: created.id, result: "succeeded", safeDetails: { trigger: "manual" }, occurredAt: startedAt });
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
    if (forbid(auth.actor, "manage_rules")) return jsonError("FORBIDDEN");
    if (!repositories?.dictionaries) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = DictionaryCreateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const created = await repositories.dictionaries.create({ entries: body.data.entries, createdBy: auth.actor.id, now, auditEvent: { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "dictionary.created", entityType: "module_dictionary", result: "succeeded", safeDetails: { entryCount: body.data.entries.length }, occurredAt: now } });
    return json(dictionaryDto(created), 201);
  }
  const dictionaryPublishMatch = url.pathname.match(/^\/api\/rules\/dictionary\/(\d+)\/publish$/);
  if (method === "POST" && dictionaryPublishMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "manage_rules")) return jsonError("FORBIDDEN");
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
    if (forbid(auth.actor, "manage_rules")) return jsonError("FORBIDDEN");
    if (!repositories?.priorityRules) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = PriorityRuleCreateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const created = await repositories.priorityRules.create({ rules: body.data.rules, validationEvidence: body.data.validationEvidence ?? [], createdBy: auth.actor.id, now, auditEvent: { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "priority_rule.created", entityType: "priority_rule", result: "succeeded", safeDetails: {}, occurredAt: now } });
    return json(priorityRuleDto(created), 201);
  }
  const rulePublishMatch = url.pathname.match(/^\/api\/rules\/priority\/([^/]+)\/publish$/);
  if (method === "POST" && rulePublishMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "manage_rules")) return jsonError("FORBIDDEN");
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
  if (method === "GET" && url.pathname === "/api/feishu/users") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "operate")) return jsonError("FORBIDDEN");
    if (!dependencies.feishuUsers) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = FeishuUserSearchQuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
    if (!parsed.success) return jsonError("VALIDATION_FAILED");
    try { return json({ items: (await dependencies.feishuUsers.search(parsed.data.q)).slice(0, 20) }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
  }
  if (method === "GET" && url.pathname === "/api/requirements") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = RequirementListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const cursor = decodeRequirementCursor(parsed.data.cursor);
    const page = await repositories.requirements.search({ ...(parsed.data.q === undefined ? {} : { q: parsed.data.q }), ...(parsed.data.pullState === undefined ? {} : { pullState: parsed.data.pullState }), ...(parsed.data.analysisState === undefined ? {} : { analysisState: parsed.data.analysisState }), ...(parsed.data.ownerState === undefined ? {} : { ownerState: parsed.data.ownerState }), ...(parsed.data.pushState === undefined ? {} : { pushState: parsed.data.pushState }), ...(parsed.data.batchId === undefined ? {} : { batchId: parsed.data.batchId }), ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }), ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }), limit: parsed.data.limit, ...(cursor === undefined ? {} : { cursor }) });
    return json({ items: page.items.map(requirementSearchDto), nextCursor: page.nextCursor });
  }
  const requirementMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "GET" && requirementMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const req = await repositories.requirements.get(decodeURIComponent(requirementMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    const latest = await repositories.analyses?.latest(req.id) ?? null;
    const history = await repositories.analyses?.listByRequirement(req.id) ?? [];
    return json(requirementDto(req, latest && latest.status === "analyzed" ? latest.structuredResult : null, history.map(analysisVersionDto)));
  }
  const itemRetryMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/retry$/);
  if (method === "POST" && itemRetryMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "operate")) return jsonError("FORBIDDEN");
    if (!repositories?.items || !repositories.batches || !repositories.jobs) return jsonError("DEPENDENCY_UNAVAILABLE");
    const item = await repositories.items.get(decodeURIComponent(itemRetryMatch[1]!)); if (!item) return jsonError("NOT_FOUND");
    if (item.status !== "failed") return jsonError("CONFLICT");
    const batch = await repositories.batches.get(item.batchId); if (!batch) return jsonError("NOT_FOUND");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    let retryBatch = await repositories.batches.findByIdempotencyKey(batch.sourceConfigId, key.data);
    if (!retryBatch) {
      try { retryBatch = await repositories.batches.create({ sourceConfigId: batch.sourceConfigId, triggerType: "manual", actorId: auth.actor.id, idempotencyKey: key.data, startedAt }); }
      catch {
        retryBatch = await repositories.batches.findByIdempotencyKey(batch.sourceConfigId, key.data);
        if (!retryBatch) return jsonError("CONFLICT");
      }
    }
    const retryDedupeKey = `sync:${retryBatch.id}`;
    const priorJob = await repositories.jobs.findByDedupeKey?.(retryDedupeKey);
    if (priorJob && ["queued", "running"].includes(priorJob.status)) return json({ batchId: retryBatch.id, status: "queued" }, 202);
    if (priorJob?.status === "succeeded") return json({ batchId: retryBatch.id, status: retryBatch.status }, 202);
    try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${retryBatch.id}`, payload: { batchId: retryBatch.id, sourceId: batch.sourceConfigId, triggerType: "manual", actorId: auth.actor.id, onlyIds: [item.teambitionRequirementId] }, availableAt: startedAt }); }
    catch {
      await repositories.batches.complete(retryBatch.id, { status: "failed", totalCount: 1, succeededCount: 0, failedCount: 1, errorSummary: "Job enqueue failed; repeat the retry to recover.", completedAt: startedAt });
      return jsonError("DEPENDENCY_UNAVAILABLE");
    }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "sync.item.retry_requested", entityType: "sync_item", entityId: item.id, result: "succeeded", safeDetails: { sourceRequirementId: item.teambitionRequirementId, trigger: "manual" }, occurredAt: startedAt });
    if (auditFailure) return auditFailure;
    return json({ batchId: retryBatch.id, status: "queued" }, 202);
  }
  const analysisRetryMatch = url.pathname.match(/^\/api\/analysis\/([^/]+)\/retry$/);
  if (method === "POST" && analysisRetryMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "operate")) return jsonError("FORBIDDEN");
    if (!repositories?.requirements || !repositories.jobs) return jsonError("DEPENDENCY_UNAVAILABLE");
    const req = await repositories.requirements.get(decodeURIComponent(analysisRetryMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    if (req.pipeline.pull !== "synced" || req.pipeline.analysis !== "failed_retryable") return jsonError("CONFLICT");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const latestAnalysis = await repositories.analyses?.latest(req.id) ?? null;
    const priorAnalysisVersion = latestAnalysis?.analysisVersion ?? 0;
    try { await repositories.jobs.enqueue({ jobType: "analysis", dedupeKey: `analysis:${req.id}:sv${req.sourceVersion}:after${priorAnalysisVersion}`, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, actorId: auth.actor.id }, availableAt: now }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "analysis.retry_requested", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { sourceVersion: req.sourceVersion, priorAnalysisVersion }, occurredAt: now });
    if (auditFailure) return auditFailure;
    return json({ requirementId: req.id, status: "queued" }, 202);
  }
  const ownerMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/owner$/);
  if (method === "PUT" && ownerMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "operate")) return jsonError("FORBIDDEN");
    if (!repositories?.people || !repositories.requirements || !repositories.jobs || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = OwnerMappingUpdateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const req = await repositories.requirements.get(decodeURIComponent(ownerMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    if (req.pipeline.pull !== "synced") return jsonError("CONFLICT");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    // 工单 14：人工映射持久化成功后再入队推送——任一步失败不留虚假成功
    const mapping = await repositories.people.upsertManual({ sourceConfigId:req.sourceConfigId, teambitionUserId:body.data.tbUserId ?? req.executorUserId, teambitionDisplayName:body.data.tbDisplayName ?? req.executorName, feishuUserId:body.data.feishuUserId, feishuIdType:body.data.feishuIdType, createdBy:auth.actor.id, now });
    await repositories.requirements.setOwner(req.id,mapping.feishuUserId,"manually_mapped");
    const latestAnalysis = await repositories.analyses?.latest(req.id) ?? null;
    const analysisVersion = latestAnalysis?.analysisVersion ?? 0;
    await repositories.jobs.enqueue({jobType:"base_push",dedupeKey:basePushIdempotencyKey(req.id,req.sourceVersion,analysisVersion),payload:{requirementId:req.id,sourceVersion:req.sourceVersion,analysisVersion,actorId:auth.actor.id},availableAt:now});
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "owner.manually_mapped", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: {}, occurredAt: now });
    if (auditFailure) return auditFailure;
    return json({requirementId:req.id,ownerState:"manually_mapped",status:"queued"});
  }
  const pushMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/push$/);
  if (method === "POST" && pushMatch) {
    const auth = await actorFor(request,dependencies); if ("response" in auth) return auth.response;
    if (forbid(auth.actor, "operate")) return jsonError("FORBIDDEN");
    if (!repositories?.requirements || !repositories.jobs || !repositories.audit) return jsonError("DEPENDENCY_UNAVAILABLE");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const req = await repositories.requirements.get(decodeURIComponent(pushMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    if (req.pipeline.pull !== "synced" || req.pipeline.owner === "pending_mapping" || !["pending", "failed"].includes(req.pipeline.push)) return jsonError("CONFLICT");
    const latestAnalysis = await repositories.analyses?.latest(req.id) ?? null;
    const analysisVersion = latestAnalysis?.analysisVersion ?? 0;
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const dedupeKey = basePushIdempotencyKey(req.id, req.sourceVersion, analysisVersion);
    try { await repositories.jobs.enqueue({ jobType: "base_push", dedupeKey, payload: { requirementId: req.id, sourceVersion: req.sourceVersion, analysisVersion, actorId: auth.actor.id }, availableAt: now }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    const auditFailure = await appendAudit(repositories, { id: crypto.randomUUID(), actorId: auth.actor.id, eventType: "base.push.retry_requested", entityType: "requirement", entityId: req.id, result: "succeeded", safeDetails: { sourceVersion: req.sourceVersion, analysisVersion }, occurredAt: now });
    if (auditFailure) return auditFailure;
    return json({ requirementId: req.id, status: "queued" }, 202);
  }
  return jsonError("ROUTE_NOT_IMPLEMENTED");
}
