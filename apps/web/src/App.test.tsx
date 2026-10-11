import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("RQ-Sys local workbench", () => {
  it("shows a recoverable service error instead of claiming the API is configured", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法连接到本地 API");
    expect(screen.getByRole("button", { name: "重试连接" })).toBeInTheDocument();
  });

  it("loads source configuration from the API and can request a manual sync", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ status: "ok", service: "rq-sys-api" }))
      .mockResolvedValueOnce(Response.json({ items: [{
        id: "source-1", projectId: "project-1", projectName: "产品需求", requirementTypeId: "req-type",
        enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null },
      }] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }));

    render(<App />);
    expect(await screen.findByText("产品需求")).toBeInTheDocument();
    expect(screen.getByText("还没有同步批次")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(Response.json({ batchId: "batch-42", status: "running" }, { status: 202 }));
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));

    expect(await screen.findByText("批次 batch-42 已提交")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sync/run", expect.objectContaining({ method: "POST" })));
  });

  it("renders an honest empty state when the API has no sources or batches", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ status: "ok", service: "rq-sys-api" }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }));

    render(<App />);

    expect(await screen.findByText("尚未配置数据源")).toBeInTheDocument();
    expect(screen.getByText("还没有同步批次")).toBeInTheDocument();
  });

  it("manages dictionary drafts and publishes a version from the Rules page", async () => {
    type DictionaryRow = { version: number; status: string; entries: string[]; createdBy: string; createdAt: string; publishedAt: string | null };
    const dictionaryVersions: DictionaryRow[] = [];
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources" || path === "/api/batches" || path === "/api/requirements" || path === "/api/rules/priority") return Response.json({ items: [] });
      if (path === "/api/rules/dictionary") {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body) || "{}") as { entries?: string[] };
          if (!body.entries?.length) return Response.json({ error: { code: "VALIDATION_FAILED", message: "Request validation failed." } }, { status: 400 });
          const created: DictionaryRow = { version: dictionaryVersions.length + 1, status: "draft", entries: body.entries, createdBy: "actor-1", createdAt: "2026-10-09T00:00:00.000Z", publishedAt: null };
          dictionaryVersions.push(created);
          return Response.json(created, { status: 201 });
        }
        return Response.json({ items: dictionaryVersions });
      }
      const publishMatch = path.match(/^\/api\/rules\/dictionary\/(\d+)\/publish$/);
      if (publishMatch && init?.method === "POST") {
        const record = dictionaryVersions.find((d) => d.version === Number(publishMatch[1]));
        if (!record || record.status !== "draft") return Response.json({ error: { code: "CONFLICT", message: "Conflicting concurrent operation." } }, { status: 409 });
        record.status = "published";
        record.publishedAt = "2026-10-09T02:00:00.000Z";
        return Response.json(record);
      }
      return Response.json({ error: { code: "ROUTE_NOT_IMPLEMENTED", message: "Not implemented." } }, { status: 501 });
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "分类规则" }));

    expect(await screen.findByText("还没有词典版本")).toBeInTheDocument();
    expect(screen.getByText("还没有规则版本")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "报表分析\n工单管理\n" } });
    fireEvent.click(screen.getAllByRole("button", { name: "创建草稿" })[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/rules/dictionary", expect.objectContaining({ method: "POST", body: JSON.stringify({ entries: ["报表分析", "工单管理"] }) })));
    expect(await screen.findByText("词典 v1 草稿已创建")).toBeInTheDocument();
    expect(await screen.findByText("报表分析、工单管理")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "发布" })[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/rules/dictionary/1/publish", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("词典 v1 已发布")).toBeInTheDocument();
  });
});
