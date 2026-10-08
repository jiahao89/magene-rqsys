// 作业 claim / lease 编排纯函数。不直接读写存储，而是返回"应如何更新"的意图，
// 由 InMemoryJobStorage 或目标 Miaoda 适配器解释执行。
// 这一层保证不变量 1（每源一个活跃 run）和不变量 3（lease 回收规则）的一致逻辑。

import { randomUUID } from "node:crypto";
import type { ClaimRequest, ClaimOutcome, JobRun, SyncStage } from "./types.js";
import { STAGE_ORDER } from "./types.js";

// 判断 run 是否处于"活跃"状态（仍可推进，未终态）。
export function isActive(run: JobRun): boolean {
  return run.status === "pending" || run.status === "running";
}

// 判断 run 是否处于终态（不再接受新 claim）。
export function isTerminal(run: JobRun): boolean {
  return run.status === "succeeded" || run.status === "dead";
}

// 判断 lease 是否在给定时刻仍然有效。
export function isLeaseValidAt(run: JobRun, now: string): boolean {
  if (!run.leaseExpiresAt || !run.workerId) return false;
  return new Date(run.leaseExpiresAt).getTime() > new Date(now).getTime();
}

// 计算下一个应执行的阶段：首个既未成功也未被记录为当前阶段的阶段。
// 重试只针对失败阶段，保留先前成功结果（不变量 2）。
export function nextStage(run: JobRun): SyncStage | null {
  const succeededStages = new Set(
    run.stageResults.filter((r) => r.status === "succeeded").map((r) => r.stage),
  );
  for (const stage of STAGE_ORDER) {
    if (!succeededStages.has(stage)) {
      return stage;
    }
  }
  return null; // 全部阶段已成功
}

// 核心 claim 决策：给定已有 run（可能为 null）和请求，返回应采取的 ClaimOutcome。
// 这是纯函数，storage 实现负责按此结果更新持久状态。
export function decideClaim(
  existing: JobRun | null,
  request: ClaimRequest,
): ClaimOutcome {
  // 无已有 run：新建并 claim
  if (!existing) {
    return { kind: "claimed", run: createNewRun(request) };
  }

  // 已有 run 已终态：拒绝重复创建
  if (isTerminal(existing)) {
    return { kind: "terminal_rejected", run: existing };
  }

  // 已有 run 且 lease 仍有效：拒绝并发 claim（不变量 3 后半）
  if (isLeaseValidAt(existing, request.now)) {
    return { kind: "already_active", run: existing };
  }

  // 已有 run 但 lease 过期或从未 claim：回收并重新 claim（不变量 3 前半）
  return {
    kind: "lease_expired_reclaimed",
    run: reclaimRun(existing, request),
  };
}

// 创建新 run。
function createNewRun(request: ClaimRequest): JobRun {
  const now = request.now;
  const leaseExpiry = new Date(
    new Date(now).getTime() + request.leaseDurationMs,
  ).toISOString();
  return {
    id: randomUUID(),
    sourceProjectId: request.sourceProjectId,
    sourceRequirementId: request.sourceRequirementId,
    trigger: request.trigger,
    idempotencyKey: request.idempotencyKey,
    status: "running",
    attempt: 1,
    currentStage: "pull",
    stageResults: [],
    workerId: request.workerId,
    leaseExpiresAt: leaseExpiry,
    createdAt: now,
    updatedAt: now,
  };
}

// 回收过期 lease：保留已有阶段结果，尝试次数递增，重新 claim 给新 worker。
function reclaimRun(existing: JobRun, request: ClaimRequest): JobRun {
  const leaseExpiry = new Date(
    new Date(request.now).getTime() + request.leaseDurationMs,
  ).toISOString();
  // 重试时恢复到首个未成功阶段
  const resumeStage = nextStage(existing) ?? existing.currentStage;
  return {
    ...existing,
    status: "running",
    attempt: existing.attempt + 1,
    currentStage: resumeStage,
    workerId: request.workerId,
    leaseExpiresAt: leaseExpiry,
    updatedAt: request.now,
  };
}
