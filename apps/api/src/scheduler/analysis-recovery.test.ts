import assert from "node:assert/strict";
import test from "node:test";
import { redactSafeDetails } from "../audit/event.js";
import type { AuditEventRecord, PipelineJobRecord, RequirementRecord } from "../domain/persistence.js";
import type { RequirementQueryRepository } from "../application/repositories.js";
import {
  ANALYSIS_RECOVERY_SCAN_LIMIT,
  MAX_SCHEDULER_ANALYSIS_RETRIES,
  analysisRetryDedupeKey,
  analysisRunningJobKeys,
  recoverAnalysisPipeline,
} from "./analysis-recovery.js";

const NOW = new Date("2026-10-20T12:00:00.000Z");

type SearchQuery = Parameters<RequirementQueryRepository["search"]>[0];

function requirement(overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  return {
    id: "req-1", platformRequirementId: "RQ-000001", sourceType: "teambition", sourceChannel: null, productModel: null, requirementType: null, constraintNotes: null, supplementUrl: null, intakeModule: null, sourceConfigId: "src-1", teambitionRequirementId: "tb-1", teambitionUniqueId: 1,
    title: "需求", description: null, scope: null, acceptanceCriteria: null,
    proposerUserId: null, proposerName: null, executorUserId: null, executorName: null,
    sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null,
    attachmentRefs: [], sourceCustomFields: [], sourcePayload: {},
    sourceHash: "source-hash", substantiveHash: "substantive-hash", sourceVersion: 3,
    latestBatchId: "batch-1", baseRecordId: null, lastPushedAt: null,
    pipeline: { pull: "synced", analysis: "failed_retryable", owner: "pending_mapping", push: "pending" },
    firstSeenAt: "2026-10-20T10:00:00.000Z", lastSeenAt: "2026-10-20T10:00:00.000Z",
    createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

function job(overrides: Partial<PipelineJobRecord> = {}): PipelineJobRecord {
  return {
    id: "job-1", jobType: "analysis", dedupeKey: "analysis:req-1:sv3:after0",
    payload: { requirementId: "req-1" }, status: "queued", attemptCount: 0, maxAttempts: 5,
    availableAt: "2026-10-20T11:00:00.000Z", lockedUntil: null,
    lastErrorCode: null, lastErrorSummary: null,
    createdAt: "2026-10-20T11:00:00.000Z", updatedAt: "2026-10-20T11:00:00.000Z",
    ...overrides,
  };
}

function auditEvent(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id: `audit-${Math.random().toString(36).slice(2)}`, actorId: null,
    eventType: "analysis.retry_requested", entityType: "requirement", entityId: "req-1",
    result: "succeeded", safeDetails: {}, occurredAt: "2026-10-20T11:00:00.000Z",
    ...overrides,
  };
}

function schedulerRetryEvent(priorAnalysisVersion: number, sourceVersion = 3): AuditEventRecord {
  return auditEvent({ safeDetails: { source: "scheduler", sourceVersion, priorAnalysisVersion } });
}

function harness(input: {
  failed?: RequirementRecord[];
  running?: RequirementRecord[];
  jobs?: Record<string, PipelineJobRecord>;
  latestAnalysisVersion?: Record<string, number>;
  events?: AuditEventRecord[];
  enqueueErrors?: Set<string>;
  searchErrors?: Set<string>;
  /** 模拟 complete 的 fencing 失败：作业在回收前被其他实例重新认领。 */
  completeRejects?: boolean;
}) {
  const failed = input.failed ?? [];
  const running = input.running ?? [];
  const jobs = new Map(Object.entries(input.jobs ?? {}));
  const latest = new Map(Object.entries(input.latestAnalysisVersion ?? {}));
  const state = {
    failed, running, jobs, latest,
    events: [...(input.events ?? [])],
    searchQueries: [] as SearchQuery[],
    enqueueCalls: [] as { dedupeKey: string; payload: Record<string, unknown> }[],
    completions: [] as { id: string; expectedAttempt: number; status: string }[],
    stateUpdates: [] as { id: string; to: string }[],
  };

  const deps = {
    requirements: {
      async search(query: SearchQuery) {
        state.searchQueries.push(query);
        if (query.analysisState && input.searchErrors?.has(query.analysisState)) {
          throw new Error(`search ${query.analysisState} unavailable`);
        }
        const source = query.analysisState === "running" ? state.running : state.failed;
        const items = source.filter((item) =>
          !query.pullState || item.pipeline.pull === query.pullState,
        );
        return { items: items.slice(0, query.limit), nextCursor: null };
      },
      async updateAnalysisState(requirementId: string, to: string) {
        state.stateUpdates.push({ id: requirementId, to });
        const current = [...state.failed, ...state.running].find((item) => item.id === requirementId);
        if (!current) throw new Error("Requirement not found");
        current.pipeline = { ...current.pipeline, analysis: to as RequirementRecord["pipeline"]["analysis"] };
        const index = state.running.indexOf(current);
        if (index >= 0) {
          state.running.splice(index, 1);
          state.failed.push(current);
        }
      },
    },
    analyses: {
      async latest(requirementId: string) {
        const version = state.latest.get(requirementId);
        return version === undefined ? null : { analysisVersion: version };
      },
    },
    jobs: {
      async findByDedupeKey(key: string) {
        return state.jobs.get(key) ?? null;
      },
      async enqueue(jobInput: { dedupeKey: string; payload: Record<string, unknown>; availableAt: string }) {
        state.enqueueCalls.push({ dedupeKey: jobInput.dedupeKey, payload: jobInput.payload });
        const requirementId = jobInput.payload["requirementId"];
        if (typeof requirementId === "string" && input.enqueueErrors?.has(requirementId)) {
          throw new Error("enqueue unavailable");
        }
        const existing = state.jobs.get(jobInput.dedupeKey);
        if (existing && existing.status !== "failed" && existing.status !== "cancelled") {
          // 与 Postgres 仓储一致：非终态 key 不会被复用/重置，返回既有作业。
          return existing;
        }
        const created = job({
          id: `job-${state.jobs.size + 1}`, dedupeKey: jobInput.dedupeKey, payload: jobInput.payload,
          status: "queued", attemptCount: 0, lockedUntil: null,
        });
        state.jobs.set(jobInput.dedupeKey, created);
        return created;
      },
      async complete(id: string, result: { expectedAttempt: number; status: string }) {
        state.completions.push({ id, expectedAttempt: result.expectedAttempt, status: result.status });
        if (input.completeRejects) return null;
        const current = [...state.jobs.values()].find((item) => item.id === id);
        if (!current || current.status !== "running" || current.attemptCount !== result.expectedAttempt) return null;
        current.status = result.status as PipelineJobRecord["status"];
        return current;
      },
    },
    audit: {
      async append(event: AuditEventRecord) {
        state.events.push(event);
      },
      async search(query: { entityId?: string; limit: number }) {
        return state.events.filter((event) => !query.entityId || event.entityId === query.entityId).slice(0, query.limit);
      },
    },
    now: NOW,
  };

  async function run(overrides: { limit?: number; maxRetries?: number } = {}) {
    return recoverAnalysisPipeline({ ...deps, now: NOW, ...overrides } as never);
  }

  return { state, deps: deps as never, run };
}

test("failed_retryable 需求会被自动补排分析作业并写系统审计", async () => {
  const h = harness({
    failed: [requirement()],
    latestAnalysisVersion: { "req-1": 2 },
  });

  const report = await h.run();

  assert.equal(report.retried.length, 1);
  assert.equal(report.retried[0]?.action, "enqueued");
  assert.equal(report.retried[0]?.dedupeKey, "analysis:req-1:sv3:after2");
  // 与手动重试端点相同的 key / payload 形状；actorId=null 表示系统触发
  assert.equal(h.state.enqueueCalls.length, 1);
  assert.deepEqual(h.state.enqueueCalls[0]?.payload, {
    requirementId: "req-1", sourceVersion: 3, substantiveHash: "substantive-hash", actorId: null,
  });
  assert.equal(h.state.enqueueCalls[0]?.dedupeKey, "analysis:req-1:sv3:after2");

  const retryAudit = h.state.events.find((event) => event.eventType === "analysis.retry_requested");
  assert.ok(retryAudit);
  assert.equal(retryAudit.actorId, null);
  assert.equal(retryAudit.result, "succeeded");
  assert.deepEqual(retryAudit.safeDetails, {
    source: "scheduler", sourceVersion: 3, priorAnalysisVersion: 2, analysisStatus: "queued_new_job",
  });
  // 审计脱敏白名单必须保留这些键，否则线上落库后调度重试预算无法累计
  assert.deepEqual(redactSafeDetails(retryAudit.safeDetails), retryAudit.safeDetails);

  // 扫描查询按 pull=synced + analysis=failed_retryable 过滤，并带单轮上限
  const failedQuery = h.state.searchQueries.find((query) => query.analysisState === "failed_retryable");
  assert.deepEqual(failedQuery, { pullState: "synced", analysisState: "failed_retryable", limit: ANALYSIS_RECOVERY_SCAN_LIMIT });
});

test("已有 queued/running 作业时不重复入队", async () => {
  for (const status of ["queued", "running"] as const) {
    const h = harness({
      failed: [requirement()],
      latestAnalysisVersion: { "req-1": 2 },
      jobs: { "analysis:req-1:sv3:after2": job({ status }) },
    });
    const report = await h.run();
    assert.equal(report.retried[0]?.action, "skipped", status);
    assert.equal(report.retried[0]?.reason, "job_active", status);
    assert.equal(h.state.enqueueCalls.length, 0, `${status} 作业存在时不应再入队`);
    assert.equal(h.state.events.length, 0, "跳过时不写审计，避免每轮刷屏");
  }
});

test("作业已 succeeded 但需求仍是 failed_retryable 时不做自动动作", async () => {
  const h = harness({
    failed: [requirement()],
    latestAnalysisVersion: { "req-1": 2 },
    jobs: { "analysis:req-1:sv3:after2": job({ status: "succeeded" }) },
  });
  const report = await h.run();
  assert.equal(report.retried[0]?.action, "skipped");
  assert.equal(report.retried[0]?.reason, "job_succeeded");
  assert.equal(h.state.enqueueCalls.length, 0);
});

test("同一源版本累计调度重试达到上限后放弃：只留一条 failed 审计，之后静默跳过", async () => {
  assert.equal(MAX_SCHEDULER_ANALYSIS_RETRIES, 3);
  const h = harness({
    failed: [requirement()],
    latestAnalysisVersion: { "req-1": 4 },
    events: [
      schedulerRetryEvent(1), schedulerRetryEvent(2), schedulerRetryEvent(3),
    ],
  });

  const first = await h.run();
  assert.equal(first.retried[0]?.action, "exhausted");
  assert.equal(first.retried[0]?.reason, "retry_budget_exhausted");
  assert.equal(h.state.enqueueCalls.length, 0, "达到上限后不再入队");
  const failedAudit = h.state.events.filter((event) => event.result === "failed");
  assert.equal(failedAudit.length, 1);
  assert.equal(failedAudit[0]?.eventType, "analysis.retry_requested");
  assert.equal(failedAudit[0]?.actorId, null);
  assert.equal(failedAudit[0]?.safeDetails["reason"], "retry_budget_exhausted");
  assert.equal(failedAudit[0]?.safeDetails["attempt"], 3);
  assert.deepEqual(redactSafeDetails(failedAudit[0]?.safeDetails), failedAudit[0]?.safeDetails);

  // 第二轮：放弃标记已存在，不再重复写审计、也不入队
  const second = await h.run();
  assert.equal(second.retried[0]?.action, "exhausted");
  assert.equal(second.retried[0]?.reason, "already_reported");
  assert.equal(h.state.enqueueCalls.length, 0);
  assert.equal(h.state.events.filter((event) => event.result === "failed").length, 1);
});

test("上限内的调度重试仍会继续入队（边界：2 次已用，允许第 3 次）", async () => {
  const h = harness({
    failed: [requirement()],
    latestAnalysisVersion: { "req-1": 3 },
    events: [schedulerRetryEvent(1), schedulerRetryEvent(2)],
  });
  const report = await h.run();
  assert.equal(report.retried[0]?.action, "enqueued");
  assert.equal(h.state.enqueueCalls.length, 1);
  assert.equal(h.state.enqueueCalls[0]?.dedupeKey, "analysis:req-1:sv3:after3");
});

test("running + 作业已终态 → 回退 failed_retryable 并写 analysis.recovery 审计", async () => {
  const h = harness({
    running: [requirement({ pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
    latestAnalysisVersion: { "req-1": 1 },
    jobs: { "analysis:req-1:sv3:after1": job({ status: "failed" }) },
  });

  const report = await h.run();
  assert.equal(report.recovered[0]?.action, "reverted");
  assert.equal(report.recovered[0]?.reason, "job_terminal");
  assert.deepEqual(h.state.stateUpdates, [{ id: "req-1", to: "failed_retryable" }]);

  const recovery = h.state.events.find((event) => event.eventType === "analysis.recovery");
  assert.ok(recovery);
  assert.equal(recovery.actorId, null);
  assert.equal(recovery.result, "succeeded");
  assert.deepEqual(redactSafeDetails(recovery.safeDetails), recovery.safeDetails);
  assert.equal(recovery.safeDetails["from"], "running");
  assert.equal(recovery.safeDetails["to"], "failed_retryable");
  assert.equal(recovery.safeDetails["reason"], "job_terminal");
  assert.equal(recovery.safeDetails["source"], "scheduler");

  // 回退后本轮不立刻重试（"下一轮接手"），因此本轮不再入队
  assert.equal(h.state.enqueueCalls.length, 0);
});

test("running + 作业不存在 → 回退 failed_retryable（reason=job_missing）", async () => {
  const h = harness({
    running: [requirement({ pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
    latestAnalysisVersion: { "req-1": 0 },
  });
  const report = await h.run();
  assert.equal(report.recovered[0]?.action, "reverted");
  assert.equal(report.recovered[0]?.reason, "job_missing");
  assert.equal(h.state.events[0]?.safeDetails["reason"], "job_missing");
});

test("running + 作业租约未过期 → 不动", async () => {
  const runningJob = job({
    status: "running", attemptCount: 1, lockedUntil: new Date(NOW.getTime() + 60_000).toISOString(),
  });
  const h = harness({
    running: [requirement({ pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
    latestAnalysisVersion: { "req-1": 1 },
    jobs: { "analysis:req-1:sv3:after0": runningJob },
  });
  const report = await h.run();
  assert.equal(report.recovered[0]?.action, "skipped");
  assert.equal(report.recovered[0]?.reason, "job_live");
  assert.equal(h.state.stateUpdates.length, 0);
  assert.equal(h.state.events.length, 0);
  assert.equal(h.state.completions.length, 0);
});

test("running + 首轮同步链路的活作业（analysis:<id>:v<sv>）→ 不动，避免误判崩溃", async () => {
  // handler 正在跑首轮分析：最新分析版本已是 1，但作业键仍是同步链路的 v<sourceVersion>。
  for (const status of ["queued", "running"] as const) {
    const h = harness({
      running: [requirement({ pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
      latestAnalysisVersion: { "req-1": 1 },
      jobs: {
        "analysis:req-1:v3": job({
          status, dedupeKey: "analysis:req-1:v3",
          ...(status === "running" ? { attemptCount: 1, lockedUntil: new Date(NOW.getTime() + 60_000).toISOString() } : {}),
        }),
      },
    });
    const report = await h.run();
    assert.equal(report.recovered[0]?.action, "skipped", status);
    assert.equal(h.state.stateUpdates.length, 0, `${status} 的首轮作业仍在跑，不能回退`);
  }
});

test("running + 租约过期但尝试次数未用尽 → 不动（worker 会重新认领）", async () => {
  const h = harness({
    running: [requirement({ pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
    latestAnalysisVersion: { "req-1": 0 },
    jobs: {
      "analysis:req-1:sv3:after0": job({
        status: "running", attemptCount: 2, maxAttempts: 5,
        lockedUntil: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    },
  });
  const report = await h.run();
  assert.equal(report.recovered[0]?.reason, "job_live");
  assert.equal(h.state.stateUpdates.length, 0);
});

test("running + 租约过期且尝试次数用尽 → 终结僵尸作业并回退", async () => {
  const h = harness({
    running: [requirement({ pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
    latestAnalysisVersion: { "req-1": 0 },
    jobs: {
      "analysis:req-1:sv3:after0": job({
        status: "running", attemptCount: 5, maxAttempts: 5,
        lockedUntil: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    },
  });
  const report = await h.run();
  assert.equal(report.recovered[0]?.action, "reverted");
  assert.equal(report.recovered[0]?.reason, "job_terminal");
  assert.deepEqual(h.state.completions, [{ id: "job-1", expectedAttempt: 5, status: "failed" }]);
  assert.equal(h.state.jobs.get("analysis:req-1:sv3:after0")?.status, "failed");
  assert.deepEqual(h.state.stateUpdates, [{ id: "req-1", to: "failed_retryable" }]);
});

test("僵尸作业在被回收前被其他实例认领（fencing 拒绝）→ 不回退需求状态", async () => {
  const h = harness({
    running: [requirement({ pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
    latestAnalysisVersion: { "req-1": 0 },
    jobs: {
      "analysis:req-1:sv3:after0": job({
        status: "running", attemptCount: 5, maxAttempts: 5,
        lockedUntil: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    },
    completeRejects: true,
  });
  const report = await h.run();
  assert.equal(report.recovered[0]?.action, "skipped");
  assert.equal(report.recovered[0]?.reason, "job_reclaimed");
  assert.equal(h.state.stateUpdates.length, 0);
  assert.equal(h.state.completions.length, 1, "仍应先尝试用 fencing 回收僵尸作业");
});

test("running 阶段查询异常时记录错误，但不阻断 failed_retryable 重试", async () => {
  const h = harness({
    failed: [requirement()],
    running: [requirement({ id: "req-running", pipeline: { pull: "synced", analysis: "running", owner: "pending_mapping", push: "pending" } })],
    latestAnalysisVersion: { "req-1": 2, "req-running": 0 },
    searchErrors: new Set(["running"]),
  });
  const report = await h.run();
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0] ?? "", /running recovery phase/);
  assert.equal(report.retried[0]?.action, "enqueued", "running 阶段失败不能阻断重试阶段");
  assert.equal(h.state.enqueueCalls.length, 1);
});

test("单个需求入队异常时记录错误并继续处理下一条", async () => {
  const h = harness({
    failed: [requirement(), requirement({ id: "req-2", teambitionRequirementId: "tb-2" })],
    latestAnalysisVersion: { "req-1": 1, "req-2": 1 },
    enqueueErrors: new Set(["req-1"]),
  });
  const report = await h.run();
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0] ?? "", /req-1/);
  assert.equal(report.retried.length, 1, "入队失败的需求不应产出 enqueued 结果");
  assert.equal(report.retried[0]?.requirementId, "req-2");
  assert.equal(report.retried[0]?.action, "enqueued");
  assert.equal(h.state.enqueueCalls.length, 2);
  // 入队失败留一条 failed 审计但不占重试预算（预算只数 succeeded）
  const failedAudit = h.state.events.find((event) => event.result === "failed");
  assert.equal(failedAudit?.safeDetails["analysisStatus"], "enqueue_failed");
});

test("作业键助手覆盖重试键、上一版本键与首轮同步键", () => {
  const req = requirement();
  assert.deepEqual(analysisRunningJobKeys(req, 0), [
    "analysis:req-1:sv3:after0",
    "analysis:req-1:v3",
  ]);
  assert.deepEqual(analysisRunningJobKeys(req, 2), [
    "analysis:req-1:sv3:after2",
    "analysis:req-1:sv3:after1",
    "analysis:req-1:v3",
  ]);
  assert.equal(analysisRetryDedupeKey(req, 2), "analysis:req-1:sv3:after2");
});
