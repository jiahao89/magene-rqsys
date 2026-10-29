import assert from "node:assert/strict";
import test from "node:test";
import { handleApiRequest, type ApiDependencies, type ApiRepositories } from "./app.js";
import type { PersonMappingRecord, RequirementRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "../base/client.js";

const requirement: RequirementRecord = { id: "req-1", platformRequirementId: "RQ-000001", sourceType: "teambition", sourceChannel: null, productModel: null, requirementType: null, constraintNotes: null, supplementUrl: null, intakeModule: null, audienceTags: [], audienceConfirmed: false, audienceVersion: 0, sourceConfigId: "source-1", teambitionRequirementId: "tb-1", teambitionUniqueId: null, title: "Need", description: null, scope: null, acceptanceCriteria: null, proposerUserId: null, proposerName: null, executorUserId: "tb-user", executorName: "Ada", sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null, attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "h", substantiveHash: "s", sourceVersion: 1, latestBatchId: null, baseRecordId: null, lastPushedAt: null, pipeline: { pull: "synced", analysis: "failed_retryable", owner: "pending_mapping", push: "pending" }, firstSeenAt: "2026-10-08T00:00:00.000Z", lastSeenAt: "2026-10-08T00:00:00.000Z", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };

function deps() {
  const actions: string[] = [];
  let savedMapping: unknown;
  let assigned: unknown;
  let queued: unknown;
  let audited: unknown;
  const repositories = {
    sources: { list: async () => [], get: async () => null, update: async () => null },
    batches: { create: async () => { throw new Error(); }, get: async () => null, findByIdempotencyKey: async () => null, list: async () => ({ items: [], nextCursor: null }), complete: async () => null },
    items: { upsert: async () => { throw new Error(); }, get: async () => null, listByBatch: async () => [] },
    audit: { append: async (row: unknown) => { audited = row; }, search: async () => [] },
    jobs: { enqueue: async (row: unknown) => { queued = row; return {} as never; }, claimNext: async () => null, complete: async () => null },
    people: { upsertManual: async (p: unknown) => { savedMapping = p; return { id: "map-1", sourceConfigId: "source-1", teambitionUserId: "tb-user", teambitionDisplayName: "Ada", normalizedName: "ada", feishuUserId: "ou-user", feishuIdType: "open_id", matchMethod: "manual", active: true, createdBy: "operator", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" } satisfies PersonMappingRecord; }, resolveActive: async () => ({ id: "map-1", sourceConfigId: "source-1", teambitionUserId: "tb-user", teambitionDisplayName: "Ada", normalizedName: "ada", feishuUserId: "ou-user", feishuIdType: "open_id" as const, matchMethod: "manual" as const, active: true, createdBy: "operator", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" } satisfies PersonMappingRecord) },
    requirements: { get: async () => requirement, listDuplicates: async () => [], assignManualOwner: async (id: string, owner: unknown) => { assigned = { id, owner }; }, setOwner: async (_id: string, owner: string | null, state: RequirementRecord["pipeline"]["owner"]) => { actions.push(`owner:${owner}:${state}`); return { ...requirement, pipeline: { ...requirement.pipeline, owner: state } }; }, setBaseRecord: async () => undefined, setPushState: async (_id: string, state: string) => { actions.push(`push:${state}`); } },
    basePushes: { findByIdempotencyKey: async () => null, append: async (row: unknown) => { actions.push("push-run"); return { id: "run-1", ...(row as object), status: "running", baseRecordId: null, safeErrorCode: null, safeErrorSummary: null, completedAt: null }; }, restart: async () => null, updateResult: async (_id: string, result: { status: string }) => { actions.push(`run:${result.status}`); return null; }, latest: async () => null, latestSuccessful: async () => null },
    sourceSnapshots: { getAtVersion: async () => null },
  } as unknown as ApiRepositories & { people: { upsertManual: (p: unknown) => Promise<PersonMappingRecord> }; requirements: { get: (id: string) => Promise<RequirementRecord | null>; setOwner: (id: string, owner: string | null, state: RequirementRecord["pipeline"]["owner"]) => Promise<RequirementRecord>; setBaseRecord: (id: string, record: string, pushedAt: string) => Promise<void>; setPushState: (id: string, state: string) => Promise<void> }; basePushes: { findByIdempotencyKey: (key: string) => Promise<null>; append: (row: unknown) => Promise<{ id: string }>; restart: (id: string, startedAt: string) => Promise<null>; latestSuccessful: () => Promise<null>; updateResult: (id: string, row: { status: string; baseRecordId?: string; completedAt: string }) => Promise<unknown> } };
  const base = { push: async (input: { owner: unknown }) => { actions.push(`base:${JSON.stringify(input.owner)}`); return { recordId: "base-1", created: false }; } } as unknown as FeishuBasePushAdapter;
  const dependencies = { database: null, repositories, identity: { requireActor: async () => ({ id: "operator" }) }, now: () => new Date("2026-10-09T00:00:00.000Z"), base, baseFields:{projectId:"project",requirementId:"requirement",owner:"owner",source:{},ai:{},pm:[]} } as unknown as ApiDependencies & { base: FeishuBasePushAdapter };
  return { dependencies, actions, savedMapping: () => savedMapping, assigned: () => assigned, queued: () => queued, audited: () => audited };
}

test("per-requirement owner assignment stores it on the requirement, queues a push and audits", async () => {
  const h = deps();
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ feishuUserId: "ou-user", feishuIdType: "open_id" }) }), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "queued");
  const assigned = h.assigned() as { id: string; owner: { feishuUserId: string; feishuIdType: string; assignedBy: string } };
  assert.equal(assigned.id, "req-1");
  assert.equal(assigned.owner.feishuUserId, "ou-user");
  assert.equal(assigned.owner.assignedBy, "operator");
  assert.equal((h.queued() as { jobType: string }).jobType, "base_push");
  assert.equal((h.audited() as { eventType: string }).eventType, "owner.manually_mapped");
});

