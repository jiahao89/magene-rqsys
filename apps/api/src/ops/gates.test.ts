import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEventRecord } from "../domain/persistence.js";
import { confirmGate, evaluateGates } from "./gates.js";

const NOW = new Date("2026-11-12T08:00:00.000Z");

function harness(options: { formulaType?: string; unpublishedMapping?: boolean; webhook?: boolean; flags?: Record<string, Record<string, unknown>> } = {}) {
  const store = new Map(Object.entries(options.flags ?? {}));
  const events: AuditEventRecord[] = [];
  const flags = {
    async get(name: string) { const value = store.get(name); return value ? { value, updatedAt: NOW.toISOString() } : null; },
    async set(name: string, value: Record<string, unknown>) { store.set(name, value); },
  };
  const requirements = {
    async getPipelineCounts() { return { pushPushed: 279, total: 284 }; },
    async search() { return { items: options.unpublishedMapping ? [{ id: "req-1" }] : [], nextCursor: null }; },
  };
  const priorityRules = {
    async getPublished() { return { version: 2, rules: { formulaType: options.formulaType ?? "umsc_weighted_v2" } }; },
  };
  const audit = {
    async append(event: AuditEventRecord) { events.push(event); },
    async search() { return []; },
  };
  const env = {
    BASE_APP_TOKEN: "app", BASE_TABLE_ID: "tbl",
    ...(options.webhook === false ? {} : { RQSYS_ALERT_WEBHOOK_URL: "https://hook" }),
  };
  return { flags, requirements, priorityRules, audit, env, store, events };
}

const evaluate = (h: ReturnType<typeof harness>) => evaluateGates({
  flags: h.flags as never, requirements: h.requirements as never,
  priorityRules: h.priorityRules as never, env: h.env, now: NOW,
});

test("自动项与人工确认共同决定 Gate 状态", async () => {
  const h = harness();
  const result = await evaluate(h);
  assert.equal(result.ready, false);
  const byId = new Map(result.gates.map((gate) => [gate.id, gate]));
  assert.equal(byId.get("G1")?.auto.status, "pass");
  assert.equal(byId.get("G1")?.status, "pending"); // 人工通知实收未确认
  assert.equal(byId.get("G2")?.status, "fail"); // v3 未发布，人工确认也不能绕过
  assert.equal(byId.get("G3")?.status, "pass");
  assert.equal(byId.get("G4")?.status, "pending");
  assert.equal(byId.get("G5")?.status, "pending");

  assert.equal((await confirmGate({ flags: h.flags as never, audit: h.audit as never, id: "G1", confirmed: true, evidence: "通知截图 2026-11-12", actorId: "pm-lead", now: NOW })).outcome, "saved");
  const after = await evaluate(h);
  assert.equal(new Map(after.gates.map((gate) => [gate.id, gate])).get("G1")?.status, "pass");
  assert.equal(h.events[0]?.eventType, "ops.gate_confirmed");

  await confirmGate({ flags: h.flags as never, audit: h.audit as never, id: "G1", confirmed: false, actorId: "pm-lead", now: NOW });
  assert.equal(new Map((await evaluate(h)).gates.map((gate) => [gate.id, gate])).get("G1")?.status, "pending");
});

test("自动检查反映未配置与待映射", async () => {
  const h = harness({ webhook: false, unpublishedMapping: true });
  const result = await evaluate(h);
  const byId = new Map(result.gates.map((gate) => [gate.id, gate]));
  assert.equal(byId.get("G3")?.auto.status, "fail");
  assert.equal(byId.get("G4")?.auto.status, "fail");
});

test("v3 规则发布后 G2 自动项通过，但仍需人工校准确认", async () => {
  const h = harness({ formulaType: "umsc_weighted_v3" });
  const gate = (await evaluate(h)).gates.find((item) => item.id === "G2")!;
  assert.equal(gate.auto.status, "pass");
  assert.equal(gate.status, "pending");
});

test("拒绝确认非人工项与未知 Gate", async () => {
  const h = harness();
  assert.equal((await confirmGate({ flags: h.flags as never, audit: h.audit as never, id: "G3", confirmed: true, evidence: "x", actorId: "a", now: NOW })).outcome, "invalid");
  assert.equal((await confirmGate({ flags: h.flags as never, audit: h.audit as never, id: "G9", confirmed: true, evidence: "x", actorId: "a", now: NOW })).outcome, "invalid");
});
