import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineJobRecord } from "../domain/persistence.js";
import type { PipelineJobRepository } from "../application/repositories.js";
import type { SyncJobRunner } from "../sync/service.js";
import { PipelineJobWorker } from "./worker.js";
import { assertFixtureWorkAllowed, FixturePolicyError } from "../sync/test-fixture.js";

const NOW = "2026-10-08T00:00:00.000Z";
function job(overrides: Partial<PipelineJobRecord> = {}): PipelineJobRecord {
  return {
    id: "job-1", jobType: "sync", dedupeKey: "sync:key", payload: { batchId: "batch-1", sourceId: "source-1", triggerType: "manual", actorId: null },
    status: "running", attemptCount: 1, maxAttempts: 4, availableAt: NOW, lockedUntil: "2026-10-08T00:01:00.000Z",
    lastErrorCode: null, lastErrorSummary: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}
function harness(next: PipelineJobRecord | null, options: { syncResult?: { batchId: string; status: string; totalCount: number; succeededCount: number; failedCount: number }; handlerError?: Error } = {}) {
  const calls: unknown[] = [];
  const jobs: PipelineJobRepository = {
    async enqueue() { throw new Error("unused"); },
    async claimNext(workerId, leaseMs, now) { calls.push(["claim", workerId, leaseMs, now]); return next; },
    async reschedule(id, params) { calls.push(["reschedule", id, params]); return job({ ...next!, status: "queued" }); },
    async complete(id, result) { calls.push(["complete", id, result]); return job({ ...next!, status: result.status === "failed" ? "queued" : result.status }); },
  };
  const sync = (async (input: unknown) => { calls.push(["sync", input]); if (options.handlerError) throw options.handlerError; return options.syncResult ?? { batchId: "batch-1", status: "succeeded", totalCount: 1, succeededCount: 1, failedCount: 0 }; }) as unknown as SyncJobRunner;
  return { calls, jobs, sync };
}

test("worker claims one due job and dispatches sync using the existing orchestrator", async () => {
  const h = harness(job());
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  const result = await worker.runOnce();
  assert.equal(result.kind, "succeeded");
  assert.deepEqual(h.calls.map((call) => (call as unknown[])[0]), ["claim", "sync", "complete"]);
  assert.deepEqual(h.calls[1], ["sync", { batchId: "batch-1", sourceConfigId: "source-1", trigger: "manual", actorId: null, mode: "full_pipeline" }]);
  assert.deepEqual((h.calls[2] as unknown[])[2], { expectedAttempt: 1, status: "succeeded", now: NOW });
});

test("worker preserves the explicit source-only mode for a manual import", async () => {
  const h = harness(job({ payload: { batchId: "batch-1", sourceId: "source-1", triggerType: "manual", actorId: null, mode: "source_only" } }));
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.equal((await worker.runOnce()).kind, "succeeded");
  assert.deepEqual(h.calls[1], ["sync", { batchId: "batch-1", sourceConfigId: "source-1", trigger: "manual", actorId: null, mode: "source_only" }]);
});

test("worker preserves the explicit scheduled fixture marker for the safe sync reader", async () => {
  const h = harness(job({ payload: { batchId: "batch-1", sourceId: "source-1", triggerType: "scheduled", actorId: null, testFixture: true } }));
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.equal((await worker.runOnce()).kind, "succeeded");
  assert.deepEqual(h.calls[1], ["sync", { batchId: "batch-1", sourceConfigId: "source-1", trigger: "scheduled", actorId: null, mode: "full_pipeline", testFixture: true }]);
});

test("迟到的 worker 结果被 fencing 拒绝：不覆盖新认领者的状态（不变量，工单 15）", async () => {
  const calls: unknown[] = [];
  const claimedJob = job();
  const jobs: PipelineJobRepository = {
    async enqueue() { throw new Error("unused"); },
    async claimNext(workerId, leaseMs, now) { calls.push(["claim", workerId, leaseMs, now]); return claimedJob; },
    async reschedule(id, params) { calls.push(["reschedule", id, params]); return claimedJob; },
    // 模拟租约已被新 worker 重新认领（attempt 已推进）：本 worker 迟到的 complete 被 fencing 拒绝返回 null
    async complete(id, result) { calls.push(["complete", id, result]); return null; },
  };
  const sync = (async (input: unknown) => { calls.push(["sync", input]); return { batchId: "batch-1", status: "succeeded", totalCount: 1, succeededCount: 1, failedCount: 0 }; }) as unknown as SyncJobRunner;
  const worker = new PipelineJobWorker({ jobs, sync, workerId: "stale-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.equal((await worker.runOnce()).kind, "failed");
  assert.deepEqual(calls.map((call) => (call as unknown[])[0]), ["claim", "sync", "complete"]);
  // complete 携带认领时的 attempt 作为 fencing 令牌
  assert.deepEqual((calls[2] as unknown[])[2], { expectedAttempt: 1, status: "succeeded", now: NOW });
});

test("worker leaves the queue untouched when no job is claimable", async () => {
  const h = harness(null);
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.deepEqual(await worker.runOnce(), { kind: "idle" });
  assert.deepEqual(h.calls.map((call) => (call as unknown[])[0]), ["claim"]);
});

test("不变量4：retryable failure reschedules with bounded stage backoff and a safe summary", async () => {
  const h = harness(job(), { handlerError: new Error("secret token and provider response") });
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  const result = await worker.runOnce();
  assert.deepEqual(result, { kind: "failed", jobId: "job-1" });
  // attemptCount 1 < maxAttempts 4 → 重排而非终态
  assert.deepEqual(h.calls.map((call) => (call as unknown[])[0]), ["claim", "sync", "reschedule"]);
  const params = (h.calls[2] as unknown[])[2] as Record<string, unknown>;
  // sync → pull 阶段，下一次尝试为第 2 次 → 退避 2000ms（有界、确定）
  assert.deepEqual(params, { expectedAttempt: 1, backoffMs: 2_000, errorCode: "worker_handler_failed", errorSummary: "Job handler failed; scheduled for retry.", now: NOW });
  assert.equal(JSON.stringify(params).includes("secret"), false);
});

test("不变量4：max attempts reached completes the job as failed terminal", async () => {
  const h = harness(job({ attemptCount: 4, maxAttempts: 4 }), { handlerError: new Error("boom") });
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  const result = await worker.runOnce();
  assert.deepEqual(result, { kind: "failed", jobId: "job-1" });
  assert.deepEqual(h.calls.map((call) => (call as unknown[])[0]), ["claim", "sync", "complete"]);
  const completion = (h.calls[2] as unknown[])[2] as Record<string, unknown>;
  assert.equal(completion.status, "failed");
  assert.equal(completion.errorCode, "max_attempts_reached");
});

test("fixture policy denial is terminal and never schedules an unsafe retry", async () => {
  const h = harness(job(), { handlerError: new FixturePolicyError("Unsafe fixture target") });
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.equal((await worker.runOnce()).kind, "failed");
  assert.deepEqual(h.calls.map((call) => (call as unknown[])[0]), ["claim", "sync", "complete"]);
  assert.equal(((h.calls.at(-1) as unknown[])[2] as Record<string, unknown>).errorCode, "fixture_policy_denied");
});

test("fixture rejection persists a bounded reason without disclosing environment values", async () => {
  let policyError: Error | undefined;
  try {
    assertFixtureWorkAllowed({ sourceId: "source-1", fixture: true }, {
      RQSYS_ENABLE_TEST_FIXTURES: "true", BASE_APP_TOKEN: "secret-formal-base", BASE_TABLE_ID: "private-table",
    }, new Date(NOW));
  } catch (error) { policyError = error as Error; }
  assert.ok(policyError instanceof FixturePolicyError);
  const h = harness(job(), { handlerError: policyError });
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "worker", leaseMs: 30_000, now: () => new Date(NOW) });
  await worker.runOnce();
  const result = (h.calls.at(-1) as unknown[])[2] as Record<string, unknown>;
  assert.match(String(result.errorSummary), /base_app_not_poc/);
  assert.equal(JSON.stringify(result).includes("secret-formal-base"), false);
  assert.equal(JSON.stringify(result).includes("private-table"), false);
});

test("partial_failure sync is retryable; job types without a handler fail closed (terminal)", async () => {
  const partial = harness(job(), { syncResult: { batchId: "batch-1", status: "partial_failure", totalCount: 2, succeededCount: 1, failedCount: 1 } });
  const worker = new PipelineJobWorker({ jobs: partial.jobs, sync: partial.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.deepEqual(await worker.runOnce(), { kind: "failed", jobId: "job-1" });
  assert.equal((partial.calls.at(-1) as unknown[])[0], "reschedule"); // 重排回 queued（退避推迟）

  const unsupportedJob = job({ jobType: "analysis" });
  const unsupported = harness(unsupportedJob);
  const closed = new PipelineJobWorker({ jobs: unsupported.jobs, sync: unsupported.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.deepEqual(await closed.runOnce(), { kind: "failed", jobId: "job-1" });
  assert.equal(unsupported.calls.some((call) => (call as unknown[])[0] === "sync"), false);
  // 永久错误（无 handler）终态，不重排
  assert.deepEqual(unsupported.calls.map((call) => (call as unknown[])[0]), ["claim", "complete"]);
  assert.equal(((unsupported.calls.at(-1) as unknown[])[2] as Record<string, unknown>).errorCode, "unsupported_job_type");
  // 非 sync 作业不碰批次
  assert.equal(((unsupported.calls.at(-1) as unknown[])[2] as Record<string, unknown>).settleSyncBatch, undefined);
});

test("sync 作业的任意终态失败都收敛批次，不留下永久 running 的孤儿批次", async () => {
  // 回归：此前只在 FixturePolicyError 时传 settleSyncBatch。网关 5xx / 网络 / 数据库
  // 异常走到终态 failed 时批次不被收敛，永远停在 running，后续同步被并发守卫拒绝（409），
  // 只能手工改库恢复。这里用一个普通错误（非夹具策略错误）覆盖该路径。
  const h = harness(job({ attemptCount: 4, maxAttempts: 4 }), { handlerError: new Error("gateway 503") });
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });

  assert.deepEqual(await worker.runOnce(), { kind: "failed", jobId: "job-1" });
  const terminal = h.calls.at(-1) as unknown[];
  assert.equal(terminal[0], "complete");
  const payload = terminal[2] as Record<string, unknown>;
  assert.equal(payload.status, "failed");
  assert.equal(payload.errorCode, "max_attempts_reached");
  assert.equal(payload.settleSyncBatch, true);
});

test("夹具策略拒绝仍然收敛批次（原有行为不回退）", async () => {
  let policyError: Error | undefined;
  try {
    assertFixtureWorkAllowed({ sourceId: "source-1", fixture: true }, { RQSYS_ENABLE_TEST_FIXTURES: "true", BASE_APP_TOKEN: "formal" }, new Date(NOW));
  } catch (error) { policyError = error as Error; }
  assert.ok(policyError instanceof FixturePolicyError);
  const h = harness(job(), { handlerError: policyError });
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "worker", leaseMs: 30_000, now: () => new Date(NOW) });
  await worker.runOnce();
  const payload = (h.calls.at(-1) as unknown[])[2] as Record<string, unknown>;
  assert.equal(payload.errorCode, "fixture_policy_denied");
  assert.equal(payload.settleSyncBatch, true);
});

test("dispatch 期间按租约 1/3 周期续约，长任务不会被重复认领", async () => {
  // 此前 30s 租约且无心跳：314 条同步或限流 Base 批量必然超时，另一个实例可重复认领，
  // 产生重复 AI 调用/Base 写入（fencing 只保护最终写入）。
  const renewals: Array<{ expectedAttempt: number; leaseMs: number }> = [];
  const jobs = {
    async enqueue() { throw new Error("unused"); },
    async claimNext() { return job(); },
    async reschedule() { throw new Error("unused"); },
    async complete() { return job({ status: "queued" }); },
    async renewLease(_id: string, p: { expectedAttempt: number; leaseMs: number }) { renewals.push(p); return true; },
  };
  const slowSync = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { batchId: "batch-1", status: "succeeded", totalCount: 1, succeededCount: 1, failedCount: 0 };
  }) as never;
  const worker = new PipelineJobWorker({ jobs: jobs as never, sync: slowSync, workerId: "worker", leaseMs: 300 });
  assert.equal((await worker.runOnce()).kind, "succeeded");
  assert.ok(renewals.length >= 2, `期望至少 2 次续约，实际 ${renewals.length}`);
  assert.equal(renewals[0]?.expectedAttempt, 1);
  assert.equal(renewals[0]?.leaseMs, 300);
});

test("续约被拒（租约已易主）后停止续约，不覆盖他人结果", async () => {
  let calls = 0;
  const jobs = {
    async enqueue() { throw new Error("unused"); },
    async claimNext() { return job(); },
    async reschedule() { throw new Error("unused"); },
    async complete() { return job({ status: "queued" }); },
    async renewLease() { calls += 1; return false; },
  };
  const slowSync = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { batchId: "batch-1", status: "succeeded", totalCount: 1, succeededCount: 1, failedCount: 0 };
  }) as never;
  const worker = new PipelineJobWorker({ jobs: jobs as never, sync: slowSync, workerId: "worker", leaseMs: 300 });
  await worker.runOnce();
  assert.ok(calls <= 2, `拒绝后应停止续约，实际调用 ${calls} 次`);
});
