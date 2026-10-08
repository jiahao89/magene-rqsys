import type { Pool } from "pg";
import { isDatabaseReady } from "../adapters/postgres/health.js";

export interface ApiDependencies {
  database: Pool | null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function handleApiRequest(
  request: Request,
  dependencies: ApiDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "GET" && url.pathname === "/api/health") {
    return json({ status: "ok", service: "rq-sys-api" });
  }

  if (method === "GET" && url.pathname === "/api/health/ready") {
    const ready = await isDatabaseReady(dependencies.database);
    return ready
      ? json({ status: "ready", database: "connected" })
      : json({ status: "not_ready", reason: "database_unavailable_or_not_configured" }, 503);
  }

  return json(
    {
      error: {
        code: "ROUTE_NOT_IMPLEMENTED",
        message: "This endpoint is defined by the API contract and will be implemented in its ticket.",
      },
    },
    501,
  );
}

