// 时钟端口：让调度 / lease / 退避计算不依赖机器本地时间，满足不变量 6。
// 生产实现注入平台时钟；测试使用 DeterministicClock 保证可重现。

export interface Clock {
  now(): Date;
}

// 确定性时钟，测试专用。从固定起点推进，避免依赖真实系统时间。
export class DeterministicClock implements Clock {
  private currentMs: number;

  constructor(start: Date = new Date("2026-01-01T00:00:00Z")) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }

  set(date: Date): void {
    this.currentMs = date.getTime();
  }
}

// 系统时钟实现，生产环境可注入。仍应由调用方显式传入，而非在纯函数内直接调用。
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
