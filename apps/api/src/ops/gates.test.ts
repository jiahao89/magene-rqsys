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

test("G3 只统计活跃（processingState=active）待匹配且未推送需求，已压制重复项不阻断 Gate", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const h = harness();
  h.requirements.search = async (query?: Record<string, unknown>) => {
    queries.push(query ?? {});
    return { items: [], nextCursor: null };
  };
  const result = await evaluate(h);
  assert.equal(result.gates.find((g) => g.id === "G3")?.auto.status, "pass");
  assert.deepEqual(queries, [{ ownerState: "pending_mapping", pushState: "pending", processingState: "active", limit: 1 }]);
});

test("evaluateGates 并行发起所有查询（消除串行 N+1 往返），优先使用 listByPrefix", async () => {
  const h = harness({
    formulaType: "umsc_weighted_v3",
    flags: { "gate:G1": { confirmed: true, evidence: "ok", by: "u1", at: NOW.toISOString() } },
  });
  let inFlight = 0;
  let maxInFlight = 0;
  const track = async <T>(fn: () => Promise<T>): Promise<T> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    try { return await fn(); } finally { inFlight -= 1; }
  };
  const origCounts = h.requirements.getPipelineCounts;
  const origSearch = h.requirements.search;
  const origRule = h.priorityRules.getPublished;
  const origGet = h.flags.get;
  h.requirements.getPipelineCounts = () => track(() => origCounts());
  h.requirements.search = () => track(() => origSearch());
  h.priorityRules.getPublished = () => track(() => origRule());
  h.flags.get = (name: string) => track(() => origGet(name));

  const parallelResult = await evaluate(h);
  // 3 个主查询 + 7 个人工 Gate 标志查询应在同一并行波次发出（10 个并发）
  assert.equal(maxInFlight, 10);
  assert.equal(parallelResult.gates.find((g) => g.id === "G1")?.status, "pass");

  // 提供 listByPrefix 时只调用一次前缀查询，不再逐条调 flags.get
  let getCalls = 0;
  const prefixCalls: string[] = [];
  const prefixedFlags = {
    async get() { getCalls += 1; return null; },
    async set() {},
    async listByPrefix(prefix: string) {
      prefixCalls.push(prefix);
      return [{ name: "gate:G1", value: { confirmed: true, evidence: "prefixed" }, updatedAt: NOW.toISOString() }];
    },
  };
  const prefixResult = await evaluateGates({
    flags: prefixedFlags as never,
    requirements: h.requirements as never,
    priorityRules: h.priorityRules as never,
    env: h.env,
    now: NOW,
  });
  assert.deepEqual(prefixCalls, ["gate:"]);
  assert.equal(getCalls, 0);
  assert.equal(prefixResult.gates.find((g) => g.id === "G1")?.manual.evidence, "prefixed");
});
