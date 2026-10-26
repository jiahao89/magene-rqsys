import assert from "node:assert/strict";
import test from "node:test";
import type { BaseClient, BaseRecord } from "./client.js";
import { RateLimitedBaseClient } from "./rate-limit.js";

function stub() {
  const calls: string[] = [];
  const client: BaseClient = {
    async findByRequirementKey() { calls.push("find"); return null; },
    async findByPlatformKey() { calls.push("platform"); return null; },
    async create() { calls.push("create"); return { recordId: "r1", fields: {} } as BaseRecord; },
    async update() { calls.push("update"); return { recordId: "r1", fields: {} } as BaseRecord; },
    async readPmFields() { calls.push("read"); return {}; },
  };
  return { calls, client };
}

/** 受控时钟：sleep 立即推进虚拟时间，避免测试里真的等待。 */
function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => { slept.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
  };
}

test("minIntervalMs 为 0 时只串行化，不额外等待", async () => {
  const { calls, client } = stub();
  const clock = fakeClock();
  const limited = new RateLimitedBaseClient(client, { minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
  await Promise.all([limited.create({}), limited.create({}), limited.create({})]);
  assert.equal(calls.length, 3);
  assert.deepEqual(clock.slept, []);
});

test("连续调用被拉开到最小间隔", async () => {
  const { calls, client } = stub();
  const clock = fakeClock();
  const limited = new RateLimitedBaseClient(client, { minIntervalMs: 100, now: clock.now, sleep: clock.sleep });

  // 同时发起 5 次调用：第 1 次不等待，之后每次都要补足 100ms 间隔
  await Promise.all(Array.from({ length: 5 }, () => limited.create({})));
  assert.equal(calls.length, 5);
  assert.deepEqual(clock.slept, [100, 100, 100, 100]);
  assert.equal(clock.now(), 400);
});

test("并发调用不会重叠：内部客户端一次只被调用一个", async () => {
  const { client } = stub();
  let inFlight = 0;
  let maxInFlight = 0;
  const wrapped: BaseClient = {
    ...client,
    async create(fields) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return client.create(fields);
    },
  };
  const limited = new RateLimitedBaseClient(wrapped, { minIntervalMs: 5 });
  await Promise.all([limited.create({}), limited.create({}), limited.create({})]);
  assert.equal(maxInFlight, 1);
});

test("已有足够间隔时不额外等待，队列失败不阻塞后续调用", async () => {
  const clock = fakeClock();
  let failNext = true;
  const inner: BaseClient = {
    async findByRequirementKey() { return null; },
    async create() {
      if (failNext) { failNext = false; throw new Error("rate limited by provider"); }
      return { recordId: "r1", fields: {} } as BaseRecord;
    },
    async update() { return { recordId: "r1", fields: {} } as BaseRecord; },
    async readPmFields() { return {}; },
  };
  const limited = new RateLimitedBaseClient(inner, { minIntervalMs: 100, now: clock.now, sleep: clock.sleep });

  await assert.rejects(limited.create({}), /rate limited by provider/);
  await limited.create({}); // 前一次失败不阻塞本次
  assert.deepEqual(clock.slept, [100]); // 失败也推进了计时
});

test("所有 Base 方法都受限流（含读取路径）", async () => {
  const { calls, client } = stub();
  const clock = fakeClock();
  const limited = new RateLimitedBaseClient(client, { minIntervalMs: 50, now: clock.now, sleep: clock.sleep });
  await limited.findByRequirementKey({ projectId: "p", requirementId: "r" });
  await limited.findByPlatformKey("RQ-000001");
  await limited.readPmFields("rec");
  await limited.update("rec", {});
  assert.deepEqual(calls, ["find", "platform", "read", "update"]);
  assert.deepEqual(clock.slept, [50, 50, 50]);
});
