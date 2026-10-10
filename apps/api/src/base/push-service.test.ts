import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisRunRecord, BasePushRunRecord, RequirementRecord, SourceSnapshotRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "./client.js";
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

function makeHarness(options: { req?: RequirementRecord; previous?: BasePushRunRecord | null; lastSuccessful?: BasePushRunRecord | null; sourceSnapshot?: SourceSnapshotRecord | null } = {}) {
  const req = options.req ?? requirement();
  const calls: string[] = [];
  let existing = options.previous ?? null;
  let baseInput: { substantiveChanged: boolean } | null = null;
  let savedBaseRecord: string | null = null;
  const currentRun = pushRun({ id: "push-current", status: "running", sourceVersion: req.sourceVersion, idempotencyKey: "push:req-1:v2", baseRecordId: null });
  const service = createBasePushService({
    requirements: {
      get: async () => req,
      setOwner: async () => { calls.push("owner"); },
      setPushState: async (_id: string, state: RequirementRecord["pipeline"]["push"]) => { calls.push(`state:${state}`); req.pipeline.push = state; },
      setBaseRecord: async (_id: string, recordId: string) => { savedBaseRecord = recordId; calls.push("base-record"); },
    } as never,
    people: { resolveActive: async () => null } as never,
    analyses: { latest: async () => ({ status: "analyzed", analysisVersion: 1, moduleSuggestion: null, priority: null } as AnalysisRunRecord) } as never,
    basePushes: {
      findByIdempotencyKey: async () => existing,
      append: async () => { calls.push("append"); existing = currentRun; return currentRun; },
      latest: async () => existing,
      latestSuccessful: async () => options.lastSuccessful ?? null,
      updateResult: async (id: string, result: { status: "pushed" | "failed"; baseRecordId?: string; completedAt: string }) => { calls.push(`run:${result.status}`); existing = { ...(existing ?? currentRun), id, status: result.status, baseRecordId: result.baseRecordId ?? null, completedAt: result.completedAt }; return existing; },
      restart: async (id: string, startedAt: string) => { calls.push("restart"); const restarted = { ...(existing ?? currentRun), id, status: "running" as const, startedAt, completedAt: null, safeErrorCode: null, safeErrorSummary: null }; existing = restarted; return restarted; },
    } as never,
    sourceSnapshots: { getAtVersion: async () => options.sourceSnapshot ?? null } as never,
    audit: { append: async () => { calls.push("audit"); } } as never,
    base: { push: async (input: { substantiveChanged: boolean }) => { calls.push("base"); baseInput = input; return { recordId: "record-2", created: false }; } } as unknown as FeishuBasePushAdapter,
    baseProjectId: "tb-project",
    baseFields: { projectId: "project", requirementId: "requirement", owner: "owner", source: {}, ai: {}, pm: ["PM状态"] },
    actorId: "operator-1", now: () => new Date("2026-10-10T00:00:00.000Z"),
  });
  return { service, calls, get baseInput() { return baseInput; }, get savedBaseRecord() { return savedBaseRecord; } };
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
