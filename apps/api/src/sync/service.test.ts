import test from "node:test";
import assert from "node:assert/strict";
import { shouldProcessSyncDownstream, SyncOrchestrator, type SyncPersistence, type SyncSourceReader } from "./service.js";
import type { AnalysisState, SourceProjectConfig } from "../domain/workflow.js";


const config: SourceProjectConfig = { id: "cfg", projectId: "project", projectName: "Project", requirementTypeId: "type", enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null }, ownerNames: [], fieldMap: { description: "allowed" } };
test("source-only mode suppresses every downstream stage while omitted mode keeps the full pipeline", () => {
  assert.equal(shouldProcessSyncDownstream("source_only"), false);
  assert.equal(shouldProcessSyncDownstream("full_pipeline"), true);
  assert.equal(shouldProcessSyncDownstream(undefined), true);
});
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

test("drops later TB records that share a normalized title, keeping the earliest one", async () => {
  // TB 里存在 ID 不同、标题相同的重复需求；需求池只保留最早的一条，避免同一诉求重复流转。
  const h = harness([
    task("later", "【Beta】 同一个诉求", { created: "2026-02-01T00:00:00.000Z" }),
    task("earlier", "【beta】  同一个诉求", { created: "2026-01-01T00:00:00.000Z" }),
    task("other", "另一个诉求", { created: "2026-01-05T00:00:00.000Z" }),
  ]);
  const result = await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  assert.equal(result.status, "succeeded");
  assert.equal(result.totalCount, 2);
  assert.equal(result.succeededCount, 2);
  assert.ok(h.calls.includes("upsert:earlier"));
  assert.equal(h.calls.includes("upsert:later"), false);
  assert.equal(h.calls.some((call) => call.startsWith("item:later")), false);
  assert.ok(h.calls.includes("complete:succeeded:2:2:0"));
});

test("keeps blank titles and breaks created ties by requirement id", async () => {
  const h = harness([
    task("b", "", { created: "2026-01-01T00:00:00.000Z" }),
    task("a", "  ", { created: "2026-01-01T00:00:00.000Z" }),
    task("z", "重复标题", { created: "2026-01-01T00:00:00.000Z" }),
    task("y", "重复标题", { created: "2026-01-01T00:00:00.000Z" }),
  ]);
  const result = await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  // 空标题不去重，两条都导入；重复标题按 created 相同、ID 升序保留 y（共 3 条）。
  assert.equal(result.totalCount, 3);
  assert.ok(h.calls.includes("upsert:a"));
  assert.ok(h.calls.includes("upsert:b"));
  assert.ok(h.calls.includes("upsert:y"));
  assert.equal(h.calls.includes("upsert:z"), false);
});

test("does not expose unmapped provider custom fields in normalized payload", async () => {
  const h = harness([task("one", "One")]);
  capturedPayloads.length = 0;
  await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  const payload = capturedPayloads[0];
  assert.deepEqual(payload?.custom_fields, [{ id: "allowed", type: null, value: "yes", values: null }]);
  assert.equal(payload?.private_provider_field, undefined);
});

test("source-only metadata updates remain recoverable by a later full sync", async () => {
  const writes: boolean[] = [];
  let current = task("one", "Stable requirement", { executor_id: "owner-a", taskflow_status_id: "open" });
  let previous: { id: string; sourceVersion: number; sourceHash: string; substantiveHash: string; analysisState: AnalysisState } | null = null;
  const source: SyncSourceReader = { async listRequirements() { return { items: [current], hasMore: false, nextCursor: null }; } };
  const persistence: SyncPersistence = {
    async findRequirement() { return previous; },
    async upsertRequirement(input) {
      writes.push(input.analysisRequired);
      previous = { id: "db-one", sourceVersion: input.sourceVersion, sourceHash: input.sourceHash, substantiveHash: input.substantiveHash, analysisState: input.analysisRequired ? "pending" : "analyzed" };
      return { id: "db-one", created: input.sourceVersion === 1 };
    },
    async appendSourceSnapshot() {},
    async writeSyncItem() {},
    async completeBatch() {},
  };
  const orchestrator = new SyncOrchestrator(source, persistence);
  await orchestrator.run({ batchId: "first", sourceConfigId: config.id, config });
  previous!.analysisState = "analyzed";
  current = task("one", "Stable requirement", { executor_id: "owner-b", taskflow_status_id: "done" });
  await orchestrator.run({ batchId: "metadata", sourceConfigId: config.id, config, mode: "source_only" });
  await orchestrator.run({ batchId: "metadata-recovery", sourceConfigId: config.id, config });
  current = task("one", "Changed requirement", { executor_id: "owner-b", taskflow_status_id: "done" });
  await orchestrator.run({ batchId: "content", sourceConfigId: config.id, config });
  // 若先前的 AI 任務未完成，之后的完整同步会再次把该需求放入下游队列。
  await orchestrator.run({ batchId: "pending-retry", sourceConfigId: config.id, config });
  assert.deepEqual(writes, [true, false, false, true, true]);
});

test("classifies a source snapshot write failure without exposing its database error", async () => {
  const h = harness([task("one", "One")]);
  const itemWrites: Array<{ status: string; errorCode: string | null; errorDetail: string | null }> = [];
  h.persistence.appendSourceSnapshot = async () => { throw new Error("private database detail"); };
  h.persistence.writeSyncItem = async (item) => { itemWrites.push({ status: item.status, errorCode: item.errorCode, errorDetail: item.errorDetail }); };
  const result = await h.orchestrator.run({ batchId: "batch-1", sourceConfigId: config.id, config });
  assert.equal(result.status, "failed");
  assert.deepEqual(itemWrites, [{ status: "failed", errorCode: "source_snapshot_failed", errorDetail: "Requirement updated, but its source snapshot could not be saved" }]);
  assert.equal(JSON.stringify(itemWrites).includes("private database detail"), false);
});
