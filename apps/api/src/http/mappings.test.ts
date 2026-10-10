// 工单 17：负责人映射列表 API 测试（GET /api/mappings，公共接缝 handleApiRequest）。
import assert from "node:assert/strict";
import test from "node:test";
import type { PersonMappingRecord, SourceConfigRecord } from "../domain/persistence.js";
import type { ApiDependencies, ApiRepositories } from "./app.js";
import { handleApiRequest } from "./app.js";

const source: SourceConfigRecord = { id: "11111111-1111-4111-8111-111111111111", provider: "teambition", externalProjectId: "p1", externalProjectName: "Project", requirementTypeId: "type1", enabled: true, scheduleEnabled: false, scheduleWeekday: null, scheduleLocalTime: null, scheduleTimezone: null, ownerNames: [], fieldMap: {}, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" };
function mappingRecord(overrides: Partial<PersonMappingRecord> = {}): PersonMappingRecord {
  return { id: "map-1", sourceConfigId: source.id, teambitionUserId: "tb-user", teambitionDisplayName: "Ada", normalizedName: "ada", feishuUserId: "ou-user", feishuIdType: "open_id", matchMethod: "manual", active: true, createdBy: "operator", createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", ...overrides };
}
function makeFixture(): ApiDependencies {
  const mappings: PersonMappingRecord[] = [mappingRecord(), mappingRecord({ id: "map-2", teambitionUserId: null, teambitionDisplayName: null, normalizedName: null, feishuUserId: "ou-auto", matchMethod: "unique_name", createdBy: null }), mappingRecord({ id: "map-inactive", feishuUserId: "ou-old", active: false })];
  const repositories: ApiRepositories = {
    sources: { list: async () => [source], get: async () => source, update: async () => null, create: async () => { throw new Error("unused"); } },
    people: { upsertManual: async () => { throw new Error("unused"); }, resolveActive: async () => null, listActive: async (sourceConfigId) => sourceConfigId === source.id ? mappings.filter((m) => m.active) : [] },
    audit: { append: async () => undefined, search: async () => [] },
    batches: { create: async () => { throw new Error("unused"); }, get: async () => null, findByIdempotencyKey: async () => null, list: async () => ({ items: [], nextCursor: null }), complete: async () => null },
    items: { upsert: async () => { throw new Error("unused"); }, get: async () => null, listByBatch: async () => [] },
    jobs: { enqueue: async () => { throw new Error("unused"); }, claimNext: async () => null, reschedule: async () => null, complete: async () => null },
  };
  return { database: null, repositories, identity: { requireActor: async () => ({ id: "actor-1", roles: ["operator"] }) }, feishuUsers: { search: async (query) => query === "Ada" ? [{ openId: "ou-ada", name: "Ada", enName: "Ada Lovelace" }] : [] }, now: () => new Date("2026-10-09T00:00:00.000Z") };
}
const unauthenticated: ApiDependencies = { database: null, repositories: undefined, identity: undefined, now: undefined };

test("lists active person mappings for the single source", async () => {
  const r = await handleApiRequest(new Request("http://localhost/api/mappings"), makeFixture());
  assert.equal(r.status, 200);
  const body = await r.json() as { items: { feishuUserId: string; matchMethod: string }[] };
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.items.map((m) => m.feishuUserId).sort(), ["ou-auto", "ou-user"]);
});
test("mappings list requires authentication", async () => {
  const r = await handleApiRequest(new Request("http://localhost/api/mappings"), unauthenticated);
  assert.equal(r.status, 401);
});
test("mappings list returns an empty page when no source is configured", async () => {
  const fixture = makeFixture();
  (fixture.repositories as ApiRepositories).sources = { list: async () => [], get: async () => null, update: async () => null, create: async () => { throw new Error("unused"); } };
  (fixture.repositories as ApiRepositories).people = { upsertManual: async () => { throw new Error("unused"); }, resolveActive: async () => null, listActive: async () => [] };
  const r = await handleApiRequest(new Request("http://localhost/api/mappings"), fixture);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { items: [] });
});

test("searches Feishu users only for an authorized operator and returns minimal candidates", async () => {
  const r = await handleApiRequest(new Request("http://localhost/api/feishu/users?q=%20Ada%20"), makeFixture());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { items: [{ openId: "ou-ada", name: "Ada", enName: "Ada Lovelace" }] });
});

test("Feishu user search validates query, requires auth, and rejects read-only roles", async () => {
  const invalid = await handleApiRequest(new Request("http://localhost/api/feishu/users?q=a"), makeFixture());
  assert.equal(invalid.status, 400);
  const unauth = await handleApiRequest(new Request("http://localhost/api/feishu/users?q=Ada"), unauthenticated);
  assert.equal(unauth.status, 401);
  const fixture = makeFixture();
  fixture.identity = { requireActor: async () => ({ id: "reader", roles: ["pm"] }) };
  const forbidden = await handleApiRequest(new Request("http://localhost/api/feishu/users?q=Ada"), fixture);
  assert.equal(forbidden.status, 403);
});
