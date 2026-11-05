// V02-T26：人工优先级覆盖 + 分析补充上下文 + force 重跑 的 HTTP 契约测试。
// 仓储替身只记录调用参数；SQL 副作用由 repositories.integration.test.ts 覆盖。
import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementRecord } from "../domain/persistence.js";
import type { ApiDependencies, ApiRepositories } from "./app.js";
import { handleApiRequest } from "./app.js";

const requirement: RequirementRecord = {
  id: "66666666-6666-4666-8666-666666666666",
  platformRequirementId: "RQ-000001",
  sourceType: "teambition",
  sourceChannel: null,
  productModel: null,
  requirementType: null,
  constraintNotes: null,
  supplementUrl: null,
  intakeModule: null,
  audienceTags: [],
  audienceConfirmed: false,
  audienceVersion: 0,
  sourceConfigId: null,
  teambitionRequirementId: "tb-1",
  teambitionUniqueId: null,
  title: "Need",
  description: null,
  scope: null,
  acceptanceCriteria: null,
  proposerUserId: null,
  proposerName: null,
  executorUserId: null,
  executorName: null,
  sourceStatusId: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  sourceUrl: null,
  attachmentRefs: [],
  sourceCustomFields: [],
  sourcePayload: {},
  sourceHash: "h",
  substantiveHash: "s",
  sourceVersion: 1,
  latestBatchId: null,
  baseRecordId: null,
  lastPushedAt: null,
  pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pending" },
  priorityOverride: null,
  analysisContext: null,
  firstSeenAt: "2026-10-08T00:00:00.000Z",
  lastSeenAt: "2026-10-08T00:00:00.000Z",
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
};
const scoreVersion = {
  id: "score-1", requirementId: requirement.id, version: 2, status: "current" as const, origin: "manual" as const,
  sourceVersion: 1, analysisVersion: 2, ruleVersionId: null,
  inputs: { user: { pain: 3, frequency: 4 }, market: { sellingPoint: 1, competitor: 1 }, strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 3, technicalRisk: 2, resource: 2 } },
  alpha: 0.8, score: 6.4, priority: "P3" as const, scoreConfidence: "中" as const, scoreConfidenceReason: "r", safetyFlag: false,
  basis: {}, rationale: null, actorId: null, changeReason: null, createdAt: "2026-10-08T00:00:00.000Z",
};

interface Recorded {
  priorityCalls: Array<{ id: string; priority: string | null; reason: string | null; actorId: string; at: string }>;
  contextCalls: Array<{ id: string; context: string | null; actorId: string; at: string }>;
  auditEvents: Array<Record<string, unknown>>;
  enqueued: Array<{ dedupeKey: string; payload: Record<string, unknown> }>;
  searches: number;
}

