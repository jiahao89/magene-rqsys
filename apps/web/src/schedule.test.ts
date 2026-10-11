import { describe, expect, it } from "vitest";
import { checkScheduleHealth, describeCountdown, formatInZone, nextRunAt, type WeeklySchedule } from "./schedule";

// 计划展示是纯计算：显式传入 now，避免依赖机器时钟与本地时区。
const monday: WeeklySchedule = { enabled: true, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" };

/** 用 Date.UTC 独立推算某天的 ISO 星期（1=周一），不复用被测模块的日期工具。 */
function isoWeekdayOf(instant: string, timezone: string): number {
  const parts: Record<string, string> = {};
  for (const { type, value } of new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instant))) {
    if (type !== "literal") parts[type] = value;
  }
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return names.indexOf(parts.weekday ?? "Mon") + 1;
}

describe("周计划预测", () => {
  it("按业务时区算出下一次周一 09:00，而不是机器本地时间", () => {
    // 上海时间 2026-10-11 11:10（周日）→ 下一次应为 2026-10-12 09:00 +08:00。
    const result = nextRunAt(monday, new Date("2026-10-11T03:10:00Z"));
    expect(result?.toISOString()).toBe("2026-10-12T01:00:00.000Z");
    expect(isoWeekdayOf(result!.toISOString(), "Asia/Shanghai")).toBe(1);
  });

  it("今天就是计划日但时刻已过时顺延一周", () => {
    // 上海时间 2026-10-12 10:00（周一，已过 09:00）→ 应为 2026-10-19。
    const result = nextRunAt(monday, new Date("2026-10-12T02:00:00Z"));
    expect(result?.toISOString()).toBe("2026-10-19T01:00:00.000Z");
  });

  it("今天就是计划日且时刻未到时返回当天", () => {
    // 上海时间 2026-10-12 08:00（周一，未到 09:00）→ 当天 09:00。
    const result = nextRunAt(monday, new Date("2026-10-12T00:00:00Z"));
    expect(result?.toISOString()).toBe("2026-10-12T01:00:00.000Z");
  });

  it("夏令时边界仍落在业务时区的墙上时刻", () => {
    // 纽约 2026-11-01 发生夏令时回退；计划为周一 09:00 America/New_York。
    const schedule: WeeklySchedule = { enabled: true, weekday: 1, time: "09:00", timezone: "America/New_York" };
    const result = nextRunAt(schedule, new Date("2026-10-30T12:00:00Z"));
    const shown: Record<string, string> = {};
    for (const { type, value } of new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
    }).formatToParts(result!)) {
      if (type !== "literal") shown[type] = value;
    }
    expect(`${shown.hour}:${shown.minute}`).toBe("09:00");
    expect(isoWeekdayOf(result!.toISOString(), "America/New_York")).toBe(1);
  });

  it("计划未启用、缺时区或时间非法时不出预测值", () => {
    const now = new Date("2026-10-11T03:10:00Z");
    expect(nextRunAt({ ...monday, enabled: false }, now)).toBeNull();
    expect(nextRunAt({ ...monday, timezone: null }, now)).toBeNull();
    expect(nextRunAt({ ...monday, time: "25:00" }, now)).toBeNull();
    expect(nextRunAt({ ...monday, weekday: null }, now)).toBeNull();
    expect(nextRunAt(null, now)).toBeNull();
  });

  it("无法识别的时区报错而不是静默回退到机器本地时区", () => {
    expect(nextRunAt({ ...monday, timezone: "Not/AZone" }, new Date("2026-10-11T03:10:00Z"))).toBeNull();
    expect(checkScheduleHealth({ ...monday, timezone: "Not/AZone" })).toEqual({ active: false, reason: "无法识别的时区：Not/AZone" });
  });

  it("区分「未配置」「未启用」与「配置非法」三种不可用原因", () => {
    expect(checkScheduleHealth(null)).toEqual({ active: false, reason: "尚未配置周计划" });
    expect(checkScheduleHealth({ ...monday, enabled: false })).toEqual({ active: false, reason: "周计划未启用" });
    expect(checkScheduleHealth({ ...monday, time: "9:00" }).reason).toBe("执行时间格式需为 HH:MM");
    expect(checkScheduleHealth(monday)).toEqual({ active: true, reason: null });
  });

  it("相对时间只做展示，不宣称任务已执行", () => {
    const now = new Date("2026-10-11T03:10:00Z");
    expect(describeCountdown(new Date("2026-10-12T01:00:00Z"), now)).toBe("21 小时 50 分钟后");
    expect(describeCountdown(new Date("2026-10-14T05:10:00Z"), now)).toBe("3 天 2 小时后");
    expect(describeCountdown(new Date("2026-10-11T03:00:00Z"), now)).toBe("即将执行");
  });

  it("按业务时区格式化，非法时区时不伪造本地时间", () => {
    const target = new Date("2026-10-12T01:00:00Z");
    expect(formatInZone(target, "Asia/Shanghai")).toContain("09:00");
    expect(formatInZone(target, "Not/AZone")).toBe("2026-10-12T01:00:00.000Z");
  });
});
