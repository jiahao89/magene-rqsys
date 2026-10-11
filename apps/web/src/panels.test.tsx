// 工单 16/17 面板测试：数据全部来自 mock API；覆盖正向、权限拒绝与详情/重试交互。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BatchesPanel, MappingsPanel, RequirementsPanel, SourcesPanel } from "./panels";
import type { SourceConfig } from "./api";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const source: SourceConfig = { id: "source-1", projectName: "需求收集与管理", enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null } };

function jsonOk(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("SourcesPanel (ticket 16)", () => {
  it("defaults to the selected Teambition project name and sends no project or task type IDs", async () => {
    let createBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources" && init?.method === "POST") {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk({ ...source, projectName: String(createBody.projectName) }, 201);
      }
      return jsonOk({ items: [] });
    });

    render(<SourcesPanel sources={[]} loadState="ready" onRefresh={() => undefined} />);
    const projectName = screen.getByLabelText("项目名称") as HTMLInputElement;
    expect(projectName.value).toBe("室外产品-码表软固件需求池");
    expect(screen.queryByLabelText("负责人名单")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("字段映射")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建来源" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sources", expect.objectContaining({ method: "POST" })));
    if (!createBody) throw new Error("Source creation request was not captured");
    expect(createBody).toMatchObject({ projectName: "室外产品-码表软固件需求池" });
    expect(createBody).not.toHaveProperty("projectId");
    expect(createBody).not.toHaveProperty("requirementTypeId");
    expect(createBody).not.toHaveProperty("ownerNames");
    expect(createBody).not.toHaveProperty("fieldMap");
    expect(createBody.schedule).toEqual({ enabled: false, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" });
  });

  it("updates the existing source and re-reads a consistent result", async () => {
    let updateBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources/source-1" && init?.method === "PUT") {
        updateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk({ ...source, projectName: String(updateBody.projectName) });
      }
      return jsonOk(source);
    });

    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "产品需求池" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更新" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sources/source-1", expect.objectContaining({ method: "PUT" })));
    expect(await screen.findByText("来源配置已保存并从 API 重新读取一致。")).toBeInTheDocument();
    expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("产品需求池");
    expect(updateBody).toMatchObject({ projectName: "产品需求池" });
    expect(updateBody).not.toHaveProperty("ownerNames");
    expect(updateBody).not.toHaveProperty("fieldMap");
  });

  it("shows an explicit permission state instead of faking success on 403", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources/source-1" && init?.method === "PUT") {
        return jsonOk({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } }, 403);
      }
      return jsonOk(source);
    });

    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "保存更新" }));

    expect(await screen.findByText(/没有权限执行此操作/)).toBeInTheDocument();
  });
});

describe("BatchesPanel (ticket 16)", () => {
  const batch = { id: "batch-1", status: "partial_failure", totalCount: 2, succeededCount: 1, failedCount: 1, startedAt: "2026-10-09T00:00:00.000Z", triggerType: "manual", actorId: "operator-1" };

  it("opens batch detail, keeps succeeded rows visible and retries the failed item", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/batches/batch-1") {
        return jsonOk({
          batchId: "batch-1", status: "partial_failure", totalCount: 2, succeededCount: 1, failedCount: 1, items: [
            { id: "item-ok", requirementId: null, teambitionRequirementId: "tb-ok", action: "created", status: "succeeded", errorCode: null, errorDetail: null, startedAt: "2026-10-09T00:00:00.000Z", completedAt: "2026-10-09T00:00:01.000Z" },
            { id: "item-bad", requirementId: null, teambitionRequirementId: "tb-bad", action: "created", status: "failed", errorCode: "source_item_failed", errorDetail: "Requirement could not be synchronized", startedAt: "2026-10-09T00:00:00.000Z", completedAt: "2026-10-09T00:00:01.000Z" },
          ],
        });
      }
      if (path === "/api/items/item-bad/retry" && init?.method === "POST") return jsonOk({ batchId: "batch-2", status: "queued" }, 202);
      return jsonOk({ items: [batch], nextCursor: null });
    });

    render(<BatchesPanel onRefresh={() => undefined} />);
    expect(await screen.findByText("手动 · operator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看" }));

    expect(await screen.findByText("tb-ok")).toBeInTheDocument();
    expect(screen.getByText("tb-bad")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("失败项已重新入队：批次 batch-2")).toBeInTheDocument();
  });
});

