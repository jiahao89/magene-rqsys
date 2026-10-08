import assert from "node:assert/strict";
import test from "node:test";
import { decideClaim, isActive, isTerminal, isLeaseValidAt, nextStage } from "./claim.js";
import type { ClaimRequest, JobRun, StageResult } from "./types.js";

const BASE_TIME = "2026-01-01T00:00:00.000Z";

function buildRequest(overrides?: Partial<ClaimRequest>): ClaimRequest {
  return {
    sourceProjectId: "proj-1",
    sourceRequirementId: "req-1",
    trigger: "scheduled",
    idempotencyKey: "sched:proj-1:req-1:2026-01-01T08:00:00.000Z",
    workerId: "worker-a",
    leaseDurationMs: 60_000,
    now: BASE_TIME,
    ...overrides,
  };
}

function buildRun(overrides?: Partial<JobRun>): JobRun {
  return {
    id: "run-1",
    sourceProjectId: "proj-1",
    sourceRequirementId: "req-1",
    trigger: "scheduled",
    idempotencyKey: "sched:proj-1:req-1:2026-01-01T08:00:00.000Z",
    status: "running",
    attempt: 1,
    currentStage: "pull",
    stageResults: [],
    workerId: "worker-a",
    leaseExpiresAt: "2026-01-01T00:01:00.000Z",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

test("不变量1：无已有 run 时 claim 创建新 run 并绑定 worker lease", () => {
  const outcome = decideClaim(null, buildRequest());
  assert.equal(outcome.kind, "claimed");
  if (outcome.kind === "claimed") {
    assert.equal(outcome.run.status, "running");
    assert.equal(outcome.run.attempt, 1);
    assert.equal(outcome.run.workerId, "worker-a");
    assert.equal(outcome.run.currentStage, "pull");
  }
});

test("不变量1：同幂等键重复触发不创建重复工作（already_active）", () => {
  const existing = buildRun();
  const outcome = decideClaim(existing, buildRequest({ workerId: "worker-b" }));
  assert.equal(outcome.kind, "already_active");
  if (outcome.kind === "already_active") {
    assert.equal(outcome.run.id, existing.id);
    assert.equal(outcome.run.workerId, "worker-a"); // 原 worker 保留
  }
});

test("不变量1：终态 run 拒绝同幂等键重复触发（terminal_rejected）", () => {
  const succeeded = buildRun({ status: "succeeded", currentStage: null, workerId: null, leaseExpiresAt: null });
  const outcome = decideClaim(succeeded, buildRequest());
  assert.equal(outcome.kind, "terminal_rejected");

  const dead = buildRun({ status: "dead", workerId: null, leaseExpiresAt: null });
  assert.equal(decideClaim(dead, buildRequest()).kind, "terminal_rejected");
});

test("不变量3：过期 lease 可安全回收（lease_expired_reclaimed）", () => {
  const expired = buildRun({
    leaseExpiresAt: "2026-01-01T00:00:30.000Z",
  });
  const outcome = decideClaim(expired, buildRequest({ workerId: "worker-b", now: "2026-01-01T00:01:00.000Z" }));
  assert.equal(outcome.kind, "lease_expired_reclaimed");
  if (outcome.kind === "lease_expired_reclaimed") {
    assert.equal(outcome.run.workerId, "worker-b");
    assert.equal(outcome.run.attempt, 2); // 尝试次数递增
    // lease 延长到新时长
    assert.equal(
      new Date(outcome.run.leaseExpiresAt ?? "").getTime(),
      new Date("2026-01-01T00:02:00.000Z").getTime(),
    );
  }
});

test("不变量3：从未 claim 的 pending run 可被回收", () => {
  const pending = buildRun({ status: "pending", workerId: null, leaseExpiresAt: null });
  const outcome = decideClaim(pending, buildRequest({ workerId: "worker-c" }));
  assert.equal(outcome.kind, "lease_expired_reclaimed");
  if (outcome.kind === "lease_expired_reclaimed") {
    assert.equal(outcome.run.workerId, "worker-c");
  }
});

test("不变量3：lease 有效性判断的边界条件", () => {
  const run = buildRun({ leaseExpiresAt: "2026-01-01T00:01:00.000Z" });
  // 完全相等的时刻不算有效（过期）
  assert.equal(isLeaseValidAt(run, "2026-01-01T00:01:00.000Z"), false);
  // 早于过期时刻有效
  assert.equal(isLeaseValidAt(run, "2026-01-01T00:00:59.999Z"), true);
  // 无 lease 信息则无效
  assert.equal(isLeaseValidAt(buildRun({ leaseExpiresAt: null }), BASE_TIME), false);
  assert.equal(isLeaseValidAt(buildRun({ workerId: null }), BASE_TIME), false);
});

test("不变量2：nextStage 返回首个未成功阶段，保留先前成功结果", () => {
  const results: StageResult[] = [
    { stage: "pull", status: "succeeded", attempt: 1, finishedAt: BASE_TIME },
  ];
  assert.equal(nextStage(buildRun({ stageResults: results })), "analysis");

  const results2: StageResult[] = [
    { stage: "pull", status: "succeeded", attempt: 1, finishedAt: BASE_TIME },
    { stage: "analysis", status: "failed", attempt: 1, errorClass: "provider_5xx", finishedAt: BASE_TIME },
  ];
  // 失败阶段不算成功，nextStage 仍返回 analysis（重试目标）
  assert.equal(nextStage(buildRun({ stageResults: results2 })), "analysis");
});

test("不变量2：全部阶段成功时 nextStage 返回 null", () => {
  const results: StageResult[] = (["pull", "analysis", "owner_mapping", "push"] as const).map(
    (stage) => ({ stage, status: "succeeded" as const, attempt: 1, finishedAt: BASE_TIME }),
  );
  assert.equal(nextStage(buildRun({ stageResults: results })), null);
});

test("回收过期 lease 时恢复到首个未成功阶段", () => {
  const results: StageResult[] = [
    { stage: "pull", status: "succeeded", attempt: 1, finishedAt: BASE_TIME },
    { stage: "analysis", status: "failed", attempt: 1, errorClass: "provider_5xx", finishedAt: BASE_TIME },
  ];
  const expired = buildRun({ stageResults: results, currentStage: "analysis" });
  const outcome = decideClaim(expired, buildRequest({ now: "2026-01-01T00:05:00.000Z" }));
  assert.equal(outcome.kind, "lease_expired_reclaimed");
  if (outcome.kind === "lease_expired_reclaimed") {
    // 恢复到失败阶段 analysis，而非从头开始
    assert.equal(outcome.run.currentStage, "analysis");
    assert.equal(outcome.run.stageResults.length, 2); // 先前结果保留
  }
});

test("活跃与终态判断", () => {
  assert.equal(isActive(buildRun()), true);
  assert.equal(isActive(buildRun({ status: "pending" })), true);
  assert.equal(isActive(buildRun({ status: "failed" })), false);
  assert.equal(isTerminal(buildRun()), false);
  assert.equal(isTerminal(buildRun({ status: "succeeded" })), true);
  assert.equal(isTerminal(buildRun({ status: "dead" })), true);
  // failed 状态既不算活跃（不接受新 claim 前）也不算终态？——按实现：failed 可被重试 claim 回收
  assert.equal(isTerminal(buildRun({ status: "failed" })), false);
});
