import assert from "node:assert/strict";
import test from "node:test";
import { computeLastDueWindow, type ScheduleConfig } from "./due.js";
import { buildScheduledRunIdempotencyKey } from "./idempotency.js";

test("不变量6：调度计算使用显式时区而非机器本地时区", () => {
  // 配置 08:00 Asia/Shanghai（UTC+8）= 00:00 UTC
  const config: ScheduleConfig = {
    enabled: true,
    weekday: null,
    time: "08:00",
    timezone: "Asia/Shanghai",
  };

  // 传入 now = 2026-01-01T10:00:00Z（上海 18:00），今日窗口已过 → 窗口为今日 08:00 上海 = 00:00 UTC
  const window = computeLastDueWindow(config, new Date("2026-01-01T10:00:00.000Z"));
  assert.ok(window);
  assert.equal(window.start, "2026-01-01T00:00:00.000Z");

  // 同一配置在 UTC+0 解释下会是不同窗口 —— 显式时区确保结果与机器时区无关
  const configUtc: ScheduleConfig = { ...config, timezone: "UTC" };
  const windowUtc = computeLastDueWindow(configUtc, new Date("2026-01-01T10:00:00.000Z"));
  assert.ok(windowUtc);
  assert.equal(windowUtc.start, "2026-01-01T08:00:00.000Z");
  assert.notEqual(window.start, windowUtc.start);
});

test("不变量6：now 在目标时刻之前时返回昨日窗口", () => {
  const config: ScheduleConfig = {
    enabled: true,
    weekday: null,
    time: "08:00",
    timezone: "Asia/Shanghai",
  };

  // now = 2026-01-01T02:00:00Z（上海 10:00），今日 08:00 上海（00:00 UTC）已过
  const window = computeLastDueWindow(config, new Date("2026-01-01T02:00:00.000Z"));
  assert.ok(window);
  assert.equal(window.start, "2026-01-01T00:00:00.000Z");

  // now = 2025-12-31T23:00:00Z（上海 07:00），今日目标（00:00 UTC）已过？—— 23:00Z > 00:00Z，是已过
  const window2 = computeLastDueWindow(config, new Date("2025-12-31T23:00:00.000Z"));
  assert.ok(window2);
  assert.equal(window2.start, "2025-12-31T00:00:00.000Z");
});

test("不变量6：weekday 过滤找到最近符合的窗口", () => {
  // 周三（3）的调度
  const config: ScheduleConfig = {
    enabled: true,
    weekday: 3,
    time: "08:00",
    timezone: "UTC",
  };

  // 2026-01-01 是周四；最近的周三是 2025-12-31
  const window = computeLastDueWindow(config, new Date("2026-01-01T10:00:00.000Z"));
  assert.ok(window);
  assert.equal(window.start, "2025-12-31T08:00:00.000Z");

  // 2026-01-05 是周一；最近的周三是 2025-12-30？不：2025-12-31 之后最近的周三是 2026-01-07 之前 → 2025-12-31... 实际是 2025-12-31
  // 从 2026-01-05 往前找周三：2026-01-04(周日) → 01-03(周六) → 01-02(周五) → 01-01(周四) → 2025-12-31(周三)
  const window2 = computeLastDueWindow(config, new Date("2026-01-05T10:00:00.000Z"));
  assert.ok(window2);
  assert.equal(window2.start, "2025-12-31T08:00:00.000Z");
});

test("不变量6：调度未启用或配置不完整返回 null", () => {
  const disabled: ScheduleConfig = { enabled: false, weekday: null, time: "08:00", timezone: "UTC" };
  assert.equal(computeLastDueWindow(disabled, new Date()), null);

  const noTime: ScheduleConfig = { enabled: true, weekday: null, time: null, timezone: "UTC" };
  assert.equal(computeLastDueWindow(noTime, new Date()), null);
});

test("不变量6：非法 time 格式抛错而非静默回退", () => {
  const badTime: ScheduleConfig = {
    enabled: true,
    weekday: null,
    time: "8:00" as string,
    timezone: "UTC",
  };
  assert.throws(() => computeLastDueWindow(badTime, new Date()), /Invalid schedule time/);
});

test("不变量6：非法时区抛错而非静默回退到机器本地时区", () => {
  const badTz: ScheduleConfig = {
    enabled: true,
    weekday: null,
    time: "08:00",
    timezone: "Not/ARealZone",
  };
  assert.throws(() => computeLastDueWindow(badTz, new Date()));
});

test("窗口终点为起点 + 24 小时", () => {
  const config: ScheduleConfig = { enabled: true, weekday: null, time: "08:00", timezone: "UTC" };
  const window = computeLastDueWindow(config, new Date("2026-01-01T10:00:00.000Z"));
  assert.ok(window);
  assert.equal(
    new Date(window.end).getTime() - new Date(window.start).getTime(),
    24 * 60 * 60 * 1000,
  );
});

test("跨夏令时边界：America/New_York 时区的调度计算", () => {
  // 2026-07-01 处于 EDT（UTC-4）：08:00 纽约 = 12:00 UTC
  const config: ScheduleConfig = {
    enabled: true,
    weekday: null,
    time: "08:00",
    timezone: "America/New_York",
  };
  const window = computeLastDueWindow(config, new Date("2026-07-01T14:00:00.000Z"));
  assert.ok(window);
  assert.equal(window.start, "2026-07-01T12:00:00.000Z");

  // 2026-01-01 处于 EST（UTC-5）：08:00 纽约 = 13:00 UTC
  const window2 = computeLastDueWindow(config, new Date("2026-01-01T14:00:00.000Z"));
  assert.ok(window2);
  assert.equal(window2.start, "2026-01-01T13:00:00.000Z");
});

test("调度幂等键：同窗口同键，不同窗口不同键", () => {
  const config: ScheduleConfig = { enabled: true, weekday: null, time: "08:00", timezone: "UTC" };
  const window1 = computeLastDueWindow(config, new Date("2026-01-01T10:00:00.000Z"));
  const window2 = computeLastDueWindow(config, new Date("2026-01-01T15:00:00.000Z")); // 同一窗口内
  const window3 = computeLastDueWindow(config, new Date("2026-01-02T10:00:00.000Z")); // 次日窗口

  assert.ok(window1 && window2 && window3);

  const key1 = buildScheduledRunIdempotencyKey({
    sourceProjectId: "proj-1",
    sourceRequirementId: "req-1",
    window: window1,
  });
  const key2 = buildScheduledRunIdempotencyKey({
    sourceProjectId: "proj-1",
    sourceRequirementId: "req-1",
    window: window2,
  });
  const key3 = buildScheduledRunIdempotencyKey({
    sourceProjectId: "proj-1",
    sourceRequirementId: "req-1",
    window: window3,
  });

  // 同一窗口内重复计算 → 同键（不变量1）
  assert.equal(key1, key2);
  // 不同窗口 → 不同键
  assert.notEqual(key1, key3);
});