test("assigning an owner to a requirement with a TB executor never rewrites the global mapping", async () => {
  const h = deps();
  let mappingWrites = 0;
  (h.dependencies.repositories!.people as unknown as { upsertManual: () => Promise<never> }).upsertManual = async () => { mappingWrites += 1; throw new Error("single-requirement assignment must not write person_mappings"); };
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ feishuUserId: "ou-user", feishuIdType: "open_id" }) }), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal(mappingWrites, 0);
});

test("clearing a per-requirement owner restores the TB default mapping and queues a push", async () => {
  const h = deps();
  let cleared = false;
  let ownerState: string | null = null;
  const repositories = h.dependencies.repositories as unknown as {
    requirements: Record<string, unknown>;
  };
  const base = await (repositories.requirements.get as () => Promise<RequirementRecord | null>)();
  repositories.requirements.get = async () => ({ ...base!, manualOwner: { feishuUserId: "u-assignee", feishuIdType: "user_id", name: "毕梓浩", assignedBy: "operator", assignedAt: "2026-10-09T00:00:00.000Z", pushedFeishuUserId: null, assignmentVersion: 1 } });
  repositories.requirements.clearManualOwner = async () => { cleared = true; };
  repositories.requirements.setOwner = async (_id: string, _owner: string | null, state: string) => { ownerState = state; };
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "DELETE" }), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal(cleared, true);
  assert.equal(ownerState, "auto_mapped");
  assert.deepEqual(await response.json(), { requirementId: "req-1", ownerState: "auto_mapped", status: "queued" });
  assert.equal((h.queued() as { jobType: string }).jobType, "base_push");
});

test("a same-title hint does not block owner assignment", async () => {
  const h = deps();
  const repositories = h.dependencies.repositories as unknown as { requirements: Record<string, unknown> };
  const base = await (repositories.requirements.get as () => Promise<RequirementRecord | null>)();
  repositories.requirements.get = async () => ({ ...base!, duplicateOfRequirementId: "req-canonical" });
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ feishuUserId: "ou-user", feishuIdType: "open_id" }) }), h.dependencies);
  assert.equal(response.status, 200);
});

