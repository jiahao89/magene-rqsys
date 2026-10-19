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
  const completedJobs: Array<{ id: string; expectedAttempt: number; status: string; settleSyncBatch?: boolean; errorCode?: string }> = [];
  return {
    settled,
    completedJobs,
    deps: {
      batches: {
        async list() { return { items: input.batches, nextCursor: null }; },
        async complete(id: string, result: { status: string; errorSummary: string | null }) {
          settled.push({ id, status: result.status, errorSummary: result.errorSummary });
          return { ...batch({ id }), status: result.status } as SyncBatchRecord;
        },
      },
      jobs: {
        async findByDedupeKey(key: string) { return input.jobs[key] ?? null; },
        async complete(id: string, result: { expectedAttempt: number; status: string; settleSyncBatch?: boolean; errorCode?: string }) {
          completedJobs.push({ id, expectedAttempt: result.expectedAttempt, status: result.status, ...(result.settleSyncBatch === undefined ? {} : { settleSyncBatch: result.settleSyncBatch }), ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }) });
          return job({ id, status: "failed", attemptCount: result.expectedAttempt });
        },
      },
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

test("手动路径的作业键（sync:<sourceId>:<key>）也能找到作业，不误杀健康批次", async () => {
  // 回归：早期 reap 只查 `sync:<batchId>`，而手动作业用的是 `sync:<sourceId>:<idempotencyKey>`。
  // 只查一种会把健康的手动批次判成"作业不存在"，标记 failed 后并发守卫又会放行第二个同步。
  const b = batch();
  const h = harness({
    batches: [b],
    jobs: {
      [`sync:${b.sourceConfigId}:${b.idempotencyKey}`]: job({ status: "running", dedupeKey: `sync:${b.sourceConfigId}:${b.idempotencyKey}` }),
    },
  });
  const reaped = await reapOrphanedBatches(h.deps as never);
  assert.equal(reaped.length, 0, "作业仍在 running 且未用尽尝试，不应被回收");
  assert.equal(h.settled.length, 0);
});

test("running 且尝试用尽、租约过期 → 原子收敛（complete + settleSyncBatch）", async () => {
  // 这是 BLOCKER 情形：claimNext 要求 attempt_count < max_attempts，complete 要求进程活着且 attempt 匹配。
  // worker 在第 5 次尝试中途死亡后，作业既不能被认领也不能被收尾，批次永久 running → 来源永久 409。
  const b = batch();
  const h = harness({
    batches: [b],
    jobs: {
      [`sync:${b.id}`]: job({ status: "running", attemptCount: 5, maxAttempts: 5, lockedUntil: "2026-01-01T11:00:00.000Z" }),
    },
  });
  const reaped = await reapOrphanedBatches(h.deps as never);
  assert.equal(reaped.length, 1);
  assert.equal(reaped[0]?.reason, "sync job exhausted");
  assert.equal(h.completedJobs.length, 1);
  assert.equal(h.completedJobs[0]?.expectedAttempt, 5);
  assert.equal(h.completedJobs[0]?.status, "failed");
  assert.equal(h.completedJobs[0]?.errorCode, "lease_expired");
  assert.equal(h.completedJobs[0]?.settleSyncBatch, true, "必须用同一条 CTE 原子收敛批次，避免两步之间再留孤儿");
});

test("尝试用尽但租约尚未过期 → 放过（可能仍有活着的 worker 在收尾）", async () => {
  const b = batch();
  const h = harness({
    batches: [b],
    jobs: {
      [`sync:${b.id}`]: job({ status: "running", attemptCount: 5, maxAttempts: 5, lockedUntil: "2026-01-01T12:30:00.000Z" }),
    },
  });
  const reaped = await reapOrphanedBatches(h.deps as never);
  assert.equal(reaped.length, 0);
  assert.equal(h.completedJobs.length, 0);
});
