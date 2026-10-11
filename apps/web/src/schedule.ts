// 周计划预测：把「下次同步时间 / 计划配置是否可用」算成纯函数，便于测试与复用。
// 不变量：不使用机器本地时区作为业务默认值——时区缺失或非法时返回 null，而不是回退。

export interface WeeklySchedule {
  enabled: boolean;
  weekday: number | null;
  time: string | null;
  timezone: string | null;
}

export interface ScheduleHealth {
  /** 计划是否可用（启用且配置合法）。 */
  active: boolean;
  /** 配置不合法时的原因；active 为 true 时为 null。 */
  reason: string | null;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** 判断计划配置本身是否可用；不访问网络。 */
export function checkScheduleHealth(schedule: WeeklySchedule | null | undefined): ScheduleHealth {
  if (!schedule) return { active: false, reason: "尚未配置周计划" };
  if (!schedule.enabled) return { active: false, reason: "周计划未启用" };
  if (schedule.weekday === null || !Number.isInteger(schedule.weekday) || schedule.weekday < 1 || schedule.weekday > 7) {
    return { active: false, reason: "周计划星期取值需为 1–7" };
  }
  if (!schedule.time || !TIME_PATTERN.test(schedule.time)) {
    return { active: false, reason: "执行时间格式需为 HH:MM" };
  }
  if (!schedule.timezone) return { active: false, reason: "缺少时区，无法按业务时区计算" };
  if (!isValidTimezone(schedule.timezone)) return { active: false, reason: `无法识别的时区：${schedule.timezone}` };
  return { active: true, reason: null };
}

/** 求某个时刻在指定时区的 UTC 偏移（毫秒）。用于把「时区内的墙上时间」转成绝对时刻。 */
function zoneOffsetMs(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  // Intl 用 24 表示午夜，归一到 0。
  const hour = parts.hour === 24 ? 0 : (parts.hour ?? 0);
  const asUtc = Date.UTC(parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1, hour, parts.minute ?? 0, parts.second ?? 0);
  return asUtc - date.getTime();
}

/** 把「某时区内的墙上时间」转换为绝对时刻；夏令时跳变等边界可能产生偏差，仅用于展示预测。 */
function wallClockToInstant(
  year: number, month: number, day: number, hour: number, minute: number, timezone: string,
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  // 两轮足以收敛；夏令时切换当天可能仍有一小时误差。
  for (let i = 0; i < 2; i += 1) {
    const offset = zoneOffsetMs(guess, timezone);
    const corrected = new Date(Date.UTC(year, month - 1, day, hour, minute) - offset);
    if (corrected.getTime() === guess.getTime()) break;
    guess = corrected;
  }
  return guess;
}

/** 目标时区中「now」的日历字段。 */
function calendarInZone(now: Date, timezone: string): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(now)) {
    if (type !== "literal") parts[type] = value;
  }
  const weekdayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday ?? "Mon");
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    weekday: (weekdayIndex < 0 ? 0 : weekdayIndex) + 1,
  };
}

/**
 * 计算严格晚于 `now` 的下一次计划时刻；计划不可用时返回 null。
 * 先按业务时区的日历日推进，再换算为绝对时刻，避免机器本地时区影响结果。
 */
export function nextRunAt(schedule: WeeklySchedule | null | undefined, now: Date): Date | null {
  const health = checkScheduleHealth(schedule);
  if (!health.active) return null;
  const { weekday, time, timezone } = schedule as { weekday: number; time: string; timezone: string };
  const [hour, minute] = time.split(":").map(Number) as [number, number];

  const today = calendarInZone(now, timezone);
  const dayDelta = (weekday - today.weekday + 7) % 7;
  let candidate = wallClockToInstant(today.year, today.month, today.day + dayDelta, hour, minute, timezone);
  // 今天就是计划日但时刻已过：顺延一周。
  if (candidate.getTime() <= now.getTime()) {
    candidate = wallClockToInstant(today.year, today.month, today.day + dayDelta + 7, hour, minute, timezone);
  }
  return candidate;
}

/** 相对时间描述，例如「3 天 2 小时后」。 */
export function describeCountdown(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "即将执行";
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时后`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟后`;
  return `${minutes} 分钟后`;
}

/** 按业务时区格式化计划时刻，供工作台展示。 */
export function formatInZone(target: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone, dateStyle: "medium", timeStyle: "short", hour12: false,
    }).format(target);
  } catch {
    return target.toISOString();
  }
}
