// 工单 16/17 面板测试：数据全部来自 mock API；覆盖正向、权限拒绝与详情/重试交互。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BatchesPanel, MappingsPanel, ModulesPanel, PeoplePanel, RequirementsPanel, SourcesPanel } from "./panels";
import type { SourceConfig, TeamPerson } from "./api";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // 需求池会把手动筛选/详情写进 URL；恢复默认路径，避免污染其它用例。
  window.history.replaceState(null, "", "/");
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

  it("shows an explicit server-rejection state instead of faking success on 403", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources/source-1" && init?.method === "PUT") {
        return jsonOk({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } }, 403);
      }
      return jsonOk(source);
    });

    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "保存更新" }));

    // 服务端拒绝必须原样暴露：既不伪造成成功，也不归因为本地不存在的角色矩阵。
    expect(await screen.findByText(/服务端拒绝了此操作（FORBIDDEN）/)).toBeInTheDocument();
  });

  it("shows a configuration self-check that never claims to have validated credentials", async () => {
    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);
    const selfCheck = screen.getByRole("group", { name: "连接自检" });

    expect(within(selfCheck).getByText("Teambition 项目名称")).toBeInTheDocument();
    expect(within(selfCheck).getByText("周计划配置")).toBeInTheDocument();
    expect(within(selfCheck).getByText("同步开关")).toBeInTheDocument();
    expect(within(selfCheck).getAllByText(/服务端凭据/).length).toBeGreaterThan(0);
    // 凭据只存在于服务端：此处不得出现「有效」结论。
    expect(within(selfCheck).queryByText(/凭据有效/)).not.toBeInTheDocument();
  });

  it("summarises the saved schedule instead of the unsaved draft", () => {
    const scheduled = { ...source, enabled: true, schedule: { enabled: true, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" } };
    render(<SourcesPanel sources={[scheduled]} loadState="ready" onRefresh={() => undefined} />);
    const selfCheck = screen.getByRole("group", { name: "连接自检" });

    // 自检读取已保存配置：应显示计划摘要，而不是「周计划未启用」。
    expect(within(selfCheck).getByText("周一 09:00 Asia/Shanghai")).toBeInTheDocument();
    expect(within(selfCheck).queryByText(/周计划未启用/)).not.toBeInTheDocument();
  });
});

