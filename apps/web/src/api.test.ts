import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getHealth, getOverviewMetrics, getRequirement, getRequirementSourceCounts, listBatches, listRequirements, listSources, retrySyncItem, revokeDuplicateDecision, runSync, searchFeishuUsers, updateSource, type SourceConfig } from "./api";

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
    await expect(getOverviewMetrics(fetcher)).resolves.toEqual({ ...counts, ai: null });
    expect(fetcher).toHaveBeenCalledWith("/api/overview/metrics", expect.objectContaining({ headers: { accept: "application/json" } }));
  });

  it("merges the top-level ai block into the overview metrics", async () => {
    const counts = { total: 311, pullSynced: 311, analysisAnalyzed: 8, ownerResolved: 9, pushPushed: 6, failed: 2 };
    const ai = { status: "paused", statsAvailable: true, pausedUntil: "2026-11-18T10:00:00.000Z", pauseReason: "额度受限", analysis: { total: 44, today: 3 }, chatIntake: { total: 9, today: 1 }, lastCall: { at: "2026-11-18T07:30:00.000Z", kind: "analysis", result: "succeeded" } };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ counts, ai }));
    await expect(getOverviewMetrics(fetcher)).resolves.toEqual({ ...counts, ai });
  });

  it("rejects malformed overview counts instead of showing partial page counts", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ counts: { total: 25 } }));
    await expect(getOverviewMetrics(fetcher)).rejects.toMatchObject({ code: "INVALID_METRICS_RESPONSE", status: 502 });
  });

  it("reports API failures without inventing fallback data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Dependency unavailable" } }, { status: 503 }));
    await expect(listSources(fetcher)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 } satisfies Partial<ApiError>);
  });

  it("keeps the server Retry-After seconds on rate-limited errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "RATE_LIMITED", message: "操作太频繁，请稍后再试。" } }, { status: 429, headers: { "Retry-After": "42" } }));
    await expect(listSources(fetcher)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 42 } satisfies Partial<ApiError>);
  });

  it("ignores a non-numeric Retry-After instead of inventing a wait time", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "RATE_LIMITED", message: "操作太频繁，请稍后再试。" } }, { status: 429, headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" } }));
    await expect(listSources(fetcher)).rejects.toMatchObject({ status: 429, retryAfterSeconds: null } satisfies Partial<ApiError>);
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

  it("revokes a duplicate decision with DELETE and the optimistic version instead of writing a new decision", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requirementId: "req-1", processingState: "active", decision: null, version: 0 }));
    await expect(revokeDuplicateDecision("req-1", 3, fetcher)).resolves.toEqual({
      requirementId: "req-1", processingState: "active", decision: null, version: 0,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/requirements/req-1/duplicate-decision", expect.objectContaining({
      method: "DELETE",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 3 }),
    }));
  });

  it("sends requirement pool filters to the server", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    await listRequirements({ q: "付款", pullState: "synced", pushState: "failed", batchId: "batch-1", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", fetcher });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/requirements?"), expect.anything());
    const url = new URL(fetcher.mock.calls[0]![0] as string, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "付款", pullState: "synced", pushState: "failed", batchId: "batch-1", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" });
  });

  it("sends priority triage filters to the server", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    await listRequirements({ priority: "P2", sort: "priority_asc", processingState: "active", fetcher });
    const url = new URL(fetcher.mock.calls[0]![0] as string, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ priority: "P2", sort: "priority_asc", processingState: "active" });
  });

  it("sends the group pool scope on collection endpoints and keeps detail/write calls free of pool", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null, counts: { teambition: 0, web_manual: 0, base_form: 0, chat_paste: 0, all: 0 } }));
    await listRequirements({ pool: "group", fetcher });
    expect(Object.fromEntries(new URL(fetcher.mock.calls[0]![0] as string, "http://localhost").searchParams)).toEqual({ pool: "group" });
    await listBatches({ pool: "group", fetcher });
    expect(Object.fromEntries(new URL(fetcher.mock.calls[1]![0] as string, "http://localhost").searchParams)).toEqual({ pool: "group" });
    await getRequirementSourceCounts({ pool: "group", fetcher });
    expect(fetcher.mock.calls[2]![0]).toBe("/api/requirements/source-counts?pool=group");
    const detail = vi.fn().mockResolvedValue(Response.json({ id: "req-1", pool: "group" }));
    await getRequirement("req-1", detail);
    expect(detail.mock.calls[0]![0]).toBe("/api/requirements/req-1");
    expect(String(detail.mock.calls[0]![0])).not.toContain("pool=");
  });

  it("sends batch time filters to the server", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    await listBatches({ status: "failed", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", fetcher });
    const url = new URL(fetcher.mock.calls[0]![0] as string, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "failed", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" });
  });

  it("reads source counts for the requirement pool tabs", async () => {
    const counts = { teambition: 320, web_manual: 4, base_form: 12, chat_paste: 4, all: 340 };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ counts }));
    await expect(getRequirementSourceCounts({ fetcher })).resolves.toEqual(counts);
    expect(fetcher).toHaveBeenCalledWith("/api/requirements/source-counts", expect.objectContaining({ headers: { accept: "application/json" } }));
  });

  it("needs only the all count for the group pool", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ counts: { all: 7 } }));
    await expect(getRequirementSourceCounts({ pool: "group", fetcher })).resolves.toEqual({ teambition: 0, web_manual: 0, base_form: 0, chat_paste: 0, all: 7 });
    // 产品池仍要求五个键齐全，缺字段就按计数不可用降级。
    const partial = vi.fn().mockResolvedValue(Response.json({ counts: { all: 7 } }));
    await expect(getRequirementSourceCounts({ fetcher: partial })).resolves.toBeNull();
  });

  it("hides source counts instead of showing partial numbers when the endpoint is unavailable or malformed", async () => {
    const failed = vi.fn().mockResolvedValue(Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE" } }, { status: 503 }));
    await expect(getRequirementSourceCounts({ fetcher: failed })).resolves.toBeNull();
    // 缺字段或负数都按「计数不可用」处理：Tab 照常可点，只是不显示数字。
    const partial = vi.fn().mockResolvedValue(Response.json({ counts: { teambition: 1, web_manual: 2 } }));
    await expect(getRequirementSourceCounts({ fetcher: partial })).resolves.toBeNull();
    const negative = vi.fn().mockResolvedValue(Response.json({ counts: { teambition: -1, web_manual: 2, base_form: 0, chat_paste: 0, all: 1 } }));
    await expect(getRequirementSourceCounts({ fetcher: negative })).resolves.toBeNull();
  });

  it("exposes server error details for unresolved executor names", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "VALIDATION_FAILED", message: "执行人未解析", details: { unresolvedExecutorNames: ["李四"] } } }, { status: 400 }));
    await expect(updateSource("source-1", { projectName: "需求收集与管理", enabled: false, schedule: { enabled: false, weekday: 1, weekdays: [1], time: "09:00", timezone: "Asia/Shanghai" }, pool: "group", executorAllowlist: ["李四"] }, fetcher)).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { unresolvedExecutorNames: ["李四"] } });
  });

  it("searches Feishu user candidates through the server API", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [{ openId: "ou-ada", name: "Ada" }] }));
    await expect(searchFeishuUsers(" Ada ", fetcher)).resolves.toEqual([{ openId: "ou-ada", name: "Ada" }]);
    expect(fetcher).toHaveBeenCalledWith("/api/feishu/users?q=Ada", expect.objectContaining({ headers: { accept: "application/json" } }));
  });
});
