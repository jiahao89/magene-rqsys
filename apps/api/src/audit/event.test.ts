import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuditStorage } from "./storage.js";
import { createAuditEvent, redactSafeDetails } from "./event.js";

test("不变量5：审计事件捕获 actor/entity/result/timestamp（DDL 对齐形状）", () => {
  const event = createAuditEvent({
    actor: "worker:abc",
    action: "stage.succeeded",
    entityType: "run",
    entityId: "123",
    result: "succeeded",
    occurredAt: "2026-01-01T00:00:00.000Z",
    safeDetails: { stage: "pull", attempt: 1 },
  });

  assert.equal(event.actorId, "worker:abc");
  assert.equal(event.eventType, "stage.succeeded");
  assert.equal(event.entityType, "run");
  assert.equal(event.entityId, "123");
  assert.equal(event.result, "succeeded");
  assert.equal(event.occurredAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(event.safeDetails, { stage: "pull", attempt: 1 });
});

test("不变量5：result 枚举与 DDL CHECK 对齐（succeeded/failed/denied）", () => {
  assert.equal(
    createAuditEvent({
      actor: "system",
      action: "run.failed",
      entityType: "run",
      entityId: "1",
      result: "failed",
      occurredAt: "2026-01-01T00:00:00.000Z",
    }).result,
    "failed",
  );
  assert.equal(
    createAuditEvent({
      actor: "system",
      action: "source.pushed_to_base",
      entityType: "requirement",
      entityId: "1",
      result: "denied",
      occurredAt: "2026-01-01T00:00:00.000Z",
    }).result,
    "denied",
  );
});

test("不变量5：禁止字段被脱敏（密钥/联系方式/原始载荷）", () => {
  const redacted = redactSafeDetails({
    sourceProjectId: "proj-1",
    apiKey: "sk-should-not-appear",
    secret: "s3cr3t",
    accessToken: "tok-123",
    password: "hunter2",
    email: "pm@example.com",
    phone: "13800000000",
    openId: "ou_123",
    payload: { raw: "provider response" },
    responseBody: "{...}",
    stage: "pull",
  });

  assert.equal(redacted["sourceProjectId"], "proj-1");
  assert.equal(redacted["stage"], "pull");
  // 禁止字段全部移除
  assert.equal(redacted["apiKey"], undefined);
  assert.equal(redacted["secret"], undefined);
  assert.equal(redacted["accessToken"], undefined);
  assert.equal(redacted["password"], undefined);
  assert.equal(redacted["email"], undefined);
  assert.equal(redacted["phone"], undefined);
  assert.equal(redacted["openId"], undefined);
  assert.equal(redacted["payload"], undefined);
  assert.equal(redacted["responseBody"], undefined);
});

test("不变量5：白名单外的字段被丢弃，嵌套结构被丢弃", () => {
  const redacted = redactSafeDetails({
    stage: "pull",
    unknownField: "whatever",
    nested: { deep: { deeper: "value" } },
    durationMs: 123,
  });
  assert.equal(redacted["stage"], "pull");
  assert.equal(redacted["durationMs"], 123);
  assert.equal(redacted["unknownField"], undefined);
  assert.equal(redacted["nested"], undefined);
});

test("不变量5：全部字段被脱敏后 safeDetails 为空对象", () => {
  assert.deepEqual(redactSafeDetails({ apiKey: "sk-x", token: "t" }), {});
  assert.deepEqual(redactSafeDetails(undefined), {});
});

test("不变量5：createAuditEvent 内部自动脱敏", () => {
  const event = createAuditEvent({
    actor: "system",
    action: "run.failed",
    entityType: "run",
    entityId: "456",
    result: "failed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    safeDetails: {
      stage: "analysis",
      errorClass: "provider_5xx",
      attempt: 2,
      apiKey: "sk-leak-attempt", // 必须被移除
    },
  });
  assert.equal(event.safeDetails["stage"], "analysis");
  assert.equal(event.safeDetails["errorClass"], "provider_5xx");
  assert.equal(event.safeDetails["apiKey"], undefined);
});

test("不变量5：审计存储追加只读，按实体查询按时间排序", async () => {
  const storage = new InMemoryAuditStorage();
  await storage.append(
    createAuditEvent({
      actor: "worker:a",
      action: "run.claimed",
      entityType: "run",
      entityId: "1",
      result: "succeeded",
      occurredAt: "2026-01-01T00:00:01.000Z",
    }),
  );
  await storage.append(
    createAuditEvent({
      actor: "worker:a",
      action: "run.succeeded",
      entityType: "run",
      entityId: "1",
      result: "succeeded",
      occurredAt: "2026-01-01T00:00:03.000Z",
    }),
  );
  await storage.append(
    createAuditEvent({
      actor: "system",
      action: "stage.failed",
      entityType: "run",
      entityId: "2",
      result: "failed",
      occurredAt: "2026-01-01T00:00:02.000Z",
    }),
  );

  const run1 = await storage.findByEntity("run", "1");
  assert.equal(run1.length, 2);
  assert.equal(run1[0]?.eventType, "run.claimed");
  assert.equal(run1[1]?.eventType, "run.succeeded");

  const run2 = await storage.findByEntity("run", "2");
  assert.equal(run2.length, 1);
  assert.equal(run2[0]?.result, "failed");
});

test("不变量5：非法事件被 schema 拒绝", () => {
  assert.throws(() =>
    createAuditEvent({
      actor: "",
      action: "run.claimed",
      entityType: "run",
      entityId: "1",
      result: "succeeded",
      occurredAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  assert.throws(() =>
    createAuditEvent({
      actor: "worker:a",
      action: "unknown.action" as never,
      entityType: "run",
      entityId: "1",
      result: "succeeded",
      occurredAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  assert.throws(() =>
    createAuditEvent({
      actor: "worker:a",
      action: "run.claimed",
      entityType: "run",
      entityId: "1",
      result: "skipped" as never, // 非 DDL 枚举值
      occurredAt: "2026-01-01T00:00:00.000Z",
    }),
  );
});