function makeDeps(overrides: { stored?: RequirementRecord; score?: typeof scoreVersion | null; jobsByKey?: Map<string, { status: string }> } = {}): { deps: ApiDependencies; recorded: Recorded } {
  const stored = overrides.stored ?? requirement;
  const jobsByKey = overrides.jobsByKey ?? new Map<string, { status: string }>();
  const recorded: Recorded = { priorityCalls: [], contextCalls: [], auditEvents: [], enqueued: [], searches: 0 };
  const repositories: ApiRepositories = {
    sources: { list: async () => [], get: async () => null, update: async () => null, create: async () => ({} as never) },
    batches: { create: async () => ({} as never), get: async () => null, findByIdempotencyKey: async () => null, list: async () => ({ items: [], nextCursor: null }), complete: async () => null },
    items: { upsert: async () => ({} as never), get: async () => null, listByBatch: async () => [] },
    audit: { append: async (event) => { recorded.auditEvents.push(event as unknown as Record<string, unknown>); }, search: async () => [] },
    jobs: {
      enqueue: async (input) => { recorded.enqueued.push({ dedupeKey: input.dedupeKey, payload: input.payload }); jobsByKey.set(input.dedupeKey, { status: "queued" }); return { ...input, id: "job-1", status: "queued", attemptCount: 0, maxAttempts: 3, lockedUntil: null, lastErrorCode: null, lastErrorSummary: null, createdAt: input.availableAt, updatedAt: input.availableAt }; },
      claimNext: async () => null, reschedule: async () => null, complete: async () => null,
      findByDedupeKey: async (key: string) => { const found = jobsByKey.get(key); return found ? ({ id: `job-${key}`, dedupeKey: key, status: found.status } as never) : null; },
    },
    analyses: { append: async () => ({} as never), complete: async () => ({} as never), latest: async () => null, listByRequirement: async () => [] },
    scoring: {
      current: async () => (overrides.score === null ? null : scoreVersion) as never,
      aiSuggestion: async () => null,
      list: async () => [],
      createAi: async () => scoreVersion as never, saveManual: async () => ({ outcome: "saved", version: scoreVersion } as never), applyAi: async () => ({ outcome: "saved", version: scoreVersion } as never),
    },
    requirements: {
      get: async (id: string) => id === stored.id ? stored : null,
      search: async () => { recorded.searches += 1; return { items: [stored], nextCursor: null }; },
      findForSync: async () => null,
      upsertRequirement: async () => { throw new Error("unused"); },
      updateAnalysisState: async () => undefined, setOwner: async () => undefined, setBaseRecord: async () => undefined,
      setPushState: async () => undefined, updateOwnerState: async () => undefined, updatePushState: async () => undefined,
      listDuplicates: async () => [], listTitleCandidates: async () => [], setDuplicateOf: async () => undefined,
      markLastPushedOwner: async () => undefined, assignManualOwner: async () => undefined, clearManualOwner: async () => undefined,
      markManualOwnerPushed: async () => undefined,
      getPipelineCounts: async () => ({ total: 1, pullSynced: 1, analysisAnalyzed: 1, ownerResolved: 1, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 1, suppressed: 0, priority: { P0: 0, P1: 0, P2: 0, P3: 1, scored: 1, legacy: 0, unscored: 0 } }),
      setPriorityOverride: async (id: string, input: { priority: "P0" | "P1" | "P2" | "P3" | null; reason: string | null; actorId: string; at: string }) => { recorded.priorityCalls.push({ id, ...input }); return { outcome: "saved", override: input.priority === null ? null : { priority: input.priority, reason: input.reason!, actorId: input.actorId, at: input.at } }; },
      setAnalysisContext: async (id: string, input: { context: string | null; actorId: string; at: string }) => { recorded.contextCalls.push({ id, ...input }); return { outcome: "updated", context: input.context === null ? null : { note: input.context, updatedAt: input.at, updatedBy: input.actorId } }; },
    } as never,
  };
  return { deps: { database: null, repositories, identity: { requireActor: async () => ({ id: "actor-1" }) }, now: () => new Date("2026-11-03T00:00:00.000Z") }, recorded };
}

