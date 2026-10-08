import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicClock, SystemClock } from "./clock.js";

test("不变量6：确定性时钟不依赖机器本地时间", () => {
  const clock = new DeterministicClock(new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(clock.now().toISOString(), "2026-01-01T00:00:00.000Z");

  clock.advance(60_000);
  assert.equal(clock.now().toISOString(), "2026-01-01T00:01:00.000Z");

  clock.set(new Date("2026-06-15T12:00:00.000Z"));
  assert.equal(clock.now().toISOString(), "2026-06-15T12:00:00.000Z");

  // 相同起点时钟给出相同时间（可重现）
  const clock2 = new DeterministicClock(new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(clock2.now().getTime(), new Date("2026-01-01T00:00:00.000Z").getTime());
});

test("系统时钟返回合法 Date", () => {
  const clock = new SystemClock();
  const now = clock.now();
  assert.ok(now instanceof Date);
  assert.ok(!Number.isNaN(now.getTime()));
});
