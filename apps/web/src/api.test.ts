import { describe, expect, it, vi } from "vitest";
import { ApiError, getHealth, listSources } from "./api";

describe("workbench API client", () => {
  it("reads liveness from the local API route", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "ok", service: "rq-sys-api" }));
    await expect(getHealth(fetcher)).resolves.toEqual({ status: "ok", service: "rq-sys-api" });
    expect(fetcher).toHaveBeenCalledWith("/api/health", expect.objectContaining({ headers: { accept: "application/json" } }));
  });

  it("reports API failures without inventing fallback data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Dependency unavailable" } }, { status: 503 }));
    await expect(listSources(fetcher)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 } satisfies Partial<ApiError>);
  });
});