function put(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, { method: "PUT", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("sets a manual priority override and returns override + effective priority", async () => {
  const { deps, recorded } = makeDeps();
  const response = await handleApiRequest(put(`/api/requirements/${requirement.id}/priority-override`, { priority: "P0", reason: "老板要求提前" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    requirementId: requirement.id,
    priorityOverride: { priority: "P0", reason: "老板要求提前", actorId: "actor-1", at: "2026-11-03T00:00:00.000Z" },
    effectivePriority: "P0",
  });
  assert.deepEqual(recorded.priorityCalls[0], { id: requirement.id, priority: "P0", reason: "老板要求提前", actorId: "actor-1", at: "2026-11-03T00:00:00.000Z" });
  assert.deepEqual(recorded.auditEvents[0]?.safeDetails, { priority: "P0", at: "2026-11-03T00:00:00.000Z" });
  assert.equal(recorded.auditEvents[0]?.eventType, "requirement.priority_override_set");
});

test("clearing the override falls back to the current scoring priority and audits the clear", async () => {
  const stored: RequirementRecord = { ...requirement, priorityOverride: { priority: "P0", reason: "旧覆盖", actorId: "actor-1", at: "2026-10-08T00:00:00.000Z" } };
  const { deps, recorded } = makeDeps({ stored });
  const response = await handleApiRequest(put(`/api/requirements/${requirement.id}/priority-override`, { priority: null, reason: "恢复评分结果" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { requirementId: requirement.id, priorityOverride: null, effectivePriority: "P3" });
  assert.equal(recorded.priorityCalls[0]?.priority, null);
  assert.equal(recorded.auditEvents[0]?.eventType, "requirement.priority_override_cleared");
});

test("rejects invalid priority override bodies and unknown requirements", async () => {
  const { deps } = makeDeps();
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/priority-override`, { priority: "P9", reason: "x" }), deps)).status, 400);
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/priority-override`, { priority: "P1" }), deps)).status, 400);
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/priority-override`, { priority: "P1", reason: "x", extra: 1 }), deps)).status, 400);
  assert.equal((await handleApiRequest(put(`/api/requirements/00000000-0000-4000-8000-000000000000/priority-override`, { priority: "P1", reason: "x" }), deps)).status, 404);
});

test("suppressed requirements cannot be given a manual priority or context (409)", async () => {
  const stored: RequirementRecord = { ...requirement, processingState: "suppressed_duplicate" };
  const { deps } = makeDeps({ stored });
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/priority-override`, { priority: "P1", reason: "x" }), deps)).status, 409);
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/analysis-context`, { context: "x" }), deps)).status, 409);
});

test("saves and clears the analysis context", async () => {
  const { deps, recorded } = makeDeps();
  const saved = await handleApiRequest(put(`/api/requirements/${requirement.id}/analysis-context`, { context: "  硬件仅支持 C706  " }), deps);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { requirementId: requirement.id, analysisContext: { note: "硬件仅支持 C706", updatedAt: "2026-11-03T00:00:00.000Z", updatedBy: "actor-1" } });
  assert.equal(recorded.contextCalls[0]?.context, "硬件仅支持 C706");
  assert.equal(recorded.auditEvents[0]?.eventType, "requirement.analysis_context_updated");
  const cleared = await handleApiRequest(put(`/api/requirements/${requirement.id}/analysis-context`, { context: null }), deps);
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { requirementId: requirement.id, analysisContext: null });
});

test("rejects invalid analysis context bodies", async () => {
  const { deps } = makeDeps();
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/analysis-context`, { context: "   " }), deps)).status, 400);
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/analysis-context`, { context: "x".repeat(4001) }), deps)).status, 400);
  assert.equal((await handleApiRequest(put(`/api/requirements/${requirement.id}/analysis-context`, {}), deps)).status, 400);
});

test("detail and list DTOs expose priorityOverride, effectivePriority and analysisContext", async () => {
  const stored: RequirementRecord = {
    ...requirement,
    priorityOverride: null,
    currentScorePriority: "P2",
    analysisContext: { note: "补充上下文", updatedAt: "2026-11-02T00:00:00.000Z", updatedBy: "pm-1" },
  };
  const { deps } = makeDeps({ stored });
  const detail = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), deps);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json() as Record<string, unknown>;
  // 详情以实际当前评分版本为准（夹具 scoring.current=P3）；列表用 search 投影 currentScorePriority=P2。
  assert.equal(detailBody.effectivePriority, "P3");
  assert.deepEqual(detailBody.analysisContext, { note: "补充上下文", updatedAt: "2026-11-02T00:00:00.000Z", updatedBy: "pm-1" });
  const list = await handleApiRequest(new Request("http://localhost/api/requirements?limit=5"), deps);
  assert.equal(list.status, 200);
  const listBody = await list.json() as { items: Array<Record<string, unknown>> };
  assert.equal(listBody.items[0]?.effectivePriority, "P2");
  // 覆盖优先于当前评分版本
  const overridden = makeDeps({ stored: { ...stored, priorityOverride: { priority: "P0", reason: "r", actorId: "a", at: "2026-11-01T00:00:00.000Z" } } });
  const overriddenDetail = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), overridden.deps);
  assert.equal((await overriddenDetail.json() as Record<string, unknown>).effectivePriority, "P0");
});

const forceRetry = () => new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });

test("force retry uses a deterministic dedupe key and passes force into the job payload", async () => {
  const { deps, recorded } = makeDeps();
  const response = await handleApiRequest(forceRetry(), deps);
  assert.equal(response.status, 202);
  assert.equal(recorded.enqueued.length, 1);
  assert.equal(recorded.enqueued[0]!.dedupeKey, `analysis:${requirement.id}:sv1:after0:force`);
  assert.equal(recorded.enqueued[0]!.payload.force, true);
});

test("repeated force retries reuse the queued force job instead of enqueueing another AI call", async () => {
  const { deps, recorded } = makeDeps();
  assert.equal((await handleApiRequest(forceRetry(), deps)).status, 202);
  assert.equal((await handleApiRequest(forceRetry(), deps)).status, 202);
  assert.equal((await handleApiRequest(forceRetry(), deps)).status, 202);
  assert.equal(recorded.enqueued.length, 1);
  const reused = recorded.auditEvents.filter((event) => (event.safeDetails as Record<string, unknown>).analysisStatus === "reused_existing_job");
  assert.equal(reused.length, 2);
});

test("force retry reuses any live analysis job (plain retry or first-pass) for the same version", async () => {
  for (const key of [`analysis:${requirement.id}:sv1:after0`, `analysis:${requirement.id}:v1`]) {
    const { deps, recorded } = makeDeps({ jobsByKey: new Map([[key, { status: "running" }]]) });
    assert.equal((await handleApiRequest(forceRetry(), deps)).status, 202);
    assert.equal(recorded.enqueued.length, 0, key);
  }
});

test("force retry re-enqueues the same key after the previous force job failed", async () => {
  const key = `analysis:${requirement.id}:sv1:after0:force`;
  const { deps, recorded } = makeDeps({ jobsByKey: new Map([[key, { status: "failed" }]]) });
  assert.equal((await handleApiRequest(forceRetry(), deps)).status, 202);
  assert.deepEqual(recorded.enqueued.map((job) => job.dedupeKey), [key]);
});

test("a running requirement whose live job is a force job is not treated as a crash leftover", async () => {
  const stored: RequirementRecord = { ...requirement, pipeline: { ...requirement.pipeline, analysis: "running" } };
  const { deps, recorded } = makeDeps({ stored, jobsByKey: new Map([[`analysis:${requirement.id}:sv1:after0:force`, { status: "running" }]]) });
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), deps);
  assert.equal(response.status, 409);
  assert.equal(recorded.enqueued.length, 0);
});

test("retry without body keeps force=false and the legacy dedupe key", async () => {
  const { deps, recorded } = makeDeps();
  const response = await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST" }), deps);
  assert.equal(response.status, 202);
  assert.equal(recorded.enqueued[0]!.dedupeKey, `analysis:${requirement.id}:sv1:after0`);
  // 非 force 路径不带 force 字段：保持既有作业 payload 形状不变。
  assert.equal("force" in recorded.enqueued[0]!.payload, false);
});

test("retry rejects malformed bodies with 400", async () => {
  const { deps } = makeDeps();
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not-json" }), deps)).status, 400);
  assert.equal((await handleApiRequest(new Request(`http://localhost/api/analysis/${requirement.id}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: "yes" }) }), deps)).status, 400);
});

