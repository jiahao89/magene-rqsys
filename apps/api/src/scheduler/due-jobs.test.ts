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
      async findByIdempotencyKey(_sourceConfigId: string, key: string) {
        return [...batches.values()].find((b) => b.idempotencyKey === key) ?? null;
      },
      async complete(id: string, result: { status: string; errorSummary: string | null }) {
        calls.push(["batch.complete", id, result.status]);
        const batch = batches.get(id);
        if (!batch) return null;
        const next = { ...batch, status: result.status as SyncBatchRecord["status"], errorSummary: result.errorSummary } satisfies SyncBatchRecord;
        batches.set(id, next);
        return next;
      },
    },
    jobs: {
      async enqueue(p: { dedupeKey: string }) { calls.push(["job.enqueue", p.dedupeKey]); return p as never; },
    },
  };
  return {
    calls, repos, batches,
    batchKeys: () => [...batches.values()].map((b) => b.idempotencyKey),
    batchStatus: (id: string) => batches.get(id)?.status,
  };
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

test("定时合成验收只调度指定来源，并隔离正式窗口幂等键", async () => {
  const h = harness([source({ id: "other-source" }), source()]);
  const queued: Array<{ dedupeKey: string; payload: Record<string, unknown> }> = [];
  const params = {
    sources: h.repos.sources as never,
    batches: h.repos.batches as never,
    jobs: { async enqueue(input: { dedupeKey: string; payload: Record<string, unknown> }) { queued.push(input); return input; } } as never,
    now: NOW,
    fixtureSourceId: "src-1",
  };
  const first = await createDueSyncJobs(params);
  const replay = await createDueSyncJobs(params);

  assert.deepEqual(h.batchKeys(), ["fixture-sched:src-1:_batch_:2026-01-01T08:00:00.000Z"]);
  assert.equal(first.find((row) => row.sourceConfigId === "other-source")?.batchId, null);
  assert.equal(replay.find((row) => row.sourceConfigId === "src-1")?.batchId, "batch-1");
  assert.ok(queued.every((row) => row.payload.testFixture === true && row.payload.sourceId === "src-1"));
});

test("合成来源不存在时，在其他来源入队前失败", async () => {
  const h = harness([source()]);
  const params = { sources: h.repos.sources as never, batches: h.repos.batches as never, jobs: h.repos.jobs as never, now: NOW, fixtureSourceId: "missing-source" };
  await assert.rejects(createDueSyncJobs(params), /fixture source was not found/);
  assert.equal(h.calls.length, 0);
});

test("单个来源入队失败不中断其他来源，且不留孤儿批次", async () => {
  // src-1 入队抛错，src-2 正常。此前一次抛错会让整个 tick 失败并把批次永远留在 running。
  const h = harness([source({ id: "src-1" }), source({ id: "src-2" })]);
  const deps = {
    sources: h.repos.sources as never,
    batches: h.repos.batches as never,
    jobs: {
      async enqueue(p: { dedupeKey: string; payload: Record<string, unknown> }) {
        if (p.payload.sourceId === "src-1") throw new Error("enqueue exploded");
        return p;
      },
    } as never,
    now: NOW,
  };

  const outcomes = await createDueSyncJobs(deps);

  // 两个来源都被处理：失败的那个有 error，另一个照常排队
  assert.equal(outcomes.length, 2);
  const failed = outcomes.find((o) => o.sourceConfigId === "src-1");
  const ok = outcomes.find((o) => o.sourceConfigId === "src-2");
  assert.equal(failed?.error, "enqueue exploded");
  assert.ok(ok?.batchId && !ok.error);

  // 失败来源的新建批次被就地收尾为 failed，不会阻塞后续同步（并发守卫 409）
  assert.equal(h.batchStatus(failed!.batchId!), "failed");
  assert.equal(h.batchStatus(ok!.batchId!), "running");
});

test("复用既有批次时入队失败不覆盖该批次状态", async () => {
  // 同窗口第二次触发复用既有批次：它可能已有在跑的任务，不能因为我们入队失败就标记 failed。
  const h = harness([source()]);
  let failEnqueue = false;
  const deps = {
    sources: h.repos.sources as never,
    batches: h.repos.batches as never,
    jobs: {
      async enqueue(p: { dedupeKey: string }) {
        if (failEnqueue) throw new Error("second enqueue exploded");
        return p;
      },
    } as never,
    now: NOW,
  };

  const first = await createDueSyncJobs(deps);
  const batchId = first[0]!.batchId!;
  assert.equal(h.batchStatus(batchId), "running");

  failEnqueue = true;
  const replay = await createDueSyncJobs(deps);
  assert.equal(replay[0]?.error, "second enqueue exploded");
  assert.equal(h.batchStatus(batchId), "running"); // 既有批次状态未被改动
});
