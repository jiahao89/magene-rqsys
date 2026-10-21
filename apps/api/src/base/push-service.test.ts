import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisRunRecord, BasePushRunRecord, PersonMappingRecord, RequirementRecord, SourceSnapshotRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter } from "./client.js";
import { FeishuApiError } from "./transport.js";
import { createBasePushService } from "./push-service.js";

/** 上一次成功推送时快照里的旧负责人 TB ID；harness 用它区分「旧负责人映射」与「当前负责人映射」。 */
const PREVIOUS_OWNER_TB_ID = "tb-owner-previous";
/** 线上 RQSYS_PM_LEADER_USER_ID 的形态：32 位十六进制 user_id（不是 ou_ 开头的 open_id）。 */
const PM_LEADER_USER_ID = "0123456789abcdef0123456789abcdef";

const requirement = (overrides: Partial<RequirementRecord> = {}): RequirementRecord => ({
  id: "req-1", platformRequirementId: "RQ-000001", sourceConfigId: "source-1", teambitionRequirementId: "tb-1", teambitionUniqueId: null,
  title: "Need", description: "Description", scope: null, acceptanceCriteria: null,
  proposerUserId: null, proposerName: null, executorUserId: null, executorName: null,
  sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null,
  attachmentRefs: [], sourceCustomFields: [], sourcePayload: {}, sourceHash: "hash-v2", substantiveHash: "substantive-v2",
  sourceVersion: 2, latestBatchId: "batch-1", baseRecordId: "record-1", lastPushedAt: null,
  pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "failed" },
  firstSeenAt: "2026-10-08T00:00:00.000Z", lastSeenAt: "2026-10-09T00:00:00.000Z",
  createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", ...overrides,
});

const mappingRecord = (overrides: Partial<PersonMappingRecord> = {}): PersonMappingRecord => ({
  id: "mapping-1", sourceConfigId: "source-1", teambitionUserId: "tb-owner", teambitionDisplayName: "Owner",
  normalizedName: "owner", feishuUserId: "ou-owner", feishuIdType: "open_id", matchMethod: "manual",
  active: true, createdBy: null, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z", ...overrides,
});

const analysisRun = (overrides: Partial<AnalysisRunRecord> = {}): AnalysisRunRecord => ({
  id: "analysis-1", requirementId: "req-1", sourceVersion: 2, analysisVersion: 1, status: "analyzed",
  moduleSuggestion: null, confidence: null, confidenceReason: null, priority: null, structuredResult: null,
  provider: null, model: null, promptVersion: null, moduleDictionaryVersion: null, priorityRuleVersionId: null,
  safeErrorCode: null, safeErrorSummary: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z", ...overrides,
});

const pushRun = (overrides: Partial<BasePushRunRecord> = {}): BasePushRunRecord => ({
  id: "push-1", requirementId: "req-1", sourceVersion: 1, pushVersion: 1, status: "pushed",
  idempotencyKey: "push:req-1:v1", baseRecordId: "record-1", safeErrorCode: null,
  safeErrorSummary: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z", ...overrides,
});

const sourceSnapshot = (overrides: Partial<SourceSnapshotRecord> = {}): SourceSnapshotRecord => ({
  id: "snapshot-1", requirementId: "req-1", sourceVersion: 1, sourceHash: "hash-v1", substantiveHash: "substantive-v1",
  payload: {}, isSubstantiveChange: false, capturedAt: "2026-10-08T00:00:00.000Z", ...overrides,
});

interface CapturedPushInput {
  projectId: string;
  platformRequirementId: string;
  substantiveChanged: boolean;
  requirementLink?: string;
  notification?: { eventId: string; eventType: string; recipientUserId: string | null; recipientIdType: "open_id" | "user_id" | "union_id"; ownerMergeUserId: string | null };
}