test("manual mapping does not bypass pull state or push when requirement is missing", async () => {
  const h = deps();
  const bad = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" }), h.dependencies);
  assert.equal(bad.status, 400);
});

test("push API queues the asynchronous Base push and deduplicates by requirement versions", async () => {
  const h = deps();
  h.dependencies.repositories!.requirements!.get = async () => ({ ...requirement, pipeline: { ...requirement.pipeline, owner: "manually_mapped" } });
  const request = () => new Request("http://localhost/api/requirements/req-1/push", { method: "POST", headers: { "Idempotency-Key": "req-1:v1" } });
  const first = await handleApiRequest(request(), h.dependencies);
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), { requirementId: "req-1", status: "queued" });
  assert.deepEqual(h.queued(), { jobType: "base_push", dedupeKey: "base-push:req-1:sv1:av0:retry:req-1:v1", payload: { requirementId: "req-1", sourceVersion: 1, analysisVersion: 0, idempotencyKey: "base-push:req-1:sv1:av0:retry:req-1:v1", actorId: "operator" }, availableAt: "2026-10-09T00:00:00.000Z" });
  assert.equal(h.actions.some((action) => action.startsWith("base:")), false, "the HTTP route must not call Feishu synchronously");
  const replay = await handleApiRequest(request(), h.dependencies);
  assert.equal(replay.status, 202);
  assert.deepEqual(await replay.json(), { requirementId: "req-1", status: "queued" });
});

