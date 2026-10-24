import assert from "node:assert/strict";
import { createHash as createHashForTest } from "node:crypto";
import test from "node:test";
import type { AuditEventRecord, RequirementRecord, SourceConfigRecord, SyncBatchRecord, SyncItemRecord } from "../domain/persistence.js";
import type { ApiDependencies, ApiRepositories } from "./app.js";
import { handleApiRequest } from "./app.js";
import { encodeBatchCursor } from "../application/batch-cursor.js";

const source: SourceConfigRecord = { id: "11111111-1111-4111-8111-111111111111", provider: "teambition", externalProjectId: "p1", externalProjectName: "Project", requirementTypeId: "type1", enabled: true, scheduleEnabled: false, scheduleWeekday: null, scheduleLocalTime: null, scheduleTimezone: null, ownerNames: ["Lee"], fieldMap: { title: "name" }, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
const batch: SyncBatchRecord = { id: "22222222-2222-4222-8222-222222222222", sourceConfigId: source.id, triggerType: "manual", actorId: "actor-1", idempotencyKey: "request-key-0001", status: "running", startedAt: "2026-10-08T00:00:00.000Z", completedAt: null, totalCount: 0, succeededCount: 0, failedCount: 0, errorSummary: null, createdAt: "2026-10-08T00:00:00.000Z" };
const item: SyncItemRecord = { id: "33333333-3333-4333-8333-333333333333", batchId: batch.id, requirementId: null, teambitionRequirementId: "tb-1", action: "created", status: "succeeded", errorCode: null, errorDetail: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:00.000Z" };
const auditEvent: AuditEventRecord = { id: "44444444-4444-4444-8444-444444444444", actorId: "actor-1", eventType: "sync.requested", entityType: "sync_batch", entityId: batch.id, result: "succeeded", safeDetails: {}, occurredAt: "2026-10-08T00:00:00.000Z" };
const requirement = { id: "66666666-6666-4666-8666-666666666666", platformRequirementId: "RQ-000001", sourceType: "teambition", sourceChannel: null, productModel: null, requirementType: null, constraintNotes: null, supplementUrl: null, sourceConfigId: source.id, teambitionRequirementId: "tb-1", teambitionUniqueId: null, title: "Need", description: null, scope: null, acceptanceCriteria: null, proposerUserId: null, proposerName: null, executorUserId: null, executorName: null, sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null, attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "h", substantiveHash: "s", sourceVersion: 1, latestBatchId: batch.id, baseRecordId: null, lastPushedAt: null, pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pending" }, firstSeenAt: "2026-10-08T00:00:00.000Z", lastSeenAt: "2026-10-08T00:00:00.000Z", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
const analysisRun = { id: "run-1", requirementId: source.id, sourceVersion: 1, analysisVersion: 2, status: "analyzed", moduleSuggestion: "报表分析", confidence: "medium", confidenceReason: "理由", priority: "P1", structuredResult: null, provider: "deepseek", model: "m", promptVersion: "p", moduleDictionaryVersion: 1, priorityRuleVersionId: null, safeErrorCode: null, safeErrorSummary: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z" };
function makeDependencies(actor: { id: string } = { id: "actor-1" }): ApiDependencies {
 const batches: SyncBatchRecord[] = [];
 const repositories: ApiRepositories = {
  sources: { list: async () => [source], get: async (id) => id === source.id ? source : null, update: async (id, u) => id === source.id ? { ...source, externalProjectId: u.projectId, externalProjectName: u.projectName, requirementTypeId: u.requirementTypeId, enabled: u.enabled, scheduleEnabled: u.schedule.enabled, scheduleWeekday: u.schedule.weekday, scheduleLocalTime: u.schedule.time, scheduleTimezone: u.schedule.timezone, ownerNames: u.ownerNames, fieldMap: u.fieldMap } : null, create: async () => source },
  batches: { create: async (p) => { const b = { ...batch, ...p, id: `batch-${batches.length + 1}` }; batches.push(b); return b; }, get: async (id) => batches.find((b) => b.id === id) ?? (id === batch.id ? batch : null), findByIdempotencyKey: async (sid, key) => batches.find((b) => b.sourceConfigId === sid && b.idempotencyKey === key) ?? null, list: async ({ status, limit, cursor }) => { const rows = batches.filter((b) => !status || b.status === status); const start = cursor ? rows.findIndex((b) => b.id === cursor.id) + 1 : 0; const items = rows.slice(start, start + limit); return { items, nextCursor: start + limit < rows.length ? items.at(-1)?.id ?? null : null }; }, complete: async () => null },
  items: { upsert: async () => item, get: async () => item, listByBatch: async (id) => id === batch.id ? [item] : [] },
  audit: { append: async () => undefined, search: async () => [auditEvent] },
  jobs: { enqueue: async (p) => ({ ...p, id: "job-1", status: "queued", attemptCount: 0, maxAttempts: p.maxAttempts ?? 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: p.availableAt, updatedAt: p.availableAt }), claimNext: async () => null, reschedule: async () => null, complete: async () => null },
 analyses: { append: async () => analysisRun as never, complete: async () => analysisRun as never, latest: async () => analysisRun as never, listByRequirement: async () => [analysisRun as never] },
 requirements: { get: async (id: string) => id === requirement.id ? requirement : null, search: async () => ({ items: [], nextCursor: null }), findForSync: async () => null, upsertRequirement: async () => { throw new Error("unused"); }, updateAnalysisState: async () => undefined, setOwner: async () => undefined, setBaseRecord: async () => undefined, setPushState: async () => undefined, updateOwnerState: async () => undefined, updatePushState: async () => undefined, listDuplicates: async () => [], listTitleCandidates: async () => [], setDuplicateOf: async () => undefined, markLastPushedOwner: async () => undefined, assignManualOwner: async () => undefined, clearManualOwner: async () => undefined, markManualOwnerPushed: async () => undefined } as never,
 };
 return { database: null, repositories, identity: { requireActor: async () => actor }, now: () => new Date("2026-10-08T00:00:00.000Z") };
}
const unauthenticated: ApiDependencies = { database: null, repositories: undefined, identity: undefined, now: undefined };
test("liveness reports the API service", async () => { const r = await handleApiRequest(new Request("http://localhost/api/health"), unauthenticated); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: "ok", service: "rq-sys-api" }); });

test("readiness reports unavailable when no database is configured", async () => { const r = await handleApiRequest(new Request("http://localhost/api/health/ready"), unauthenticated); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { status: "not_ready", reason: "database_unavailable_or_not_configured" }); });
test("overview metrics return full pipeline counts and require an authenticated actor", async () => {
 const protectedResponse = await handleApiRequest(new Request("http://localhost/api/overview/metrics"), unauthenticated);
 assert.equal(protectedResponse.status, 401);

 const d = makeDependencies();
 (d.repositories!.requirements as unknown as { getPipelineCounts: () => Promise<unknown> }).getPipelineCounts = async () => ({ total: 311, pullSynced: 311, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 0 });
 const response = await handleApiRequest(new Request("http://localhost/api/overview/metrics"), d);
 assert.equal(response.status, 200);
 assert.deepEqual(await response.json(), { counts: { total: 311, pullSynced: 311, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 0 } });
});
test("test fixture status requires authentication and reports only its availability", async () => {
 const unauthenticatedResponse = await handleApiRequest(new Request("http://localhost/api/dev/fixtures/status"), unauthenticated);
 assert.equal(unauthenticatedResponse.status, 401);

 const d = makeDependencies();
 d.enableTestFixtures = true;
 const enabledResponse = await handleApiRequest(new Request("http://localhost/api/dev/fixtures/status"), d);
 assert.equal(enabledResponse.status, 200);
 assert.deepEqual(await enabledResponse.json(), { enabled: true });

 d.enableTestFixtures = false;
 const disabledResponse = await handleApiRequest(new Request("http://localhost/api/dev/fixtures/status"), d);
 assert.equal(disabledResponse.status, 200);
 assert.deepEqual(await disabledResponse.json(), { enabled: false });
});
test("lists only user-maintained source settings after injected identity authentication", async () => { const r = await handleApiRequest(new Request("http://localhost/api/sources"), makeDependencies()); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { items: [{ id: source.id, projectName: "Project", enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null } }] }); });
test("rejects protected routes without an identity provider", async () => { const r = await handleApiRequest(new Request("http://localhost/api/sources"), unauthenticated); assert.equal(r.status, 401); });
test("updates source settings by project name while keeping server-owned IDs and metadata", async () => { const d = makeDependencies(); const r = await handleApiRequest(new Request(`http://localhost/api/sources/${source.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName: "Project", enabled: false, schedule: { enabled: true, weekday: 1, time: "09:30", timezone: "Asia/Shanghai" } }) }), d); assert.equal(r.status, 200); const body = await r.json() as Record<string, unknown>; assert.deepEqual(body, { id: source.id, projectName: "Project", enabled: false, schedule: { enabled: true, weekday: 1, time: "09:30", timezone: "Asia/Shanghai" } }); assert.equal(source.externalProjectId, "p1"); assert.equal(source.requirementTypeId, "type1"); assert.deepEqual(source.fieldMap, { title: "name" }); });
test("any authenticated Feishu actor can update source settings without an application role", async () => { const d = makeDependencies({ id: "logged-in-user" }); const r = await handleApiRequest(new Request(`http://localhost/api/sources/${source.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName: "Project", enabled: false, schedule: { enabled: true, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" } }) }), d); assert.equal(r.status, 200); });
test("queues a sync once and returns the batch for an idempotent repeat", async () => { const d = makeDependencies(); const req = () => new Request("http://localhost/api/sync/run", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "request-key-0001" }, body: JSON.stringify({ sourceId: source.id }) }); const first = await handleApiRequest(req(), d); assert.equal(first.status, 202); assert.deepEqual(await first.json(), { batchId: "batch-1", status: "running" }); const dup = await handleApiRequest(req(), d); assert.equal(dup.status, 202); assert.deepEqual(await dup.json(), { batchId: "batch-1", status: "running" }); });
test("queues a source-only sync mode separately and records the mode in the audit", async () => {
 const d = makeDependencies();
 let queued: Record<string, unknown> | null = null;
 let createdKey: string | null = null;
 let auditDetails: Record<string, unknown> | null = null;
 d.repositories!.batches.create = async (input) => {
  createdKey = input.idempotencyKey;
  return { ...batch, ...input, id: "batch-source-only", status: "running" };
 };
 d.repositories!.jobs.enqueue = async (input) => {
  queued = input as unknown as Record<string, unknown>;
  return { ...input, id: "sync-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt };
 };
 d.repositories!.audit.append = async (event) => { auditDetails = event.safeDetails as Record<string, unknown>; };
 const response = await handleApiRequest(new Request("http://localhost/api/sync/run", {
  method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "source-only-0001" },
  body: JSON.stringify({ sourceId: source.id, mode: "source_only" }),
 }), d);
 assert.equal(response.status, 202);
 assert.match(createdKey ?? "", /^source_only:[a-f0-9]{64}$/);
 assert.ok((createdKey ?? "").length <= 128);
 assert.deepEqual((queued as Record<string, unknown> | null)?.payload, { batchId: "batch-source-only", sourceId: source.id, triggerType: "manual", actorId: "actor-1", mode: "source_only" });
 assert.deepEqual(auditDetails, { trigger: "manual", mode: "source_only" });
});
test("scopes the same idempotency token to its sync mode", async () => {
 const keys: string[] = [];
 for (const mode of ["full_pipeline", "source_only"] as const) {
  const d = makeDependencies();
  d.repositories!.batches.create = async (input) => { keys.push(input.idempotencyKey); return { ...batch, ...input, id: `batch-${mode}`, status: "succeeded" }; };
  d.repositories!.jobs.enqueue = async (input) => ({ ...input, id: `job-${mode}`, status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt });
  d.repositories!.audit.append = async () => {};
  const response = await handleApiRequest(new Request("http://localhost/api/sync/run", {
   method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "same-token-123" },
   body: JSON.stringify({ sourceId: source.id, mode }),
  }), d);
  assert.equal(response.status, 202);
 }
 assert.equal(keys.length, 2);
 assert.notEqual(keys[0], keys[1]);
 assert.ok(keys.every((key) => /^(full_pipeline|source_only):[a-f0-9]{64}$/.test(key)));
});
test("queues a Base push retry without an undocumented project ID dependency", async () => {
  const d = makeDependencies();
  let queued: Record<string, unknown> | null = null;
  let auditType: string | null = null;
  d.repositories!.jobs.enqueue = async (input) => { queued = input as unknown as Record<string, unknown>; return { ...input, id: "push-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt }; };
  d.repositories!.audit.append = async (event) => { auditType = event.eventType; };
  const response = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}/push`, { method: "POST", headers: { "Idempotency-Key": "retry-key-123" } }), d);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { requirementId: requirement.id, status: "queued" });
  assert.equal((queued as Record<string, unknown> | null)?.jobType, "base_push");
  assert.deepEqual((queued as Record<string, unknown> | null)?.payload, { requirementId: requirement.id, sourceVersion: 1, analysisVersion: 2, idempotencyKey: `base-push:${requirement.id}:sv1:av2:retry:retry-key-123`, actorId: "actor-1" });
  assert.equal(auditType, "base.push.retry_requested");
});
test("queues a retry for a pending analysis when its current queue job is missing", async () => {
  const d = makeDependencies();
  const queued: Record<string, unknown>[] = [];
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "pending" as const } } as RequirementRecord : null;
  d.repositories!.jobs.enqueue = async (input) => {
    queued.push(input as unknown as Record<string, unknown>);
    return { ...input, id: "analysis-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt };
  };
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { requirementId: requirement.id, status: "queued" });
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.dedupeKey, `analysis:${requirement.id}:sv1:after2`);
});
test("audits an analysis retry request when an existing queued job is reused", async () => {
  const d = makeDependencies();
  const auditEvents: Record<string, unknown>[] = [];
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id
    ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "pending" as const } } as RequirementRecord
    : null;
  d.repositories!.jobs.findByDedupeKey = async (key) => key === `analysis:${requirement.id}:sv1:after2`
    ? { id: "analysis-job", jobType: "analysis", dedupeKey: key, payload: {}, status: "queued", attemptCount: 0, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" }
    : null;
  d.repositories!.audit.append = async (event) => { auditEvents.push(event as unknown as Record<string, unknown>); };
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { requirementId: requirement.id, status: "queued" });
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.eventType, "analysis.retry_requested");
  assert.equal(auditEvents[0]?.actorId, "actor-1");
  assert.deepEqual(auditEvents[0]?.safeDetails, { sourceVersion: 1, priorAnalysisVersion: 2, analysisStatus: "reused_existing_job" });
});
test("lists and retrieves batches with items", async () => { const d = makeDependencies(); assert.equal((await handleApiRequest(new Request("http://localhost/api/batches?limit=10"), d)).status, 200); const r = await handleApiRequest(new Request(`http://localhost/api/batches/${batch.id}`), d); assert.equal(r.status, 200); assert.deepEqual((await r.json() as { items: SyncItemRecord[] }).items, [item]); });
test("failed item retry is idempotent across repeated requests", async () => {
  const d = makeDependencies();
  let created = 0, enqueued = 0, audits = 0;
  let enqueuedPayload: Record<string, unknown> | null = null;
  let createdRetryKey: string | null = null;
  let retryBatch: SyncBatchRecord | null = null;
  d.repositories!.items.get = async () => ({ ...item, status: "failed" });
  d.repositories!.batches.create = async (params) => { created += 1; createdRetryKey = params.idempotencyKey; retryBatch = { ...batch, ...params, id: "retry-batch", status: "running" }; return retryBatch; };
  const retryKey = `item-retry:source_only:${createHashForTest("sha256").update(`${item.id}:retry-key-123`).digest("hex")}`;
  d.repositories!.batches.findByIdempotencyKey = async (_sourceId, key) => key === retryKey ? retryBatch : null;
  d.repositories!.batches.get = async () => ({ ...batch, idempotencyKey: "source_only:" + "a".repeat(64) });
  d.repositories!.jobs.enqueue = async (params) => { enqueued += 1; enqueuedPayload = params.payload; return { ...params, id: "retry-job", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: params.availableAt, updatedAt: params.availableAt }; };
  d.repositories!.jobs.findByDedupeKey = async (key) => {
    const queuedJob = { id: "retry-job", jobType: "sync" as const, dedupeKey: key, payload: { mode: "source_only" }, status: "queued" as const, attemptCount: 0, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
    if (key === `sync:${batch.sourceConfigId}:${batch.idempotencyKey}`) return queuedJob;
    return enqueued ? { ...queuedJob, dedupeKey: "sync:retry-batch", payload: enqueuedPayload ?? {} } : null;
  };
  d.repositories!.audit.append = async () => { audits += 1; };
  const request = () => new Request(`http://localhost/api/items/${item.id}/retry`, { method: "POST", headers: { "Idempotency-Key": "retry-key-123" } });
  const first = await handleApiRequest(request(), d);
  const second = await handleApiRequest(request(), d);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(created, 1);
  assert.equal(enqueued, 1);
  assert.equal(audits, 1);
  assert.equal((enqueuedPayload as unknown as Record<string, unknown> | null)?.mode, "source_only");
  assert.equal(createdRetryKey, retryKey);
});
test("batch and requirement list routes pass time, batch and stable cursor filters to repositories", async () => {
 const d = makeDependencies(); let batchQuery: unknown; let requirementQuery: unknown;
 d.repositories!.batches.list = async (query) => { batchQuery = query; return { items: [], nextCursor: null }; };
 d.repositories!.requirements!.search = async (query) => { requirementQuery = query; return { items: [], nextCursor: null }; };
 const batchCursor = { startedAt: "2026-01-01T00:00:00.000Z", id: batch.id };
 const batchResponse = await handleApiRequest(new Request(`http://localhost/api/batches?since=2026-01-01T00%3A00%3A00Z&until=2026-01-02T00%3A00%3A00Z&cursor=${encodeURIComponent(encodeBatchCursor(batchCursor))}`), d);
 assert.equal(batchResponse.status, 200);
 assert.deepEqual(batchQuery, { limit: 25, since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", cursor: batchCursor });
 const requirementResponse = await handleApiRequest(new Request(`http://localhost/api/requirements?batchId=${batch.id}&pullState=synced&since=2026-01-01T00%3A00%3A00Z&until=2026-01-02T00%3A00%3A00Z`), d);
 assert.equal(requirementResponse.status, 200);
 assert.deepEqual(requirementQuery, { batchId: batch.id, pullState: "synced", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", limit: 25 });
});
test("V02-T02 manual requirements read back with source fields and no TB link fallback", async () => {
  const d = makeDependencies();
  const manual = { ...requirement, sourceType: "web_manual", sourceChannel: "售后", sourceConfigId: null, teambitionRequirementId: null, pipeline: { ...requirement.pipeline, pull: "collected" as const }, sourceUrl: null } as unknown as RequirementRecord;
  d.repositories!.requirements!.get = async () => manual;
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/66666666-6666-4666-8666-666666666666"), d);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.sourceType, "web_manual");
  assert.equal(body.sourceChannel, "售后");
  assert.equal(body.sourceRequirementId, null);
  // 手工需求不拼接 TB 地址兜底（AC05）
  assert.equal(body.sourceUrl, null);
  assert.equal((body.pipeline as Record<string, string>).pull, "collected");
});

test("empty requirement search returns an empty page without querying mappings with an empty source id", async () => {
 const d = makeDependencies();
 let mappingQueries = 0;
 d.repositories!.people = {
  listActive: async (sourceConfigId: string) => { mappingQueries += 1; assert.notEqual(sourceConfigId, ""); return []; },
 } as never;
 const response = await handleApiRequest(new Request("http://localhost/api/requirements?q=no-such-requirement"), d);
 assert.equal(response.status, 200);
 assert.deepEqual(await response.json(), { items: [], nextCursor: null });
 assert.equal(mappingQueries, 0);
});
test("lists audit events", async () => { const r = await handleApiRequest(new Request("http://localhost/api/audit?entityId=foo&limit=10"), makeDependencies()); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { items: [auditEvent] }); });
test("requirement detail returns the full analysis version history (spec 02 prior versions)", async () => {
  const r = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), makeDependencies());
  assert.equal(r.status, 200);
  const body = await r.json() as { analyses: { analysisVersion: number; status: string; moduleSuggestion: string | null; priority: string | null; confidence: string | null; provider: string }[] };
  assert.equal(body.analyses.length, 1);
  // 存储枚举 high/medium/low 转回展示层中文；provenance 字段随版本暴露（spec 02 L44）
  assert.deepEqual(body.analyses[0], { analysisVersion: 2, status: "analyzed", moduleSuggestion: "报表分析", confidence: "中", priority: "P1", provider: "deepseek", model: "m", promptVersion: "p", moduleDictionaryVersion: 1, priorityRuleVersionId: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z", safeErrorSummary: null });
});

test("retries a requirement stranded in running by a crashed analysis handler", async () => {
  // 回归：handler 先置 analysis=running 再调模型，进程死在这两步之间时状态停在 running，
  // 且作业已终态。此前端点只接受 pending/failed_retryable → 该需求只能手工改库。
  const d = makeDependencies();
  const queued: Record<string, unknown>[] = [];
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id
    ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "running" as const } } as RequirementRecord
    : null;
  d.repositories!.jobs.findByDedupeKey = async (key) => key === `analysis:${requirement.id}:sv1:after2`
    ? { id: "crashed-job", jobType: "analysis", dedupeKey: key, payload: {}, status: "failed", attemptCount: 3, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: null, lastErrorCode: "max_attempts_reached", lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" }
    : null;
  d.repositories!.jobs.enqueue = async (input) => {
    queued.push(input as unknown as Record<string, unknown>);
    return { ...input, id: "analysis-job-2", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
  };
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 202);
  assert.equal(queued.length, 1);
});

test("still rejects a retry while the analysis job is genuinely running", async () => {
  const d = makeDependencies();
  d.repositories!.requirements!.get = async (id: string) => id === requirement.id
    ? { ...requirement, pipeline: { ...requirement.pipeline, analysis: "running" as const } } as RequirementRecord
    : null;
  d.repositories!.jobs.findByDedupeKey = async (key) => key === `analysis:${requirement.id}:sv1:after2`
    ? { id: "live-job", jobType: "analysis", dedupeKey: key, payload: {}, status: "running", attemptCount: 1, maxAttempts: 3, availableAt: "2026-10-08T00:00:00.000Z", lockedUntil: "2026-10-08T00:05:00.000Z", lastErrorCode: null, lastErrorSummary: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" }
    : null;
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), d);
  assert.equal(response.status, 409);
});

test("V02-T04 web manual intake: server-side actor, idempotent replay, payload-bound key", async () => {
  const d = makeDependencies();
  const receipts = new Map<string, { requestHash: string; requirementId: string; actorId: string }>();
  const createdInputs: Array<{ actorId: string; requestHash: string; title: string }> = [];
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  requirements.findIntakeReceipt = async (key: string) => receipts.get(key) ?? null;
  requirements.createManualRequirement = async (input: { idempotencyKey: string; requestHash: string; actorId: string; title: string }) => {
    createdInputs.push(input);
    receipts.set(input.idempotencyKey, { requestHash: input.requestHash, requirementId: requirement.id, actorId: input.actorId });
    return { requirementId: requirement.id, platformRequirementId: "RQ-000001", replay: false };
  };
  const body = JSON.stringify({ title: "售后反馈", description: "用户希望导出报表", sourceChannel: "售后", productModel: "码表 C606", requirementType: "体验优化", constraintNotes: "需兼容旧表带", supplementUrl: "https://example.com/ticket/1" });
  const post = (payload: string, key = "intake-key-123") => new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: payload });
  const first = await handleApiRequest(post(body), d);
  assert.equal(first.status, 201);
  const firstBody = await first.json() as Record<string, unknown>;
  assert.equal(firstBody.requirementId, requirement.id);
  assert.equal(firstBody.platformRequirementId, "RQ-000001");
  assert.equal(firstBody.status, "collected");
  // actor、来源类型、编号都由服务端生成（AC02）
  assert.equal(createdInputs[0]!.actorId, "actor-1");
  // V02-T05：可选上下文原样传递，未知留空
  assert.equal((createdInputs[0] as unknown as { productModel?: string }).productModel, "码表 C606");
  assert.equal((createdInputs[0] as unknown as { requirementType?: string }).requirementType, "体验优化");
  // 同键同内容重放：200 同一需求，不再创建（AC03/AC07）
  const replay = await handleApiRequest(post(body), d);
  assert.equal(replay.status, 200);
  assert.equal(createdInputs.length, 1);
  // 同键不同内容：明确冲突
  const conflict = await handleApiRequest(post(JSON.stringify({ title: "另一个诉求", description: "不同内容", sourceChannel: "售后" })), d);
  assert.equal(conflict.status, 409);
});

test("V02-T04 intake rejects a missing idempotency key, an unknown channel, or an empty description", async () => {
  const d = makeDependencies();
  const requirements = d.repositories!.requirements as unknown as Record<string, unknown>;
  requirements.findIntakeReceipt = async () => null;
  requirements.createManualRequirement = async () => { throw new Error("must not create"); };
  const noKey = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "售后" }) }), d);
  assert.equal(noKey.status, 400);
  const badChannel = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-456" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "未知渠道" }) }), d);
  assert.equal(badChannel.status, 400);
  const noDescription = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-457" }, body: JSON.stringify({ title: "t", sourceChannel: "售后" }) }), d);
  assert.equal(noDescription.status, 400);
  const badUrl = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-458" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "售后", supplementUrl: "not-a-url" }) }), d);
  assert.equal(badUrl.status, 400);
  const badType = await handleApiRequest(new Request("http://localhost/api/requirements", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "intake-key-459" }, body: JSON.stringify({ title: "t", description: "d", sourceChannel: "售后", requirementType: "未知类型" }) }), d);
  assert.equal(badType.status, 400);
});
