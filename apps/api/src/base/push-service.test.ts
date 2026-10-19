import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisRunRecord, BasePushRunRecord, RequirementRecord, SourceSnapshotRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "./client.js";
import { FeishuApiError } from "./transport.js";
import { createBasePushService } from "./push-service.js";

const requirement = (overrides: Partial<RequirementRecord> = {}): RequirementRecord => ({
  id: "req-1", sourceConfigId: "source-1", teambitionRequirementId: "tb-1", teambitionUniqueId: null,
  title: "Need", description: "Description", scope: null, acceptanceCriteria: null,
  proposerUserId: null, proposerName: null, executorUserId: null, executorName: null,
  sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null,
  attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "hash-v2", substantiveHash: "substantive-v2",
  sourceVersion: 2, latestBatchId: "batch-1", baseRecordId: "record-1", lastPushedAt: null,
  pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "failed" },
  firstSeenAt: "2026-10-08T00:00:00.000Z", lastSeenAt: "2026-10-09T00:00:00.000Z",
  createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", ...overrides,
});

const pushRun = (overrides: Partial<BasePushRunRecord> = {}): BasePushRunRecord => ({
  id: "push-1", requirementId: "req-1", sourceVersion: 1, pushVersion: 1, status: "pushed",
  idempotencyKey: "push:req-1:v1", baseRecordId: "record-1", safeErrorCode: null,
  safeErrorSummary: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z", ...overrides,
});

function makeHarness(options: { bookkeepingError?: boolean; req?: RequirementRecord; previous?: BasePushRunRecord | null; lastSuccessful?: BasePushRunRecord | null; sourceSnapshot?: SourceSnapshotRecord | null; omittedFields?: { field: string; value: string; reason: "not_in_base_select_options" | "category_omitted_by_policy" }[]; pushError?: Error } = {}) {
  const auditEvents: { eventType: string; result: string; safeDetails: Record<string, unknown> }[] = [];
  const req = options.req ?? requirement();
  const calls: string[] = [];
  let existing = options.previous ?? null;
  let baseInput: { projectId: string; substantiveChanged: boolean } | null = null;
  let savedBaseRecord: string | null = null;
  let savedFailure: { code: string | null; summary: string | null } | null = null;
  const currentRun = pushRun({ id: "push-current", status: "running", sourceVersion: req.sourceVersion, idempotencyKey: "push:req-1:v2", baseRecordId: null });
  const service = createBasePushService({
    requirements: {
      get: async () => req,
      setOwner: async () => { calls.push("owner"); },
      setPushState: async (_id: string, state: RequirementRecord["pipeline"]["push"]) => { calls.push(`state:${state}`); req.pipeline.push = state; },
      setBaseRecord: async (_id: string, recordId: string) => {
        if (options.bookkeepingError) throw new Error("bookkeeping down");
        savedBaseRecord = recordId; calls.push("base-record");
      },
    } as never,
    people: { resolveActive: async () => null } as never,
    analyses: { latest: async () => ({ status: "analyzed", analysisVersion: 1, moduleSuggestion: null, priority: null } as AnalysisRunRecord) } as never,
    basePushes: {
      findByIdempotencyKey: async () => existing,
      append: async () => { calls.push("append"); existing = currentRun; return currentRun; },
      latest: async () => existing,
      latestSuccessful: async () => options.lastSuccessful ?? null,
      updateResult: async (id: string, result: { status: "pushed" | "failed"; baseRecordId?: string; safeErrorCode?: string; safeErrorSummary?: string; completedAt: string }) => { calls.push(`run:${result.status}`); if (result.status === "failed") savedFailure = { code: result.safeErrorCode ?? null, summary: result.safeErrorSummary ?? null }; existing = { ...(existing ?? currentRun), id, status: result.status, baseRecordId: result.baseRecordId ?? null, completedAt: result.completedAt }; return existing; },
      restart: async (id: string, startedAt: string) => { calls.push("restart"); const restarted = { ...(existing ?? currentRun), id, status: "running" as const, startedAt, completedAt: null, safeErrorCode: null, safeErrorSummary: null }; existing = restarted; return restarted; },
    } as never,
    sourceSnapshots: { getAtVersion: async () => options.sourceSnapshot ?? null } as never,
    audit: { append: async (event: { eventType: string; result: string; safeDetails: Record<string, unknown> }) => { calls.push("audit"); auditEvents.push(event); } } as never,
    base: { push: async (input: { projectId: string; substantiveChanged: boolean }) => { calls.push("base"); baseInput = input; if (options.pushError) throw options.pushError; return { recordId: "record-2", created: false, omittedFields: options.omittedFields ?? [] }; } } as unknown as FeishuBasePushAdapter,
    sourceProjectId: "verified-source-project",
    baseFields: { projectId: "project", requirementId: "requirement", owner: "owner", source: {}, ai: {}, pm: ["PM状态"] },
    actorId: "operator-1", now: () => new Date("2026-10-10T00:00:00.000Z"),
  });
  return { service, calls, auditEvents, get baseInput() { return baseInput; }, get savedBaseRecord() { return savedBaseRecord; }, get savedFailure() { return savedFailure; } };
}

