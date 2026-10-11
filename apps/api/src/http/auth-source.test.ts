// Ticket 12：服务端角色授权、受控来源创建与规则 API 生产装配。
// 公共接缝：handleApiRequest（HTTP 层）；装配验证针对 PostgresRepositories 的真实字段形状。
import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { SourceConfigRecord } from "../domain/persistence.js";
import { PostgresRepositories } from "../adapters/postgres/repositories.js";
import type { ApiDependencies, ApiRepositories } from "./app.js";
import { handleApiRequest } from "./app.js";
import { SourceProjectResolutionError } from "../application/ports.js";

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
function makeFixture(): AuthFixture {
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
      update: async (id, u, event) => { const index = sources.findIndex((s) => s.id === id); if (index < 0) return null; if (event) await persistAudit(event, id); const updated = { ...sources[index]!, externalProjectId: u.projectId, externalProjectName: u.projectName, requirementTypeId: u.requirementTypeId, enabled: u.enabled, scheduleEnabled: u.schedule.enabled, scheduleWeekday: u.schedule.weekday, scheduleLocalTime: u.schedule.time, scheduleTimezone: u.schedule.timezone, ownerNames: u.ownerNames, fieldMap: u.fieldMap }; sources[index] = updated; return updated; },
      create: async (p) => { const record: SourceConfigRecord = { id: crypto.randomUUID(), provider: "teambition", externalProjectId: p.projectId, externalProjectName: p.projectName, requirementTypeId: p.requirementTypeId, enabled: p.enabled, scheduleEnabled: p.schedule.enabled, scheduleWeekday: p.schedule.weekday, scheduleLocalTime: p.schedule.time, scheduleTimezone: p.schedule.timezone, ownerNames: p.ownerNames, fieldMap: p.fieldMap, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" }; if (p.auditEvent) await persistAudit(p.auditEvent, record.id); sources.push(record); return record; },
    },
    dictionaries, priorityRules,
    audit: { append: async (e) => persistAudit(e), search: async () => [] },
    batches: { create: async () => { throw new Error("not used here"); }, get: async () => null, findByIdempotencyKey: async () => null, list: async () => ({ items: [], nextCursor: null }), complete: async () => null },
    items: { upsert: async () => { throw new Error("not used here"); }, get: async () => null, listByBatch: async () => [] },
    jobs: { enqueue: async () => { throw new Error("not used here"); }, claimNext: async () => null, reschedule: async () => null, complete: async () => null },
  };
  return { dependencies: { database: null, repositories, identity: { requireActor: async () => ({ id: "actor-1" }) }, now: () => new Date("2026-10-09T00:00:00.000Z") }, sources, auditEvents, failAudit: () => { auditDown = true; } };
}
const sourceBody = { projectName: "需求收集与管理", enabled: true, schedule: { enabled: true, weekday: 1, time: "09:30", timezone: "Asia/Shanghai" } };

