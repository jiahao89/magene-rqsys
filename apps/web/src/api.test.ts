import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getHealth, listSources, runSync, type SourceConfig } from "./api";

const source: SourceConfig = {
  id: "source-1", projectId: "project-1", projectName: "Product", requirementTypeId: "requirements",
  enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null }, ownerNames: [], fieldMap: {},
};

afterEach(() => vi.restoreAllMocks());

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

  it("posts manual runs to the contract route with an idempotency key and stable batch result", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ batchId: "batch-42", status: "running" }, { status: 202 }));
    await expect(runSync(source, fetcher, () => "key-123456")).resolves.toEqual({ batchId: "batch-42", status: "running" });
    expect(fetcher).toHaveBeenCalledWith("/api/sync/run", expect.objectContaining({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "Idempotency-Key": "key-123456" },
      body: JSON.stringify({ sourceId: source.id }),
    }));
  });

  it("does not request a run when no enabled source exists", async () => {
    const fetcher = vi.fn();
    await expect(runSync({ ...source, enabled: false }, fetcher, () => "key-123456")).rejects.toMatchObject({ code: "SOURCE_NOT_ENABLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
