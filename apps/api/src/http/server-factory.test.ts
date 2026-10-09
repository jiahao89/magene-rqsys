import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./server-factory.js";

test("source adapter completes API contract endpoints and protects base health", async () => {
  const received: string[] = [];
  const app = createServer({ token: "secret", source: { list: async () => [{ id: "s1" }] } });
  const unauthorized = await app.fetch(new Request("http://localhost/api/sources"));
  assert.equal(unauthorized.status, 401);
  const authorized = await app.fetch(new Request("http://localhost/api/sources", { headers: { authorization: "Bearer secret" } }));
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { items: [{ id: "s1" }] });
  const health = await app.fetch(new Request("http://localhost/api/health"));
  assert.equal(health.status, 200);
});