function makeHarness(options: {
  bookkeepingError?: boolean;
  req?: RequirementRecord;
  previous?: BasePushRunRecord | null;
  lastSuccessful?: BasePushRunRecord | null;
  sourceSnapshot?: SourceSnapshotRecord | null;
  omittedFields?: { field: string; value: string; reason: "not_in_base_select_options" | "category_omitted_by_policy" }[];
  pushError?: Error;
  mapping?: PersonMappingRecord | null;
  previousMapping?: PersonMappingRecord | null;
  analysisHistory?: AnalysisRunRecord[];
  latestAnalysis?: AnalysisRunRecord | null;
  pmLeaderUserId?: string | null;
  webBaseUrl?: string;
  withLock?: boolean;
} = {}) {
  const auditEvents: { eventType: string; result: string; safeDetails: Record<string, unknown> }[] = [];
  const req = options.req ?? requirement();
  const calls: string[] = [];
  let existing = options.previous ?? null;
  let baseInput: CapturedPushInput | null = null;
  let savedBaseRecord: string | null = null;
  let savedFailure: { code: string | null; summary: string | null } | null = null;
  let lockTail: Promise<unknown> = Promise.resolve();
  const withRequirementLock = async <T>(_requirementId: string, fn: () => Promise<T>): Promise<T> => {
    const previous = lockTail;
    let release!: () => void;
    lockTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    calls.push("lock:enter");
    try {
      return await fn();
    } finally {
      calls.push("lock:exit");
      release();
    }
  };
  const currentRun = pushRun({ id: "push-current", status: "running", sourceVersion: req.sourceVersion, idempotencyKey: "push:req-1:v2", baseRecordId: null });
  const defaultAnalysis = analysisRun({ sourceVersion: req.sourceVersion });
  const latestAnalysis = options.latestAnalysis === undefined ? defaultAnalysis : options.latestAnalysis;
  const service = createBasePushService({
    requirements: {
      get: async () => req,
      setOwner: async () => { calls.push("owner"); },
      setPushState: async (_id: string, state: RequirementRecord["pipeline"]["push"]) => { calls.push(`state:${state}`); req.pipeline.push = state; },
      setBaseRecord: async (_id: string, recordId: string) => {
        if (options.bookkeepingError) throw new Error("bookkeeping down");
        savedBaseRecord = recordId; calls.push("base-record");
      },
      ...(options.withLock ? { withRequirementLock } : {}),
    } as never,
    people: {
      resolveActive: async (_sourceConfigId: string, by: { tbUserId?: string; normalizedName?: string }) => {
        if (by.tbUserId === PREVIOUS_OWNER_TB_ID) return options.previousMapping ?? null;
        return options.mapping ?? null;
      },
    } as never,
    analyses: {
      latest: async () => latestAnalysis,
      listByRequirement: async () => options.analysisHistory ?? (latestAnalysis ? [latestAnalysis] : []),
    } as never,
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
    base: { push: async (input: CapturedPushInput) => { calls.push("base"); baseInput = input; if (options.pushError) throw options.pushError; return { recordId: "record-2", created: false, omittedFields: options.omittedFields ?? [] }; } } as unknown as FeishuBasePushAdapter,
    sourceProjectId: "verified-source-project",
    baseFields: { projectId: "project", requirementId: "requirement", owner: "owner", source: {}, ai: {}, pm: ["PM状态"] },
    actorId: "operator-1",
    ...(options.pmLeaderUserId === undefined ? {} : { pmLeaderUserId: options.pmLeaderUserId }),
    ...(options.webBaseUrl === undefined ? {} : { webBaseUrl: options.webBaseUrl }),
    now: () => new Date("2026-10-10T00:00:00.000Z"),
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
  assert.equal(h.baseInput?.platformRequirementId, "RQ-000001");
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

// ---- 通知事件载荷（四个系统字段）与收件人规则 ----

test("first push stays silent so a bulk backfill cannot flood the PM Leader", async () => {
  // 产品最终确认：首次推送静默。151 条需求一起推时，逐条通知会把"分配后通知负责人"淹没；
  // Base 表格本身就是 PM Leader 的工作台。首推仍要写业务字段，只是不写通知字段。
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  // 批量回填走自动匹配；人工分配属于另一次明确动作，另有用例覆盖。
  const h = makeHarness({ req, mapping: mappingRecord({ matchMethod: "tb_user_id" }), pmLeaderUserId: PM_LEADER_USER_ID });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.notification, undefined);
  assert.ok(h.calls.includes("base"));
});

test("first push notifies the owner when a person was assigned by hand", async () => {
  // 人工分配是明确的人类意图：被分配的人必须收到通知，否则不知道有这件事要做。
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const h = makeHarness({ req, mapping: mappingRecord({ matchMethod: "manual" }), pmLeaderUserId: PM_LEADER_USER_ID });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.notification?.eventType, "已分配负责人");
  assert.equal(h.baseInput?.notification?.recipientUserId, "ou-owner");
});

test("writes the stable web requirement deep link on every push, including a silent first push", async () => {
  const h = makeHarness({ webBaseUrl: "https://workbench.example/app" });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  // 首推静默（不写通知字段）仍然要写深链：它是给 PM 点击的入口，不是通知事件。
  assert.equal(h.baseInput?.notification, undefined);
  // 深链用应用库的 requirements.id（不是 TB ID），与 Web 深链参数一致。
  assert.equal(h.baseInput?.requirementLink, "https://workbench.example/app?requirement=req-1");
});

test("defaults the requirement deep link to the production workbench", async () => {
  const previous = process.env.RQSYS_WEB_BASE_URL;
  delete process.env.RQSYS_WEB_BASE_URL;
  try {
    const h = makeHarness();
    const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
    assert.equal(result.kind, "pushed");
    assert.equal(h.baseInput?.requirementLink, "https://ecn8egz1lhkq.feishu.link/app/app_17fqkjwyx1u?requirement=req-1");
  } finally {
    if (previous === undefined) delete process.env.RQSYS_WEB_BASE_URL;
    else process.env.RQSYS_WEB_BASE_URL = previous;
  }
});

test("reads the deep-link base from RQSYS_WEB_BASE_URL and trims a trailing slash", async () => {
  const previous = process.env.RQSYS_WEB_BASE_URL;
  process.env.RQSYS_WEB_BASE_URL = "https://workbench.example/app/";
  try {
    const h = makeHarness();
    const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
    assert.equal(result.kind, "pushed");
    assert.equal(h.baseInput?.requirementLink, "https://workbench.example/app?requirement=req-1");
  } finally {
    if (previous === undefined) delete process.env.RQSYS_WEB_BASE_URL;
    else process.env.RQSYS_WEB_BASE_URL = previous;
  }
});

test("a substantive change notifies the current owner with substantive_update", async () => {
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const h = makeHarness({
    req,
    mapping: mappingRecord(),
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({
      substantiveHash: "substantive-v1",
      payload: { sourceExecutorId: "tb-owner", mappedFields: { executorName: "Owner" } },
    }),
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.substantiveChanged, true);
  assert.deepEqual(h.baseInput?.notification, {
    eventType: "需求内容变更",
    eventId: "substantive_update:req-1:sv2",
    recipientUserId: "ou-owner",
    // 负责人映射是 open_id：收件人类型必须跟随映射，否则 client 无法与 user_id 的 PM Leader 分开请求。
    recipientIdType: "open_id",
    ownerMergeUserId: "ou-owner",
  });
});

test("a substantive change without an owner falls back to the PM Leader", async () => {
  const h = makeHarness({
    pmLeaderUserId: PM_LEADER_USER_ID,
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({ substantiveHash: "substantive-v1" }),
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.substantiveChanged, true);
  assert.deepEqual(h.baseInput?.notification, {
    eventType: "需求内容变更",
    eventId: "substantive_update:req-1:sv2",
    recipientUserId: PM_LEADER_USER_ID,
    recipientIdType: "user_id",
    ownerMergeUserId: null,
  });
});

test("an owner appearing for the first time produces owner_assigned for the new owner", async () => {
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const h = makeHarness({
    req,
    mapping: mappingRecord(),
    // 负责人事件必须发给新的当前负责人，即使配置了 PM Leader 也不用它。
    pmLeaderUserId: PM_LEADER_USER_ID,
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    // 上次成功推送时 TB 无负责人：Base 负责人为空
    sourceSnapshot: sourceSnapshot({
      substantiveHash: req.substantiveHash,
      payload: { sourceExecutorId: null, mappedFields: { executorName: null } },
    }),
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.substantiveChanged, false);
  assert.deepEqual(h.baseInput?.notification, {
    eventType: "已分配负责人",
    eventId: "owner_assigned:req-1:sv2:none:ou-owner",
    recipientUserId: "ou-owner",
    recipientIdType: "open_id",
    ownerMergeUserId: "ou-owner",
  });
});

test("an owner A→B change produces owner_changed with the previous and new user ids in the event id", async () => {
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const h = makeHarness({
    req,
    mapping: mappingRecord({ feishuUserId: "ou-owner" }),
    previousMapping: mappingRecord({ id: "mapping-old", feishuUserId: "ou-previous", matchMethod: "tb_user_id" }),
    pmLeaderUserId: PM_LEADER_USER_ID,
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({
      substantiveHash: req.substantiveHash,
      payload: { sourceExecutorId: PREVIOUS_OWNER_TB_ID, mappedFields: { executorName: "Previous Owner" } },
    }),
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.deepEqual(h.baseInput?.notification, {
    eventType: "负责人变更",
    eventId: "owner_changed:req-1:sv2:ou-previous:ou-owner",
    recipientUserId: "ou-owner",
    recipientIdType: "open_id",
    ownerMergeUserId: "ou-owner",
  });
});

test("AI failure followed by success on the same source version produces ai_retry_success", async () => {
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const latest = analysisRun({ analysisVersion: 2, status: "analyzed" });
  const h = makeHarness({
    req,
    mapping: mappingRecord(),
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({
      substantiveHash: req.substantiveHash,
      payload: { sourceExecutorId: "tb-owner", mappedFields: { executorName: "Owner" } },
    }),
    latestAnalysis: latest,
    analysisHistory: [analysisRun({ analysisVersion: 1, status: "failed_retryable" }), latest],
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.substantiveChanged, false);
  assert.deepEqual(h.baseInput?.notification, {
    eventType: "AI 重试成功",
    eventId: "ai_retry_success:req-1:sv2",
    recipientUserId: "ou-owner",
    recipientIdType: "open_id",
    ownerMergeUserId: "ou-owner",
  });
});

test("AI retry success without an owner falls back to the PM Leader", async () => {
  const latest = analysisRun({ analysisVersion: 2, status: "analyzed" });
  const h = makeHarness({
    pmLeaderUserId: PM_LEADER_USER_ID,
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({ substantiveHash: "substantive-v2" }),
    latestAnalysis: latest,
    analysisHistory: [analysisRun({ analysisVersion: 1, status: "failed_retryable" }), latest],
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.substantiveChanged, false);
  assert.deepEqual(h.baseInput?.notification, {
    eventType: "AI 重试成功",
    eventId: "ai_retry_success:req-1:sv2",
    recipientUserId: PM_LEADER_USER_ID,
    recipientIdType: "user_id",
    ownerMergeUserId: null,
  });
});

test("a repeated no-change sync is silent and writes no notification fields", async () => {
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const h = makeHarness({
    req,
    mapping: mappingRecord(),
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({
      substantiveHash: req.substantiveHash,
      payload: { sourceExecutorId: "tb-owner", mappedFields: { executorName: "Owner" } },
    }),
  });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.ok(h.baseInput, "业务字段仍然推送");
  assert.equal(h.baseInput?.notification, undefined);
  assert.equal(Object.hasOwn(h.baseInput ?? {}, "notification"), false);
});

test("replaying a pushed idempotency key is silent and never touches Base again", async () => {
  const h = makeHarness({ previous: pushRun({ status: "pushed" }) });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.calls.includes("base"), false);
  assert.equal(h.baseInput, null);
});

test("first push without an owner is also silent", async () => {
  // 静默规则与是否有负责人无关：首推一律不写通知字段，避免批量回填刷屏。
  const h = makeHarness({ pmLeaderUserId: PM_LEADER_USER_ID });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.equal(h.baseInput?.notification, undefined);
});
test("first push with an owner but no PM Leader stays silent instead of falling back to the owner", async () => {
  // 规则是 first_push → PM Leader；PM Leader 未配置时本次不写通知字段，
  // 而不是退回负责人（那会把「新需求入场」通知发给个人，与产品规则相反）。
  const req = requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const h = makeHarness({ req, mapping: mappingRecord({ matchMethod: "tb_user_id" }), pmLeaderUserId: null });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.ok(h.baseInput, "业务字段仍然推送");
  assert.equal(h.baseInput?.notification, undefined);
});

test("omits the notification payload when no recipient can be resolved", async () => {
  const h = makeHarness({ pmLeaderUserId: null });
  const result = await h.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(result.kind, "pushed");
  assert.ok(h.baseInput, "业务字段仍然推送");
  assert.equal(h.baseInput?.notification, undefined);
});

test("event ids are stable for the same event and distinct across events", async () => {
  const ownedRequirement = () => requirement({ executorUserId: "tb-owner", executorName: "Owner" });
  const ownerAssigned = () => makeHarness({
    req: ownedRequirement(),
    mapping: mappingRecord(),
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({ substantiveHash: "substantive-v2", payload: { sourceExecutorId: null, mappedFields: { executorName: null } } }),
  });
  const assigned = ownerAssigned();
  await assigned.service.pushRequirement("req-1", "push:req-1:v2");
  const replay = ownerAssigned();
  await replay.service.pushRequirement("req-1", "push:req-1:v2");
  assert.equal(assigned.baseInput?.notification?.eventId, replay.baseInput?.notification?.eventId);

  // 不同源版本 / 不同事件类型必须得到不同事件ID，规则不会把新事件当成旧事件去重。
  const newer = makeHarness({
    req: requirement({ executorUserId: "tb-owner", executorName: "Owner", sourceVersion: 3 }),
    mapping: mappingRecord(),
    lastSuccessful: pushRun({ sourceVersion: 2 }),
    sourceSnapshot: sourceSnapshot({ sourceVersion: 2, substantiveHash: "substantive-v2", payload: { sourceExecutorId: null, mappedFields: { executorName: null } } }),
  });
  await newer.service.pushRequirement("req-1", "push:req-1:v3");
  const changed = makeHarness({
    req: ownedRequirement(),
    mapping: mappingRecord(),
    previousMapping: mappingRecord({ feishuUserId: "ou-previous" }),
    lastSuccessful: pushRun({ sourceVersion: 1 }),
    sourceSnapshot: sourceSnapshot({ substantiveHash: "substantive-v2", payload: { sourceExecutorId: PREVIOUS_OWNER_TB_ID, mappedFields: { executorName: "Previous Owner" } } }),
  });
  await changed.service.pushRequirement("req-1", "push:req-1:v2");
  const ids = new Set([
    assigned.baseInput?.notification?.eventId,
    newer.baseInput?.notification?.eventId,
    changed.baseInput?.notification?.eventId,
  ]);
  assert.equal(ids.size, 3, `不同事件必须有不同的确定性 ID: ${[...ids].join(", ")}`);
});

test("the requirement advisory lock serializes concurrent pushes and prevents a duplicate Base row", async () => {
  const req = requirement({ pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pending" } });
  const calls: string[] = [];
  const runs = new Map<string, BasePushRunRecord>();
  let baseWrites = 0;
  let activeBaseWrites = 0;
  let maxActiveBaseWrites = 0;
  let lockTail: Promise<unknown> = Promise.resolve();
  const service = createBasePushService({
    requirements: {
      get: async () => req,
      setOwner: async () => { calls.push("owner"); },
      setPushState: async (_id: string, state: RequirementRecord["pipeline"]["push"]) => { req.pipeline.push = state; calls.push(`state:${state}`); },
      setBaseRecord: async () => { calls.push("base-record"); },
      withRequirementLock: async <T>(_requirementId: string, fn: () => Promise<T>): Promise<T> => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        calls.push("lock:enter");
        try {
          return await fn();
        } finally {
          calls.push("lock:exit");
          release();
        }
      },
    } as never,
    people: { resolveActive: async () => null } as never,
    analyses: { latest: async () => null } as never,
    basePushes: {
      findByIdempotencyKey: async (key: string) => runs.get(key) ?? null,
      append: async (input: { idempotencyKey: string }) => {
        const run = pushRun({ id: "run-lock", status: "running", idempotencyKey: input.idempotencyKey, baseRecordId: null, completedAt: null });
        runs.set(input.idempotencyKey, run);
        calls.push("append");
        return run;
      },
      latest: async () => Array.from(runs.values()).at(-1) ?? null,
      latestSuccessful: async () => Array.from(runs.values()).find((run) => run.status === "pushed") ?? null,
      updateResult: async (id: string, result: { status: "pushed" | "failed"; baseRecordId?: string; completedAt: string }) => {
        const run = Array.from(runs.values()).find((item) => item.id === id);
        if (!run) return null;
        const updated = { ...run, status: result.status, baseRecordId: result.baseRecordId ?? null, completedAt: result.completedAt };
        runs.set(run.idempotencyKey, updated);
        return updated;
      },
      restart: async () => null,
    } as never,
    sourceSnapshots: { getAtVersion: async () => null } as never,
    audit: { append: async () => {} } as never,
    base: {
      push: async () => {
        baseWrites += 1;
        activeBaseWrites += 1;
        maxActiveBaseWrites = Math.max(maxActiveBaseWrites, activeBaseWrites);
        calls.push("base");
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeBaseWrites -= 1;
        return { recordId: "record-2", created: false, omittedFields: [] };
      },
    } as unknown as FeishuBasePushAdapter,
    sourceProjectId: "verified-source-project",
    baseFields: { projectId: "project", requirementId: "requirement", owner: "owner", source: {}, ai: {}, pm: ["PM状态"] },
    actorId: "operator-1", now: () => new Date("2026-10-10T00:00:00.000Z"),
  });

  const [first, second] = await Promise.all([
    service.pushRequirement("req-1", "push:req-1:v2"),
    service.pushRequirement("req-1", "push:req-1:v2"),
  ]);

  assert.equal(first.kind, "pushed");
  assert.equal(second.kind, "pushed");
  assert.equal(baseWrites, 1, "同一需求不得产生第二次 Base 写入（否则会多出一行或相互覆盖）");
  assert.equal(maxActiveBaseWrites, 1, "两个关键区的 Base 写入不得重叠");
  assert.equal(calls.filter((call) => call === "append").length, 1, "同一推送只能建一条 run");
  const firstLockExit = calls.indexOf("lock:exit");
  const secondLockEnter = calls.indexOf("lock:enter", firstLockExit);
  assert.ok(firstLockExit >= 0 && secondLockEnter > firstLockExit, `第二个推送必须等第一个完成: ${calls.join(",")}`);
  // 第二个推送看到第一个已推送的 run，走幂等重放（不再写 Base）。
  assert.equal(runs.get("push:req-1:v2")?.status, "pushed");
});
