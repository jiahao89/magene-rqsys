// 调度窗口纯计算：给定调度配置和"当前时间"，返回应触发的调度窗口起点。
// 关键约束（不变量 6）：必须显式传入时区和调度配置，永不使用机器本地时区作为业务默认。

export interface ScheduleConfig {
  enabled: boolean;
  weekday: number | null; // 1-7（周一=1，周日=7），null 表示每日
  time: string | null; // "HH:MM" 业务日历时刻（按 timezone 解释，非 UTC）
  timezone: string; // 显式时区，调用方必须传入
}

export interface ScheduledWindow {
  // 窗口起点 ISO 8601（UTC），作为幂等键的一部分
  start: string;
  // 窗口终点的下一刻（用于判断是否仍在窗口内）
  end: string;
}

// 计算从 now 往前看、最近一次应触发的调度窗口。
// 返回 null 表示调度未启用或配置不完整。
export function computeLastDueWindow(
  config: ScheduleConfig,
  now: Date,
): ScheduledWindow | null {
  if (!config.enabled) return null;
  if (config.time === null) return null;
  if (!/^\d{2}:\d{2}$/.test(config.time)) {
    throw new Error(
      `Invalid schedule time: ${config.time}. Expected "HH:MM".`,
    );
  }

  // 显式按 config.timezone 解释"业务日历时刻"。
  // 这里用 Intl 获取该时区的偏移量，避免引入额外依赖。
  const offsetMs = timezoneOffsetMs(config.timezone, now);
  const localMs = now.getTime() + offsetMs;
  const localDate = new Date(localMs);

  const [hh, mm] = config.time.split(":").map(Number) as [number, number];
  if (hh === undefined || mm === undefined) {
    throw new Error(`Invalid schedule time parts: ${config.time}`);
  }

  // 构造"业务日历"目标时刻
  const targetLocal = new Date(localDate);
  targetLocal.setUTCHours(hh, mm, 0, 0);

  // 若已过今日目标时刻，窗口为今日；否则窗口为昨日（最近一次应触发的）
  let windowLocal = new Date(targetLocal);
  if (localMs < targetLocal.getTime()) {
    windowLocal = new Date(targetLocal.getTime() - 24 * 60 * 60 * 1000);
  }

  // weekday 过滤：如果指定了 weekday，找到最近符合的工作日窗口
  if (config.weekday !== null) {
    while (getUtcDayOfWeek(windowLocal) !== config.weekday) {
      windowLocal = new Date(windowLocal.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  // 窗口起点换算回 UTC：用窗口时刻的时区偏移（而非 now 的偏移），
  // 保证跨夏令时边界的窗口起点不偏移 1 小时。
  const startUtc = wallTimeToUtc(config.timezone, windowLocal);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  return {
    start: startUtc.toISOString(),
    end: endUtc.toISOString(),
  };
}

// 获取 UTC Date 的 ISO 星期（周一=1 ... 周日=7）。
function getUtcDayOfWeek(date: Date): number {
  // JS getDay(): 周日=0, 周一=1 ... 周六=6
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

// 计算某时区在某时刻的 UTC 偏移（毫秒）。
// 使用 Intl.DateTimeFormat 的 formatToParts 提取时区偏移。
function timezoneOffsetMs(timezone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string): string => {
    const part = parts.find((p) => p.type === type);
    return part?.value ?? "0";
  };

  const year = Number(get("year"));
  const month = Number(get("month")) - 1;
  const day = Number(get("day"));
  // hour 可能是 "24"，需要特殊处理
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute"));
  const second = Number(get("second"));

  // 构造"该时区墙上时间对应的 UTC Date"
  const asIfUtc = Date.UTC(year, month, day, hour, minute, second);
  return asIfUtc - date.getTime();
}

// 将"墙上时刻"（按 wall.getTime() 解释为 UTC 的本地日历时刻）换算为真实 UTC 时刻。
// 迭代求解 utc = wall - offsetAt(utc)，两次迭代覆盖夏令时切换边界；
// 结果对同一输入确定（固定迭代次数）。
function wallTimeToUtc(timezone: string, wall: Date): Date {
  let utc = new Date(wall.getTime() - timezoneOffsetMs(timezone, wall));
  for (let i = 0; i < 2; i++) {
    utc = new Date(wall.getTime() - timezoneOffsetMs(timezone, utc));
  }
  return utc;
}
