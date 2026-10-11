import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementRecord } from "../domain/persistence.js";
import { createSourceMetadataAdvancer, type AdvanceDeps } from "./advance.js";

function requirement(overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  return {
    id: "req-1", sourceConfigId: "source-1", teambitionRequirementId: "tb-1", teambitionUniqueId: null,
    title: "Need", description: null, scope: null, acceptanceCriteria: null,
    proposerUserId: null, proposerName: null, executorUserId: "tb-new", executorName: "New Owner",
    sourceStatusId: "status", sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null,
    attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "hash", substantiveHash: "substantive",
    sourceVersion: 2, latestBatchId: "batch-2", baseRecordId: "base-1", lastPushedAt: null,
    pipeline: { pull: "synced", analysis: "analyzed", owner: "pending_mapping", push: "pending" },
    firstSeenAt: "2026-10-08T00:00:00Z", lastSeenAt: "2026-10-10T00:00:00Z",
    createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", ...overrides,
  };
}

function harness(row: RequirementRecord, mapping: Awaited<ReturnType<Parameters<typeof createSourceMetadataAdvancer>[0]["people"]["resolveActive"]>>) {
  const calls: string[] = [];
  const advance = createSourceMetadataAdvancer({
    requirements: {
      async get() { return row; },
      async setOwner(_id: string, feishuUserId: string | null, state: Parameters<AdvanceDeps["requirements"]["setOwner"]>[2]) { calls.push(`owner:${feishuUserId}:${state}`); return { ...row, pipeline: { ...row.pipeline, owner: state } }; },
    } as never,
    people: { async resolveActive() { return mapping; } } as never,
    jobs: { async enqueue(job: Parameters<AdvanceDeps["jobs"]["enqueue"]>[0]) { calls.push(`job:${job.jobType}:${job.dedupeKey}`); return {} as never; } } as never,
    audit: { async append(event: Parameters<AdvanceDeps["audit"]["append"]>[0]) { calls.push(`audit:${event.eventType}:${event.result}`); } } as never,
  }, { now: () => new Date("2026-10-10T00:00:00Z") });
  return { advance, calls };
}

test("metadata-only source changes reuse a known owner mapping and queue Base update without AI", async () => {
  const mapping = { id: "map-1", sourceConfigId: "source-1", teambitionUserId: "tb-new", teambitionDisplayName: "New Owner", normalizedName: "new owner", feishuUserId: "ou-new", feishuIdType: "open_id" as const, matchMethod: "manual" as const, active: true, createdBy: "operator", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  const h = harness(requirement(), mapping);
  const result = await h.advance("req-1", "operator", 2);
  assert.equal(result, "queued");
  assert.ok(h.calls.includes("owner:ou-new:manually_mapped"));
  assert.ok(h.calls.some((call) => call.startsWith("job:base_push:base-push:req-1:sv2:av2")));
  assert.equal(h.calls.some((call) => call.startsWith("job:analysis:")), false);
});

test("metadata-only owner removal resolves to no owner and queues an empty-owner Base update", async () => {
  const h = harness(requirement({ executorUserId: null, executorName: null }), null);
  const result = await h.advance("req-1", "operator", 1);
  assert.equal(result, "queued");
  assert.ok(h.calls.includes("owner:null:not_required"));
  assert.ok(h.calls.some((call) => call.startsWith("job:base_push:")));
});

test("metadata-only update with an unmapped new owner waits for manual mapping", async () => {
  const h = harness(requirement(), null);
  const result = await h.advance("req-1", "operator", 2);
  assert.equal(result, "waiting_mapping");
  assert.equal(h.calls.some((call) => call.startsWith("job:base_push:")), false);
});

test("metadata-only source update preserves an existing manual owner selection", async () => {
  const mapping = { id: "map-2", sourceConfigId: "source-1", teambitionUserId: "tb-new", teambitionDisplayName: "New Owner", normalizedName: "new owner", feishuUserId: "ou-manual", feishuIdType: "open_id" as const, matchMethod: "tb_user_id" as const, active: true, createdBy: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  const h = harness(requirement({ pipeline: { pull: "synced", analysis: "analyzed", owner: "manually_mapped", push: "pending" } }), mapping);
  const result = await h.advance("req-1", "operator", 2);
  assert.equal(result, "queued");
  assert.equal(h.calls.some((call) => call.startsWith("owner:")), false);
  assert.ok(h.calls.some((call) => call.startsWith("job:base_push:")));
});