describe("MappingsPanel (ticket 17)", () => {
  const pending = { id: "req-1", sourceRequirementId: "tb-1", title: "需要报表", sourceVersion: 1, pipeline: { pull: "synced", analysis: "analyzed", owner: "pending_mapping", push: "pending" } };

  it("persists a manual mapping via the API and reports the queued push", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/req-1/owner" && init?.method === "PUT") return jsonOk({ requirementId: "req-1", ownerState: "manually_mapped", status: "queued" });
      if (path === "/api/feishu/users?q=Ada") return jsonOk({ items: [{ openId: "ou-ada", name: "Ada", enName: "Ada Lovelace" }] });
      if (path === "/api/feishu/users?q=Bob") return jsonOk({ items: [
        { openId: "ou-bob", name: "Bob" },
        { openId: "ou-bobby", name: "Bobby" },
      ] });
      if (path.includes("ownerState=pending_mapping")) return jsonOk({ items: [pending], nextCursor: null });
      if (path.startsWith("/api/requirements")) return jsonOk({ items: [], nextCursor: null });
      if (path === "/api/mappings") return jsonOk({ items: [{ id: "map-1", teambitionUserId: "tb-user", teambitionDisplayName: "Ada", feishuUserId: "ou-user", feishuIdType: "open_id", matchMethod: "manual", createdBy: "operator", updatedAt: "2026-10-09T00:00:00.000Z" }] });
      throw new Error(`unexpected fetch ${path}`);
    });

    render(<MappingsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "选择飞书用户" }));
    fireEvent.change(screen.getByLabelText("搜索飞书用户"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.click(await screen.findByRole("option", { name: /Ada/ }));

    fireEvent.change(screen.getByLabelText("搜索飞书用户"), { target: { value: "Bob" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const listbox = await screen.findByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(await screen.findByText("已选择：Bobby")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/映射已持久化（manually_mapped），Base 推送已入队/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/owner", expect.objectContaining({ method: "PUT", body: JSON.stringify({ feishuUserId: "ou-bobby", feishuIdType: "open_id" }) })));
  });

  it("ignores an older directory response when the operator has changed the search query", async () => {
    let resolveAda: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/feishu/users?q=Ada") return new Promise<Response>((resolve) => { resolveAda = resolve; });
      if (path === "/api/feishu/users?q=Bob") return jsonOk({ items: [{ openId: "ou-bob", name: "Bob" }] });
      if (path.includes("ownerState=pending_mapping")) return jsonOk({ items: [pending], nextCursor: null });
      if (path.startsWith("/api/requirements")) return jsonOk({ items: [], nextCursor: null });
      if (path === "/api/mappings") return jsonOk({ items: [], nextCursor: null });
      throw new Error(`unexpected fetch ${path} ${init?.method ?? "GET"}`);
    });

    render(<MappingsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "选择飞书用户" }));
    fireEvent.change(screen.getByLabelText("搜索飞书用户"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(resolveAda).toBeTypeOf("function"));

    fireEvent.change(screen.getByLabelText("搜索飞书用户"), { target: { value: "Bob" } });
    await act(async () => { resolveAda?.(jsonOk({ items: [{ openId: "ou-ada", name: "Ada" }] })); });
    expect(screen.queryByRole("option", { name: /Ada/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("option", { name: /Bob/ })).toBeInTheDocument();
  });
});

describe("RequirementsPanel (ticket 17)", () => {
  const row = { id: "req-1", sourceRequirementId: "tb-1", title: "需要报表", sourceVersion: 2, pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" } };

  it("shows AI evidence, facts vs inference separation, and the analysis version history in detail", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path.startsWith("/api/requirements/req-1")) {
        return jsonOk({
          ...row,
          analysis: {
            module: "报表分析", priority: "P1", confidence: "中", confidence_reason: "标题提到报表",
            evidence: ["支持报表导出"], facts: [{ text: "需要月度报表", evidence: "支持报表导出" }],
            recommendations: {
              user: { recommendation: "改善用户效率", rationale: "减少重复操作", evidence: ["减少操作步骤"] },
              market: { recommendation: "市场信号不足", rationale: "没有市场数据", evidence: [], missing_evidence: true },
              business: { recommendation: "降低服务成本", rationale: "减少人工处理", evidence: ["减少人工处理"] },
              technology: { recommendation: "可行性待评估", rationale: "缺少技术约束信息", evidence: [], missing_evidence: true },
            },
            inferences: [{ text: "可能需要定时导出", ai_inference: true }], missing_inputs: ["目标用户"], blind_spots: ["价值待确认"],
          },
          analyses: [
            { analysisVersion: 1, status: "failed_retryable", moduleSuggestion: null, confidence: null, priority: null, startedAt: "2026-10-09T00:00:00.000Z", completedAt: "2026-10-09T00:00:05.000Z", safeErrorSummary: "AI provider request timed out." },
            { analysisVersion: 2, status: "analyzed", moduleSuggestion: "报表分析", confidence: "中", priority: "P1", startedAt: "2026-10-09T00:01:00.000Z", completedAt: "2026-10-09T00:01:03.000Z", safeErrorSummary: null },
          ],
        });
      }
      return jsonOk({ items: [row], nextCursor: null });
    });

    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));

    expect(await screen.findByText("支持报表导出")).toBeInTheDocument();
    expect(screen.getByText(/【AI 推断】可能需要定时导出/)).toBeInTheDocument();
    expect(screen.getByText("目标用户")).toBeInTheDocument();
    expect(screen.getByText("价值待确认")).toBeInTheDocument();
    expect(screen.getByText(/AI provider request timed out\./)).toBeInTheDocument();
    expect(screen.getByText(/事实（来自源文本）/)).toBeInTheDocument();
    expect(screen.getByText("U · 用户")).toBeInTheDocument();
    expect(screen.getByText("改善用户效率")).toBeInTheDocument();
    expect(screen.getByText(/理由：减少重复操作/)).toBeInTheDocument();
    expect(screen.getByText(/证据：减少操作步骤/)).toBeInTheDocument();
    expect(screen.getByText("M · 市场")).toBeInTheDocument();
    expect(screen.getAllByText(/证据不足/)).toHaveLength(2);
    expect(screen.getByText("S · 商业")).toBeInTheDocument();
    expect(screen.getByText("C · 技术")).toBeInTheDocument();
  });

  it("passes server-side search and filters to the requirements API", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path.startsWith("/api/requirements")) return jsonOk({ items: [row], nextCursor: "cursor-1" });
      return jsonOk({});
    });

    render(<RequirementsPanel onRefresh={() => undefined} />);
    await screen.findByText("需要报表");
    fireEvent.change(screen.getByLabelText("搜索需求标题"), { target: { value: "报表" } });
    fireEvent.change(screen.getByLabelText("负责人筛选"), { target: { value: "auto_mapped" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements?q=%E6%8A%A5%E8%A1%A8&ownerState=auto_mapped&limit=25", expect.anything()));
    expect(await screen.findByRole("button", { name: "加载更多" })).toBeInTheDocument();
  });
});
