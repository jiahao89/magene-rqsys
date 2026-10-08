import assert from "node:assert/strict";
import test from "node:test";
import { type ApiDependencies, handleApiRequest } from "./app.js";

const dependencies: ApiDependencies = { database: null };

 test("liveness reports the API service", async () => {
  const response = await handleApiRequest(new Request("http://localhost/api/health"), dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "rq-sys-api" });
});

test("readiness reports unavailable when no database is configured", async () => {
  const response = await handleApiRequest(new Request("http://localhost/api/health/ready"), dependencies);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: "not_ready",
    reason: "database_unavailable_or_not_configured",
  });
});

test("unimplemented product endpoints return an explicit 501 contract error", async () => {
  const response = await handleApiRequest(
    new Request("http://localhost/api/sources"),
    dependencies,
  );
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: {
      code: "ROUTE_NOT_IMPLEMENTED",
      message: "This endpoint is defined by the API contract and will be implemented in its ticket.",
    },
  });
});
