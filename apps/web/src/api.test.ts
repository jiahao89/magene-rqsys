import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getHealth, getOverviewMetrics, listBatches, listRequirements, listSources, retrySyncItem, runSync, searchFeishuUsers, type SourceConfig } from "./api";

const source: SourceConfig = {
  id: "source-1", projectName: "Product",
  enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null },
};

afterEach(() => vi.restoreAllMocks());

describe("workbench API client", () => {
  it("reads liveness from the local API route", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "ok", service: "rq-sys-api" }));
    await expect(getHealth(fetcher)).resolves.toEqual({ status: "ok", service: "rq-sys-api" });
    expect(fetcher).toHaveBeenCalledWith("/api/health", expect.objectContaining({ headers: { accept: "application/json" } }));
  });

  it("loads all-record overview counts from the aggregate endpoint", async () => {
    const counts = { total: 311, pullSynced: 311, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0 };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ counts }));
    await expect(getOverviewMetrics(fetcher)).resolves.toEqual(counts);
    expect(fetcher).toHaveBeenCalledWith("/api/overview/metrics", expect.objectContaining({ headers: { accept: "application/json" } }));
  });

  it("rejects malformed overview counts instead of showing partial page counts", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ counts: { total: 25 } }));
    await expect(getOverviewMetrics(fetcher)).rejects.toMatchObject({ code: "INVALID_METRICS_RESPONSE", status: 502 });
  });

  it("reports API failures without inventing fallback data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Dependency unavailable" } }, { status: 503 }));
    await expect(listSources(fetcher)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 } satisfies Partial<ApiError>);
  });

  it("posts manual runs to the contract route with an idempotency key and stable batch result", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ batchId: "batch-42", status: "running" }, { status: 202 }));
    await expect(runSync(source, "full_pipeline", fetcher, () => "key-123456")).resolves.toEqual({ batchId: "batch-42", status: "running" });
    expect(fetcher).toHaveBeenCalledWith("/api/sync/run", expect.objectContaining({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "Idempotency-Key": "key-123456" },
      body: JSON.stringify({ sourceId: source.id }),
    }));
  });

  it("does not request a run when no enabled source exists", async () => {
    const fetcher = vi.fn();
    await expect(runSync({ ...source, enabled: false }, "full_pipeline", fetcher, () => "key-123456")).rejects.toMatchObject({ code: "SOURCE_NOT_ENABLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requests a source-only import without enabling AI or Base work", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ batchId: "batch-43", status: "running" }, { status: 202 }));
    await runSync(source, "source_only", fetcher, () => "source-only-123");
    expect(fetcher).toHaveBeenCalledWith("/api/sync/run", expect.objectContaining({ body: JSON.stringify({ sourceId: source.id, mode: "source_only" }) }));
  });

  it("sends the retry idempotency key for a failed sync item", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ batchId: "batch-retry", status: "queued" }, { status: 202 }));
    await expect(retrySyncItem("item-1", fetcher, "retry-key-123")).resolves.toEqual({ batchId: "batch-retry", status: "queued" });
    expect(fetcher).toHaveBeenCalledWith("/api/items/item-1/retry", expect.objectContaining({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "Idempotency-Key": "retry-key-123" },
    }));
  });

  it("sends requirement pool filters to the server", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    await listRequirements({ q: "付款", pullState: "synced", pushState: "failed", batchId: "batch-1", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", fetcher });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/requirements?"), expect.anything());
    const url = new URL(fetcher.mock.calls[0]![0] as string, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "付款", pullState: "synced", pushState: "failed", batchId: "batch-1", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" });
  });

  it("sends batch time filters to the server", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    await listBatches({ status: "failed", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", fetcher });
    const url = new URL(fetcher.mock.calls[0]![0] as string, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "failed", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" });
  });

  it("searches Feishu user candidates through the server API", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [{ openId: "ou-ada", name: "Ada" }] }));
    await expect(searchFeishuUsers(" Ada ", fetcher)).resolves.toEqual([{ openId: "ou-ada", name: "Ada" }]);
    expect(fetcher).toHaveBeenCalledWith("/api/feishu/users?q=Ada", expect.objectContaining({ headers: { accept: "application/json" } }));
  });
});
