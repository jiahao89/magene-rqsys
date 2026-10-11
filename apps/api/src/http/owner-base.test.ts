import assert from "node:assert/strict";
import test from "node:test";
import { handleApiRequest, type ApiDependencies, type ApiRepositories } from "./app.js";
import type { PersonMappingRecord, RequirementRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "../base/client.js";

const requirement: RequirementRecord = { id: "req-1", sourceConfigId: "source-1", teambitionRequirementId: "tb-1", teambitionUniqueId: null, title: "Need", description: null, scope: null, acceptanceCriteria: null, proposerUserId: null, proposerName: null, executorUserId: "tb-user", executorName: "Ada", sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null, attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "h", substantiveHash: "s", sourceVersion: 1, latestBatchId: null, baseRecordId: null, lastPushedAt: null, pipeline: { pull: "synced", analysis: "failed_retryable", owner: "pending_mapping", push: "pending" }, firstSeenAt: "2026-10-08T00:00:00.000Z", lastSeenAt: "2026-10-08T00:00:00.000Z", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };

function deps() {
  const actions: string[] = [];
  let savedMapping: unknown;
  let queued: unknown;
  let audited: unknown;
  const repositories = {
    sources: { list: async () => [], get: async () => null, update: async () => null },
    batches: { create: async () => { throw new Error(); }, get: async () => null, findByIdempotencyKey: async () => null, list: async () => ({ items: [], nextCursor: null }), complete: async () => null },
    items: { upsert: async () => { throw new Error(); }, get: async () => null, listByBatch: async () => [] },
    audit: { append: async (row: unknown) => { audited = row; }, search: async () => [] },
    jobs: { enqueue: async (row: unknown) => { queued = row; return {} as never; }, claimNext: async () => null, complete: async () => null },
    people: { upsertManual: async (p: unknown) => { savedMapping = p; return { id: "map-1", sourceConfigId: "source-1", teambitionUserId: "tb-user", teambitionDisplayName: "Ada", normalizedName: "ada", feishuUserId: "ou-user", feishuIdType: "open_id", matchMethod: "manual", active: true, createdBy: "operator", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" } satisfies PersonMappingRecord; }, resolveActive: async () => ({ id: "map-1", sourceConfigId: "source-1", teambitionUserId: "tb-user", teambitionDisplayName: "Ada", normalizedName: "ada", feishuUserId: "ou-user", feishuIdType: "open_id" as const, matchMethod: "manual" as const, active: true, createdBy: "operator", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" } satisfies PersonMappingRecord) },
    requirements: { get: async () => requirement, setOwner: async (_id: string, owner: string | null, state: RequirementRecord["pipeline"]["owner"]) => { actions.push(`owner:${owner}:${state}`); return { ...requirement, pipeline: { ...requirement.pipeline, owner: state } }; }, setBaseRecord: async () => undefined, setPushState: async (_id: string, state: string) => { actions.push(`push:${state}`); } },
    basePushes: { findByIdempotencyKey: async () => null, append: async (row: unknown) => { actions.push("push-run"); return { id: "run-1", ...(row as object), status: "running", baseRecordId: null, safeErrorCode: null, safeErrorSummary: null, completedAt: null }; }, restart: async () => null, updateResult: async (_id: string, result: { status: string }) => { actions.push(`run:${result.status}`); return null; }, latest: async () => null, latestSuccessful: async () => null },
    sourceSnapshots: { getAtVersion: async () => null },
  } as unknown as ApiRepositories & { people: { upsertManual: (p: unknown) => Promise<PersonMappingRecord> }; requirements: { get: (id: string) => Promise<RequirementRecord | null>; setOwner: (id: string, owner: string | null, state: RequirementRecord["pipeline"]["owner"]) => Promise<RequirementRecord>; setBaseRecord: (id: string, record: string, pushedAt: string) => Promise<void>; setPushState: (id: string, state: string) => Promise<void> }; basePushes: { findByIdempotencyKey: (key: string) => Promise<null>; append: (row: unknown) => Promise<{ id: string }>; restart: (id: string, startedAt: string) => Promise<null>; latestSuccessful: () => Promise<null>; updateResult: (id: string, row: { status: string; baseRecordId?: string; completedAt: string }) => Promise<unknown> } };
  const base = { push: async (input: { owner: unknown }) => { actions.push(`base:${JSON.stringify(input.owner)}`); return { recordId: "base-1", created: false }; } } as unknown as FeishuBasePushAdapter;
  const dependencies = { database: null, repositories, identity: { requireActor: async () => ({ id: "operator" }) }, now: () => new Date("2026-10-09T00:00:00.000Z"), base, baseFields:{projectId:"project",requirementId:"requirement",owner:"owner",source:{},ai:{},pm:[]} } as unknown as ApiDependencies & { base: FeishuBasePushAdapter };
  return { dependencies, actions, savedMapping: () => savedMapping, queued: () => queued, audited: () => audited };
}

test("manual owner mapping persists mapping, marks manually mapped, enqueues push and audits", async () => {
  const h = deps();
  const response = await handleApiRequest(new Request("http://localhost/api/requirements/req-1/owner", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ feishuUserId: "ou-user", feishuIdType: "open_id" }) }), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "queued");
  assert.equal((h.savedMapping() as { createdBy: string }).createdBy, "operator");
  assert.deepEqual(h.queued(), { jobType: "base_push", dedupeKey: "base-push:req-1:sv1:av0:mapping:map-1", payload: { requirementId: "req-1", sourceVersion: 1, analysisVersion: 0, idempotencyKey: "base-push:req-1:sv1:av0:mapping:map-1", actorId: "operator" }, availableAt: "2026-10-09T00:00:00.000Z" });
  assert.equal((h.audited() as { eventType: string }).eventType, "owner.manually_mapped");
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
