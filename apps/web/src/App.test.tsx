import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // 深链测试会改写地址栏：恢复默认路径，避免影响其它用例。
  window.history.replaceState(null, "", "/");
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

    expect(await screen.findByText("311 / 311")).toBeInTheDocument();
    expect(screen.getByText("状态来自全量需求聚合 API")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("link", { name: "数据源配置" }));
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
    fireEvent.click(await screen.findByRole("link", { name: "功能模块" }));

    expect(await screen.findAllByRole("heading", { name: "功能模块" })).toHaveLength(2);
    expect(await screen.findByText("地图")).toBeInTheDocument();
    expect(screen.getAllByText("盛永帮").length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/modules", expect.anything());
  });

  it("opens the requirement detail from a ?requirement= notification deep link", async () => {
    window.history.replaceState(null, "", "/?requirement=req-1");
    const row = { id: "req-1", sourceRequirementId: "tb-1", title: "需要报表", sourceVersion: 2, pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" } };
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources" || path.startsWith("/api/batches")) return Response.json({ items: [] });
      if (path === "/api/requirements/req-1") return Response.json({ ...row, analysis: null, analyses: [] });
      if (path.startsWith("/api/requirements")) return Response.json({ items: [row], nextCursor: null });
      return Response.json({ items: [] });
    });

    render(<App />);

    // 深链进入需求池并直接打开详情页，不需要用户再点列表行。
    expect(await screen.findByRole("heading", { name: "需求池" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "需要报表" })).toBeInTheDocument();
    expect(screen.getByText("REQ-tb-1 · v2")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1", expect.anything());
  });

  it("keeps the default overview when the deep-link parameter is missing or empty", async () => {
    window.history.replaceState(null, "", "/?requirement=");
    fetchMock.mockImplementation(async () => Response.json({ items: [] }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "工作流总览" })).toBeInTheDocument();
  });

  it("stores the selected workbench page in the URL", async () => {
    fetchMock.mockImplementation(async () => Response.json({ items: [] }));
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "需求池" }));

    expect(window.location.hash).toBe("#requirements");
    expect(await screen.findByRole("heading", { name: "需求池" })).toBeInTheDocument();
  });

  it("opens a functional help page from the topbar", async () => {
    fetchMock.mockImplementation(async () => Response.json({ items: [] }));
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "帮助" }));

    expect(window.location.hash).toBe("#guide");
    expect(await screen.findByRole("heading", { level: 1, name: "使用指南" })).toBeInTheDocument();
  });

  it("opens the responsive navigation as a dialog and closes it after selection", async () => {
    fetchMock.mockImplementation(async () => Response.json({ items: [] }));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开主导航" }));
    expect(screen.getByRole("dialog", { name: "主导航" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "人员" }));

    expect(window.location.hash).toBe("#people");
    expect(screen.queryByRole("dialog", { name: "主导航" })).not.toBeInTheDocument();
  });

  it("opens the requirement pool with the matching owner filter from its dashboard todo", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources") return Response.json({ items: [] });
      if (path.startsWith("/api/batches")) return Response.json({ items: [] });
      if (path === "/api/overview/metrics") return Response.json({ counts: { total: 12, pullSynced: 12, analysisAnalyzed: 8, ownerResolved: 9, pushPushed: 6, failed: 2 } });
      return Response.json({ items: [], nextCursor: null });
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /待分配负责人/ }));

    expect(window.location.hash).toBe("#requirements");
    expect(new URLSearchParams(window.location.search).get("ownerState")).toBe("pending_mapping");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("ownerState=pending_mapping"), expect.anything()));
  });

  it("opens the failed push filter from its dashboard todo", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/sources") return Response.json({ items: [] });
      if (path.startsWith("/api/batches")) return Response.json({ items: [] });
      if (path === "/api/overview/metrics") return Response.json({ counts: { total: 12, pullSynced: 12, analysisAnalyzed: 8, ownerResolved: 9, pushPushed: 6, failed: 2 } });
      return Response.json({ items: [], nextCursor: null });
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /推送失败/ }));

    expect(window.location.hash).toBe("#requirements");
    expect(new URLSearchParams(window.location.search).get("push")).toBe("failed");
  });

  it("does not present unavailable dashboard counts as zero", async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health") return Response.json({ status: "ok", service: "rq-sys-api" });
      if (path === "/api/overview/metrics") return Response.json({ error: { code: "UNAVAILABLE", message: "temporarily unavailable" } }, { status: 503 });
      return Response.json({ items: [], nextCursor: null });
    });

    render(<App />);

    const unassignedTodo = await screen.findByRole("button", { name: /待分配负责人/ });
    expect(unassignedTodo.querySelector(".todo-value")).toHaveTextContent("—");
    expect(unassignedTodo).toBeDisabled();
  });
});
