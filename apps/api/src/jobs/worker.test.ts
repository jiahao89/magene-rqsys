import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineJobRecord } from "../domain/persistence.js";
import type { PipelineJobRepository } from "../application/repositories.js";
import type { SyncJobRunner } from "../sync/service.js";
import { PipelineJobWorker } from "./worker.js";

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
  assert.deepEqual(h.calls[1], ["sync", { batchId: "batch-1", sourceConfigId: "source-1", trigger: "manual", actorId: null }]);
  assert.deepEqual((h.calls[2] as unknown[])[2], { expectedAttempt: 1, status: "succeeded", now: NOW });
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
});