// 无 TB 负责人的需求：负责人只属于这一条需求，不能写成人员映射（否则会改写名单里这个人的绑定）。
function unownedDeps(ownerState: RequirementRecord["pipeline"]["owner"] = "not_required") {
  const h = deps();
  const row: RequirementRecord = { ...requirement, executorUserId: null, executorName: null, pipeline: { ...requirement.pipeline, owner: ownerState } };
  let assigned: unknown = null;
  let mappingWrites = 0;
  const repositories = h.dependencies.repositories as unknown as {
    requirements: Record<string, unknown>;
    people: { upsertManual: (p: unknown) => Promise<PersonMappingRecord> };
  };
  repositories.requirements.get = async () => row;
  repositories.requirements.assignManualOwner = async (id: string, owner: unknown) => { assigned = { id, owner }; };
  repositories.people.upsertManual = async () => { mappingWrites += 1; throw new Error("no-owner assignment must not write person mappings"); };
  return { ...h, assigned: () => assigned, mappingWrites: () => mappingWrites };
}
const ownerPut = (body: unknown) => new Request("http://localhost/api/requirements/req-1/owner", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("assigning an owner to a requirement without a TB owner stores it on the requirement and queues a push", async () => {
  const h = unownedDeps();
  const response = await handleApiRequest(ownerPut({ feishuUserId: "u-assignee", feishuIdType: "user_id", tbDisplayName: "毕梓浩" }), h.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { requirementId: "req-1", ownerState: "manually_mapped", status: "queued" });
  assert.deepEqual(h.assigned(), { id: "req-1", owner: { feishuUserId: "u-assignee", feishuIdType: "user_id", name: "毕梓浩", assignedBy: "operator", assignedAt: "2026-10-09T00:00:00.000Z" } });
  assert.equal(h.mappingWrites(), 0);
  const queued = h.queued() as { jobType: string; dedupeKey: string; payload: { idempotencyKey: string } };
  assert.equal(queued.jobType, "base_push");
  // 每次指定都是独立意图：改派回同一个人也必须重新入队，因此键里带唯一的指定 ID。
  assert.match(queued.dedupeKey, /^base-push:req-1:sv1:av0:owner:av\d+:[^:]+:(open_id|user_id|union_id)$/);
  assert.equal(queued.payload.idempotencyKey, queued.dedupeKey);
  assert.equal((h.audited() as { eventType: string }).eventType, "owner.manually_mapped");
});

test("a legacy no-owner requirement still waiting for mapping accepts a per-requirement owner", async () => {
  const h = unownedDeps("pending_mapping");
  const response = await handleApiRequest(ownerPut({ feishuUserId: "u-assignee", feishuIdType: "user_id", tbDisplayName: "毕梓浩" }), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal(h.mappingWrites(), 0);
});

test("a per-requirement owner assignment that cannot be stored reports a dependency failure and queues nothing", async () => {
  const h = unownedDeps();
  (h.dependencies.repositories as unknown as { requirements: Record<string, unknown> }).requirements.assignManualOwner = async () => { throw new Error("database down"); };
  const response = await handleApiRequest(ownerPut({ feishuUserId: "u-assignee", feishuIdType: "user_id", tbDisplayName: "毕梓浩" }), h.dependencies);
  assert.equal(response.status, 503);
  assert.equal(h.queued(), undefined);
});

test("the requirement detail shows the per-requirement owner picked for a no-TB-owner requirement", async () => {
  const h = unownedDeps("manually_mapped");
  const repositories = h.dependencies.repositories as unknown as { requirements: Record<string, unknown> };
  const base = await (repositories.requirements.get as () => Promise<RequirementRecord>)();
  repositories.requirements.get = async () => ({ ...base, manualOwner: { feishuUserId: "u-assignee", feishuIdType: "user_id", name: "毕梓浩", assignedBy: "operator", assignedAt: "2026-10-09T00:00:00.000Z", pushedFeishuUserId: null, assignmentVersion: 1 } });
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1"), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { ownerName: string | null }).ownerName, "毕梓浩");
});

test("clearing a manual owner on a manually-mapped requirement bridges to auto_mapped through pending_mapping", async () => {
  // manually_mapped 没有 → auto_mapped 的直接迁移：先退 pending_mapping 再落目标，
  // 否则真实仓储会抛 InvalidTransitionError，需求被永久卡在 manually_mapped（重试 409）。
  const h = deps();
  const calls: string[] = [];
  const repositories = h.dependencies.repositories as unknown as { requirements: Record<string, unknown> };
  const base = await (repositories.requirements.get as () => Promise<RequirementRecord | null>)();
  repositories.requirements.get = async () => ({ ...base!, pipeline: { ...base!.pipeline, owner: "manually_mapped" }, manualOwner: { feishuUserId: "u-assignee", feishuIdType: "user_id", name: "毕梓浩", assignedBy: "operator", assignedAt: "2026-10-09T00:00:00.000Z", pushedFeishuUserId: null, assignmentVersion: 1 } });
  repositories.requirements.clearManualOwner = async () => { calls.push("cleared"); };
  repositories.requirements.setOwner = async (_id: string, owner: string | null, state: string) => { calls.push(`owner:${owner ?? "none"}:${state}`); };
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "DELETE" }), h.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["cleared", "owner:none:pending_mapping", "owner:ou-user:auto_mapped"]);
  assert.deepEqual(await response.json(), { requirementId: "req-1", ownerState: "auto_mapped", status: "queued" });
});

test("clearing a manual owner on a requirement without TB executor transitions through pending_mapping", async () => {
  const h = deps();
  const calls: string[] = [];
  const repositories = h.dependencies.repositories as unknown as { requirements: Record<string, unknown> };
  const base = await (repositories.requirements.get as () => Promise<RequirementRecord | null>)();
  repositories.requirements.get = async () => ({ ...base!, executorUserId: null, executorName: null, pipeline: { ...base!.pipeline, owner: "manually_mapped" }, manualOwner: { feishuUserId: "u-assignee", feishuIdType: "user_id", name: "毕梓浩", assignedBy: "operator", assignedAt: "2026-10-09T00:00:00.000Z", pushedFeishuUserId: null, assignmentVersion: 1 } });
  repositories.requirements.clearManualOwner = async () => { calls.push("cleared"); };
  repositories.requirements.setOwner = async (_id: string, _owner: string | null, state: string) => { calls.push(`owner:${state}`); };
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "DELETE" }), h.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["cleared", "owner:pending_mapping", "owner:not_required"]);
  assert.deepEqual(await response.json(), { requirementId: "req-1", ownerState: "not_required", status: "queued" });
});
