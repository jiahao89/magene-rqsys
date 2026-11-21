// 2026-11-21：PRD 提示词限流（2/分钟、20/天，进程内）。
import assert from "node:assert/strict";
import test from "node:test";
import { createPrdPromptRateLimiter } from "./rate-limit.js";

test("每分钟 2 次：第 3 次被拒并给出等待秒数", () => {
  let now = 1_000;
  const limiter = createPrdPromptRateLimiter({ perMinute: 2, perDay: 20 }, () => now);
  assert.deepEqual(limiter.check("actor-1"), { ok: true });
  assert.deepEqual(limiter.check("actor-1"), { ok: true });
  const third = limiter.check("actor-1");
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.retryAfterSeconds, 60);
  // 一分钟后窗口滑出，重新放行。
  now += 60_000;
  assert.deepEqual(limiter.check("actor-1"), { ok: true });
});

test("不同用户互不影响", () => {
  const limiter = createPrdPromptRateLimiter({ perMinute: 1, perDay: 20 }, () => 0);
  assert.equal(limiter.check("a").ok, true);
  assert.equal(limiter.check("a").ok, false);
  assert.equal(limiter.check("b").ok, true);
});

test("每日 20 次上限：超过后不再放行", () => {
  let now = 0;
  const limiter = createPrdPromptRateLimiter({ perMinute: 100, perDay: 20 }, () => now);
  for (let index = 0; index < 20; index += 1) {
    assert.equal(limiter.check("actor-1").ok, true, `第 ${index + 1} 次应放行`);
    now += 1_000;
  }
  assert.equal(limiter.check("actor-1").ok, false);
  // 次日窗口清空（按 24 小时滑动）。
  now += 24 * 60 * 60 * 1000;
  assert.equal(limiter.check("actor-1").ok, true);
});