test("retrying the same failed Base push executes the upsert instead of reporting the failure as success", async () => {
  const h = makeHarness({ previous: pushRun({ status: "failed", safeErrorCode: "BASE_PUSH_FAILED", completedAt: "2026-10-08T00:00:01.000Z" }) });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.ok(h.calls.includes("base"));
  assert.ok(h.calls.includes("restart"));
});

test("substantive source updates snapshot against the last successful push and persist the Base record ID", async () => {
  const req = requirement({ pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pending" } });
  const h = makeHarness({
    req,
    lastSuccessful: pushRun({ sourceVersion: 1, pushVersion: 1 }),
    sourceSnapshot: { id: "snapshot-1", requirementId: req.id, sourceVersion: 1, sourceHash: "hash-v1", substantiveHash: "substantive-v1", payload: {}, isSubstantiveChange: false, capturedAt: "2026-10-08T00:00:00.000Z" },
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.substantiveChanged, true);
  assert.equal(h.savedBaseRecord, "record-2");
});

test("uses the configured Teambition source project ID as the Base project key", async () => {
  const h = makeHarness();
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.projectId, "verified-source-project");
});

test("records a rejected select value in the push audit instead of hiding it", async () => {
  const h = makeHarness({
    omittedFields: [{ field: "AI优先级建议", value: "P3", reason: "not_in_base_select_options" }],
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.deepEqual(result.kind === "pushed" ? result.omittedFields : null, [
    { field: "AI优先级建议", value: "P3", reason: "not_in_base_select_options" },
  ]);
  // 推送仍然成功，但审计必须解释「成功却没有写入该字段」。
  const success = h.auditEvents.find((event) => event.eventType === "base.push" && event.result === "succeeded");
  assert.ok(success);
  assert.match(String(success.safeDetails.reason), /omitted_fields:AI优先级建议=P3\(not_in_base_select_options\)/);
});

test("keeps the success audit free of an omission reason when nothing was skipped", async () => {
  const h = makeHarness();
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.deepEqual(result.kind === "pushed" ? result.omittedFields : null, []);
  const success = h.auditEvents.find((event) => event.eventType === "base.push" && event.result === "succeeded");
  assert.ok(success);
  assert.equal(success.safeDetails.reason, undefined);
});

test("classifies Feishu failures from structured fields rather than Error.message wording", async () => {
  const h = makeHarness({ pushError: new FeishuApiError("api", "record update", undefined, 1254043) });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "error");
  assert.equal(h.savedFailure?.code, "FEISHU_RECORD_UPDATE_CODE_1254043");
  assert.equal(h.savedFailure?.summary, "Feishu record update failed (code 1254043); retry is available.");
});

test("a bookkeeping failure after a successful Base write is not reported as a push failure", async () => {
  // 回归：Base 行写成功后本地落库失败，早期实现把整次推送记成 failed 并让 worker 重试。
  // Base 行已经存在，重试会在 findByRequirementKey 尚未可见时制造重复行，
  // 同时向 PM 误报"没推上去"。正确结论是 pushed_unrecorded（外部已成功、本地未记账）。
  const h = makeHarness({ bookkeepingError: true });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed_unrecorded");
  assert.equal((result as { baseRecordId: string }).baseRecordId, "record-2");
  assert.ok(h.calls.includes("base"), "外部写必须已发生");
  assert.equal(h.calls.includes("state:failed"), false, "不得把推送状态标记为失败");
});

test("reconciles a Base record left by a previous push whose local record was never written", async () => {
  // 上一次：Base 写成功 + 记账失败 → base_record_id 为空但 base_push_runs 已记成功。
  // 再次推送时必须先据此补写记录，按"已有行"处理，而不是当新建。
  const req = requirement({ baseRecordId: null, pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pending" } });
  const h = makeHarness({
    req,
    lastSuccessful: pushRun({ sourceVersion: 1, pushVersion: 1, baseRecordId: "record-prev" }),
    sourceSnapshot: { id: "snapshot-1", requirementId: req.id, sourceVersion: 1, sourceHash: "hash-v1", substantiveHash: "substantive-v1", payload: {} } as never,
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  // 关键：base_record_id 为空但上一次推送已成功 → 必须按"实质变更"处理（而不是当新建）
  assert.equal(h.baseInput?.substantiveChanged, true);
  // 补写记录发生在外部写之前
  assert.ok(h.calls.indexOf("base-record") < h.calls.indexOf("base"), `调用顺序: ${h.calls.join(",")}`);
});