test("detail exposes a Base record link only when a valid https template is configured", async () => {
  const stored: RequirementRecord = { ...requirement, baseRecordId: "rec/1 a" };
  const previous = process.env.RQSYS_BASE_RECORD_URL_TEMPLATE;
  const detailUrl = async () => {
    const { deps } = makeDeps({ stored });
    const response = await handleApiRequest(new Request(`http://localhost/api/requirements/${requirement.id}`), deps);
    return (await response.json() as Record<string, unknown>).baseRecordUrl;
  };
  try {
    delete process.env.RQSYS_BASE_RECORD_URL_TEMPLATE;
    assert.equal(await detailUrl(), null);
    process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = "http://tenant.feishu.cn/base/app?record={recordId}";
    assert.equal(await detailUrl(), null);
    process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = "https://tenant.feishu.cn/base/app?table=t";
    assert.equal(await detailUrl(), null);
    process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = "https://tenant.feishu.cn/base/app?table=t&record={recordId}";
    assert.equal(await detailUrl(), "https://tenant.feishu.cn/base/app?table=t&record=rec%2F1%20a");
  } finally {
    if (previous === undefined) delete process.env.RQSYS_BASE_RECORD_URL_TEMPLATE;
    else process.env.RQSYS_BASE_RECORD_URL_TEMPLATE = previous;
  }
});
