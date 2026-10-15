// Base 调用限流：把并发调用串行化，并保证两次调用之间至少间隔 minIntervalMs。
//
// 背景：一次全量同步会对 POC Base 逐条 find/create/update，311 条需求意味着数百次
// 连续写入。此前没有任何节流，容易被飞书的速率限制拒绝；更糟的是失败发生在批量
// 推送中途，只有部分需求写成功。
//
// 用装饰器实现而不是散在业务代码里：所有路径（find/create/update/readPmFields）
// 自动受限，推送适配器的逻辑不需要知道限流的存在。

import type { BaseClient, BaseRecord, BaseRequirementKey } from "./client.js";

export interface BaseRateLimitOptions {
  /** 两次调用之间的最小间隔（毫秒）。0 或省略表示不限制（仅串行化）。 */
  minIntervalMs?: number;
  /** 可注入时钟，便于测试。默认 Date.now。 */
  now?: () => number;
  /** 可注入休眠，便于测试。默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimitedBaseClient implements BaseClient {
  /** 队尾：所有调用挂在同一条链上，保证串行 + 间隔。 */
  private tail: Promise<unknown> = Promise.resolve();
  private lastCallAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly inner: BaseClient, private readonly options: BaseRateLimitOptions = {}) {}

  private schedule<T>(run: () => Promise<T>): Promise<T> {
    const minIntervalMs = this.options.minIntervalMs ?? 0;
    const now = this.options.now ?? (() => Date.now());
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    const next = this.tail.then(async () => {
      if (minIntervalMs > 0) {
        const waitMs = this.lastCallAt + minIntervalMs - now();
        if (waitMs > 0) await sleep(waitMs);
      }
      try {
        return await run();
      } finally {
        // 即使调用失败也要推进计时，否则失败风暴会变成无间隔重试
        this.lastCallAt = now();
      }
    });
    // 队列继续推进；本次调用的结果与错误仍照常返回给调用方
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  findByRequirementKey(key: BaseRequirementKey): Promise<BaseRecord | null> {
    return this.schedule(() => this.inner.findByRequirementKey(key));
  }

  create(fields: Record<string, unknown>): Promise<BaseRecord> {
    return this.schedule(() => this.inner.create(fields));
  }

  update(recordId: string, fields: Record<string, unknown>): Promise<BaseRecord> {
    return this.schedule(() => this.inner.update(recordId, fields));
  }

  readPmFields(recordId: string): Promise<Record<string, unknown>> {
    return this.schedule(() => this.inner.readPmFields(recordId));
  }
}
