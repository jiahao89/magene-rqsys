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
