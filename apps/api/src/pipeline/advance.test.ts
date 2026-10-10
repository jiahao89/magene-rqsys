// 工单 14：分析终态 → 负责人 → Base 推送闭合链路测试（fake adapter，公共接缝为领域函数与 push-service）。
import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "../base/client.js";
import { createAnalysisAdvancer, type AdvanceDeps } from "./advance.js";
import { createBasePushService, type BasePushServiceDeps } from "../base/push-service.js";

function requirement(overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  return { id: "req-1", sourceConfigId: "source-1", teambitionRequirementId: "tb-1", teambitionUniqueId: null, title: "Need", description: null, scope: null, acceptanceCriteria: null, proposerUserId: null, proposerName: null, executorUserId: null, executorName: null, sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null, attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "h", substantiveHash: "s", sourceVersion: 1, latestBatchId: null, baseRecordId: null, lastPushedAt: null, pipeline: { pull: "synced", analysis: "analyzed", owner: "pending_mapping", push: "pending" }, firstSeenAt: "2026-10-09T00:00:00.000Z", lastSeenAt: "2026-10-09T00:00:00.000Z", createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", ...overrides };
}
const mapping = { id: "map-1", sourceConfigId: "source-1", teambitionUserId: "tb-user", teambitionDisplayName: "Ada", normalizedName: "ada", feishuUserId: "ou-user", feishuIdType: "open_id" as const, matchMethod: "auto" as const, active: true, createdBy: null, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" };

interface AdvanceFixture extends AdvanceDeps {
  requirementRow: RequirementRecord;
  queuedJobs: { dedupeKey: string }[];
  ownerChanges: string[];
  auditResults: string[];
}
function makeAdvanceFixture(req: RequirementRecord, resolveMapping: boolean): AdvanceFixture {
  const queuedJobs: { dedupeKey: string }[] = [];
  const ownerChanges: string[] = [];
  const auditResults: string[] = [];
  const fixture: AdvanceFixture = {
    requirementRow: req,
    queuedJobs,
    ownerChanges,
    auditResults,
    requirements: {
      get: async (_id: string) => fixture.requirementRow,
      setOwner: async (_id: string, owner: string | null, state: "pending_mapping" | "auto_mapped" | "manually_mapped" | "not_required") => { ownerChanges.push(`${owner}:${state}`); fixture.requirementRow = { ...fixture.requirementRow, pipeline: { ...fixture.requirementRow.pipeline, owner: state } }; },
    },
    people: { resolveActive: async () => resolveMapping ? mapping : null },
    jobs: { enqueue: async (p: { dedupeKey: string }) => { queuedJobs.push({ dedupeKey: p.dedupeKey }); return p as never; } },
    audit: { append: async (e: { result: string }) => { auditResults.push(e.result); } },
    now: () => new Date("2026-10-09T00:00:00.000Z"),
  } as never as AdvanceFixture;
  return fixture;
}

test("无负责人需求：分析终态后标记 not_required 并幂等入队推送（可空负责人推送）", async () => {
  const fixture = makeAdvanceFixture(requirement(), false);
  const advance = createAnalysisAdvancer(fixture);
  assert.equal(await advance("req-1", "analyzed", "worker", 1), "queued");
  assert.deepEqual(fixture.ownerChanges, ["null:not_required"]);
  assert.deepEqual(fixture.queuedJobs.map((j) => j.dedupeKey), ["base-push:req-1:sv1:av1"]);
  assert.deepEqual(fixture.auditResults, ["succeeded"]);
});

test("TB 有负责人且映射唯一：分析失败终态也入队推送（AI 不是门槛）", async () => {
  const fixture = makeAdvanceFixture(requirement({ executorUserId: "tb-user", pipeline: { pull: "synced", analysis: "failed_retryable", owner: "pending_mapping", push: "pending" } }), true);
  const advance = createAnalysisAdvancer(fixture);
  assert.equal(await advance("req-1", "failed_retryable", "worker", 1), "queued");
  assert.deepEqual(fixture.ownerChanges, ["ou-user:auto_mapped"]);
  assert.deepEqual(fixture.auditResults, ["failed"]);
});

test("TB 有负责人但未匹配：等待人工映射，不入队推送", async () => {
  const fixture = makeAdvanceFixture(requirement({ executorUserId: "tb-user" }), false);
  const advance = createAnalysisAdvancer(fixture);
  assert.equal(await advance("req-1", "analyzed", "worker", 1), "waiting_mapping");
  assert.deepEqual(fixture.queuedJobs, []);
  assert.deepEqual(fixture.ownerChanges, []);
});

test("AI 成功重试可更新已推送需求；失败重试不重复推送，未同步需求不推进", async () => {
  const pushed = makeAdvanceFixture(requirement({ pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" } }), true);
  assert.equal(await createAnalysisAdvancer(pushed)("req-1", "analyzed", "worker", 2), "queued");
  assert.equal(pushed.queuedJobs[0]?.dedupeKey, "base-push:req-1:sv1:av2");
  const failedRetry = makeAdvanceFixture(requirement({ pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" } }), true);
  assert.equal(await createAnalysisAdvancer(failedRetry)("req-1", "failed_retryable", "worker", 2), "not_eligible");
  const unsynced = makeAdvanceFixture(requirement({ pipeline: { pull: "pending", analysis: "analyzed", owner: "pending_mapping", push: "pending" } }), true);
  assert.equal(await createAnalysisAdvancer(unsynced)("req-1", "analyzed", "worker", 2), "not_eligible");
  assert.deepEqual(failedRetry.queuedJobs, []);
});

interface PushFixture {
  deps: BasePushServiceDeps;
  actions: string[];
  pushedInputs: { owner: unknown; aiValues: Record<string, unknown>; substantiveChanged: boolean }[];
  audits: { result: string; safeDetails: Record<string, unknown> }[];
}
function makePushFixture(req: RequirementRecord, options: { resolveMapping?: boolean; latestAnalysis?: { status: "analyzed" | "failed_retryable"; analysisVersion: number; moduleSuggestion: string | null; priority: string | null } | null; lastPushVersion?: number } = {}): PushFixture {
  const actions: string[] = [];
  const pushedInputs: PushFixture["pushedInputs"] = [];
  const audits: PushFixture["audits"] = [];
  const deps: BasePushServiceDeps = {
    requirements: {
      get: async (_id: string) => req,
      setOwner: async (_id: string, owner: string | null, state: "pending_mapping" | "auto_mapped" | "manually_mapped" | "not_required") => { actions.push(`owner:${owner}:${state}`); },
      setPushState: async (_id: string, state: "pending" | "running" | "pushed" | "failed") => { actions.push(`push:${state}`); },
      setBaseRecord: async (_id: string, recordId: string) => { actions.push(`base-record:${recordId}`); },
    } as unknown as BasePushServiceDeps["requirements"],
    people: { resolveActive: async () => options.resolveMapping ? mapping : null } as unknown as BasePushServiceDeps["people"],
    basePushes: {
      findByIdempotencyKey: async () => null,
      append: async (p: { requirementId: string; sourceVersion: number; pushVersion: number; idempotencyKey: string; startedAt: string }) => ({ id: "run-1", requirementId: p.requirementId, sourceVersion: p.sourceVersion, pushVersion: p.pushVersion, status: "running" as const, idempotencyKey: p.idempotencyKey, startedAt: p.startedAt, baseRecordId: null, safeErrorCode: null, safeErrorSummary: null, completedAt: null }),
      restart: async () => null,
      updateResult: async (_id: string, r: { status: "pushed" | "failed" }) => { actions.push(`run:${r.status}`); return null; },
      latest: async () => options.lastPushVersion === undefined ? null : { id: "run-0", requirementId: req.id, sourceVersion: options.lastPushVersion, pushVersion: options.lastPushVersion, status: "pushed", idempotencyKey: "old", startedAt: "2026-10-08T00:00:00.000Z", baseRecordId: "rec-1", safeErrorCode: null, safeErrorSummary: null, completedAt: "2026-10-08T00:00:00.000Z" },
      latestSuccessful: async () => options.lastPushVersion === undefined ? null : { id: "run-0", requirementId: req.id, sourceVersion: options.lastPushVersion, pushVersion: options.lastPushVersion, status: "pushed", idempotencyKey: "old", startedAt: "2026-10-08T00:00:00.000Z", baseRecordId: "rec-1", safeErrorCode: null, safeErrorSummary: null, completedAt: "2026-10-08T00:00:00.000Z" },
    } as unknown as BasePushServiceDeps["basePushes"],
    sourceSnapshots: { getAtVersion: async () => options.lastPushVersion === undefined ? null : { id: "snapshot-1", requirementId: req.id, sourceVersion: options.lastPushVersion, sourceHash: "h", substantiveHash: "s", payload: {}, isSubstantiveChange: false, capturedAt: "2026-10-08T00:00:00.000Z" } } as never,
    audit: { append: async (e: { result: string; safeDetails: Record<string, unknown> }) => { audits.push({ result: e.result, safeDetails: e.safeDetails }); } } as unknown as BasePushServiceDeps["audit"],
    ...(options.latestAnalysis !== undefined ? { analyses: { latest: async () => options.latestAnalysis } as never } : {}),
    base: {
      push: async (input: { owner: unknown; aiValues?: Record<string, unknown>; substantiveChanged: boolean }) => { actions.push("base:push"); pushedInputs.push({ owner: input.owner, aiValues: input.aiValues ?? {}, substantiveChanged: input.substantiveChanged }); return { recordId: "base-1", created: !req.baseRecordId }; },
    } as unknown as FeishuBasePushAdapter,
    baseProjectId: "bp", baseFields: { projectId: "P", requirementId: "R", owner: "O", source: {}, ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" }, pm: ["PM状态"] },
    actorId: null, now: () => new Date("2026-10-09T00:00:00.000Z"),
  };
  return { deps, actions, pushedInputs, audits };
}

test("推送映射最新 AI 版本：P3 原样传递不丢弃，无分析时不写 AI 字段", async () => {
  const withP3 = makePushFixture(requirement({ baseRecordId: null }), { latestAnalysis: { status: "analyzed", analysisVersion: 2, moduleSuggestion: "报表分析", priority: "P3" } });
  const outcome = await createBasePushService(withP3.deps).pushRequirement("req-1", "k1");
  assert.equal(outcome.kind, "pushed");
  assert.deepEqual(withP3.pushedInputs[0]!.aiValues, { module: "报表分析", priority: "P3", analysisVersion: 2 });

  const blankPriority = makePushFixture(requirement(), { latestAnalysis: { status: "analyzed", analysisVersion: 3, moduleSuggestion: "报表分析", priority: null } });
  await createBasePushService(blankPriority.deps).pushRequirement("req-1", "k2");
  assert.deepEqual(blankPriority.pushedInputs[0]!.aiValues, { module: "报表分析", analysisVersion: 3 });

  const failedAnalysis = makePushFixture(requirement(), { latestAnalysis: { status: "failed_retryable", analysisVersion: 1, moduleSuggestion: "报表分析", priority: "P1" } });
  await createBasePushService(failedAnalysis.deps).pushRequirement("req-1", "k3");
  assert.deepEqual(failedAnalysis.pushedInputs[0]!.aiValues, {});
});

test("TB 有负责人但未匹配：不推送且审计 denied（映射前不误报已推送）", async () => {
  const fixture = makePushFixture(requirement({ executorUserId: "tb-user" }), { resolveMapping: false });
  const outcome = await createBasePushService(fixture.deps).pushRequirement("req-1", "k4");
  assert.equal(outcome.kind, "conflict");
  assert.deepEqual(fixture.actions, []);
  assert.deepEqual(fixture.audits.map((a) => a.result), ["denied"]);
  assert.equal(fixture.audits[0]!.safeDetails.reason, "owner_pending_mapping");
});

test("TB 无负责人：先 not_required 再空负责人推送，且新源版本才触发 PM 快照", async () => {
  const noOwner = makePushFixture(requirement({ baseRecordId: "rec-existing" }), { lastPushVersion: 1 });
  const outcome = await createBasePushService(noOwner.deps).pushRequirement("req-1", "k5");
  assert.equal(outcome.kind, "pushed");
  assert.deepEqual(noOwner.actions[0], "owner:null:not_required");
  assert.deepEqual(noOwner.pushedInputs[0]!.owner, null);

  // 同版本重复推送（上次推送即当前版本）→ 实质未变化，不触发快照路径
  const sameVersion = makePushFixture(requirement({ baseRecordId: "rec-existing", sourceVersion: 1 }), { lastPushVersion: 1 });
  await createBasePushService(sameVersion.deps).pushRequirement("req-1", "k6");
  assert.equal(sameVersion.pushedInputs[0]!.substantiveChanged, false);

  // 新源版本 → 实质变化，触发快照路径
  const newVersion = makePushFixture(requirement({ baseRecordId: "rec-existing", sourceVersion: 2, substantiveHash: "changed-substantive" }), { lastPushVersion: 1 });
  await createBasePushService(newVersion.deps).pushRequirement("req-1", "k7");
  assert.equal(newVersion.pushedInputs[0]!.substantiveChanged, true);
});
