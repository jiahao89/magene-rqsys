// Rules 管理 API 测试：公共接缝是 handleApiRequest（HTTP 层）。
// 覆盖 Spec 04「词典/规则设置」：版本化模块词典与优先级规则，规则发布前 priority 留空。
import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleDictionaryVersionRecord, PriorityRuleVersionRecord } from "../domain/persistence.js";
import type { ApiDependencies, ApiRepositories } from "./app.js";
import { handleApiRequest } from "./app.js";

function dictionaryRecord(overrides: Partial<ModuleDictionaryVersionRecord> = {}): ModuleDictionaryVersionRecord {
  return { version: 1, status: "draft", entries: ["报表分析", "数据导入"], createdBy: "actor-1", createdAt: "2026-10-09T00:00:00.000Z", publishedAt: null, ...overrides };
}
function ruleRecord(overrides: Partial<PriorityRuleVersionRecord> = {}): PriorityRuleVersionRecord {
  return { id: "55555555-5555-4555-8555-555555555555", version: 1, status: "draft", rules: { scoring: { user: { 强: 3, 中: 2 }, market: { 强: 3, 中: 2 }, business: { 强: 3, 中: 2 }, technology: { 强: 3, 中: 2 } }, thresholds: { p0: 11, p1: 8, p2: 5 } }, validationEvidence: [{ cohort: "q3" }], createdBy: "actor-1", createdAt: "2026-10-09T00:00:00.000Z", publishedAt: null, ...overrides };
}

interface RulesFixture {
  dependencies: ApiDependencies;
  dictionaries: ModuleDictionaryVersionRecord[];
  rules: PriorityRuleVersionRecord[];
  auditEvents: { eventType: string; entityType: string; entityId: string }[];
}
function makeFixture(): RulesFixture {
  const dictionaries: ModuleDictionaryVersionRecord[] = [dictionaryRecord()];
  const rules: PriorityRuleVersionRecord[] = [ruleRecord()];
  const auditEvents: RulesFixture["auditEvents"] = [];
  const repositories: ApiRepositories = {
    dictionaries: {
      list: async () => dictionaries,
      get: async (version) => dictionaries.find((d) => d.version === version) ?? null,
      create: async (p) => { const record = { version: Math.max(0, ...dictionaries.map((d) => d.version)) + 1, status: "draft" as const, entries: p.entries, createdBy: p.createdBy, createdAt: p.now, publishedAt: null }; dictionaries.push(record); if (p.auditEvent) auditEvents.push({ eventType: p.auditEvent.eventType, entityType: p.auditEvent.entityType, entityId: String(record.version) }); return record; },
      publish: async (version, publishedAt, auditEvent) => {
        const record = dictionaries.find((d) => d.version === version);
        if (!record || record.status !== "draft") throw new Error("publish requires an existing draft version");
        for (const other of dictionaries) if (other.status === "published" && other.version !== version) other.status = "retired";
        record.status = "published"; record.publishedAt = publishedAt;
        if (auditEvent) auditEvents.push({ eventType: auditEvent.eventType, entityType: auditEvent.entityType, entityId: String(version) });
        return record;
      },
    },
    priorityRules: {
      get: async (id) => rules.find((r) => r.id === id) ?? null,
      getPublished: async () => [...rules].reverse().find((r) => r.status === "published") ?? null,
      list: async () => rules,
      create: async (p) => { const record = { id: crypto.randomUUID(), version: Math.max(0, ...rules.map((r) => r.version)) + 1, status: "draft" as const, rules: p.rules, validationEvidence: p.validationEvidence, createdBy: p.createdBy, createdAt: p.now, publishedAt: null }; rules.push(record); if (p.auditEvent) auditEvents.push({ eventType: p.auditEvent.eventType, entityType: p.auditEvent.entityType, entityId: record.id }); return record; },
      publish: async (id, publishedAt, auditEvent) => {
        const record = rules.find((r) => r.id === id);
        if (!record || record.status !== "draft") throw new Error("publish requires an existing draft version");
        for (const other of rules) if (other.status === "published" && other.id !== id) other.status = "retired";
        record.status = "published"; record.publishedAt = publishedAt;
        if (auditEvent) auditEvents.push({ eventType: auditEvent.eventType, entityType: auditEvent.entityType, entityId: id });
        return record;
      },
    },
    audit: { append: async () => undefined, search: async () => [] },
    sources: { list: async () => [], get: async () => null, update: async () => null, create: async () => { throw new Error("not used in rules tests"); } },
    batches: { create: async () => { throw new Error("not used in rules tests"); }, get: async () => null, findByIdempotencyKey: async () => null, list: async () => ({ items: [], nextCursor: null }), complete: async () => null },
    items: { upsert: async () => { throw new Error("not used in rules tests"); }, get: async () => null, listByBatch: async () => [] },
    jobs: { enqueue: async () => { throw new Error("not used in rules tests"); }, claimNext: async () => null, reschedule: async () => null, complete: async () => null },
  };
  return { dependencies: { database: null, repositories, identity: { requireActor: async () => ({ id: "actor-1" }) }, now: () => new Date("2026-10-09T00:00:00.000Z") }, dictionaries, rules, auditEvents };
}
const unauthenticated: ApiDependencies = { database: null, repositories: undefined, identity: undefined, now: undefined };

