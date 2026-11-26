import assert from "node:assert/strict";
import test from "node:test";
import { createAssessmentRateLimiter } from "./rate-limit.js";

test("assessment rate limiter enforces per-minute and per-day sliding windows per user", () => {
  let clock = 1_000_000;
  const limiter = createAssessmentRateLimiter({ perMinute: 2, perDay: 3 }, () => clock);
  assert.deepEqual(limiter.check("u1"), { ok: true });
  clock += 10_000;
  assert.deepEqual(limiter.check("u1"), { ok: true });
  const minuteHit = limiter.check("u1");
  assert.equal(minuteHit.ok, false);
  assert.equal(minuteHit.retryAfterSeconds, 50);
  // 独立用户互不干扰
  assert.deepEqual(limiter.check("u2"), { ok: true });
  // 过了 1 分钟恢复，但命中单日上限
  clock += 60_000;
  assert.deepEqual(limiter.check("u1"), { ok: true });
  const dayHit = limiter.check("u1");
  assert.equal(dayHit.ok, false);
  assert.equal(dayHit.retryAfterSeconds, 60);
});
