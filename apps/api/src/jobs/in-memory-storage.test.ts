import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobStorage } from "./in-memory-storage.js";
import { buildScheduledIdempotencyKey, buildManualIdempotencyKey, isValidIdempotencyKey } from "./idempotency.js";

const BASE_TIME = "2026-01-01T00:00:00.000Z";

function makeRequest(overrides?: Record<string, unknown>) {
  return {
    sourceConfigId: "proj-1",
    teambitionRequirementId: "req-1",
    trigger: "scheduled" as const,
    idempotencyKey: "sched:proj-1:req-1:window-1",
    workerId: "worker-a",
    leaseDurationMs: 60_000,
    now: BASE_TIME,
    ...overrides,
  };
}

test("不变量1：同幂等键的重复调度不创建重复 run", async () => {
  const storage = new InMemoryJobStorage();
  const first = await storage.claim(makeRequest());
  const second = await storage.claim(makeRequest());

  assert.equal(first.kind, "claimed");
  assert.equal(second.kind, "already_active");
  if (second.kind === "already_active") {
    assert.equal(second.run.id, first.kind === "claimed" ? first.run.id : "");
  }

  // 幂等索引只映射到同一个 run
  const found = await storage.findByIdempotencyKey("sched:proj-1:req-1:window-1");
  assert.ok(found);
  assert.equal(found.id, first.kind === "claimed" ? first.run.id : "");
});

test("不变量1：同需求身份不同键、活跃 run 存在时不创建重复工作", async () => {
  const storage = new InMemoryJobStorage();
  const first = await storage.claim(
    makeRequest({ idempotencyKey: "sched:proj-1:req-1:window-1" }),
  );
  assert.equal(first.kind, "claimed");

  // 不同键（如新调度窗口或手动触发）但同一需求身份且活跃 → 拒绝重复创建
  const second = await storage.claim(
    makeRequest({ idempotencyKey: "sched:proj-1:req-1:window-2" }),
  );
  assert.equal(second.kind, "already_active");
  if (second.kind === "already_active") {
    assert.equal(second.run.id, first.kind === "claimed" ? first.run.id : "");
  }
});

test("不变量1：不同需求身份各自创建独立 run", async () => {
  const storage = new InMemoryJobStorage();
  const first = await storage.claim(makeRequest());
  const second = await storage.claim(
    makeRequest({
      teambitionRequirementId: "req-2",
      idempotencyKey: "sched:proj-1:req-2:window-1",
    }),
  );

  assert.equal(first.kind, "claimed");
  assert.equal(second.kind, "claimed");
  if (first.kind === "claimed" && second.kind === "claimed") {
    assert.notEqual(first.run.id, second.run.id);
  }
});

test("不变量3：有效 lease 内的并发 claim 被拒绝，过期后可回收", async () => {
  const storage = new InMemoryJobStorage();
  const first = await storage.claim(makeRequest());
  assert.equal(first.kind, "claimed");

  // 同一时刻另一个 worker 尝试 claim —— 被 already_active 拒绝
  const concurrent = await storage.claim(makeRequest({ workerId: "worker-b" }));
  assert.equal(concurrent.kind, "already_active");

  // lease 过期后可回收
  const later = await storage.claim(
    makeRequest({ workerId: "worker-b", now: "2026-01-01T00:02:00.000Z" }),
  );
  assert.equal(later.kind, "lease_expired_reclaimed");
  if (later.kind === "lease_expired_reclaimed") {
    assert.equal(later.run.workerId, "worker-b");
    assert.equal(later.run.attempt, 2);
  }
});

test("不变量2：阶段推进只追加成功结果，失败保留先前成功", async () => {
  const storage = new InMemoryJobStorage();
  const claimed = await storage.claim(makeRequest());
  assert.equal(claimed.kind, "claimed");
  const runId = claimed.kind === "claimed" ? claimed.run.id : "";

  // pull 成功 → currentStage 推进到 analysis
  const afterPull = await storage.advance({
    runId,
    stage: "pull",
    status: "succeeded",
    workerId: "worker-a",
    now: "2026-01-01T00:00:10.000Z",
  });
  assert.equal(afterPull.currentStage, "analysis");
  assert.equal(afterPull.stageResults.length, 1);
  assert.equal(afterPull.stageResults[0]?.stage, "pull");

  // analysis 失败 → 状态 failed，先前 pull 结果保留
  const afterFail = await storage.advance({
    runId,
    stage: "analysis",
    status: "failed",
    errorClass: "provider_5xx",
    workerId: "worker-a",
    now: "2026-01-01T00:00:20.000Z",
  });
  assert.equal(afterFail.status, "failed");
  assert.equal(afterFail.stageResults.length, 2);
  assert.equal(afterFail.stageResults[0]?.status, "succeeded"); // pull 结果保留
  assert.equal(afterFail.stageResults[1]?.status, "failed");

  // 回收重试：恢复到 analysis（首个未成功阶段），pull 结果仍在
  const reclaimed = await storage.claim(
    makeRequest({ workerId: "worker-b", now: "2026-01-01T00:02:00.000Z" }),
  );
  assert.equal(reclaimed.kind, "lease_expired_reclaimed");
  if (reclaimed.kind === "lease_expired_reclaimed") {
    assert.equal(reclaimed.run.currentStage, "analysis");
    assert.equal(reclaimed.run.stageResults.length, 2);
  }
});

