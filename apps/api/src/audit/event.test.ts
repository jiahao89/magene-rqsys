import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuditStorage } from "./storage.js";
import { createAuditEvent, redactDetail } from "./event.js";

test("不变量5：审计事件捕获 actor/action/object/outcome/timestamp", () => {
  const event = createAuditEvent({
    actor: "worker:abc",
    action: "stage.succeeded",
    object: "run:123",
    outcome: "success",
    timestamp: "2026-01-01T00:00:00.000Z",
    detail: { stage: "pull", attempt: 1 },
  });

  assert.equal(event.actor, "worker:abc");
  assert.equal(event.action, "stage.succeeded");
  assert.equal(event.object, "run:123");
  assert.equal(event.outcome, "success");
  assert.equal(event.timestamp, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(event.detail, { stage: "pull", attempt: 1 });
});

test("不变量5：禁止字段被脱敏（密钥/联系方式/原始载荷）", () => {
  const redacted = redactDetail({
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

  assert.ok(redacted);
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
  const redacted = redactDetail({
    stage: "pull",
    unknownField: "whatever",
    nested: { deep: { deeper: "value" } },
    durationMs: 123,
  });
  assert.ok(redacted);
  assert.equal(redacted["stage"], "pull");
  assert.equal(redacted["durationMs"], 123);
  assert.equal(redacted["unknownField"], undefined);
  assert.equal(redacted["nested"], undefined);
});

test("不变量5：全部字段被脱敏后 detail 为 undefined", () => {
  const redacted = redactDetail({ apiKey: "sk-x", token: "t" });
  assert.equal(redacted, undefined);
  assert.equal(redactDetail(undefined), undefined);
});

test("不变量5：createAuditEvent 内部自动脱敏", () => {
  const event = createAuditEvent({
    actor: "system",
    action: "run.failed",
    object: "run:456",
    outcome: "failure",
    timestamp: "2026-01-01T00:00:00.000Z",
    detail: {
      stage: "analysis",
      errorClass: "provider_5xx",
      attempt: 2,
      apiKey: "sk-leak-attempt", // 必须被移除
    },
  });
  assert.ok(event.detail);
  assert.equal(event.detail["stage"], "analysis");
  assert.equal(event.detail["errorClass"], "provider_5xx");
  assert.equal(event.detail["apiKey"], undefined);
});

test("不变量5：审计存储追加只读，按对象查询按时间排序", async () => {
  const storage = new InMemoryAuditStorage();
  await storage.append(
    createAuditEvent({
      actor: "worker:a",
      action: "run.claimed",
      object: "run:1",
      outcome: "success",
      timestamp: "2026-01-01T00:00:01.000Z",
    }),
  );
  await storage.append(
    createAuditEvent({
      actor: "worker:a",
      action: "run.succeeded",
      object: "run:1",
      outcome: "success",
      timestamp: "2026-01-01T00:00:03.000Z",
    }),
  );
  await storage.append(
    createAuditEvent({
      actor: "system",
      action: "stage.failed",
      object: "run:2",
      outcome: "failure",
      timestamp: "2026-01-01T00:00:02.000Z",
    }),
  );

  const run1 = await storage.findByObject("run:1");
  assert.equal(run1.length, 2);
  assert.equal(run1[0]?.action, "run.claimed");
  assert.equal(run1[1]?.action, "run.succeeded");

  const run2 = await storage.findByObject("run:2");
  assert.equal(run2.length, 1);
  assert.equal(run2[0]?.outcome, "failure");
});

test("不变量5：非法事件被 schema 拒绝", () => {
  assert.throws(() =>
    createAuditEvent({
      actor: "",
      action: "run.claimed",
      object: "run:1",
      outcome: "success",
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  assert.throws(() =>
    createAuditEvent({
      actor: "worker:a",
      action: "unknown.action" as never,
      object: "run:1",
      outcome: "success",
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
});
