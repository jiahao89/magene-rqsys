import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STAGE_POLICIES,
  classifyHttpStatus,
  computeBackoffMs,
  isRetryable,
  shouldRetry,
} from "./policy.js";

test("不变量4：退避计算确定且有界（指数增长但封顶）", () => {
  // 同输入同输出
  const a1 = computeBackoffMs({ stage: "pull", attempt: 1 });
  const a2 = computeBackoffMs({ stage: "pull", attempt: 1 });
  assert.equal(a1, a2);

  // 指数增长
  assert.equal(computeBackoffMs({ stage: "pull", attempt: 1 }), 1_000);
  assert.equal(computeBackoffMs({ stage: "pull", attempt: 2 }), 2_000);
  assert.equal(computeBackoffMs({ stage: "pull", attempt: 3 }), 4_000);
  assert.equal(computeBackoffMs({ stage: "pull", attempt: 4 }), 8_000);

  // 封顶：超过 maxBackoffMs 后不再增长
  const policy = DEFAULT_STAGE_POLICIES.pull;
  const huge = computeBackoffMs({ stage: "pull", attempt: 20 });
  assert.equal(huge, policy.maxBackoffMs);
  assert.ok(huge <= policy.maxBackoffMs);
});

test("不变量4：rate_limited 退避翻倍但仍封顶", () => {
  const base = computeBackoffMs({ stage: "pull", attempt: 2 });
  const rl = computeBackoffMs({ stage: "pull", attempt: 2, errorClass: "rate_limited" });
  assert.equal(rl, Math.min(base * 2, DEFAULT_STAGE_POLICIES.pull.maxBackoffMs));

  // 极端情况下仍不超过 maxBackoffMs
  const rlHuge = computeBackoffMs({ stage: "pull", attempt: 20, errorClass: "rate_limited" });
  assert.equal(rlHuge, DEFAULT_STAGE_POLICIES.pull.maxBackoffMs);
});

test("不变量4：各阶段尝试上限确定且不同", () => {
  assert.equal(DEFAULT_STAGE_POLICIES.pull.maxAttempts, 5);
  assert.equal(DEFAULT_STAGE_POLICIES.analysis.maxAttempts, 4);
  assert.equal(DEFAULT_STAGE_POLICIES.owner_mapping.maxAttempts, 3);
  assert.equal(DEFAULT_STAGE_POLICIES.push.maxAttempts, 5);
});

test("不变量4：shouldRetry 在达到上限后返回 false", () => {
  // pull maxAttempts=5：第 5 次失败后（attemptsSoFar=5）不再重试
  assert.equal(shouldRetry({ stage: "pull", errorClass: "provider_5xx", attemptsSoFar: 4 }), true);
  assert.equal(shouldRetry({ stage: "pull", errorClass: "provider_5xx", attemptsSoFar: 5 }), false);

  // owner_mapping maxAttempts=3
  assert.equal(shouldRetry({ stage: "owner_mapping", errorClass: "network", attemptsSoFar: 2 }), true);
  assert.equal(shouldRetry({ stage: "owner_mapping", errorClass: "network", attemptsSoFar: 3 }), false);
});

test("不可重试错误类别直接返回 false", () => {
  for (const cls of ["provider_4xx", "validation", "auth", "lease_lost"] as const) {
    assert.equal(isRetryable("pull", cls), false, `expected ${cls} non-retryable`);
    assert.equal(shouldRetry({ stage: "pull", errorClass: cls, attemptsSoFar: 0 }), false);
  }
});

test("可重试错误类别按阶段判断", () => {
  assert.equal(isRetryable("pull", "network"), true);
  assert.equal(isRetryable("analysis", "provider_5xx"), true);
  assert.equal(isRetryable("push", "rate_limited"), true);
  assert.equal(isRetryable("owner_mapping", "unknown"), true);
});

test("HTTP 状态码到错误类别映射", () => {
  assert.equal(classifyHttpStatus(401), "auth");
  assert.equal(classifyHttpStatus(403), "auth");
  assert.equal(classifyHttpStatus(429), "rate_limited");
  assert.equal(classifyHttpStatus(400), "provider_4xx");
  assert.equal(classifyHttpStatus(404), "provider_4xx");
  assert.equal(classifyHttpStatus(500), "provider_5xx");
  assert.equal(classifyHttpStatus(503), "provider_5xx");
  assert.equal(classifyHttpStatus(200), "unknown");
});

test("不变量2：失败阶段的重试只影响该阶段（由 nextStage + storage 保证）", () => {
  // 该不变量的端到端验证在 in-memory-storage.test.ts；此处验证策略层语义：
  // 失败后 shouldRetry 为 true 时，重试目标仍是失败阶段本身。
  const policy = DEFAULT_STAGE_POLICIES.analysis;
  const canRetry = shouldRetry({ stage: "analysis", errorClass: "provider_5xx", attemptsSoFar: 1 });
  assert.equal(canRetry, true);
  const backoff = computeBackoffMs({ stage: "analysis", attempt: 2, errorClass: "provider_5xx" });
  assert.equal(backoff, policy.baseBackoffMs * 2);
});