test("不变量2：全部阶段成功后 run 标记 succeeded，lease 释放", async () => {
  const storage = new InMemoryJobStorage();
  const claimed = await storage.claim(makeRequest());
  const runId = claimed.kind === "claimed" ? claimed.run.id : "";

  let current = await storage.advance({
    runId,
    stage: "pull",
    status: "succeeded",
    workerId: "worker-a",
    now: BASE_TIME,
  });
  for (const stage of ["analysis", "owner", "push"] as const) {
    current = await storage.advance({
      runId,
      stage,
      status: "succeeded",
      workerId: "worker-a",
      now: BASE_TIME,
    });
  }
  assert.equal(current.status, "succeeded");
  assert.equal(current.currentStage, null);
  assert.equal(current.workerId, null);

  // 终态后同幂等键 claim 被拒绝
  const terminal = await storage.claim(makeRequest({ workerId: "worker-b" }));
  assert.equal(terminal.kind, "terminal_rejected");
});

test("advance 校验 lease 与阶段匹配", async () => {
  const storage = new InMemoryJobStorage();
  const claimed = await storage.claim(makeRequest());
  const runId = claimed.kind === "claimed" ? claimed.run.id : "";

  // 错误 worker 被拒绝
  await assert.rejects(
    storage.advance({
      runId,
      stage: "pull",
      status: "succeeded",
      workerId: "worker-b",
      now: BASE_TIME,
    }),
    /does not hold a valid lease/,
  );

  // 错误阶段被拒绝
  await assert.rejects(
    storage.advance({
      runId,
      stage: "push",
      status: "succeeded",
      workerId: "worker-a",
      now: BASE_TIME,
    }),
    /Stage mismatch/,
  );

  // lease 过期后被拒绝
  await assert.rejects(
    storage.advance({
      runId,
      stage: "pull",
      status: "succeeded",
      workerId: "worker-a",
      now: "2026-01-01T00:02:00.000Z",
    }),
    /does not hold a valid lease/,
  );

  // 不存在的 run 被拒绝
  await assert.rejects(
    storage.advance({
      runId: "nonexistent",
      stage: "pull",
      status: "succeeded",
      workerId: "worker-a",
      now: BASE_TIME,
    }),
    /Job run not found/,
  );
});

test("幂等键生成：调度键稳定，手动键唯一", () => {
  const scheduled1 = buildScheduledIdempotencyKey({
    sourceConfigId: "proj-1",
    teambitionRequirementId: "req-1",
    scheduleWindow: "2026-01-01T08:00:00.000Z",
  });
  const scheduled2 = buildScheduledIdempotencyKey({
    sourceConfigId: "proj-1",
    teambitionRequirementId: "req-1",
    scheduleWindow: "2026-01-01T08:00:00.000Z",
  });
  assert.equal(scheduled1, scheduled2); // 同窗口同键

  const manual1 = buildManualIdempotencyKey({ sourceConfigId: "proj-1", teambitionRequirementId: "req-1" });
  const manual2 = buildManualIdempotencyKey({ sourceConfigId: "proj-1", teambitionRequirementId: "req-1" });
  assert.notEqual(manual1, manual2); // 每次手动触发独立
});

test("幂等键格式校验", () => {
  assert.equal(isValidIdempotencyKey("sched:proj-1:req-1:window"), true);
  assert.equal(isValidIdempotencyKey("short"), false); // < 8
  assert.equal(isValidIdempotencyKey("a".repeat(129)), false); // > 128
  assert.equal(isValidIdempotencyKey("bad\nkey"), false); // 控制字符
});
