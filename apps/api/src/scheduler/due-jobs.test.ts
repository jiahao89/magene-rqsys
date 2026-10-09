import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConfigRecord, SyncBatchRecord } from "../domain/persistence.js";
import { createDueSyncJobs } from "./due-jobs.js";

const NOW = new Date("2026-01-01T10:00:00.000Z");

function source(overrides?: Partial<SourceConfigRecord>): SourceConfigRecord {
  return {
    id: "src-1", provider: "teambition", externalProjectId: "p1", externalProjectName: "P",
    requirementTypeId: "t1", enabled: true, scheduleEnabled: true, scheduleWeekday: null,
    scheduleLocalTime: "08:00", scheduleTimezone: "UTC", ownerNames: [], fieldMap: {},
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function harness(sources: SourceConfigRecord[]) {
  const calls: unknown[] = [];
  const batches = new Map<string, SyncBatchRecord>();
  const repos = {
    sources: { list: async () => sources },
    batches: {
      async create(p: { sourceConfigId: string; idempotencyKey: string; startedAt: string; triggerType: string; actorId: string | null }) {
        calls.push(["batch.create", p.idempotencyKey]);
        const existing = [...batches.values()].find((b) => b.idempotencyKey === p.idempotencyKey);
        if (existing) return existing;
        const batch: SyncBatchRecord = {
          id: `batch-${batches.size + 1}`, sourceConfigId: p.sourceConfigId, triggerType: p.triggerType as "scheduled",
          actorId: p.actorId, idempotencyKey: p.idempotencyKey, status: "running",
          startedAt: p.startedAt, completedAt: null, totalCount: 0, succeededCount: 0, failedCount: 0,
          errorSummary: null, createdAt: p.startedAt,
        };
        batches.set(batch.id, batch);
        return batch;
      },
    },
    jobs: {
      async enqueue(p: { dedupeKey: string }) { calls.push(["job.enqueue", p.dedupeKey]); return p as never; },
    },
  };
  return { calls, repos, batchKeys: () => [...batches.values()].map((b) => b.idempotencyKey) };
}

test("不变量1：同一调度窗口的重复触发不创建重复批次/任务（幂等键按窗口）", async () => {
  const h = harness([source()]);
  const deps = { sources: h.repos.sources as never, batches: h.repos.batches as never, jobs: h.repos.jobs as never, now: NOW };

  const first = await createDueSyncJobs(deps);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.enabled, true);
  assert.ok(first[0]?.batchId);
  assert.equal(first[0]?.window, "2026-01-01T08:00:00.000Z");

  const second = await createDueSyncJobs(deps);
  assert.equal(second[0]?.batchId, first[0]?.batchId); // 同窗口复用同一批次
  // 幂等键/任务键只出现一次
  assert.equal(h.calls.filter((c) => (c as unknown[])[0] === "batch.create").length, 2); // create 被调用但返回既有批次
  assert.equal(h.batchKeys().length, 1); // 只有一个批次
});

test("不变量6：调度计算按显式时区执行（UTC 08:00）", async () => {
  const h = harness([source({ scheduleTimezone: "Asia/Shanghai" })]);
  const outcomes = await createDueSyncJobs({ sources: h.repos.sources as never, batches: h.repos.batches as never, jobs: h.repos.jobs as never, now: NOW });
  // 08:00 上海 = 00:00 UTC
  assert.equal(outcomes[0]?.window, "2026-01-01T00:00:00.000Z");
});

test("未启用/未配置调度的来源跳过", async () => {
  const disabled = harness([source({ enabled: false }), source({ scheduleEnabled: false }), source({ scheduleLocalTime: null })]);
  const outcomes = await createDueSyncJobs({ sources: disabled.repos.sources as never, batches: disabled.repos.batches as never, jobs: disabled.repos.jobs as never, now: NOW });
  assert.equal(outcomes.length, 3);
  assert.ok(outcomes.every((o) => o.batchId === null && o.window === null));
  assert.equal(disabled.calls.length, 0); // 无批次/任务创建
});
