import assert from "node:assert/strict";
import test from "node:test";
import { SourceProjectResolutionError } from "../../application/ports.js";
import { TeambitionApiError, TeambitionClient } from "./client.js";

type JsonReply = { status?: number; payload: unknown };

function installFetch(t: import("node:test").TestContext, replies: JsonReply[]) {
  const originalFetch = globalThis.fetch;
  const requests: { url: URL; authorization: string | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: new URL(String(input)),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected Teambition request");
    return Response.json(reply.payload, { status: reply.status ?? 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  return requests;
}

test("resolves an exact project name and its unique requirement task type", async (t) => {
  const requests = installFetch(t, [
    { payload: { "project-1": { name: "室外产品-码表软固件需求池" }, "project-2": { name: "其他项目" } } },
    { payload: { "type-requirement": "需求", "type-task": "任务", "type-bug": "缺陷" } },
  ]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example/", apiKey: "test-key" });

  const resolved = await client.resolveProject("  室外产品-码表软固件需求池  ");

  assert.deepEqual(resolved, { projectId: "project-1", requirementTypeId: "type-requirement" });
  assert.equal(requests[0]?.url.pathname, "/getProjects");
  assert.equal(requests[0]?.authorization, "Bearer test-key");
  assert.equal(requests[1]?.url.pathname, "/getProjectScenarioFieldConfigs");
  assert.equal(requests[1]?.url.searchParams.get("project_id"), "project-1");
  assert.equal(requests[1]?.authorization, "Bearer test-key");
});

test("does not resolve a project by a partial or different name", async (t) => {
  const requests = installFetch(t, [{ payload: { "project-1": { name: "室外产品需求池（归档）" } } }]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key" });

  await assert.rejects(
    client.resolveProject("室外产品需求池"),
    (error: unknown) => error instanceof SourceProjectResolutionError && error.reason === "project_not_found",
  );
  assert.equal(requests.length, 1, "task types must not be queried for an unmatched project");
});

test("rejects duplicate project names instead of selecting the first project", async (t) => {
  const requests = installFetch(t, [{ payload: { "project-1": { name: "需求池" }, "project-2": { name: "需求池" } } }]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key" });

  await assert.rejects(
    client.resolveProject("需求池"),
    (error: unknown) => error instanceof SourceProjectResolutionError && error.reason === "project_ambiguous",
  );
  assert.equal(requests.length, 1, "task types must not be queried for an ambiguous project");
});

test("rejects multiple requirement task types even when one is named exactly 需求", async (t) => {
  installFetch(t, [
    { payload: { "project-1": { name: "需求池" } } },
    { payload: { "type-requirement": "需求", "type-hardware-requirement": "硬件需求" } },
  ]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key" });

  await assert.rejects(
    client.resolveProject("需求池"),
    (error: unknown) => error instanceof SourceProjectResolutionError && error.reason === "requirement_type_ambiguous",
  );
});

test("surfaces only the HTTP status for gateway failures", async (t) => {
  installFetch(t, [{ status: 403, payload: { detail: "secret-bearing upstream response" } }]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key" });

  await assert.rejects(
    client.resolveProject("需求池"),
    (error: unknown) => error instanceof TeambitionApiError && error.statusCode === 403 && !error.message.includes("secret-bearing"),
  );
});

test("fails closed at construction when the gateway URL is missing and names the env var", () => {
  assert.throws(
    () => new TeambitionClient({ baseUrl: "", apiKey: "test-key" }),
    (error: unknown) => error instanceof Error && error.message.includes("TEAMBITION_GATEWAY_URL"),
  );
});

test("fails closed at construction when the gateway API key is missing and names the env var", () => {
  assert.throws(
    () => new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "" }),
    (error: unknown) => error instanceof Error && error.message.includes("GATEWAY_API_KEY"),
  );
});

test("group pool picks the exactly named 需求 task type when several candidates match", async (t) => {
  installFetch(t, [
    { payload: { "project-1": { name: "需求收集与管理" } } },
    { payload: { "type-requirement": "需求", "type-requirement-1": "需求1" } },
  ]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key" });

  assert.deepEqual(
    await client.resolveProject("需求收集与管理", { pool: "group" }),
    { projectId: "project-1", requirementTypeId: "type-requirement" },
  );
});

test("group pool still refuses to guess when no candidate is exactly named 需求", async (t) => {
  installFetch(t, [
    { payload: { "project-1": { name: "需求收集与管理" } } },
    { payload: { "type-a": "需求1", "type-b": "需求2" } },
  ]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key" });

  await assert.rejects(
    client.resolveProject("需求收集与管理", { pool: "group" }),
    (error: unknown) => error instanceof SourceProjectResolutionError && error.reason === "requirement_type_ambiguous",
  );
});

test("product pool keeps the strict single-candidate rule even when one is named 需求", async (t) => {
  installFetch(t, [
    { payload: { "project-1": { name: "需求收集与管理" } } },
    { payload: { "type-requirement": "需求", "type-requirement-1": "需求1" } },
  ]);
  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key" });

  await assert.rejects(
    client.resolveProject("需求收集与管理", { pool: "product" }),
    (error: unknown) => error instanceof SourceProjectResolutionError && error.reason === "requirement_type_ambiguous",
  );
});

test("cancels non-2xx response bodies and does not retry 4xx failures", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let cancelled = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const stream = new ReadableStream({
      cancel() { cancelled += 1; },
    });
    return new Response(stream, { status: 404 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key", retryDelayMs: 0 });
  await assert.rejects(
    client.listOrganizationMembers(),
    (error: unknown) => error instanceof TeambitionApiError && error.statusCode === 404,
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
});

test("retries transient 5xx once (cancelling the failed body) and succeeds on recovery", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let cancelled = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      const stream = new ReadableStream({
        cancel() { cancelled += 1; },
      });
      return new Response(stream, { status: 503 });
    }
    return Response.json({ "u-1": "张三" }, { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key", retryDelayMs: 0 });
  const members = await client.listOrganizationMembers();
  assert.deepEqual(members, [{ userId: "u-1", name: "张三" }]);
  assert.equal(calls, 2);
  assert.equal(cancelled, 1);
});

test("retries transient network failures once and caps retries at 2 total attempts", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("socket hang up");
    return Response.json([{ id: "t-1", content: "A" }], { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new TeambitionClient({ baseUrl: "https://gateway.example", apiKey: "test-key", retryDelayMs: 0 });
  const tasks = await client.listRequirementTasks({
    id: "s1", projectId: "p1", projectName: "P", requirementTypeId: "rt1",
    enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null },
    ownerNames: [], fieldMap: {},
  });
  assert.equal(tasks.length, 1);
  assert.equal(calls, 2);

  calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new DOMException("aborted", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(
    client.listOrganizationMembers(),
    (error: unknown) => error instanceof TeambitionApiError && error.statusCode === null,
  );
  assert.equal(calls, 2);
});
