import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineJobRecord, SyncBatchRecord } from "../domain/persistence.js";
import { reapOrphanedBatches } from "./reap.js";

const NOW = new Date("2026-01-01T12:00:00.000Z");

function batch(overrides: Partial<SyncBatchRecord> = {}): SyncBatchRecord {
  return {
    id: "batch-1", sourceConfigId: "src-1", triggerType: "scheduled", actorId: null,
    idempotencyKey: "sched:src-1:_batch_:x", status: "running",
    startedAt: "2026-01-01T11:00:00.000Z", completedAt: null,
    totalCount: 0, succeededCount: 0, failedCount: 0, errorSummary: null,
    createdAt: "2026-01-01T11:00:00.000Z", ...overrides,
  };
}

function job(overrides: Partial<PipelineJobRecord> = {}): PipelineJobRecord {
  return {
    id: "job-1", jobType: "sync", dedupeKey: "sync:batch-1", payload: { batchId: "batch-1" },
    status: "queued", attemptCount: 0, maxAttempts: 5,
    availableAt: "2026-01-01T11:00:00.000Z", lockedUntil: null,
    lastErrorCode: null, lastErrorSummary: null,
    createdAt: "2026-01-01T11:00:00.000Z", updatedAt: "2026-01-01T11:00:00.000Z", ...overrides,
  };
}

function harness(input: { batches: SyncBatchRecord[]; jobs: Record<string, PipelineJobRecord | null> }) {
  const settled: Array<{ id: string; status: string; errorSummary: string | null }> = [];
  return {
    settled,
    deps: {
      batches: {
        async list() { return { items: input.batches, nextCursor: null }; },
        async complete(id: string, result: { status: string; errorSummary: string | null }) {
          settled.push({ id, status: result.status, errorSummary: result.errorSummary });
          return { ...batch({ id }), status: result.status } as SyncBatchRecord;
        },
      },
      jobs: { async findByDedupeKey(key: string) { return input.jobs[key] ?? null; } },
      now: NOW,
    },
  };
}

test("作业不存在且批次已过最小年龄 → 回收为 failed", async () => {
  const h = harness({ batches: [batch()], jobs: {} });
  const reaped = await reapOrphanedBatches(h.deps as never);
  assert.equal(reaped.length, 1);
  assert.equal(reaped[0]?.reason, "sync job missing");
  assert.equal(h.settled[0]?.id, "batch-1");
  assert.equal(h.settled[0]?.status, "failed");
});

test("作业已终态但批次仍 running → 回收（收敛机会已过去）", async () => {
  const h = harness({ batches: [batch()], jobs: { "sync:batch-1": job({ status: "failed" }) } });
  const reaped = await reapOrphanedBatches(h.deps as never);
  assert.equal(reaped[0]?.reason, "sync job terminal");
  assert.equal(h.settled.length, 1);
});

test("作业仍在 queued/running → 不动它（租约机制会接管）", async () => {
  for (const status of ["queued", "running"] as const) {
    const h = harness({ batches: [batch()], jobs: { "sync:batch-1": job({ status }) } });
    const reaped = await reapOrphanedBatches(h.deps as never);
    assert.equal(reaped.length, 0, `${status} 不应被回收`);
    assert.equal(h.settled.length, 0);
  }
});

test("未过最小年龄的批次放过，避免误杀刚建好、作业尚未入队的批次", async () => {
  // 批次创建与作业入队之间存在正常间隙，此时作业确实还不存在
  const fresh = batch({ startedAt: new Date(NOW.getTime() - 30_000).toISOString() });
  const h = harness({ batches: [fresh], jobs: {} });
  const reaped = await reapOrphanedBatches(h.deps as never);
  assert.equal(reaped.length, 0);
  assert.equal(h.settled.length, 0);
});

test("只扫描 running 批次", async () => {
  let askedStatus: string | undefined;
  const deps = {
    batches: {
      async list(query: { status?: string }) { askedStatus = query.status; return { items: [], nextCursor: null }; },
      async complete() { return null; },
    },
    jobs: { async findByDedupeKey() { return null; } },
    now: NOW,
  };
  await reapOrphanedBatches(deps as never);
  assert.equal(askedStatus, "running");
});
