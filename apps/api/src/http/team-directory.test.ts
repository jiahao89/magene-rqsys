import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDependencies } from "./app.js";
import { handleApiRequest } from "./app.js";
import type { FunctionModuleEntry } from "../domain/persistence.js";

function fixture() {
  let people = ["毕梓浩", "盛永帮"];
  let version = 1;
  let modules: FunctionModuleEntry[] = [{ name: "地图", personName: "盛永帮" }];
  const events: Array<{ actorId: string | null; eventType: string; safeDetails: Record<string, unknown> }> = [];
  let requirementQuery: unknown;
  const directory = {
    listPeople: async () => people,
    addPerson: async (name: string, event: { actorId: string | null; eventType: string; safeDetails: Record<string, unknown> }) => {
      people = [...people, name]; events.push(event); return people;
    },
    renamePerson: async (from: string, to: string, event: { actorId: string | null; eventType: string; safeDetails: Record<string, unknown> }) => {
      people = people.map((name) => name === from ? to : name);
      modules = modules.map((entry) => entry.personName === from ? { ...entry, personName: to } : entry);
      events.push(event); return people;
    },
    deletePerson: async (name: string, event: { actorId: string | null; eventType: string; safeDetails: Record<string, unknown> }) => {
      people = people.filter((person) => person !== name);
      modules = modules.map((entry) => entry.personName === name ? { ...entry, personName: null } : entry);
      events.push(event); return people;
    },
    listModules: async () => ({ version, items: modules }),
    saveModules: async (expected: number, next: FunctionModuleEntry[], createdBy: string, now: string, event: { actorId: string | null; eventType: string; safeDetails: Record<string, unknown> }) => {
      if (expected !== version) throw Object.assign(new Error("The team directory changed; refresh and retry."), { name: "TeamDirectoryConflict" });
      assert.equal(createdBy, "signed-in-user");
      assert.equal(now, "2026-10-13T00:00:00.000Z");
      modules = next;
      version += 1;
      events.push(event);
      return { version, items: modules };
    },
  };
  const dependencies = {
    database: null,
    identity: { requireActor: async () => ({ id: "signed-in-user" }) },
    repositories: {
      directory,
      requirements: { search: async (query: unknown) => { requirementQuery = query; return { items: [], nextCursor: null }; } },
    },
    now: () => new Date("2026-10-13T00:00:00.000Z"),
  } as unknown as ApiDependencies;
  return { dependencies, events, getPeople: () => people, getModules: () => modules, getVersion: () => version, getRequirementQuery: () => requirementQuery };
}

test("team-directory endpoints require the trusted Feishu identity", async () => {
  const { dependencies } = fixture();
  const noIdentity = { ...dependencies, identity: undefined };
  for (const path of ["/api/people", "/api/modules"]) {
    const response = await handleApiRequest(new Request(`http://localhost${path}`), noIdentity);
    assert.equal(response.status, 401);
  }
});

test("people endpoints list, add, rename and delete names with actor-attributed audit events", async () => {
  const f = fixture();
  const get = await handleApiRequest(new Request("http://localhost/api/people"), f.dependencies);
  assert.deepEqual(await get.json(), { items: [{ name: "毕梓浩" }, { name: "盛永帮" }] });

  const create = await handleApiRequest(new Request("http://localhost/api/people", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "新成员" }),
  }), f.dependencies);
  assert.equal(create.status, 201);
  assert.deepEqual(await create.json(), { items: [{ name: "毕梓浩" }, { name: "盛永帮" }, { name: "新成员" }] });

  const rename = await handleApiRequest(new Request("http://localhost/api/people/%E6%96%B0%E6%88%90%E5%91%98", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "成员B" }),
  }), f.dependencies);
  assert.equal(rename.status, 200);
  const renameOwner = await handleApiRequest(new Request("http://localhost/api/people/%E7%9B%9B%E6%B0%B8%E5%B8%AE", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "地图负责人" }),
  }), f.dependencies);
  assert.equal(renameOwner.status, 200);
  assert.equal(f.getModules()[0]?.personName, "地图负责人");

  const remove = await handleApiRequest(new Request("http://localhost/api/people/%E5%9C%B0%E5%9B%BE%E8%B4%9F%E8%B4%A3%E4%BA%BA", { method: "DELETE" }), f.dependencies);
  assert.equal(remove.status, 200);
  assert.ok(!f.getPeople().includes("地图负责人"));
  assert.deepEqual(f.getModules()[0]?.personName, null);
  assert.deepEqual(f.events.map((event) => event.eventType), ["team_person.created", "team_person.renamed", "team_person.renamed", "team_person.deleted"]);
  assert.ok(f.events.every((event) => event.actorId === "signed-in-user"));
});

test("module directory reads and saves the exact module/person dictionary as a new version", async () => {
  const f = fixture();
  const before = await handleApiRequest(new Request("http://localhost/api/modules"), f.dependencies);
  assert.deepEqual(await before.json(), { version: 1, items: [{ name: "地图", personName: "盛永帮" }] });

  const save = await handleApiRequest(new Request("http://localhost/api/modules", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, items: [{ name: "地图导航", personName: "盛永帮" }, { name: "语音提示", personName: null }] }),
  }), f.dependencies);
  assert.equal(save.status, 200);
  assert.deepEqual(await save.json(), { version: 2, items: [{ name: "地图导航", personName: "盛永帮" }, { name: "语音提示", personName: null }] });
  assert.equal(f.events.at(-1)?.eventType, "module_dictionary.updated");

  const stale = await handleApiRequest(new Request("http://localhost/api/modules", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: 1, items: [{ name: "语音提示", personName: null }] }),
  }), f.dependencies);
  assert.equal(stale.status, 409);
  assert.equal(f.getVersion(), 2);
});

test("refuses an empty module list so the active taxonomy cannot be cleared", async () => {
  const f = fixture();
  const response = await handleApiRequest(new Request("http://localhost/api/modules", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, items: [] }),
  }), f.dependencies);
  // An empty published dictionary is strictly worse than no published version:
  // readers fall back to the built-in modules only when no version is published,
  // so publishing nothing to publish would silently degrade every classification
  // to 无法识别 and stop the module field from ever reaching Base.
  assert.equal(response.status, 400);
  assert.equal(f.getVersion(), 1);
  assert.deepEqual(f.getModules(), [{ name: "地图", personName: "盛永帮" }]);
});

test("requirements API forwards exact TB-owner filtering to the server repository", async () => {
  const f = fixture();
  const response = await handleApiRequest(new Request("http://localhost/api/requirements?executorName=%E6%AF%95%E6%A2%93%E6%B5%A9"), f.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(f.getRequirementQuery(), { executorName: "毕梓浩", limit: 25 });
});