test("lists module dictionary versions after authentication", async () => {
  const { dependencies } = makeFixture();
  const r = await handleApiRequest(new Request("http://localhost/api/rules/dictionary"), dependencies);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { items: [{ version: 1, status: "draft", entries: ["报表分析", "数据导入"], createdBy: "actor-1", createdAt: "2026-10-09T00:00:00.000Z", publishedAt: null }] });
});
test("rejects rules routes without an identity provider", async () => {
  const r = await handleApiRequest(new Request("http://localhost/api/rules/dictionary"), unauthenticated);
  assert.equal(r.status, 401);
});

test("creates a module dictionary draft with an auto-incremented version", async () => {
  const { dependencies, dictionaries } = makeFixture();
  const r = await handleApiRequest(new Request("http://localhost/api/rules/dictionary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: ["工单管理", "统计看板"] }) }), dependencies);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { version: 2, status: "draft", entries: ["工单管理", "统计看板"], createdBy: "actor-1", createdAt: "2026-10-09T00:00:00.000Z", publishedAt: null });
  assert.equal(dictionaries.length, 2);
});
test("rejects an empty or malformed dictionary body", async () => {
  const { dependencies } = makeFixture();
  for (const body of [{ entries: [] }, { entries: ["", "  "] }, { entries: "报表分析" }, {}]) {
    const r = await handleApiRequest(new Request("http://localhost/api/rules/dictionary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), dependencies);
    assert.equal(r.status, 400);
  }
});
test("publishes a draft dictionary and retires the previously published version", async () => {
  const { dependencies, dictionaries } = makeFixture();
  dictionaries.push({ ...dictionaryRecord(), version: 2, status: "published", publishedAt: "2026-10-08T00:00:00.000Z" });
  dictionaries[0]!.status = "draft";
  const r = await handleApiRequest(new Request("http://localhost/api/rules/dictionary/1/publish", { method: "POST" }), dependencies);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { version: 1, status: "published", entries: ["报表分析", "数据导入"], createdBy: "actor-1", createdAt: "2026-10-09T00:00:00.000Z", publishedAt: "2026-10-09T00:00:00.000Z" });
  assert.equal(dictionaries.find((d) => d.version === 2)?.status, "retired");
});
test("publishing an unknown or non-draft dictionary version fails without mutating state", async () => {
  const { dependencies, dictionaries } = makeFixture();
  dictionaries.push({ ...dictionaryRecord(), version: 2, status: "published", publishedAt: "2026-10-08T00:00:00.000Z" });
  const missing = await handleApiRequest(new Request("http://localhost/api/rules/dictionary/9/publish", { method: "POST" }), dependencies);
  assert.equal(missing.status, 404);
  const conflict = await handleApiRequest(new Request("http://localhost/api/rules/dictionary/2/publish", { method: "POST" }), dependencies);
  assert.equal(conflict.status, 409);
  assert.equal(dictionaries.find((d) => d.version === 2)?.status, "published");
});
test("audits dictionary create and publish actions", async () => {
  const { dependencies, auditEvents } = makeFixture();
  await handleApiRequest(new Request("http://localhost/api/rules/dictionary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: ["工单管理"] }) }), dependencies);
  await handleApiRequest(new Request("http://localhost/api/rules/dictionary/2/publish", { method: "POST" }), dependencies);
  assert.deepEqual(auditEvents.map((e) => `${e.eventType}:${e.entityType}:${e.entityId}`), ["dictionary.created:module_dictionary:2", "dictionary.published:module_dictionary:2"]);
});

test("lists priority rule versions after authentication", async () => {
  const { dependencies } = makeFixture();
  const r = await handleApiRequest(new Request("http://localhost/api/rules/priority"), dependencies);
  assert.equal(r.status, 200);
  const body = await r.json() as { items: { id: string; rules: unknown }[] };
  assert.equal(body.items.length, 1);
  assert.deepEqual(body.items[0]!.rules, { scoring: { user: { 强: 3, 中: 2 }, market: { 强: 3, 中: 2 }, business: { 强: 3, 中: 2 }, technology: { 强: 3, 中: 2 } }, thresholds: { p0: 11, p1: 8, p2: 5 } });
});
test("creates a priority rule draft and rejects thresholds violating the contract", async () => {
  const { dependencies, rules } = makeFixture();
  const scoring = { user: { 强: 3, 中: 2, 弱: 1 }, market: { 强: 3, 中: 2, 弱: 1 }, business: { 强: 3, 中: 2, 弱: 1 }, technology: { 强: 3, 中: 2, 弱: 1 } };
  const ok = await handleApiRequest(new Request("http://localhost/api/rules/priority", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: { scoring, thresholds: { p0: 4, p1: 2, p2: 1 } }, validationEvidence: [{ case: "c-1" }] }) }), dependencies);
  assert.equal(ok.status, 201);
  const created = await ok.json() as { version: number; status: string; rules: unknown; validationEvidence: unknown[] };
  assert.equal(created.version, 2);
  assert.deepEqual(created.rules, { scoring, thresholds: { p0: 4, p1: 2, p2: 1 } });
  assert.deepEqual(created.validationEvidence, [{ case: "c-1" }]);
  assert.equal(rules.length, 2);
  for (const rulesPayload of [
    { scoring, thresholds: { p0: 1, p1: 3, p2: 2 } },
    { scoring, thresholds: { p0: 4, p1: 3, p2: 9 } },
    { scoring, thresholds: { p0: "4", p1: 3, p2: 2 } },
    { thresholds: { p0: 4, p1: 3, p2: 2 } },
    { scoring: { ...scoring, user: {} }, thresholds: { p0: 4, p1: 3, p2: 2 } },
  ]) {
    const bad = await handleApiRequest(new Request("http://localhost/api/rules/priority", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: rulesPayload }) }), dependencies);
    assert.equal(bad.status, 400);
  }
});
test("publishes a draft priority rule and retires the previously published version", async () => {
  const { dependencies, rules } = makeFixture();
  rules.push({ ...ruleRecord(), id: "66666666-6666-4666-8666-666666666666", version: 2, status: "published", publishedAt: "2026-10-08T00:00:00.000Z" });
  rules[0]!.status = "draft";
  const r = await handleApiRequest(new Request(`http://localhost/api/rules/priority/${rules[0]!.id}/publish`, { method: "POST" }), dependencies);
  assert.equal(r.status, 200);
  const body = await r.json() as { id: string; status: string; publishedAt: string | null };
  assert.equal(body.id, rules[0]!.id);
  assert.equal(body.status, "published");
  assert.equal(body.publishedAt, "2026-10-09T00:00:00.000Z");
  assert.equal(rules.find((item) => item.version === 2)?.status, "retired");
});
test("publishing an unknown or non-draft priority rule fails", async () => {
  const { dependencies, rules } = makeFixture();
  const missing = await handleApiRequest(new Request("http://localhost/api/rules/priority/77777777-7777-4777-8777-777777777777/publish", { method: "POST" }), dependencies);
  assert.equal(missing.status, 404);
  rules[0]!.status = "published";
  rules[0]!.publishedAt = "2026-10-08T00:00:00.000Z";
  const conflict = await handleApiRequest(new Request(`http://localhost/api/rules/priority/${rules[0]!.id}/publish`, { method: "POST" }), dependencies);
  assert.equal(conflict.status, 409);
});
test("audits priority rule create and publish actions", async () => {
  const { dependencies, auditEvents } = makeFixture();
  await handleApiRequest(new Request("http://localhost/api/rules/priority", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: { scoring: { user: { 强: 3, 中: 2 }, market: { 强: 3, 中: 2 }, business: { 强: 3, 中: 2 }, technology: { 强: 3, 中: 2 } }, thresholds: { p0: 4, p1: 3, p2: 1 } } }) }), dependencies);
  const created = (dependencies.repositories as ApiRepositories).priorityRules ? await (dependencies.repositories as ApiRepositories).priorityRules!.list() : [];
  await handleApiRequest(new Request(`http://localhost/api/rules/priority/${created[0]!.id}/publish`, { method: "POST" }), dependencies);
  assert.deepEqual(auditEvents.map((e) => e.eventType), ["priority_rule.created", "priority_rule.published"]);
  assert.ok(auditEvents.every((e) => e.entityType === "priority_rule"));
});
