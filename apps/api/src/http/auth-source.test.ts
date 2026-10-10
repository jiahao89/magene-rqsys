// Ticket 12：服务端角色授权、受控来源创建与规则 API 生产装配。
// 公共接缝：handleApiRequest（HTTP 层）；装配验证针对 PostgresRepositories 的真实字段形状。
import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { SourceConfigRecord } from "../domain/persistence.js";
import { PostgresRepositories } from "../adapters/postgres/repositories.js";
import type { ApiDependencies, ApiRepositories } from "./app.js";
import { handleApiRequest } from "./app.js";

// 装配一致性：生产仓储组合必须满足 ApiRepositories（规则 API 曾因命名不一致返回 dependency unavailable）。
test("production repository composition exposes rules repositories to the HTTP layer", () => {
  const repositories = new PostgresRepositories({} as Pool);
  const composition: ApiRepositories = repositories;
  assert.ok(composition.dictionaries, "dictionaries repository must be wired");
  assert.ok(composition.priorityRules, "priority rules repository must be wired");
  for (const method of ["list", "get", "create", "publish"] as const) {
    assert.equal(typeof composition.dictionaries![method], "function", `dictionaries.${method} must exist`);
  }
  for (const method of ["list", "create", "publish"] as const) {
    assert.equal(typeof composition.priorityRules![method], "function", `priorityRules.${method} must exist`);
  }
});

