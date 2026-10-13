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
  it("uses full-dataset metrics instead of the current requirement page size", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources") return Response.json({ items: [] });
      if (path.startsWith("/api/batches")) return Response.json({ items: [] });
      if (path.startsWith("/api/requirements")) return Response.json({ items: [{ id: "req-1", sourceRequirementId: "tb-1", title: "One visible row", sourceVersion: 1, pipeline: { pull: "synced", analysis: "pending", owner: "pending_mapping", push: "pending" } }] });
      if (path === "/api/overview/metrics") return Response.json({ counts: { total: 311, pullSynced: 311, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0 } });
      return Response.json({ items: [] });
    });

    render(<App />);

    expect(await screen.findAllByText("/ 311")).toHaveLength(4);
    expect(screen.getAllByText("全量需求数据")).toHaveLength(4);
  });

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

  it("surfaces the server rejection on source save without inventing a local role model", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources") {
        if (init?.method === "POST") return Response.json({ error: { code: "FORBIDDEN", message: "Denied." } }, { status: 403 });
        return Response.json({ items: [] });
      }
      return Response.json({ items: [] });
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "数据源配置" }));
    fireEvent.change(await screen.findByLabelText("项目名称"), { target: { value: "产品需求池" } });
    fireEvent.click(screen.getByRole("button", { name: "创建来源" }));

    // 目标环境曾出现服务端拒绝；工作台必须原样暴露，且不声称存在本地角色矩阵。
    expect(await screen.findByText(/服务端拒绝了此操作（FORBIDDEN）/)).toBeInTheDocument();
  });

  it("shows the configured plan and its next planned time from the source schedule", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources") return Response.json({ items: [{
        id: "source-1", projectName: "产品需求", enabled: true,
        schedule: { enabled: true, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" },
      }] });
      return Response.json({ items: [] });
    });

    render(<App />);

    expect(await screen.findByText("计划已配置")).toBeInTheDocument();
    expect(screen.getByText("下次计划同步")).toBeInTheDocument();
    expect(screen.getByText(/\d{4}年\d{1,2}月\d{1,2}日/)).toBeInTheDocument();
    // 只描述计划，不宣称目标环境已经或能够执行。
    expect(screen.getByText(/不代表目标环境已执行/)).toBeInTheDocument();
  });

  it("reports why a saved schedule cannot produce a next run instead of guessing one", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources") return Response.json({ items: [{
        id: "source-1", projectName: "产品需求", enabled: true,
        schedule: { enabled: true, weekday: 1, time: "09:00", timezone: "Not/AZone" },
      }] });
      return Response.json({ items: [] });
    });

    render(<App />);

    expect(await screen.findByText(/无法识别的时区：Not\/AZone/)).toBeInTheDocument();
    expect(screen.queryByText("下次计划同步")).not.toBeInTheDocument();
  });

  it("opens the function module directory and shows its current owners", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources" || path === "/api/batches" || path === "/api/requirements" || path === "/api/rules/priority" || path === "/api/rules/dictionary") return Response.json({ items: [] });
      if (path === "/api/modules") return Response.json({ version: 4, items: [{ name: "地图", personName: "盛永帮" }] });
      if (path === "/api/people") return Response.json({ items: [{ name: "盛永帮" }] });
      return Response.json({ items: [] });
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "功能模块" }));

    expect(await screen.findAllByRole("heading", { name: "功能模块" })).toHaveLength(2);
    expect(await screen.findByText("地图")).toBeInTheDocument();
    expect(screen.getAllByText("盛永帮").length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/modules", expect.anything());
  });
});
