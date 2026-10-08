// 重试分类与退避计算：阶段特定的重试策略。
// 不变量 2：重试只针对失败阶段，保留先前成功结果（由 jobs/claim.ts 的 nextStage 保证）。
// 不变量 4：退避和尝试次数确定且有界（本模块的纯函数保证）。

import type { SyncStage } from "../jobs/types.js";

// 错误类别：决定是否可重试以及退避策略。
export type ErrorClass =
  | "network" // 网络抖动，可重试
  | "provider_5xx" // 上游 5xx，可重试
  | "provider_4xx" // 上游 4xx（非 429），不可重试
  | "rate_limited" // 429，可重试（更长退避）
  | "validation" // 输入/数据校验失败，不可重试
  | "auth" // 认证/授权失败，不可重试（需人工介入）
  | "lease_lost" // worker 丢失 lease，不在此重试（由 claim 回收处理）
  | "unknown"; // 未知错误，默认可重试但次数更少

// 阶段特定重试策略：不同阶段允许的最大尝试次数不同。
export interface StageRetryPolicy {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

// 默认策略：pull/push 涉及外部 IO，允许更多尝试；analysis 涉及模型调用，退避更长。
export const DEFAULT_STAGE_POLICIES: Record<SyncStage, StageRetryPolicy> = {
  pull: { maxAttempts: 5, baseBackoffMs: 1_000, maxBackoffMs: 60_000 },
  analysis: { maxAttempts: 4, baseBackoffMs: 5_000, maxBackoffMs: 120_000 },
  owner: { maxAttempts: 3, baseBackoffMs: 2_000, maxBackoffMs: 30_000 },
  push: { maxAttempts: 5, baseBackoffMs: 1_000, maxBackoffMs: 60_000 },
};

// 不可重试的错误类别：直接进入 failed 终态（等待人工或阶段重置）。
const NON_RETRYABLE: ReadonlySet<ErrorClass> = new Set([
  "provider_4xx",
  "validation",
  "auth",
  "lease_lost",
]);

// 判断给定错误类别在给定阶段是否可重试。
export function isRetryable(stage: SyncStage, errorClass: ErrorClass): boolean {
  if (NON_RETRYABLE.has(errorClass)) return false;
  const policy = DEFAULT_STAGE_POLICIES[stage];
  return policy !== undefined;
}

// 判断失败结果是否可重试：可重试错误类别 + 未超出阶段最大尝试次数。
export function shouldRetry(params: {
  stage: SyncStage;
  errorClass: ErrorClass;
  attemptsSoFar: number; // 已尝试次数（含刚失败的这次）
  policies?: Record<SyncStage, StageRetryPolicy>;
}): boolean {
  const policies = params.policies ?? DEFAULT_STAGE_POLICIES;
  const policy = policies[params.stage];
  if (!policy) return false;
  if (NON_RETRYABLE.has(params.errorClass)) return false;
  return params.attemptsSoFar < policy.maxAttempts;
}

// 计算下一次重试的退避时长（毫秒）。
// 确定性指数退避：base * 2^(attempt-1)，上限 maxBackoffMs。
// 不变量 4：相同输入永远得到相同输出，且结果有界。
export function computeBackoffMs(params: {
  stage: SyncStage;
  attempt: number; // 即将进行的第几次尝试（从 1 开始；失败后第一次重试传 2）
  errorClass?: ErrorClass;
  policies?: Record<SyncStage, StageRetryPolicy>;
}): number {
  const policies = params.policies ?? DEFAULT_STAGE_POLICIES;
  const policy = policies[params.stage];
  if (!policy) return 0;

  const exponent = Math.max(0, params.attempt - 1);
  let backoff = policy.baseBackoffMs * 2 ** exponent;

  // rate_limited 额外翻倍，仍受 maxBackoffMs 约束
  if (params.errorClass === "rate_limited") {
    backoff *= 2;
  }

  return Math.min(backoff, policy.maxBackoffMs);
}

// 从 HTTP 状态码映射错误类别。未知状态码归为 provider_5xx（可重试）。
export function classifyHttpStatus(status: number): ErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "provider_4xx";
  if (status >= 500) return "provider_5xx";
  return "unknown";
}