describe("BatchesPanel (ticket 16)", () => {
  const batch = { id: "batch-1", status: "partial_failure", totalCount: 2, succeededCount: 1, failedCount: 1, startedAt: "2026-10-09T00:00:00.000Z", triggerType: "manual", actorId: "operator-1" };

  it("opens batch detail, keeps succeeded rows visible and retries the failed item", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/batches/batch-1") {
        return jsonOk({
          id: "batch-1", status: "partial_failure", totalCount: 2, succeededCount: 1, failedCount: 1, items: [
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
    // 名单来自已在「负责人映射」里维护的人员，不再搜索飞书通讯录
    const picker = await screen.findByLabelText("选择负责人");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.change(picker, { target: { value: "ou-user" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/已指定为这条需求的负责人（manually_mapped），Base 推送已入队/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/owner", expect.objectContaining({ method: "PUT", body: JSON.stringify({ feishuUserId: "ou-user", feishuIdType: "open_id", tbDisplayName: "Ada" }) })));
  });

});

describe("RequirementsPanel (ticket 17)", () => {
  const row = {
    id: "req-1",
    sourceRequirementId: "tb-1",
    title: "需要报表",
    sourceVersion: 2,
    pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" },
    ownerName: "Ada",
    updatedAt: "2026-10-09T00:00:00.000Z",
    source: { created: "2026-10-08T00:00:00.000Z", description: "支持报表导出" },
  };

  function jsonOk(body: unknown, status = 200): Response {
    return Response.json(body, { status });
  }

  function detail(overrides: Record<string, unknown> = {}) {
    return { ...row, analysis: null, analyses: [], ...overrides };
  }

  function mockPanel(options: { rows?: unknown[]; detailBody?: unknown; people?: { name: string }[]; onDetail?: (path: string) => Response } = {}) {
    const rows = options.rows ?? [row];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: options.people ?? [] });
      if (path.startsWith("/api/requirements/")) {
        return options.onDetail ? options.onDetail(path) : jsonOk(options.detailBody ?? detail());
      }
      return jsonOk({ items: rows, nextCursor: null });
    });
  }

  async function openFirstRow(title = "需要报表") {
    fireEvent.click(await screen.findByText(title));
    return screen.findByRole("heading", { name: title });
  }

  it("scans a fixed row layout and opens a page-level detail instead of an inline card", async () => {
    mockPanel();
    render(<RequirementsPanel onRefresh={() => undefined} />);

    const title = await screen.findByText("需要报表");
    expect(title).toHaveAttribute("title", "需要报表");
    const listRow = title.closest("tr");
    if (!listRow) throw new Error("Requirement row was not rendered");
    expect(within(listRow).getByText("Ada")).toBeInTheDocument();
    // 四阶段中文徽标；英文原值放在 title 上，便于排查。
    expect(within(listRow).getByTitle("同步：已同步（synced）")).toBeInTheDocument();
    expect(within(listRow).getByTitle("AI 分析：已分析（analyzed）")).toBeInTheDocument();
    expect(within(listRow).getByTitle("负责人：已自动匹配（auto_mapped）")).toBeInTheDocument();
    expect(within(listRow).getByTitle("推送：已推送（pushed）")).toBeInTheDocument();
    expect(within(listRow).getByText(/\d{4}/)).toBeInTheDocument();
    // 行内唯一的交互是负责人单元格：点击直接进入分配，不必先进详情。
    const ownerButton = within(listRow).getByRole("button", { name: /Ada/ });
    expect(ownerButton).toHaveAttribute("title", "变更负责人");
    // 除负责人外不再有其他行内操作按钮；整行本身仍是进入详情的入口。
    expect(within(listRow).getAllByRole("button")).toHaveLength(1);

    await openFirstRow();

    // 列表页被详情页替换；L1/L2/L3 与来源标注同时出现。
    expect(screen.queryByText("需求列表")).not.toBeInTheDocument();
    expect(screen.getByText("需求信息")).toBeInTheDocument();
    expect(screen.getByText("来自 Teambition")).toBeInTheDocument();
    expect(screen.getByText("AI 分析与建议")).toBeInTheDocument();
    expect(screen.getByText("AI 生成 · 可被推翻")).toBeInTheDocument();
    expect(screen.getByText("处理与推送")).toBeInTheDocument();
    expect(screen.getByText("系统状态")).toBeInTheDocument();
    expect(screen.getByText("查看依据与历史")).toBeInTheDocument();
    // TB 原始字段同时使用「TB」小徽标与分区来源标注。
    expect(screen.getAllByText("TB").length).toBeGreaterThanOrEqual(8);

    fireEvent.click(screen.getByRole("button", { name: /返回需求池/ }));
    expect(await screen.findByText("需要报表")).toBeInTheDocument();
  });

  it("shows the current manual definition, labels fields as manual, and does not claim finished analysis is incomplete", async () => {
    const manualRow = {
      ...row,
      id: "req-manual",
      sourceRequirementId: null,
      sourceType: "web_manual",
      sourceChannel: "终端用户",
      title: "手工需求",
      description: "编辑后的当前描述",
      pipeline: { pull: "collected", analysis: "analyzed", owner: "not_required", push: "pushed" },
    };
    mockPanel({
      rows: [manualRow],
      detailBody: detail({
        ...manualRow,
        source: { sourceType: "web_manual", title: "手工需求", description: "初版描述" },
        analysis: { module: "爬坡", confidence: "中", priority: "P2", typeSuggestion: "体验优化", audience: [] },
        analyses: [],
        audience: { tags: [], confirmed: false, version: 0 },
        manualOwner: null,
      }),
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow("手工需求");

    // V02-T07 复查：手工来源的描述必须显示编辑后的当前值，而不是 source_payload 的初版快照。
    expect(screen.getByText("编辑后的当前描述")).toBeInTheDocument();
    expect(screen.queryByText("初版描述")).not.toBeInTheDocument();
    // 已分析完成时不能提示“AI 分析未完成”；仍保留人工重跑入口。
    expect(screen.queryByText(/AI 分析未完成/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新分析" })).toBeInTheDocument();
    // 手工来源字段不再使用 TB 徽标，改用手工徽标。
    expect(screen.queryAllByText("TB")).toHaveLength(0);
    expect(screen.getAllByText("手工").length).toBeGreaterThanOrEqual(8);
  });

  it("puts requirements waiting for human handling first, then sorts each group by update time", async () => {
    const rows = [
      { ...row, id: "req-pushed-old", title: "已推送旧", updatedAt: "2026-10-01T00:00:00.000Z" },
      { ...row, id: "req-pending", title: "待推送需求", pipeline: { ...row.pipeline, push: "pending" } },
      { ...row, id: "req-failed", title: "推送失败需求", pipeline: { ...row.pipeline, push: "failed" } },
      { ...row, id: "req-unassigned", title: "待分配需求", pipeline: { ...row.pipeline, owner: "pending_mapping" } },
      { ...row, id: "req-pushed-new", title: "已推送新", updatedAt: "2026-10-05T00:00:00.000Z" },
    ];
    mockPanel({ rows });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await screen.findByText("待分配需求");

    const order = screen.getAllByRole("row")
      .map((item) => item.getAttribute("aria-label"))
      .filter((label): label is string => Boolean(label?.startsWith("打开需求：")));
    expect(order).toEqual([
      "打开需求：待分配需求",
      "打开需求：推送失败需求",
      "打开需求：待推送需求",
      "打开需求：已推送新",
      "打开需求：已推送旧",
    ]);
    const pendingRow = screen.getByText("待分配需求").closest("tr");
    if (!pendingRow) throw new Error("Pending-owner row was not rendered");
    expect(within(pendingRow).getByText("待分配").closest(".req-owner")).toHaveClass("is-unassigned");
  });

  it("preserves loaded pages and filters when returning from the detail page", async () => {
    const second = { ...row, id: "req-2", sourceRequirementId: "tb-2", title: "第二页需求" };
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      if (path.includes("cursor=cursor-1")) return jsonOk({ items: [second], nextCursor: null });
      return jsonOk({ items: [row], nextCursor: "cursor-1" });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await screen.findByText("需要报表");
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("第二页需求")).toBeInTheDocument();

    await openFirstRow();
    fireEvent.click(screen.getByRole("button", { name: /返回需求池/ }));

    // 回到列表时第一页 + 已加载的第二页都还在，不需要重新请求。
    expect(await screen.findByText("需要报表")).toBeInTheDocument();
    expect(screen.getByText("第二页需求")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("writes filters into the URL, restores them after remount, and clears them", async () => {
    mockPanel({ rows: [row], people: [{ name: "毕梓浩" }] });
    const view = render(<RequirementsPanel onRefresh={() => undefined} />);
    await screen.findByText("需要报表");

    fireEvent.change(screen.getByLabelText("搜索需求标题"), { target: { value: "报表" } });
    fireEvent.change(screen.getByLabelText("TB负责人筛选"), { target: { value: "毕梓浩" } });
    fireEvent.change(screen.getByLabelText("同步状态筛选"), { target: { value: "synced" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    await waitFor(() => expect(new URLSearchParams(window.location.search).get("title")).toBe("报表"));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("owner")).toBe("毕梓浩");
    expect(params.get("pull")).toBe("synced");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=%E6%8A%A5%E8%A1%A8"), expect.anything()));

    view.unmount();
    render(<RequirementsPanel onRefresh={() => undefined} />);
    expect(((await screen.findByLabelText("搜索需求标题")) as HTMLInputElement).value).toBe("报表");
    expect((screen.getByLabelText("TB负责人筛选") as HTMLSelectElement).value).toBe("毕梓浩");
    expect((screen.getByLabelText("同步状态筛选") as HTMLSelectElement).value).toBe("synced");

    // 从筛选后的列表进入详情：URL 同时带筛选与 requirement，可刷新/分享直达。
    await openFirstRow();
    expect(new URLSearchParams(window.location.search).get("requirement")).toBe("req-1");
    expect(new URLSearchParams(window.location.search).get("title")).toBe("报表");
    fireEvent.click(screen.getByRole("button", { name: /返回需求池/ }));
    expect(new URLSearchParams(window.location.search).get("requirement")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("title")).toBe("报表");

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect((screen.getByLabelText("搜索需求标题") as HTMLInputElement).value).toBe("");
  });

  it("shows the suspected-duplicate notice with detail links and marks a per-requirement owner", async () => {
    mockPanel({
      detailBody: detail({
        manualOwner: { feishuUserId: "ou-owner", feishuIdType: "open_id", name: "毕梓浩", assignedAt: "2026-10-09T00:00:00.000Z" },
        duplicates: [{ id: "req-2", title: "重复的需求", teambitionRequirementId: "tb-2" }],
      }),
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    expect(screen.getByRole("note")).toHaveTextContent("发现 1 条同标题疑似重复需求");
    expect(screen.getByRole("link", { name: "重复的需求" })).toHaveAttribute("href", "?requirement=req-2");
    expect(screen.getByText("手动指定")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复默认负责人" })).toBeInTheDocument();
  });

  it("opens the detail page with the owner picker from a pending-owner row action", async () => {
    const pending = { ...row, pipeline: { ...row.pipeline, owner: "pending_mapping", push: "pending" } };
    mockPanel({ rows: [pending], detailBody: detail({ pipeline: pending.pipeline, ownerName: null }) });
    render(<RequirementsPanel onRefresh={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "分配" }));

    expect(await screen.findByRole("heading", { name: "需要报表" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分配 / 变更负责人" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("选择负责人")).toBeVisible();
    expect(window.location.search).toContain("requirement=req-1");
  });

  it("shows AI advice as cards and keeps evidence/inference/history in the folded audit area", async () => {
    mockPanel({
      detailBody: detail({
        analysis: {
          module: "报表分析", priority: "P1", confidence: "中", confidence_reason: "标题提到报表",
          evidence: ["支持报表导出"], facts: [{ text: "需要月度报表" }],
          recommendations: {
            user: { recommendation: "改善用户效率", rationale: "减少重复操作", evidence: ["减少操作步骤"] },
            market: { recommendation: "市场信号不足", rationale: "没有市场数据", evidence: [], missing_evidence: true },
            business: { recommendation: "降低服务成本", rationale: "减少人工处理", evidence: ["减少人工处理"] },
            technology: { recommendation: "可行性待评估", rationale: "缺少技术约束信息", evidence: [], missing_evidence: true },
          },
          inferences: [{ text: "可能需要定时导出" }], missing_inputs: ["目标用户"], blind_spots: ["价值待确认"],
        },
        analyses: [
          { analysisVersion: 1, status: "failed_retryable", moduleSuggestion: null, confidence: null, priority: null, startedAt: "2026-10-09T00:00:00.000Z", completedAt: "2026-10-09T00:00:05.000Z", safeErrorSummary: "AI provider request timed out." },
          { analysisVersion: 2, status: "analyzed", moduleSuggestion: "报表分析", confidence: "中", priority: "P1", startedAt: "2026-10-09T00:01:00.000Z", completedAt: "2026-10-09T00:01:03.000Z", safeErrorSummary: null },
        ],
      }),
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    // L2 卡片：维度/结论/理由，证据不足显式标红。
    expect(screen.getByText("模块建议")).toBeInTheDocument();
    expect(screen.getByText("优先级建议")).toBeInTheDocument();
    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.getByText("U · 用户")).toBeInTheDocument();
    expect(screen.getByText("改善用户效率")).toBeInTheDocument();
    expect(screen.getByText(/理由：减少重复操作/)).toBeInTheDocument();
    expect(screen.getByText(/证据：减少操作步骤/)).toBeInTheDocument();
    expect(screen.getAllByText("需要补充信息")).toHaveLength(2);
    expect(screen.getByText("C · 技术")).toBeInTheDocument();

    // L3 默认收起；展开后显示证据、推断、盲点、快照与分析版本历史。
    const trigger = screen.getByText("查看依据与历史");
    fireEvent.click(trigger);
    expect(await screen.findByText("原文证据")).toBeVisible();
    expect(screen.getByText(/【AI 推断】可能需要定时导出/)).toBeInTheDocument();
    expect(screen.getByText("目标用户")).toBeInTheDocument();
    expect(screen.getByText("价值待确认")).toBeInTheDocument();
    expect(screen.getByText(/AI provider request timed out\./)).toBeInTheDocument();
    expect(screen.getByText("源快照（只读 JSON）")).toBeInTheDocument();
  });

  it("shows 尚未分析 with an analysis trigger when no AI result exists", async () => {
    mockPanel({ detailBody: detail({ pipeline: { ...row.pipeline, analysis: "pending", push: "pending" } }) });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    expect(screen.getByText("尚未分析")).toBeInTheDocument();
    expect(screen.queryByText("模块建议")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "需求操作" })).getByRole("button", { name: "重试 AI 分析" }));
    expect(await screen.findByText("AI 分析重试已入队")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/analysis/req-1/retry", expect.objectContaining({ method: "POST" })));
  });

  it("exposes the Base record as a copyable reference without claiming PM state is readable", async () => {
    mockPanel({ detailBody: detail({ baseRecordId: "recvxwGs5Js0PA" }) });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    expect((await screen.findAllByText("recvxwGs5Js0PA")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "复制记录 ID" })).toBeInTheDocument();
    expect(screen.getByText(/请在飞书 Base 中查看/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Base/ })).not.toBeInTheDocument();
  });

  it("keeps the owner action available and explains disabled retries with titles", async () => {
    mockPanel();
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    const actions = within(await screen.findByRole("group", { name: "需求操作" }));

    expect(actions.getByRole("button", { name: "分配 / 变更负责人" })).toBeEnabled();
    const retryAnalysis = actions.getByRole("button", { name: "重新分析" });
    expect(retryAnalysis).toBeEnabled();
    expect(retryAnalysis.getAttribute("title")).toBe("重新提交 AI 分析");
    const retryPush = actions.getByRole("button", { name: "重试 Base 推送" });
    expect(retryPush).toBeDisabled();
    expect(retryPush.getAttribute("title")).toContain("无需重试");
    expect(actions.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByText(/已推送完成/)).toBeInTheDocument();
    expect(screen.queryByText(/拉取 synced/)).not.toBeInTheDocument();
  });

  it("refreshes the detail after background analysis and push finish", async () => {
    let completed = false;
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/req-1") return jsonOk({
        ...row,
        pipeline: completed ? row.pipeline : { ...row.pipeline, analysis: "pending", push: "pending" },
        analysis: null, analyses: [],
      });
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    expect(within(await screen.findByRole("group", { name: "处理状态" })).getByText("待分析")).toBeInTheDocument();
    completed = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "处理状态" })).getByText("已分析")).toBeInTheDocument());
    const refreshed = within(screen.getByRole("group", { name: "处理状态" }));
    expect(refreshed.getByText("已自动匹配")).toBeInTheDocument();
    expect(refreshed.getByText("已推送")).toBeInTheDocument();
  });

  it("returns to the list with filters intact when an older detail refresh finishes late", async () => {
    let refreshA: ((response: Response) => void) | undefined;
    let firstA = true;
    const rowB = { ...row, id: "req-2", sourceRequirementId: "tb-2", title: "另一个需求" };
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/req-1") {
        if (firstA) { firstA = false; return jsonOk(detail()); }
        return new Promise<Response>((resolve) => { refreshA = resolve; });
      }
      if (path === "/api/requirements/req-2") return jsonOk(detail(rowB));
      return jsonOk({ items: [row, rowB], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    // 先留下一个未完成的详情刷新请求，再返回列表打开另一条需求。
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(refreshA).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: /返回需求池/ }));
    expect(await screen.findByText("另一个需求")).toBeInTheDocument();
    await openFirstRow("另一个需求");
    await act(async () => { refreshA?.(jsonOk(detail())); });
    expect(screen.getByRole("heading", { name: "另一个需求" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "需要报表" })).not.toBeInTheDocument();
  });

  it("lets an operator refresh a mapped owner after a failed Base push", async () => {
    const failedRow = { ...row, pipeline: { ...row.pipeline, owner: "manually_mapped", push: "failed" } };
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/req-1") return jsonOk(detail({ pipeline: failedRow.pipeline }));
      if (path === "/api/mappings") return jsonOk({ items: [{ id: "map-alex", teambitionUserId: "tb-alex", teambitionDisplayName: "Alex Chen", feishuUserId: "ou-alex-new", feishuIdType: "open_id", matchMethod: "manual", createdBy: null, updatedAt: "2026-10-01T00:00:00Z" }] });
      if (path === "/api/requirements/req-1/owner" && init?.method === "PUT") return jsonOk({ requirementId: "req-1", ownerState: "manually_mapped", status: "queued" });
      return jsonOk({ items: [failedRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    const status = within(await screen.findByRole("group", { name: "处理状态" }));
    expect(status.getByText("已手动匹配")).toBeInTheDocument();
    expect(status.getByText("推送失败")).toBeInTheDocument();
    expect(status.getByTitle("负责人：已手动匹配（manually_mapped）")).toBeInTheDocument();
    expect(status.getByTitle("推送：推送失败（failed）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "分配 / 变更负责人" }));
    fireEvent.change(await screen.findByLabelText("选择负责人"), { target: { value: "ou-alex-new" } });
    fireEvent.click(screen.getByRole("button", { name: "变更负责人并入队推送" }));

    expect(await screen.findByText(/推送已排队/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/owner", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ feishuUserId: "ou-alex-new", feishuIdType: "open_id", tbDisplayName: "Alex Chen" }),
    })));
  });

  it("opens the requirement referenced by a notification deep link on first mount", async () => {
    mockPanel({ detailBody: detail() });
    render(<RequirementsPanel onRefresh={() => undefined} initialRequirementId="req-1" />);

    expect(await screen.findByRole("heading", { name: "需要报表" })).toBeInTheDocument();
    expect(screen.getByText("REQ-tb-1 · v2")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1", expect.anything());
  });

  it("restores filters when a deep link enters the detail page and returns to the list", async () => {
    window.history.replaceState(null, "", "/?requirement=req-1&title=%E6%8A%A5%E8%A1%A8");
    mockPanel({ detailBody: detail() });
    render(<RequirementsPanel onRefresh={() => undefined} />);

    expect(await screen.findByRole("heading", { name: "需要报表" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /返回需求池/ }));
    expect(((await screen.findByLabelText("搜索需求标题")) as HTMLInputElement).value).toBe("报表");
    expect(window.location.search).toBe("?title=%E6%8A%A5%E8%A1%A8");
  });

  it("passes server-side search and filters to the requirements API", async () => {
    mockPanel({ rows: [row], people: [{ name: "毕梓浩" }] });
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [{ name: "毕梓浩" }] });
      if (path.startsWith("/api/requirements")) return jsonOk({ items: [row], nextCursor: "cursor-1" });
      return jsonOk({});
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await screen.findByText("需要报表");
    fireEvent.change(screen.getByLabelText("搜索需求标题"), { target: { value: "报表" } });
    fireEvent.change(screen.getByLabelText("TB负责人筛选"), { target: { value: "毕梓浩" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements?q=%E6%8A%A5%E8%A1%A8&executorName=%E6%AF%95%E6%A2%93%E6%B5%A9&limit=25", expect.anything()));
    expect(await screen.findByRole("button", { name: "加载更多" })).toBeInTheDocument();
  });

  it("groups the toolbar with visible labels, keeps the date range collapsed, and clears filters", async () => {
    mockPanel({ rows: [row], people: [{ name: "毕梓浩" }] });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await screen.findByText("需要报表");

    // 查询表单式 toolbar：搜索 + 负责人 + 同步状态 常驻，其余收进「更多筛选」
    expect(screen.getByLabelText("搜索需求标题")).toBeInTheDocument();
    expect(screen.getByLabelText("TB负责人筛选")).toBeInTheDocument();
    expect(screen.getByLabelText("同步状态筛选")).toBeInTheDocument();
    const moreFilters = screen.getByText(/更多筛选/).closest("details");
    expect(moreFilters).not.toHaveAttribute("open");
    // 高级筛选控件在 details 内，收起时仍然存在于 DOM
    expect(within(moreFilters as HTMLElement).getByLabelText("负责人筛选")).toBeInTheDocument();
    expect(within(moreFilters as HTMLElement).getByLabelText("分析状态筛选")).toBeInTheDocument();
    expect(within(moreFilters as HTMLElement).getByLabelText("推送状态筛选")).toBeInTheDocument();
    expect(within(moreFilters as HTMLElement).getByLabelText("批次 ID 筛选")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("TB负责人筛选"), { target: { value: "毕梓浩" } });
    // 草稿未提交时不显示"已生效"，点「筛选」后才出现
    expect(screen.queryByText(/个筛选已生效/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(await screen.findByText("1 个筛选已生效")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.queryByText(/个筛选已生效/)).not.toBeInTheDocument();
    expect((screen.getByLabelText("TB负责人筛选") as HTMLSelectElement).value).toBe("");
  });
});

describe("团队字典维护", () => {
  it("supports adding, renaming and deleting people through the API", async () => {
    let people = [{ name: "毕梓浩" }];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string };
        people = [...people, body];
        return jsonOk({ items: people }, 201);
      }
      if (path.startsWith("/api/people/") && init?.method === "PUT") {
        const oldName = decodeURIComponent(path.split("/").at(-1) ?? "");
        const body = JSON.parse(String(init.body)) as { name: string };
        people = people.map((person) => person.name === oldName ? body : person);
        return jsonOk({ items: people });
      }
      if (path.startsWith("/api/people/") && init?.method === "DELETE") {
        const deletedName = decodeURIComponent(path.split("/").at(-1) ?? "");
        people = people.filter((person) => person.name !== deletedName);
        return jsonOk({ items: people });
      }
      if (path === "/api/people") return jsonOk({ items: people });
      throw new Error(`unexpected fetch ${path} ${init?.method ?? "GET"}`);
    });
    render(<PeoplePanel />);
    expect(await screen.findByText("毕梓浩")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("新增人员姓名"), { target: { value: "新成员" } });
    fireEvent.click(screen.getByRole("button", { name: "新增人员" }));
    expect(await screen.findByText("人员已添加。")).toBeInTheDocument();

    const newMemberRow = screen.getByText("新成员").closest("tr");
    if (!newMemberRow) throw new Error("New member row was not rendered");
    fireEvent.click(within(newMemberRow).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("编辑人员姓名"), { target: { value: "新成员改名" } });
    fireEvent.click(within(newMemberRow).getByRole("button", { name: "保存" }));
    expect(await screen.findByText("人员及模块责任关系已更新。")).toBeInTheDocument();

    const renamedRow = screen.getByText("新成员改名").closest("tr");
    if (!renamedRow) throw new Error("Renamed member row was not rendered");
    fireEvent.click(within(renamedRow).getByRole("button", { name: "删除" }));
    const personDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(personDialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("新成员改名")).toBeInTheDocument();

    fireEvent.click(within(renamedRow).getByRole("button", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("人员已删除，相关模块已解除分配。")).toBeInTheDocument();
  });

  it("binds a roster person to a Feishu account and unbinds it from the people table", async () => {
    let people: TeamPerson[] = [{ name: "贾浩", feishuUserId: null, feishuIdType: null, boundAt: null, bindingConflict: false }];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: people });
      if (path.startsWith("/api/feishu/users?")) return jsonOk({ items: [{ openId: "ou-jiahao", name: "贾浩", enName: "Jia Hao" }] });
      if (path === "/api/people/%E8%B4%BE%E6%B5%A9/feishu" && init?.method === "PUT") {
        people = [{ name: "贾浩", feishuUserId: "ou-jiahao", feishuIdType: "open_id", boundAt: "2026-10-22T00:00:00.000Z", bindingConflict: false }];
        return jsonOk({ items: people });
      }
      if (path === "/api/people/%E8%B4%BE%E6%B5%A9/feishu" && init?.method === "DELETE") {
        people = [{ name: "贾浩", feishuUserId: null, feishuIdType: null, boundAt: null, bindingConflict: false }];
        return jsonOk({ items: people });
      }
      throw new Error(`unexpected fetch ${path} ${init?.method ?? "GET"}`);
    });

    render(<PeoplePanel />);
    const row = (await screen.findByText("贾浩")).closest("tr");
    if (!row) throw new Error("Person row was not rendered");
    expect(within(row).getByText("未绑定")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "绑定飞书账号" }));

    // 打开编辑器即按姓名搜索一次，候选来自 /api/feishu/users
    const candidate = await screen.findByRole("option", { name: /贾浩/ });
    fireEvent.click(candidate);
    fireEvent.click(screen.getByRole("button", { name: "保存绑定" }));
    expect(await screen.findByText("已绑定「贾浩」的飞书账号。")).toBeInTheDocument();

    const boundRow = screen.getByText("贾浩").closest("tr");
    if (!boundRow) throw new Error("Bound person row was not rendered");
    expect(within(boundRow).getByText("已绑定")).toBeInTheDocument();
    expect(within(boundRow).getByRole("button", { name: "重新绑定" })).toBeInTheDocument();

    fireEvent.click(within(boundRow).getByRole("button", { name: "解除绑定" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认解除" }));
    expect(await screen.findByText("已解除「贾浩」的飞书账号绑定。")).toBeInTheDocument();
    const unboundRow = screen.getByText("贾浩").closest("tr");
    if (!unboundRow) throw new Error("Unbound person row was not rendered");
    expect(within(unboundRow).getByText("未绑定")).toBeInTheDocument();
  });

  it("supports creating, editing and deleting a module with a listed owner", async () => {
    let version = 2;
    let modules = [{ name: "地图", personName: "盛永帮" }];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [{ name: "盛永帮" }, { name: "贾浩" }] });
      if (path === "/api/modules" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: typeof modules };
        modules = body.items;
        version += 1;
        return jsonOk({ version, items: modules });
      }
      if (path === "/api/modules") return jsonOk({ version, items: modules });
      throw new Error(`unexpected fetch ${path} ${init?.method ?? "GET"}`);
    });
    render(<ModulesPanel />);
    expect(await screen.findByText("地图")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("功能模块名称"), { target: { value: "语音提醒" } });
    fireEvent.change(screen.getByLabelText("模块责任人员"), { target: { value: "贾浩" } });
    fireEvent.click(screen.getByRole("button", { name: "新增模块" }));
    expect(await screen.findByText("已发布模块字典 v3，后续 AI 分析将使用新版本。")).toBeInTheDocument();

    const mapRow = screen.getByText("地图").closest("tr");
    if (!mapRow) throw new Error("Module row was not rendered");
    // 行内编辑：该行的名称与负责人单元格变成输入控件，保存也在行内
    fireEvent.click(within(mapRow).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("编辑功能模块名称"), { target: { value: "导航" } });
    fireEvent.change(screen.getByLabelText("编辑模块责任人员"), { target: { value: "贾浩" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("导航")).toBeInTheDocument();

    const voiceRow = screen.getByText("语音提醒").closest("tr");
    if (!voiceRow) throw new Error("Created module row was not rendered");
    fireEvent.click(within(voiceRow).getByRole("button", { name: "删除" }));
    const moduleDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(moduleDialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("语音提醒")).toBeInTheDocument();

    fireEvent.click(within(voiceRow).getByRole("button", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("已发布模块字典 v5，后续 AI 分析将使用新版本。")).toBeInTheDocument();
    expect(screen.queryByText("语音提醒")).not.toBeInTheDocument();
  });

  it("refuses to delete the last remaining module so the dictionary cannot be emptied", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [{ name: "贾浩" }] });
      if (path === "/api/modules") return jsonOk({ version: 3, items: [{ name: "地图", personName: "贾浩" }] });
      throw new Error(`unexpected fetch ${path}`);
    });

    render(<ModulesPanel />);
    const row = (await screen.findByText("地图")).closest("tr");
    if (!row) throw new Error("Module row was not rendered");

    // Publishing an empty dictionary would retire the taxonomy in favour of nothing,
    // so the last module must not be removable from the workbench either.
    expect(within(row).getByRole("button", { name: "删除" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("RequirementsPanel intake (V02-T04)", () => {
  const intakeRow = {
    id: "req-1",
    sourceRequirementId: "tb-1",
    title: "需要报表",
    sourceVersion: 2,
    pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" },
    ownerName: "Ada",
    updatedAt: "2026-10-09T00:00:00.000Z",
    source: { created: "2026-10-08T00:00:00.000Z", description: "支持报表导出" },
  };
  const intakeDetail = { ...intakeRow, analysis: null, analyses: [] };

  it("submits title/description/channel with an idempotency key and opens the created detail", async () => {
    const posts: Array<{ init?: RequestInit }> = [];
    let detailOpened = false;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements" && init?.method === "POST") {
        posts.push({ init });
        return Response.json({ requirementId: "req-new", platformRequirementId: "RQ-000042", sourceType: "web_manual", status: "collected" }, { status: 201 });
      }
      if (path.startsWith("/api/requirements/")) { detailOpened = true; return Response.json(intakeDetail); }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "售后反馈的诉求" } });
    fireEvent.change(screen.getByLabelText("新建来源渠道"), { target: { value: "售后" } });
    fireEvent.change(screen.getByLabelText("新建需求描述"), { target: { value: "用户希望导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(new Headers(posts[0]!.init!.headers).get("Idempotency-Key")?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(JSON.parse(String(posts[0]!.init!.body))).toEqual({ title: "售后反馈的诉求", description: "用户希望导出报表", sourceChannel: "售后" });
    // 成功后打开新需求详情（AC08 成功详情入口）
    await waitFor(() => expect(detailOpened).toBe(true));
  });

  it("keeps the same idempotency key when a submission fails and is retried", async () => {
    const keys: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements" && init?.method === "POST") {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        if (keys.length === 1) return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "upstream" } }, { status: 503 });
        return Response.json({ requirementId: "req-new", sourceType: "web_manual", status: "collected" }, { status: 201 });
      }
      if (path.startsWith("/api/requirements/")) return Response.json(intakeDetail);
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "售后反馈的诉求" } });
    fireEvent.change(screen.getByLabelText("新建来源渠道"), { target: { value: "售后" } });
    fireEvent.change(screen.getByLabelText("新建需求描述"), { target: { value: "用户希望导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    await waitFor(() => expect(keys.length).toBe(2));
    expect(keys[0]).toBe(keys[1]);
  });
});
