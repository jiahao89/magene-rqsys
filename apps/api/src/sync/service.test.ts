import test from "node:test";
import assert from "node:assert/strict";
import { SyncOrchestrator, type SyncPersistence, type SyncSourceReader } from "./service.js";
import type { SourceProjectConfig } from "../domain/workflow.js";


const config: SourceProjectConfig = { id: "cfg", projectId: "project", projectName: "Project", requirementTypeId: "type", enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null }, ownerNames: [], fieldMap: { description: "allowed" } };
const task = (id: string, content: string, extra: Record<string, unknown> = {}) => ({ id, content, created: "2026-01-01", custom_fields: [{ _customfieldid: "allowed", value: "yes" }, { _customfieldid: "private", value: "secret" }], private_provider_field: "secret", ...extra });
const capturedPayloads: Record<string, unknown>[] = [];

function harness(tasks: ReturnType<typeof task>[], failId?: string, pages?: Array<{ items: ReturnType<typeof task>[]; hasMore: boolean; nextCursor: string | null }>) {
  const calls: string[] = [];
  const source: SyncSourceReader = { async listRequirements(_config, cursor) { calls.push(`list:${cursor ?? "first"}`); return pages?.[cursor === "next" ? 1 : 0] ?? { items: tasks, hasMore: false, nextCursor: null }; } };
  const persistence: SyncPersistence = {
    async findRequirement(_source, id) { calls.push(`find:${id}`); return null; },
    async upsertRequirement(req) { calls.push(`upsert:${req.sourceRequirementId}`); capturedPayloads.push(req.sourcePayload); if (req.sourceRequirementId === failId) throw new Error("raw provider secret"); return { id: `db-${req.sourceRequirementId}`, created: true }; },
    async appendSourceSnapshot(input) { calls.push(`snapshot:${input.requirementId}`); },
    async writeSyncItem(input) { calls.push(`item:${input.teambitionRequirementId}:${input.status}`); },
    async completeBatch(_batch, input) { calls.push(`complete:${input.status}:${input.totalCount}:${input.succeededCount}:${input.failedCount}`); },
  };
  return { calls, source, persistence, orchestrator: new SyncOrchestrator(source, persistence, { now: () => new Date("2026-10-08T00:00:00.000Z"), id: () => "batch-1" }) };
}

test("imports every returned task, filters provider fields, and persists snapshots and results", async () => {
  const h = harness([task("one", " One "), task("two", "Two")]);
  const result = await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  assert.equal(result.status, "succeeded");
  assert.equal(result.totalCount, 2);
  assert.equal(result.succeededCount, 2);
  assert.ok(h.calls.includes("upsert:one"));
  assert.ok(h.calls.includes("snapshot:db-two"));
  assert.ok(h.calls.includes("item:one:succeeded"));
  assert.ok(h.calls.includes("complete:succeeded:2:2:0"));
  assert.ok(h.calls.indexOf("upsert:one") < h.calls.indexOf("snapshot:db-one"));
  const input = h.calls;
  assert.equal(input.filter((call) => call.startsWith("upsert:")).length, 2);

});

test("keeps successful items committed and safely completes a partial-failure batch", async () => {
  const h = harness([task("good", "Good"), task("bad", "Bad")], "bad");
  const result = await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  assert.equal(result.status, "partial_failure");
  assert.equal(result.succeededCount, 1);
  assert.equal(result.failedCount, 1);
  assert.ok(h.calls.includes("item:good:succeeded"));
  assert.ok(h.calls.includes("item:bad:failed"));
  assert.ok(h.calls.includes("complete:partial_failure:2:1:1"));
});

test("marks a source-list failure as a failed batch", async () => {
  const h = harness([]);
  h.source.listRequirements = async () => { throw new Error("credential leaked"); };
  const result = await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  assert.equal(result.status, "failed");
  assert.equal(result.failedCount, 0);
  assert.ok(h.calls.includes("complete:failed:0:0:0"));
});

test("fetches all pages including archived tasks and deduplicates repeated IDs", async () => {
  const pages = [
    { items: [task("one", "One")], hasMore: true, nextCursor: "next" },
    { items: [task("one", "duplicate"), task("archived", "Archived")], hasMore: false, nextCursor: null },
  ];
  const h = harness([], undefined, pages);
  const result = await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  assert.equal(result.totalCount, 2);
  assert.ok(h.calls.includes("upsert:archived"));
  assert.equal(h.calls.filter((call) => call.startsWith("upsert:one")).length, 1);
});

test("does not expose unmapped provider custom fields in normalized payload", async () => {
  const h = harness([task("one", "One")]);
  capturedPayloads.length = 0;
  await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  const payload = capturedPayloads[0];
  assert.deepEqual(payload?.custom_fields, [{ id: "allowed", type: null, value: "yes", values: null }]);
  assert.equal(payload?.private_provider_field, undefined);
});

test("marks new and substantive changes for AI, while metadata-only updates remain push-only", async () => {
  const writes: boolean[] = [];
  let current = task("one", "Stable requirement", { executor_id: "owner-a", taskflow_status_id: "open" });
  let previous: { id: string; sourceVersion: number; sourceHash: string; substantiveHash: string } | null = null;
  const source: SyncSourceReader = { async listRequirements() { return { items: [current], hasMore: false, nextCursor: null }; } };
  const persistence: SyncPersistence = {
    async findRequirement() { return previous; },
    async upsertRequirement(input) {
      writes.push(input.analysisRequired);
      previous = { id: "db-one", sourceVersion: input.sourceVersion, sourceHash: input.sourceHash, substantiveHash: input.substantiveHash };
      return { id: "db-one", created: input.sourceVersion === 1 };
    },
    async appendSourceSnapshot() {},
    async writeSyncItem() {},
    async completeBatch() {},
  };
  const orchestrator = new SyncOrchestrator(source, persistence);
  await orchestrator.run({ batchId: "first", sourceConfigId: config.id, config });
  current = task("one", "Stable requirement", { executor_id: "owner-b", taskflow_status_id: "done" });
  await orchestrator.run({ batchId: "metadata", sourceConfigId: config.id, config });
  current = task("one", "Changed requirement", { executor_id: "owner-b", taskflow_status_id: "done" });
  await orchestrator.run({ batchId: "content", sourceConfigId: config.id, config });
  assert.deepEqual(writes, [true, false, true]);
});