interface AuthFixture {
  dependencies: ApiDependencies;
  sources: SourceConfigRecord[];
  auditEvents: { eventType: string; entityId: string }[];
  failAudit: () => void;
}
function makeFixture(actorRoles: string[]): AuthFixture {
  const sources: SourceConfigRecord[] = [];
  const auditEvents: { eventType: string; entityId: string }[] = [];
  let auditDown = false;
  const persistAudit = async (event: { eventType: string; entityId?: string }, entityId = event.entityId ?? "") => {
    if (auditDown) throw new Error("audit storage is down");
    auditEvents.push({ eventType: event.eventType, entityId });
  };
  const dictionaries = {
    list: async () => [{ version: 1, status: "draft" as const, entries: ["报表分析"], createdBy: "actor-1", createdAt: "2026-10-09T00:00:00.000Z", publishedAt: null }],
    get: async () => null,
    create: async (p: { entries: unknown[]; createdBy: string; now: string; auditEvent?: { eventType: string } }) => { const record = { version: 2, status: "draft" as const, entries: p.entries, createdBy: p.createdBy, createdAt: p.now, publishedAt: null }; if (p.auditEvent) await persistAudit(p.auditEvent, String(record.version)); return record; },
    publish: async () => { throw new Error("not used here"); },
  };
  const priorityRules = {
    get: async () => null,
    getPublished: async () => null,
    list: async () => [],
    create: async () => { throw new Error("not used here"); },
    publish: async () => { throw new Error("not used here"); },
  };
  const repositories: ApiRepositories = {
    sources: {
      list: async () => sources,
      get: async (id) => sources.find((s) => s.id === id) ?? null,
      update: async (id, u, event) => { const record = sources.find((s) => s.id === id); if (!record) return null; if (event) await persistAudit(event, id); return { ...record, externalProjectId: u.projectId, externalProjectName: u.projectName, requirementTypeId: u.requirementTypeId, enabled: u.enabled, scheduleEnabled: u.schedule.enabled, scheduleWeekday: u.schedule.weekday, scheduleLocalTime: u.schedule.time, scheduleTimezone: u.schedule.timezone, ownerNames: u.ownerNames, fieldMap: u.fieldMap }; },
      create: async (p) => { const record: SourceConfigRecord = { id: crypto.randomUUID(), provider: "teambition", externalProjectId: p.projectId, externalProjectName: p.projectName, requirementTypeId: p.requirementTypeId, enabled: p.enabled, scheduleEnabled: p.schedule.enabled, scheduleWeekday: p.schedule.weekday, scheduleLocalTime: p.schedule.time, scheduleTimezone: p.schedule.timezone, ownerNames: p.ownerNames, fieldMap: p.fieldMap, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" }; if (p.auditEvent) await persistAudit(p.auditEvent, record.id); sources.push(record); return record; },
    },
    dictionaries, priorityRules,
    audit: { append: async (e) => persistAudit(e), search: async () => [] },
    batches: { create: async () => { throw new Error("not used here"); }, get: async () => null, findByIdempotencyKey: async () => null, list: async () => ({ items: [], nextCursor: null }), complete: async () => null },
    items: { upsert: async () => { throw new Error("not used here"); }, get: async () => null, listByBatch: async () => [] },
    jobs: { enqueue: async () => { throw new Error("not used here"); }, claimNext: async () => null, reschedule: async () => null, complete: async () => null },
  };
  return { dependencies: { database: null, repositories, identity: { requireActor: async () => ({ id: "actor-1", roles: actorRoles }) }, now: () => new Date("2026-10-09T00:00:00.000Z") }, sources, auditEvents, failAudit: () => { auditDown = true; } };
}
const sourceBody = { projectId: "674e77e9ee4037da9d4b9f8e", projectName: "需求收集与管理", requirementTypeId: "674e7a7e5f95a1404621bb4c", enabled: true, schedule: { enabled: true, weekday: 1, time: "09:30", timezone: "Asia/Shanghai" }, ownerNames: ["李产品"], fieldMap: { description: "cf-1" } };

test("administrator creates the single source and reads it back consistently", async () => {
  const { dependencies, sources } = makeFixture(["administrator"]);
  const created = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody) }), dependencies);
  assert.equal(created.status, 201);
  const listed = await handleApiRequest(new Request("http://localhost/api/sources"), dependencies);
  const body = await listed.json() as { items: { projectId: string; projectName: string; schedule: typeof sourceBody.schedule; ownerNames: string[]; fieldMap: Record<string, string> }[] };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]!.projectId, sourceBody.projectId);
  assert.deepEqual(body.items[0]!.schedule, sourceBody.schedule);
  assert.deepEqual(body.items[0]!.ownerNames, sourceBody.ownerNames);
  assert.deepEqual(body.items[0]!.fieldMap, sourceBody.fieldMap);
  assert.equal(sources.length, 1);
  const duplicate = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody) }), dependencies);
  assert.equal(duplicate.status, 409);
});
test("source creation rejects credential fields and sensitive field-map keys", async () => {
  const { dependencies } = makeFixture(["administrator"]);
  const withCredential = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sourceBody, apiKey: "sk-should-not-appear" }) }), dependencies);
  assert.equal(withCredential.status, 400);
  const withPersonalMap = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sourceBody, fieldMap: { proposerPhone: "cf-9" } }) }), dependencies);
  assert.equal(withPersonalMap.status, 400);
  const withUnapprovedMap = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sourceBody, fieldMap: { privateAuditPayload: "cf-10" } }) }), dependencies);
  assert.equal(withUnapprovedMap.status, 400);
});
test("role matrix: configuration and rules writes are restricted server-side", async () => {
  const bodies = { source: sourceBody, dictionary: { entries: ["报表分析"] } };
  const asOperator = makeFixture(["operator"]);
  const sourceForbidden = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies.source) }), asOperator.dependencies);
  assert.equal(sourceForbidden.status, 403);
  const putForbidden = await handleApiRequest(new Request("http://localhost/api/sources/source-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies.source) }), asOperator.dependencies);
  assert.equal(putForbidden.status, 403);
  const dictionaryForbidden = await handleApiRequest(new Request("http://localhost/api/rules/dictionary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies.dictionary) }), asOperator.dependencies);
  assert.equal(dictionaryForbidden.status, 403);
  const publishForbidden = await handleApiRequest(new Request("http://localhost/api/rules/dictionary/1/publish", { method: "POST" }), asOperator.dependencies);
  assert.equal(publishForbidden.status, 403);
  const ruleCreateForbidden = await handleApiRequest(new Request("http://localhost/api/rules/priority", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: { thresholds: { p0: 4, p1: 3, p2: 2 } } }) }), asOperator.dependencies);
  assert.equal(ruleCreateForbidden.status, 403);

  const asLeader = makeFixture(["pm_leader"]);
  const dictionaryAllowed = await handleApiRequest(new Request("http://localhost/api/rules/dictionary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies.dictionary) }), asLeader.dependencies);
  assert.equal(dictionaryAllowed.status, 201);
  const sourceStillForbidden = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies.source) }), asLeader.dependencies);
  assert.equal(sourceStillForbidden.status, 403);
});
test("operator may trigger sync, retries, mapping and push; other PM roles may not", async () => {
  const asOperator = makeFixture(["operator"]);
  const sync = await handleApiRequest(new Request("http://localhost/api/sync/run", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "manual-run-0001" }, body: JSON.stringify({ sourceId: crypto.randomUUID() }) }), asOperator.dependencies);
  assert.notEqual(sync.status, 403);
  const asPm = makeFixture(["pm"]);
  for (const [path, init] of [
    ["/api/sync/run", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "manual-run-0002" }, body: JSON.stringify({ sourceId: crypto.randomUUID() }) }],
    ["/api/items/33333333-3333-4333-8333-333333333333/retry", { method: "POST" }],
    ["/api/analysis/33333333-3333-4333-8333-333333333333/retry", { method: "POST" }],
    [`/api/requirements/33333333-3333-4333-8333-333333333333/owner`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ feishuUserId: "ou-1", feishuIdType: "open_id" }) }],
    [`/api/requirements/33333333-3333-4333-8333-333333333333/push`, { method: "POST", headers: { "Idempotency-Key": "push-key-0001" } }],
  ] as const) {
    const denied = await handleApiRequest(new Request(`http://localhost${path}`, init), asPm.dependencies);
    assert.equal(denied.status, 403, `${path} must deny the pm role`);
  }
});
test("read endpoints remain available to every authenticated role", async () => {
  const asPm = makeFixture(["pm"]);
  const sources = await handleApiRequest(new Request("http://localhost/api/sources"), asPm.dependencies);
  assert.equal(sources.status, 200);
  const dictionary = await handleApiRequest(new Request("http://localhost/api/rules/dictionary"), asPm.dependencies);
  assert.equal(dictionary.status, 200);
});
test("audit write failure does not report a successful publish or source creation", async () => {
  const { dependencies, failAudit, auditEvents } = makeFixture(["administrator"]);
  failAudit();
  const created = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody) }), dependencies);
  assert.equal(created.status, 503);
  assert.equal(dependencies.repositories && await dependencies.repositories.sources.list().then((items) => items.length), 0, "source mutation must roll back when its atomic audit write fails");
  assert.equal(auditEvents.length, 0);
});