test("authenticated user creates the single source and reads it back consistently", async () => {
  const { dependencies, sources } = makeFixture();
  dependencies.teambitionSourceProjects = { resolveProject: async () => ({ projectId: "resolved-project-id", requirementTypeId: "resolved-requirement-type-id" }) };
  const created = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody) }), dependencies);
  assert.equal(created.status, 201);
  const listed = await handleApiRequest(new Request("http://localhost/api/sources"), dependencies);
  const body = await listed.json() as { items: { id: string; projectName: string; schedule: typeof sourceBody.schedule; enabled: boolean }[] };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]!.id, sources[0]!.id);
  assert.deepEqual(body.items[0]!.schedule, sourceBody.schedule);
  assert.equal(body.items[0]!.enabled, true);
  assert.equal("projectId" in body.items[0]!, false);
  assert.equal("requirementTypeId" in body.items[0]!, false);
  assert.equal("fieldMap" in body.items[0]!, false);
  assert.equal(sources.length, 1);
  const duplicate = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody) }), dependencies);
  assert.equal(duplicate.status, 409);
});
test("source creation rejects credentials and server-owned configuration fields", async () => {
  const { dependencies } = makeFixture();
  const withCredential = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sourceBody, apiKey: "sk-should-not-appear" }) }), dependencies);
  assert.equal(withCredential.status, 400);
  const withOwnerList = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sourceBody, ownerNames: ["李产品"] }) }), dependencies);
  assert.equal(withOwnerList.status, 400);
  const withFieldMap = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sourceBody, fieldMap: { description: "cf-1" } }) }), dependencies);
  assert.equal(withFieldMap.status, 400);
});
test("any authenticated user can configure the source and maintain module dictionaries", async () => {
  const anyUser = makeFixture();
  anyUser.dependencies.teambitionSourceProjects = { resolveProject: async () => ({ projectId: "project-1", requirementTypeId: "type-1" }) };
  const sourceCreated = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody) }), anyUser.dependencies);
  assert.equal(sourceCreated.status, 201);
  const dictionaryCreated = await handleApiRequest(new Request("http://localhost/api/rules/dictionary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: ["报表分析"] }) }), anyUser.dependencies);
  assert.equal(dictionaryCreated.status, 201);
});
test("any authenticated user can operate the sync, retry, mapping and push routes", async () => {
  const anyUser = makeFixture();
  for (const [path, init] of [
    ["/api/sync/run", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "manual-run-0002" }, body: JSON.stringify({ sourceId: crypto.randomUUID() }) }],
    ["/api/items/33333333-3333-4333-8333-333333333333/retry", { method: "POST" }],
    ["/api/analysis/33333333-3333-4333-8333-333333333333/retry", { method: "POST" }],
    ["/api/requirements/33333333-3333-4333-8333-333333333333/owner", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ feishuUserId: "ou-1", feishuIdType: "open_id" }) }],
    ["/api/requirements/33333333-3333-4333-8333-333333333333/push", { method: "POST", headers: { "Idempotency-Key": "push-key-0001" } }],
  ] as const) {
    const response = await handleApiRequest(new Request(`http://localhost${path}`, init), anyUser.dependencies);
    assert.notEqual(response.status, 403, `${path} must be available to any authenticated user`);
  }
});
test("read endpoints remain available to every authenticated user", async () => {
  const asPm = makeFixture();
  const sources = await handleApiRequest(new Request("http://localhost/api/sources"), asPm.dependencies);
  assert.equal(sources.status, 200);
  const dictionary = await handleApiRequest(new Request("http://localhost/api/rules/dictionary"), asPm.dependencies);
  assert.equal(dictionary.status, 200);
});
test("audit write failure does not report a successful publish or source creation", async () => {
  const { dependencies, failAudit, auditEvents } = makeFixture();
  dependencies.teambitionSourceProjects = { resolveProject: async () => ({ projectId: "resolved-project-id", requirementTypeId: "resolved-requirement-type-id" }) };
  failAudit();
  const created = await handleApiRequest(new Request("http://localhost/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody) }), dependencies);
  assert.equal(created.status, 503);
  assert.equal(dependencies.repositories && await dependencies.repositories.sources.list().then((items) => items.length), 0, "source mutation must roll back when its atomic audit write fails");
  assert.equal(auditEvents.length, 0);
});

test("authenticated user configures a source by project name and stores server-resolved Teambition IDs", async () => {
  const { dependencies, sources } = makeFixture();
  dependencies.teambitionSourceProjects = {
    resolveProject: async (projectName) => {
      assert.equal(projectName, "室外产品-码表软固件需求池");
      return { projectId: "resolved-project-id", requirementTypeId: "resolved-requirement-type-id" };
    },
  };
  const body = {
    projectName: "室外产品-码表软固件需求池",
    enabled: true,
    schedule: { enabled: true, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" },
  };

  const response = await handleApiRequest(new Request("http://localhost/api/sources", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), dependencies);

  assert.equal(response.status, 201);
  const created = await response.json() as Record<string, unknown>;
  assert.equal(created.projectName, body.projectName);
  assert.equal("projectId" in created, false);
  assert.equal("requirementTypeId" in created, false);
  assert.equal(sources.length, 1);
});

test("changing the project name resolves new IDs and clears project-specific server mappings", async () => {
  const { dependencies, sources } = makeFixture();
  dependencies.teambitionSourceProjects = { resolveProject: async (projectName) => {
    assert.equal(projectName, "新项目需求池");
    return { projectId: "new-project-id", requirementTypeId: "new-type-id" };
  } };
  const created = await handleApiRequest(new Request("http://localhost/api/sources", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody),
  }), { ...dependencies, teambitionSourceProjects: { resolveProject: async () => ({ projectId: "old-project-id", requirementTypeId: "old-type-id" }) } });
  assert.equal(created.status, 201);
  sources[0]!.ownerNames = ["旧项目负责人"];
  sources[0]!.fieldMap = { description: "old-description-field" };

  const response = await handleApiRequest(new Request(`http://localhost/api/sources/${sources[0]!.id}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName: "新项目需求池", enabled: true, schedule: sourceBody.schedule }),
  }), dependencies);

  assert.equal(response.status, 200);
  assert.equal(sources[0]!.externalProjectId, "new-project-id");
  assert.equal(sources[0]!.requirementTypeId, "new-type-id");
  assert.deepEqual(sources[0]!.ownerNames, []);
  assert.deepEqual(sources[0]!.fieldMap, {});
  assert.equal((await response.json() as { projectName: string }).projectName, "新项目需求池");
});

test("source setup rejects client-supplied Teambition IDs instead of bypassing name resolution", async () => {
  const { dependencies } = makeFixture();
  dependencies.teambitionSourceProjects = { resolveProject: async () => ({ projectId: "server-project-id", requirementTypeId: "server-type-id" }) };
  const response = await handleApiRequest(new Request("http://localhost/api/sources", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...sourceBody, projectId: "forged-project-id", requirementTypeId: "forged-type-id" }),
  }), dependencies);
  assert.equal(response.status, 400);
  assert.equal((await dependencies.repositories!.sources.list()).length, 0);
});

test("source setup rejects client-supplied field and owner mapping controls", async () => {
  const { dependencies } = makeFixture();
  dependencies.teambitionSourceProjects = { resolveProject: async () => ({ projectId: "server-project-id", requirementTypeId: "server-type-id" }) };
  for (const internalFields of [{ ownerNames: ["外部用户输入"] }, { fieldMap: { description: "cf-1" } }]) {
    const response = await handleApiRequest(new Request("http://localhost/api/sources", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sourceBody, ...internalFields }),
    }), dependencies);
    assert.equal(response.status, 400);
  }
});

test("source setup fails closed when server-side project resolution is unavailable", async () => {
  const { dependencies } = makeFixture();
  const response = await handleApiRequest(new Request("http://localhost/api/sources", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourceBody),
  }), dependencies);
  assert.equal(response.status, 503);
  assert.equal((await dependencies.repositories!.sources.list()).length, 0);
});

test("source setup reports a project-resolution conflict without persisting a source", async () => {
  const { dependencies, sources } = makeFixture();
  dependencies.teambitionSourceProjects = {
    resolveProject: async () => { throw new SourceProjectResolutionError("project_ambiguous", "项目名称匹配到多个项目"); },
  };
  const response = await handleApiRequest(new Request("http://localhost/api/sources", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName: "需求池", enabled: false, schedule: { enabled: false, weekday: null, time: null, timezone: null } }),
  }), dependencies);

  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: { message: string } }).error.message, "项目名称匹配到多个项目");
  assert.equal(sources.length, 0);
});
