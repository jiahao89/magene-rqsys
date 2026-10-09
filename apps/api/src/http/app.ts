import type { Pool } from "pg";
import type { IdentityProvider } from "../application/ports.js";
import type { AuditEventRepository, AnalysisRunRepository, PipelineJobRepository, SourceConfigRepository, SyncBatchRepository, SyncItemRepository, PersonMappingRepository, RequirementQueryRepository, BasePushRunRepository } from "../application/repositories.js";
import type { PersonMappingRecord, RequirementRecord, SourceConfigRecord, SyncBatchRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "../base/client.js";
import { AuditListQuerySchema, BatchListQuerySchema, OwnerMappingUpdateSchema, RequirementListQuerySchema, SyncIdempotencyHeaderSchema, SyncRunRequestSchema } from "../contracts/pipeline.js";
import { randomUUID } from "node:crypto";
import { SourceConfigUpdateSchema } from "../contracts/source.js";
import { isDatabaseReady } from "../adapters/postgres/health.js";
import { jsonError } from "./errors.js";
import { decodeRequirementCursor } from "../application/requirement-cursor.js";
import { createBasePushService } from "../base/push-service.js";

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
}
export interface ApiDependencies {
  database: Pool | null;
  identity: IdentityProvider | undefined;
  repositories: ApiRepositories | undefined;
  base?: FeishuBasePushAdapter;
  baseProjectId?: string;
  baseFields?: { projectId: string; requirementId: string; owner: string; source: Record<string,string>; ai: Record<string,string>; pm: string[] };
  now: (() => Date) | undefined;
}
function json(body: unknown, status = 200): Response { return Response.json(body, { status }); }
function sourceDto(source: SourceConfigRecord) {
  return { id: source.id, projectId: source.externalProjectId, projectName: source.externalProjectName, requirementTypeId: source.requirementTypeId, enabled: source.enabled, schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, time: source.scheduleLocalTime, timezone: source.scheduleTimezone }, ownerNames: source.ownerNames, fieldMap: source.fieldMap };
}
function batchDto(batch: SyncBatchRecord) {
  return { id: batch.id, status: batch.status, totalCount: batch.totalCount, succeededCount: batch.succeededCount, failedCount: batch.failedCount, startedAt: batch.startedAt, completedAt: batch.completedAt, errorSummary: batch.errorSummary };
}
function requirementDto(req: RequirementRecord, analysis: Record<string, unknown> | null = null) {
  return { id: req.id, sourceRequirementId: req.teambitionRequirementId, title: req.title, sourceVersion: req.sourceVersion, pipeline: { pull: req.pipeline.pull, analysis: req.pipeline.analysis, owner: req.pipeline.owner, push: req.pipeline.push }, source: req.sourcePayload, analysis, baseRecordId: req.baseRecordId };
}
function requirementSearchDto(req: RequirementRecord) { return requirementDto(req); }
async function actorFor(request: Request, dependencies: ApiDependencies) {
  if (!dependencies.identity) return { response: jsonError("UNAUTHORIZED") } as const;
  try { return { actor: await dependencies.identity.requireActor(request) } as const; }
  catch { return { response: jsonError("UNAUTHORIZED") } as const; }
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
  const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (method === "PUT" && sourceMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const parsed = SourceConfigUpdateSchema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const updated = await repositories.sources.update(decodeURIComponent(sourceMatch[1]!), parsed.data);
    return updated ? json(sourceDto(updated)) : jsonError("NOT_FOUND");
  }
  if (method === "POST" && url.pathname === "/api/sync/run") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = SyncRunRequestSchema.safeParse(await readJson(request)), key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key"));
    if (!body.success || !key.success) return jsonError("VALIDATION_FAILED");
    const source = await repositories.sources.get(body.data.sourceId); if (!source) return jsonError("NOT_FOUND");
    const previous = await repositories.batches.findByIdempotencyKey(source.id, key.data);
    if (previous) return json({ batchId: previous.id, status: previous.status }, 202);
    const active = await repositories.batches.list({ status: "running", limit: 100 });
    if (active.items.some((batch) => batch.sourceConfigId === source.id)) return jsonError("CONFLICT");
    const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    let created: SyncBatchRecord;
    try { created = await repositories.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: auth.actor.id, idempotencyKey: key.data, startedAt }); }
    catch {
      const raced = await repositories.batches.findByIdempotencyKey(source.id, key.data);
      return raced ? json({ batchId: raced.id, status: raced.status }, 202) : jsonError("CONFLICT");
    }
    try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${source.id}:${key.data}`, payload: { batchId: created.id, sourceId: source.id, triggerType: "manual", actorId: auth.actor.id }, availableAt: startedAt }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    return json({ batchId: created.id, status: "running" }, 202);
  }
  if (method === "GET" && url.pathname === "/api/batches") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries()); if (query.limit !== undefined) query.limit = String(Number(query.limit));
    const parsed = BatchListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const page = await repositories.batches.list({ limit: parsed.data.limit, ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }), ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }) }); return json({ items: page.items.map(batchDto), nextCursor: page.nextCursor });
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
  if (method === "GET" && url.pathname === "/api/requirements") {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = RequirementListQuerySchema.safeParse(query); if (!parsed.success) return jsonError("VALIDATION_FAILED");
    const cursor = decodeRequirementCursor(parsed.data.cursor);
    const page = await repositories.requirements.search({ ...(parsed.data.q === undefined ? {} : { q: parsed.data.q }), ...(parsed.data.pullState === undefined ? {} : { pullState: parsed.data.pullState }), ...(parsed.data.analysisState === undefined ? {} : { analysisState: parsed.data.analysisState }), ...(parsed.data.ownerState === undefined ? {} : { ownerState: parsed.data.ownerState }), ...(parsed.data.pushState === undefined ? {} : { pushState: parsed.data.pushState }), limit: parsed.data.limit, ...(cursor === undefined ? {} : { cursor }) });
    return json({ items: page.items.map(requirementSearchDto), nextCursor: page.nextCursor });
  }
  const requirementMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)$/);
  if (method === "GET" && requirementMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const req = await repositories.requirements.get(decodeURIComponent(requirementMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    const latest = await repositories.analyses?.latest(req.id) ?? null;
    return json(requirementDto(req, latest && latest.status === "analyzed" ? latest.structuredResult : null));
  }
  const itemRetryMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/retry$/);
  if (method === "POST" && itemRetryMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.items || !repositories.batches || !repositories.jobs) return jsonError("DEPENDENCY_UNAVAILABLE");
    const item = await repositories.items.get(decodeURIComponent(itemRetryMatch[1]!)); if (!item) return jsonError("NOT_FOUND");
    if (item.status !== "failed") return jsonError("CONFLICT");
    const batch = await repositories.batches.get(item.batchId); if (!batch) return jsonError("NOT_FOUND");
    const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    let retryBatch: SyncBatchRecord;
    try { retryBatch = await repositories.batches.create({ sourceConfigId: batch.sourceConfigId, triggerType: "manual", actorId: auth.actor.id, idempotencyKey: `retry:${item.id}:${randomUUID()}`, startedAt }); }
    catch { return jsonError("CONFLICT"); }
    try { await repositories.jobs.enqueue({ jobType: "sync", dedupeKey: `sync:${retryBatch.id}`, payload: { batchId: retryBatch.id, sourceId: batch.sourceConfigId, triggerType: "manual", actorId: auth.actor.id, onlyIds: [item.teambitionRequirementId] }, availableAt: startedAt }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    return json({ batchId: retryBatch.id, status: "queued" }, 202);
  }
  const analysisRetryMatch = url.pathname.match(/^\/api\/analysis\/([^/]+)\/retry$/);
  if (method === "POST" && analysisRetryMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.jobs) return jsonError("DEPENDENCY_UNAVAILABLE");
    const req = await repositories.requirements.get(decodeURIComponent(analysisRetryMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    try { await repositories.jobs.enqueue({ jobType: "analysis", dedupeKey: `analysis:${req.id}:${randomUUID()}`, payload: { requirementId: req.id, actorId: auth.actor.id }, availableAt: now }); }
    catch { return jsonError("DEPENDENCY_UNAVAILABLE"); }
    return json({ requirementId: req.id, status: "queued" }, 202);
  }
  const ownerMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/owner$/);
  if (method === "PUT" && ownerMatch) {
    const auth = await actorFor(request, dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.people || !repositories.requirements) return jsonError("DEPENDENCY_UNAVAILABLE");
    const body = OwnerMappingUpdateSchema.safeParse(await readJson(request)); if (!body.success) return jsonError("VALIDATION_FAILED");
    const req = await repositories.requirements.get(decodeURIComponent(ownerMatch[1]!)); if (!req) return jsonError("NOT_FOUND");
    if (req.pipeline.pull !== "synced") return jsonError("CONFLICT");
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const dedupeKey = `base-push:${req.id}:v${req.sourceVersion}`;
    const priorJob = await repositories.jobs.enqueue({jobType:"base_push",dedupeKey,payload:{requirementId:req.id,actorId:auth.actor.id},availableAt:now});
    const mapping = await repositories.people.upsertManual({ sourceConfigId:req.sourceConfigId, teambitionUserId:body.data.tbUserId ?? req.executorUserId, teambitionDisplayName:body.data.tbDisplayName ?? req.executorName, feishuUserId:body.data.feishuUserId, feishuIdType:body.data.feishuIdType, createdBy:auth.actor.id, now });
    await repositories.requirements.setOwner(req.id,mapping.feishuUserId,"manually_mapped");
    await repositories.audit.append({id:crypto.randomUUID(),actorId:auth.actor.id,eventType:"owner.manually_mapped",entityType:"requirement",entityId:req.id,result:"succeeded",safeDetails:{mappingId:mapping.id,feishuIdType:mapping.feishuIdType},occurredAt:now});
    return json({requirementId:req.id,ownerState:"manually_mapped",status:"queued"});
  }
  const pushMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/push$/);
  if (method === "POST" && pushMatch) {
    const auth = await actorFor(request,dependencies); if ("response" in auth) return auth.response;
    if (!repositories?.requirements || !repositories.basePushes || !repositories.people || !repositories.audit || !dependencies.base || !dependencies.baseProjectId || !dependencies.baseFields) return jsonError("DEPENDENCY_UNAVAILABLE");
    const key = SyncIdempotencyHeaderSchema.safeParse(request.headers.get("Idempotency-Key")); if (!key.success) return jsonError("VALIDATION_FAILED");
    const service = createBasePushService({
      requirements: repositories.requirements, people: repositories.people, basePushes: repositories.basePushes,
      audit: repositories.audit, base: dependencies.base, baseProjectId: dependencies.baseProjectId,
      baseFields: dependencies.baseFields, actorId: auth.actor.id, ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    const outcome = await service.pushRequirement(decodeURIComponent(pushMatch[1]!), key.data);
    if (outcome.kind === "not_found") return jsonError("NOT_FOUND");
    if (outcome.kind === "conflict") return jsonError("CONFLICT");
    if (outcome.kind === "error") return jsonError("DEPENDENCY_UNAVAILABLE");
    return json({ status: outcome.status, baseRecordId: outcome.baseRecordId, created: outcome.created }, 202);
  }
  return jsonError("ROUTE_NOT_IMPLEMENTED");
}
