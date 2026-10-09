import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineJobRecord } from "../domain/persistence.js";
import type { PipelineJobRepository } from "../application/repositories.js";
import type { SyncJobRunner, SyncResult } from "../sync/service.js";
import { PipelineJobWorker } from "./worker.js";

const NOW = "2026-10-08T00:00:00.000Z";
function job(overrides: Partial<PipelineJobRecord> = {}): PipelineJobRecord {
  return {
    id: "job-1", jobType: "sync", dedupeKey: "sync:key", payload: { batchId: "batch-1", sourceId: "source-1", triggerType: "manual", actorId: null },
    status: "running", attemptCount: 1, maxAttempts: 4, availableAt: NOW, lockedUntil: "2026-10-08T00:01:00.000Z",
    lastErrorCode: null, lastErrorSummary: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}
function harness(next: PipelineJobRecord | null, options: { syncResult?: SyncResult; handlerError?: Error } = {}) {
  const calls: unknown[] = [];
  const jobs: PipelineJobRepository = {
    async enqueue() { throw new Error("unused"); },
    async claimNext(workerId, leaseMs, now) { calls.push(["claim", workerId, leaseMs, now]); return next; },
    async complete(id, result) { calls.push(["complete", id, result]); return job({ ...next!, status: result.status === "failed" ? "queued" : result.status }); },
  };
  const sync: SyncJobRunner = async (input) => { calls.push(["sync", input]); if (options.handlerError) throw options.handlerError; return options.syncResult ?? { batchId: "batch-1", status: "succeeded", totalCount: 1, succeededCount: 1, failedCount: 0 }; };
  return { calls, jobs, sync };
}

test("worker claims one due job and dispatches sync using the existing orchestrator", async () => {
  const h = harness(job());
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  const result = await worker.runOnce();
  assert.equal(result.kind, "succeeded");
  assert.deepEqual(h.calls.map((call) => (call as unknown[])[0]), ["claim", "sync", "complete"]);
  assert.deepEqual(h.calls[1], ["sync", { batchId: "batch-1", sourceConfigId: "source-1", trigger: "manual", actorId: null }]);
  assert.deepEqual((h.calls[2] as unknown[])[2], { status: "succeeded", now: NOW });
});

test("worker leaves the queue untouched when no job is claimable", async () => {
  const h = harness(null);
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.deepEqual(await worker.runOnce(), { kind: "idle" });
  assert.deepEqual(h.calls.map((call) => (call as unknown[])[0]), ["claim"]);
});

test("retryable sync failure is safely summarized and completed as failed", async () => {
  const h = harness(job(), { handlerError: new Error("secret token and provider response") });
  const worker = new PipelineJobWorker({ jobs: h.jobs, sync: h.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  const result = await worker.runOnce();
  assert.deepEqual(result, { kind: "failed", jobId: "job-1" });
  const completion = (h.calls.at(-1) as unknown[])[2] as Record<string, unknown>;
  assert.deepEqual(completion, { status: "failed", errorCode: "worker_handler_failed", errorSummary: "Job handler failed; retry is available.", now: NOW });
  assert.equal(JSON.stringify(completion).includes("secret"), false);
});

test("failed partial sync is retryable and job types without a registered handler fail closed", async () => {
  const partial = harness(job(), { syncResult: { batchId: "batch-1", status: "partial_failure", totalCount: 2, succeededCount: 1, failedCount: 1 } });
  const worker = new PipelineJobWorker({ jobs: partial.jobs, sync: partial.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.deepEqual(await worker.runOnce(), { kind: "failed", jobId: "job-1" });
  assert.equal(((partial.calls.at(-1) as unknown[])[2] as Record<string, unknown>).status, "failed");

  const unsupportedJob = job({ jobType: "analysis" });
  const unsupported = harness(unsupportedJob);
  const closed = new PipelineJobWorker({ jobs: unsupported.jobs, sync: unsupported.sync, workerId: "local-worker", leaseMs: 30_000, now: () => new Date(NOW) });
  assert.deepEqual(await closed.runOnce(), { kind: "failed", jobId: "job-1" });
  assert.equal(unsupported.calls.some((call) => (call as unknown[])[0] === "sync"), false);
  assert.equal(((unsupported.calls.at(-1) as unknown[])[2] as Record<string, unknown>).errorCode, "unsupported_job_type");
});
