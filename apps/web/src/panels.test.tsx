// 工单 16/17 面板测试：数据全部来自 mock API；覆盖正向、权限拒绝与详情/重试交互。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AnalysisContextSection, AuditPanel, OpsPanel, BatchesPanel, MappingsPanel, ModulesPanel, PeoplePanel, PriorityOverrideSection, RequirementsPanel, ScoringPanel, SourcesPanel, SyncRecordsPanel } from "./panels";
import { AudienceEditor, IntakeForm } from "./intake-form";
import type { RequirementDetail, SourceConfig, TeamPerson } from "./api";

/** 原生 select 已替换为 Arco Select：等待控件可用后点开下拉并按选项文字选择。 */
async function chooseArcoOption(label: string, optionText: string | RegExp) {
  const anchor = screen.getByLabelText(label);
  const root = (anchor.closest(".arco-select") ?? anchor) as HTMLElement;
  const view = (root.querySelector(".arco-select-view") ?? root) as HTMLElement;
  const matches = (el: Element) => {
    const text = (el.textContent ?? "").trim();
    return typeof optionText === "string" ? text === optionText : optionText.test(text);
  };
  const findOptions = () => [...document.querySelectorAll(".arco-select-option")].filter(matches);
  // 选项异步加载期间控件可能处于 disabled，点击会被忽略：每次轮询都重新点击，直到下拉打开且选项出现。
  await waitFor(() => {
    fireEvent.click(view);
    fireEvent.mouseDown(view);
    expect(findOptions().length, `Arco Select 选项未出现：${label} / ${String(optionText)}`).toBeGreaterThan(0);
  }, { timeout: 3000, interval: 100 });
  fireEvent.click(findOptions()[0]!);
}

/** 读取 Arco Select 当前展示的文本（用于筛选值断言）。 */
function arcoSelectText(label: string): string {
  const anchor = screen.getByLabelText(label);
  return (anchor.closest(".arco-select") ?? anchor).textContent ?? "";
}

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

describe("ScoringPanel (V02-S06)", () => {
  const scoreVersion = {
    id: "score-1", requirementId: "req-1", version: 2, status: "current" as const, origin: "manual" as const,
    sourceVersion: 1, analysisVersion: 2, ruleVersionId: "rule-v2",
    inputs: { user: { pain: 3, frequency: 4 }, market: { sellingPoint: 1, competitor: 1 }, strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 3, technicalRisk: 2, resource: 2 } },
    alpha: 0.8, score: 6.4, priority: "P3" as const, scoreConfidence: "中" as const, scoreConfidenceReason: "频次不足", safetyFlag: false,
    basis: { "user.pain": { reason: "循环选择难受", evidence: ["原文"], assumption: false } }, rationale: "单条反馈", actorId: "pm-1", changeReason: "人工复核", createdAt: "2026-10-28T01:00:00.000Z",
  };
  it("shows current score and saves edited inputs and alpha", async () => {
    let body: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") { body = JSON.parse(String(init.body)) as Record<string, unknown>; return jsonOk({ scoring: scoreVersion }); }
      return jsonOk({});
    });
    render(<ScoringPanel requirementId="req-1" scoring={{ current: scoreVersion, aiSuggestion: null, history: [scoreVersion], formula: { text: "formula", thresholds: { p0: 45, p1: 25, p2: 10 } } }} onSaved={() => undefined} />);
    expect(screen.getByText("6.40")).toBeInTheDocument();
    expect(screen.getByText("P3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑评分" }));
    fireEvent.change(screen.getByLabelText("评分 U 痛点强度"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("评分 alpha"), { target: { value: "1.0" } });
    fireEvent.change(screen.getByLabelText("评分修改理由"), { target: { value: "补充证据" } });
    fireEvent.click(screen.getByRole("button", { name: "保存评分" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/scoring", expect.objectContaining({ method: "PUT" })));
    expect((body?.inputs as { user: { pain: number } }).user.pain).toBe(4);
    expect(body?.alpha).toBe(1);
    expect(body?.reason).toBe("补充证据");
  });
  it("steps and clears Arco InputNumber score controls", async () => {
    let body: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") { body = JSON.parse(String(init.body)) as Record<string, unknown>; return jsonOk({ scoring: scoreVersion }); }
      return jsonOk({});
    });
    render(<ScoringPanel requirementId="req-1" scoring={{ current: scoreVersion, aiSuggestion: null, history: [scoreVersion], formula: { text: "formula", thresholds: { p0: 45, p1: 25, p2: 10 } } }} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑评分" }));
    const alpha = screen.getByLabelText("评分 alpha") as HTMLInputElement;
    expect(alpha.value).toBe("0.8");
    // Arco InputNumber 步进：ArrowUp 按 step=0.1 递增
    fireEvent.keyDown(alpha, { key: "ArrowUp", keyCode: 38 });
    await waitFor(() => expect((screen.getByLabelText("评分 alpha") as HTMLInputElement).value).toBe("0.9"));
    // 清空后不产生 NaN：显示为空或回落为 0 均可接受，受控值保持数字
    fireEvent.change(alpha, { target: { value: "" } });
    await waitFor(() => {
      const cleared = (screen.getByLabelText("评分 alpha") as HTMLInputElement).value;
      expect(["", "0", "0.0"]).toContain(cleared);
      expect(Number.isNaN(Number(cleared))).toBe(false);
    });
    fireEvent.change(screen.getByLabelText("评分 alpha"), { target: { value: "1.2" } });
    fireEvent.change(screen.getByLabelText("评分修改理由"), { target: { value: "步进测试" } });
    fireEvent.click(screen.getByRole("button", { name: "保存评分" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/scoring", expect.objectContaining({ method: "PUT" })));
    expect(body?.alpha).toBe(1.2);
  });

  it("offers manual fill when no score exists", () => {
    render(<ScoringPanel requirementId="req-1" scoring={null} onSaved={() => undefined} />);
    expect(screen.getByText("暂无评分")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动填写评分" })).toBeInTheDocument();
  });
});

describe("AudienceEditor (2026-10-28)", () => {
  it("defaults to the first AI suggestion without auto-saving and distinguishes save from tags", async () => {
    let body: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") { body = JSON.parse(String(init.body)) as Record<string, unknown>; return jsonOk({ requirementId: "req-1", audienceVersion: 1, confirmed: true, tags: body.tags }); }
      return jsonOk({});
    });
    render(<AudienceEditor requirementId="req-1" audience={{ tags: [], confirmed: false, version: 0 }} suggestedTags={["L2", "L5"]} onSaved={() => undefined} />);
    const choices = screen.getByRole("group", { name: "选择适用人群" });
    expect(within(choices).getByRole("button", { name: "L2 竞技级 Racing" })).toHaveAttribute("aria-pressed", "true");
    expect(within(choices).getByRole("button", { name: "L5 休闲娱乐" })).toHaveAttribute("aria-pressed", "false");
    const save = screen.getByRole("button", { name: "保存人群标签" });
    expect(save).toHaveClass("audience-save-button");
    fireEvent.click(within(choices).getByRole("button", { name: "L5 休闲娱乐" }));
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/audience", expect.objectContaining({ method: "PUT" })));
    expect(body?.tags).toEqual(["L2", "L5"]);
  });
  it("does not preselect AI suggestions when the PM has confirmed an empty set", () => {
    render(<AudienceEditor requirementId="req-1" audience={{ tags: [], confirmed: true, version: 2 }} suggestedTags={["L2"]} onSaved={() => undefined} />);
    const choices = screen.getByRole("group", { name: "选择适用人群" });
    expect(within(choices).getAllByRole("button").every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(screen.getByText("已确认为空（不再默认采用 AI 建议）")).toBeInTheDocument();
  });
});

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
    expect(createBody.schedule).toEqual({ enabled: false, weekday: 1, weekdays: [1], time: "09:00", timezone: "Asia/Shanghai" });
  });

  it("saves a multi-weekday selection", async () => {
    let updateBody: Record<string, unknown> | undefined;
    const scheduledSource: SourceConfig = { ...source, schedule: { enabled: true, weekday: 1, weekdays: [1], time: "09:00", timezone: "Asia/Shanghai" } };
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources/source-1" && init?.method === "PUT") {
        updateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk(scheduledSource);
      }
      return jsonOk(scheduledSource);
    });

    render(<SourcesPanel sources={[scheduledSource]} loadState="ready" onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "周三" }));
    fireEvent.click(screen.getByRole("button", { name: "周五" }));
    fireEvent.click(screen.getByRole("button", { name: "保存更新" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sources/source-1", expect.objectContaining({ method: "PUT" })));
    if (!updateBody) throw new Error("Source update request was not captured");
    expect((updateBody.schedule as { weekdays: number[] }).weekdays).toEqual([1, 3, 5]);
    expect((updateBody.schedule as { weekday: number }).weekday).toBe(1);
  });

  it("toggles Arco checkboxes for sync and schedule and saves booleans", async () => {
    let updateBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources/source-1" && init?.method === "PUT") {
        updateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk(source);
      }
      return jsonOk(source);
    });

    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);
    const syncEnabled = screen.getByLabelText("启用同步");
    expect(syncEnabled).toBeChecked();

    fireEvent.click(syncEnabled);
    expect(syncEnabled).not.toBeChecked();
    fireEvent.click(syncEnabled);
    expect(syncEnabled).toBeChecked();

    fireEvent.click(screen.getByLabelText("启用周计划"));
    fireEvent.click(screen.getByRole("button", { name: "保存更新" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sources/source-1", expect.objectContaining({ method: "PUT" })));
    expect(updateBody).toMatchObject({ enabled: true, schedule: expect.objectContaining({ enabled: true }) });
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

  it("shows the multi-dimensional source address and read-only sync information", async () => {
    const shareUrl = "https://aimagene.feishu.cn/share/base/shrcn6eOMLqHxXb302ggnGAyvvZ";
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/ops/metrics") return jsonOk({ metrics: { baseForm: {
        lastRunAt: "2026-11-20T08:41:02.000Z", pages: 1, scanned: 1, skipped: 0, created: 1, recorded: 1, rejected: 0, writeBackFailed: 0, readFailed: false, lastError: null, shareUrl,
      } } });
      return jsonOk({ items: [] });
    });
    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);

    expect(screen.getByRole("heading", { name: "多维表格需求收集表" })).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(await screen.findByText(shareUrl)).toBeInTheDocument();
    expect(screen.getByText("需使用公司飞书登录（仅本租户可访问）。")).toBeInTheDocument();
    expect(screen.getByText("同步规则")).toBeInTheDocument();
    expect(screen.getByText(/平台自动化每 30 分钟读取一次/)).toBeInTheDocument();
    expect(screen.getByText("最近一次同步")).toBeInTheDocument();
    expect(screen.getByText("最后运行")).toBeInTheDocument();
    expect(screen.getByText("扫描")).toBeInTheDocument();
    expect(screen.getByText("新建")).toBeInTheDocument();
    // PRD §4.11.4：不展示 pages / skipped / recorded 等内部计数。
    expect(screen.queryByText("扫描行数")).not.toBeInTheDocument();
    expect(screen.queryByText("已收录")).not.toBeInTheDocument();
    // 只读：不暴露 Base 表 ID、field ID 或 record ID。
    expect(document.body.textContent).not.toMatch(/tbl[A-Za-z0-9]{8,}/);
    expect(document.body.textContent).not.toMatch(/rec[A-Za-z0-9]{8,}/);
    expect(document.body.textContent).not.toMatch(/fld[A-Za-z0-9]{8,}/);

    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shareUrl));
    expect(await screen.findByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("hides multi-dimensional sync numbers without erroring when stats are unavailable", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/ops/metrics") return new Response(JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "upstream" } }), { status: 503, headers: { "content-type": "application/json" } });
      return jsonOk({ items: [] });
    });
    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);

    // 地址未配置时整行隐藏；统计拿不到只显示降级文案，不报错、不影响来源配置。
    expect(await screen.findByText("同步统计暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("来源地址")).not.toBeInTheDocument();
    expect(screen.queryByText("扫描")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows '尚未运行' with zero counts for a configured but never-run collection table", async () => {
    const shareUrl = "https://aimagene.feishu.cn/share/base/shrcn6eOMLqHxXb302ggnGAyvvZ";
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/ops/metrics") return jsonOk({ metrics: { baseForm: {
        shareUrl, lastRunAt: null, pages: 0, scanned: 0, skipped: 0, created: 0, recorded: 0, rejected: 0, writeBackFailed: 0, readFailed: false, lastError: null,
      } } });
      return jsonOk({ items: [] });
    });
    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);

    expect(await screen.findByText("尚未运行")).toBeInTheDocument();
    expect(screen.getByText("0 行")).toBeInTheDocument();
    expect(screen.queryByText("同步统计暂不可用")).not.toBeInTheDocument();
  });

  it("falls back to the unavailable copy when the sync stats fields are missing", async () => {
    const shareUrl = "https://aimagene.feishu.cn/share/base/shrcn6eOMLqHxXb302ggnGAyvvZ";
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/ops/metrics") return jsonOk({ metrics: { baseForm: { shareUrl, lastRunAt: null } } });
      return jsonOk({ items: [] });
    });
    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);

    expect(await screen.findByText(shareUrl)).toBeInTheDocument();
    expect(await screen.findByText("同步统计暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("尚未运行")).not.toBeInTheDocument();
  });

  it("masks record/table IDs and URLs in the last sync error", async () => {
    const shareUrl = "https://aimagene.feishu.cn/share/base/shrcn6eOMLqHxXb302ggnGAyvvZ";
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/ops/metrics") return jsonOk({ metrics: { baseForm: {
        shareUrl, lastRunAt: "2026-11-20T09:16:32.000Z", pages: 1, scanned: 1, skipped: 0, created: 0, recorded: 0, rejected: 0, writeBackFailed: 1, readFailed: false,
        lastError: "写回失败：recABC123456、tblXYZ789012 https://example.com/x?token=abc",
      } } });
      return jsonOk({ items: [] });
    });
    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);

    const errorRow = (await screen.findByText("最后错误")).closest("div");
    expect(errorRow).toHaveTextContent("rec…");
    expect(errorRow).toHaveTextContent("tbl…");
    expect(errorRow).toHaveTextContent("链接已隐藏");
    expect(errorRow).not.toHaveTextContent("recABC123456");
    expect(errorRow).not.toHaveTextContent("tblXYZ789012");
    expect(errorRow).not.toHaveTextContent("https://example.com");
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

  it("loads the next page with the applied filters instead of the unsaved dropdown value", async () => {
    const urls: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      urls.push(path);
      if (path.includes("cursor=c2")) return jsonOk({ items: [{ ...batch, id: "batch-2" }], nextCursor: null });
      return jsonOk({ items: [batch], nextCursor: "c2" });
    });
    render(<BatchesPanel onRefresh={() => undefined} />);
    await screen.findByText("手动 · operator");

    // 只改下拉、不点「筛选」：用户尚未应用的筛选条件不应进入「加载更多」请求。
    await chooseArcoOption("批次状态筛选", "失败");
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() => expect(urls.some((url) => url.includes("cursor=c2"))).toBe(true));
    const cursorUrl = urls.find((url) => url.includes("cursor=c2"))!;
    expect(cursorUrl).not.toContain("status=");
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
    await screen.findByLabelText("选择负责人");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await chooseArcoOption("选择负责人", "Ada");
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

  function mockPanel(options: { rows?: unknown[]; detailBody?: unknown; people?: { name: string }[]; sourceCounts?: Record<string, number>; onDetail?: (path: string) => Response } = {}) {
    const rows = options.rows ?? [row];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: options.people ?? [] });
      if (path === "/api/requirements/source-counts") return options.sourceCounts
        ? jsonOk({ counts: options.sourceCounts })
        : new Response("not found", { status: 404 });
      if (path.startsWith("/api/requirements/export")) {
        return new Response("\uFEFF平台ID,TB需求ID\r\nRQ-000001,tb-1", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "x-rq-truncated": "false" } });
      }
      if (path.startsWith("/api/requirements/")) {
        return options.onDetail ? options.onDetail(path) : jsonOk(options.detailBody ?? detail());
      }
      return jsonOk({ items: rows, nextCursor: null });
    });
  }

  // PRD-28：需求评估契约夹具（一次调用同时产出结论与 Investigation 提示词）。
  const assessmentOutputBase = {
    background: "售后反馈夜间骑行提示音过大，影响队友。",
    goal: "降低夜间场景的提示音干扰。",
    scope: { in: ["音量分级", "夜间静音模式"], out: ["更改硬件扬声器"] },
    value: "提升夜间骑行体验，减少售后投诉。",
    feasibility: { technical: "固件可调音量曲线", cost: "约 3 人日", dependency: "依赖 C706 固件 2.3", risk: "法规提示音要求" },
    verdict: "advance",
    verdictReason: "场景明确，改动在固件范围内。",
    confidence: "high",
    assumptions: ["夜间骑行占比约 15%"],
    openQuestions: ["是否需要保留最低提示音量？"],
    investigationPrompt: "请调查夜间骑行用户对提示音的接受度，并输出 PRD 章节建议。",
  };
  function assessmentVersion(version: number, outputPatch: Record<string, unknown> = {}) {
    return { id: `assessment-${version}`, requirementId: "req-1", version, status: "succeeded", promptVersion: "rq-assessment-v1", model: "stub-model", inputs: { background: "", goal: "", scenario: "" }, output: { ...assessmentOutputBase, ...outputPatch }, errorCode: null, createdBy: null, createdAt: `2026-11-20T0${version}:00:00.000Z` };
  }

  async function openFirstRow(title = "需要报表") {
    fireEvent.click(await screen.findByText(title));
    return screen.findByRole("heading", { name: title });
  }

  it("exports the applied filters as a CSV download", async () => {
    mockPanel();
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as never;
    URL.revokeObjectURL = revokeObjectURL as never;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      render(<RequirementsPanel onRefresh={() => undefined} />);
      await screen.findByText("需要报表");
      fireEvent.change(screen.getByLabelText("搜索需求标题"), { target: { value: "报表" } });
      fireEvent.click(screen.getByRole("button", { name: "筛选" }));
      fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/requirements/export?q=%E6%8A%A5%E8%A1%A8")));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
      expect(click).toHaveBeenCalled();
      expect(await screen.findByText("已导出当前筛选结果。")).toBeInTheDocument();
    } finally {
      click.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("marks requirements that disappeared from the latest full sync (Q4)", async () => {
    const missingRow = { ...row, sourceMissingSince: "2026-11-11T00:00:00.000Z" };
    mockPanel({ rows: [missingRow], detailBody: detail({ sourceMissingSince: "2026-11-11T00:00:00.000Z" }) });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    expect(await screen.findByText("来源已移除")).toBeInTheDocument();
    await openFirstRow();
    expect(screen.getByText(/已不在最近一次全量同步中/)).toBeInTheDocument();
  });

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
    expect(screen.getByText("AI 评分与优先级")).toBeInTheDocument();
    expect(screen.getByText("适用人群")).toBeInTheDocument();
    expect(screen.getByText("处理与推送")).toBeInTheDocument();
    expect(screen.getByText("系统状态")).toBeInTheDocument();
    // TB 需求有稳定来源身份，重复判定区块应当可见。
    expect(screen.getByRole("heading", { name: "重复处理" })).toBeInTheDocument();
    expect(screen.getByText("查看依据与历史")).toBeInTheDocument();
    // TB 原始字段同时使用「TB」小徽标与分区来源标注。
    expect(screen.getAllByText("TB").length).toBeGreaterThanOrEqual(8);
    // Teambition 来源只读，不提供「编辑需求」入口。
    expect(screen.queryByRole("button", { name: "编辑需求" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /返回需求池/ }));
    expect(await screen.findByText("需要报表")).toBeInTheDocument();
  });

  it("puts score and priority in the detail summary card and keeps one integrated AI scoring section", async () => {
    mockPanel({
      detailBody: detail({
        analysis: { module: "报表分析", confidence: "中", recommendations: {} },
        scoring: {
          current: {
            id: "score-summary", requirementId: "req-1", version: 2, status: "current", origin: "ai",
            sourceVersion: 1, analysisVersion: 2, ruleVersionId: "rule-v2",
            inputs: { user: { pain: 3, frequency: 4 }, market: { sellingPoint: 1, competitor: 1 }, strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 3, technicalRisk: 2, resource: 2 } },
            alpha: 0.8, score: 6.4, priority: "P3", scoreConfidence: "中", scoreConfidenceReason: "频次不足", safetyFlag: false,
            basis: {}, rationale: null, actorId: null, changeReason: null, createdAt: "2026-10-28T01:00:00.000Z",
          },
          aiSuggestion: null, history: [], formula: { text: "formula", thresholds: { p0: 45, p1: 25, p2: 10 } },
        },
      }),
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    const summary = screen.getByLabelText("评分与优先级摘要");
    expect(within(summary).getByText("6.40")).toBeInTheDocument();
    expect(within(summary).getByText("P3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /返回需求池/ }).closest(".req-summary-backbar")).not.toBeNull();
    expect(screen.getByText("AI 评分与优先级")).toBeInTheDocument();
    expect(screen.queryByText("AI 分析与建议")).not.toBeInTheDocument();
    expect(screen.getByText("U · 用户价值")).toBeInTheDocument();
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
    // 非 TB 来源不挂字段来源徽标：整页没有 TB，也没有字段徽标，只保留字段名。
    expect(screen.queryAllByText("TB")).toHaveLength(0);
    expect(document.querySelectorAll(".req-field-label .tb-badge")).toHaveLength(0);
    expect(screen.getAllByText("标题").length).toBeGreaterThan(0);
    // 非 TB 来源不再渲染执行人/状态/链接/更新时间这些 TB 专属空字段；没有提出人时整块不渲染。
    expect(screen.queryByText("执行人")).not.toBeInTheDocument();
    expect(screen.queryByText("更新时间")).not.toBeInTheDocument();
    // 重复判定按 (来源配置, TB 需求ID) 保存，手工需求没有这个身份、后端会 404：不渲染该区块。
    expect(screen.queryByRole("heading", { name: "重复处理" })).not.toBeInTheDocument();
    // PRD-31：相似需求只读区块只用于 base_form 详情，手工来源不渲染。
    expect(screen.queryByRole("heading", { name: /相似需求/ })).not.toBeInTheDocument();
    // 手工来源可编辑，但没有「收集表」这回事：不显示多维表格专属提示。
    fireEvent.click(screen.getByRole("button", { name: "编辑需求" }));
    expect(screen.getByLabelText("编辑需求标题")).toBeInTheDocument();
    expect(screen.queryByText("修改只保存在需求平台，不会写回多维表格收集表。")).not.toBeInTheDocument();
  });

  it("allows editing base_form requirements with a platform-only note (PRD-30)", async () => {
    const baseRow = {
      ...row,
      id: "req-base-edit",
      sourceRequirementId: null,
      sourceType: "base_form",
      sourceChannel: "销售",
      title: "收集表需求",
      source: { sourceType: "base_form", proposerName: "贾浩", formRecordId: "rec-1" },
    };
    mockPanel({
      rows: [baseRow],
      detailBody: detail({ ...baseRow, analysis: null, analyses: [] }),
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow("收集表需求");

    fireEvent.click(screen.getByRole("button", { name: "编辑需求" }));
    expect(await screen.findByText("修改只保存在需求平台，不会写回多维表格收集表。")).toBeInTheDocument();
    expect(screen.getByLabelText("编辑需求标题")).toHaveValue("收集表需求");
    expect(screen.getByRole("button", { name: "保存（基于 v2）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByLabelText("编辑需求标题")).not.toBeInTheDocument();
  });

  it("hides duplicate decisions for non-TB details and shows read-only similar requirements for base_form (PRD-31)", async () => {
    const baseRow = {
      ...row,
      id: "req-base-similar",
      sourceRequirementId: null,
      sourceType: "base_form",
      sourceChannel: "销售",
      title: "收集表相似需求验证",
      source: { sourceType: "base_form", proposerName: "贾浩" },
    };
    const other = {
      ...row,
      id: "req-other",
      sourceRequirementId: "tb-9",
      platformRequirementId: "RQ-000099",
      title: "收集表相似需求验证（旧）",
      sourceType: "teambition",
    };
    const requested: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      requested.push(path);
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements?")) return jsonOk({ items: [baseRow, other], nextCursor: null });
      if (path === "/api/requirements/source-counts") return new Response("not found", { status: 404 });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail({ ...baseRow, analysis: null, analyses: [] }));
      return jsonOk({ items: [baseRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow("收集表相似需求验证");

    // PRD-31：非 TB 来源没有重复判定身份，不再渲染确认/忽略入口。
    expect(screen.queryByRole("heading", { name: "重复处理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认重复" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /相似需求（只读，仅供参考）/ })).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: /RQ-000099 · 收集表相似需求验证（旧）/ });
    expect(link.closest("li")).toHaveTextContent("Teambition");
    expect(link).toHaveAttribute("href", "?requirement=req-other");
    expect(link).toHaveAttribute("target", "_blank");
    expect(requested.some((path) => path.includes("/api/requirements?") && path.includes("limit=5") && path.includes("processingState=active"))).toBe(true);
  });

  it("falls back to the first 8 title characters when a long title has no similar match (PRD-31 R8)", async () => {
    const longTitle = "【验收】C606 多维表格相似需求验证";
    const baseRow = {
      ...row,
      id: "req-base-r8",
      sourceRequirementId: null,
      sourceType: "base_form",
      sourceChannel: "售后",
      title: longTitle,
      source: { sourceType: "base_form", proposerName: "贾浩" },
    };
    const other = {
      ...row,
      id: "req-r8-match",
      sourceRequirementId: "tb-200",
      platformRequirementId: "RQ-000200",
      title: "C606 相关旧需求",
      sourceType: "teambition",
    };
    const queries: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements?") && path.includes("q=")) {
        const query = new URL(path, "http://localhost").searchParams.get("q") ?? "";
        queries.push(query);
        // 整条标题只命中自己 → 触发 R8 降级；降级查询命中另一条。
        if (query === longTitle) return jsonOk({ items: [baseRow], nextCursor: null });
        if (query === "C606 多维表") return jsonOk({ items: [other], nextCursor: null });
        return jsonOk({ items: [], nextCursor: null });
      }
      if (path === "/api/requirements/source-counts") return new Response("not found", { status: 404 });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail({ ...baseRow, analysis: null, analyses: [] }));
      return jsonOk({ items: [baseRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow(longTitle);

    // R8：整条标题无命中（只有自己）→ 去【…】前缀取前 8 字再查一次，最多 2 次请求。
    expect(await screen.findByRole("link", { name: /RQ-000200 · C606 相关旧需求/ })).toBeInTheDocument();
    expect(queries).toEqual([longTitle, "C606 多维表"]);
  });

  it("reads the detail creation time from the server DTO for non-Teambition sources (F1)", async () => {
    const manualRow = {
      ...row,
      id: "req-manual-created",
      sourceRequirementId: null,
      sourceType: "web_manual",
      sourceChannel: "终端用户",
      title: "手工创建时间需求",
      description: "手工描述",
      createdAt: "2026-11-01T09:30:00.000Z",
    };
    mockPanel({
      rows: [manualRow],
      detailBody: detail({
        ...manualRow,
        source: { sourceType: "web_manual", title: "手工创建时间需求", description: "手工描述" },
        analysis: null,
        analyses: [],
      }),
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow("手工创建时间需求");

    // 服务端 createdAt 优先；手工来源的 source_payload 没有创建时间，不能再显示「未填写」。
    const origin = screen.getByLabelText("这条需求怎么来的");
    const expected = new Date("2026-11-01T09:30:00.000Z").toLocaleString("zh-CN");
    const creation = within(origin).getByText("创建时间").closest("span");
    expect(creation).not.toBeNull();
    expect(creation).toHaveTextContent(expected);
    expect(creation).not.toHaveTextContent("未填写");
  });

  it("renders the assessment contract, switches versions, and copies the investigation prompt", async () => {
    const v1 = assessmentVersion(1, { background: "第一版背景", verdict: "advance" });
    const v2 = assessmentVersion(2, { background: "第二版背景", verdict: "investigate" });
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [v1, v2] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    // 默认选最新版本；结论、置信度、假设按契约渲染。
    expect(await screen.findByText("第二版背景")).toBeInTheDocument();
    expect(screen.getByText("需要调查")).toBeInTheDocument();
    expect(screen.getByText("置信度：高")).toBeInTheDocument();
    expect(screen.getByText("夜间骑行占比约 15%")).toBeInTheDocument();
    expect(screen.getByText("是否需要保留最低提示音量？")).toBeInTheDocument();

    // 版本切换只换展示，不重新请求。
    fireEvent.click(screen.getByRole("button", { name: "v1" }));
    expect(await screen.findByText("第一版背景")).toBeInTheDocument();
    expect(screen.getByText("建议推进")).toBeInTheDocument();

    // Investigation 提示词默认折叠，展开后可复制。
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "展开提示词" }));
    expect(screen.getByText(/请调查夜间骑行用户/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("请调查夜间骑行用户")));
    expect(await screen.findByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("generates an assessment on demand and posts the supplementary inputs", async () => {
    let posted: unknown = null;
    const created = assessmentVersion(2, { background: "生成后的背景", verdict: "hold" });
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments" && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return jsonOk({ assessment: created });
      }
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [assessmentVersion(1)] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    fireEvent.change(screen.getByRole("textbox", { name: "需求背景" }), { target: { value: "售后反馈" } });
    fireEvent.change(screen.getByRole("textbox", { name: "需求目标" }), { target: { value: "降低投诉" } });
    fireEvent.click(screen.getByRole("button", { name: "生成评估" }));

    await waitFor(() => expect(posted).toEqual({ background: "售后反馈", goal: "降低投诉", scenario: "" }));
    expect(await screen.findByText("评估 v2 已生成。")).toBeInTheDocument();
    expect(screen.getByText("建议暂缓")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "v2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("allows empty supplements and surfaces the 429 wait time on assessment generation", async () => {
    let posted: unknown = null;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments" && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "操作太频繁，请稍后再试。" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "42" } });
      }
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    expect(await screen.findByText(/还没有评估结果/)).toBeInTheDocument();
    // PRD 4.10.3：三项补充都可为空，全空也允许生成（空输入不是错误）。
    fireEvent.click(screen.getByRole("button", { name: "生成评估" }));
    await waitFor(() => expect(posted).toEqual({ background: "", goal: "", scenario: "" }));
    expect(await screen.findByText(/还需等待约 42 秒/)).toBeInTheDocument();
  });

  it("prefills the latest assessment inputs when the detail opens (PRD 4.10.7)", async () => {
    const v1 = { ...assessmentVersion(1), inputs: { background: "第一版背景输入", goal: "第一版目标输入", scenario: "第一版场景输入" } };
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [v1] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    expect(await screen.findByDisplayValue("第一版背景输入")).toBeInTheDocument();
    expect(screen.getByDisplayValue("第一版目标输入")).toBeInTheDocument();
    expect(screen.getByDisplayValue("第一版场景输入")).toBeInTheDocument();
  });

  it("backfills a version's inputs when switching versions and shows the loaded hint", async () => {
    const v1 = { ...assessmentVersion(1), inputs: { background: "v1 背景", goal: "v1 目标", scenario: "v1 场景" } };
    const v2 = { ...assessmentVersion(2), inputs: { background: "v2 背景", goal: "", scenario: "" } };
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [v1, v2] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    expect(await screen.findByDisplayValue("v2 背景")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "v1" }));

    expect(await screen.findByDisplayValue("v1 背景")).toBeInTheDocument();
    expect(screen.getByDisplayValue("v1 目标")).toBeInTheDocument();
    expect(screen.getByDisplayValue("v1 场景")).toBeInTheDocument();
    expect(screen.getByText("已载入 v1 的输入，可改后重新生成。")).toBeInTheDocument();
    // 不做只读锁：回填后仍可修改并重新生成。
    expect(screen.getByRole("textbox", { name: "需求背景" })).not.toBeDisabled();
    expect(screen.getByRole("textbox", { name: "需求目标" })).not.toBeDisabled();
    expect(screen.getByRole("textbox", { name: "使用场景" })).not.toBeDisabled();
  });

  it("shows a running assessment as generating and disables the generate button", async () => {
    const running = { ...assessmentVersion(2), status: "running", output: null };
    const done = assessmentVersion(1);
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [running, done] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    expect(await screen.findByRole("button", { name: "v2 生成中" })).toBeInTheDocument();
    expect(screen.getByText("这一版正在生成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在生成，请稍候" })).toBeDisabled();
  });

  it("shows a 409 single-flight wait and keeps generation blocked", async () => {
    let posts = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments" && init?.method === "POST") {
        posts += 1;
        return new Response(JSON.stringify({ error: { code: "ASSESSMENT_IN_PROGRESS", message: "该需求已有正在生成的评估。" } }), { status: 409, headers: { "content-type": "application/json" } });
      }
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [assessmentVersion(1)] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    fireEvent.click(screen.getByRole("button", { name: "生成评估" }));
    expect(await screen.findByText("正在生成，请稍候。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在生成，请稍候" })).toBeDisabled();
    expect(posts).toBe(1);
  });

  it("refreshes assessment history after a non-409 failure so the failed version stays visible", async () => {
    let historyCalls = 0;
    const failed = { ...assessmentVersion(2), status: "failed", output: null, errorCode: "analysis_failure" };
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Dependency unavailable" } }), { status: 503, headers: { "content-type": "application/json" } });
      }
      if (path === "/api/requirements/req-1/assessments") {
        historyCalls += 1;
        return jsonOk({ items: historyCalls === 1 ? [assessmentVersion(1)] : [failed, assessmentVersion(1)] });
      }
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    expect(await screen.findByRole("button", { name: "v1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成评估" }));

    expect(await screen.findByText("服务暂时不可用，请稍后重试；已保存的评估不受影响。")).toBeInTheDocument();
    // 503 后服务端保留了 failed 版本：静默刷新历史即可看到它，而不是只剩一句报错。
    expect(await screen.findByRole("button", { name: "v2（失败）" })).toBeInTheDocument();
    expect(screen.getByText(/错误码：analysis_failure/)).toBeInTheDocument();
    expect(historyCalls).toBeGreaterThanOrEqual(2);
  });

  it("times out an assessment generation after 65 seconds, not before", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments" && init?.method === "POST") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        });
      }
      if (path === "/api/requirements/req-1/assessments") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "生成评估" }));
      // PRD 4.10 A5：服务端 60s，客户端 65s；64.999s 时不能抢跑。
      await act(async () => { await vi.advanceTimersByTimeAsync(64_999); });
      expect(screen.queryByText("评估生成超时，请稍后重试。")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "生成中…（约 30 秒）" })).toBeDisabled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByText("评估生成超时，请稍后重试。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "生成评估" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the detail usable when the assessment history cannot load", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/assessments") return new Response(JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Dependency unavailable" } }), { status: 503, headers: { "content-type": "application/json" } });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    expect(await screen.findByText(/评估历史读取失败/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "需求信息" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "需求评估" })).toBeInTheDocument();
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
    await chooseArcoOption("TB负责人筛选", "毕梓浩");
    await chooseArcoOption("同步状态筛选", "已同步");
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    await waitFor(() => expect(new URLSearchParams(window.location.search).get("title")).toBe("报表"));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("owner")).toBe("毕梓浩");
    expect(params.get("pull")).toBe("synced");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=%E6%8A%A5%E8%A1%A8"), expect.anything()));

    view.unmount();
    render(<RequirementsPanel onRefresh={() => undefined} />);
    expect(((await screen.findByLabelText("搜索需求标题")) as HTMLInputElement).value).toBe("报表");
    expect(arcoSelectText("TB负责人筛选")).toContain("毕梓浩");
    expect(arcoSelectText("同步状态筛选")).toContain("已同步");

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

  it("revokes a processed duplicate with DELETE so no stale confirmed decision remains", async () => {
    const suppressed = detail({
      processingState: "suppressed_duplicate",
      resolution: { decision: "duplicate", reviewState: "confirmed", canonicalRequirementId: "req-2", canonicalPlatformRequirementId: "RQ-000002", reason: "同一诉求", version: 3 },
    });
    let deleteRequest: { method?: string; body?: unknown } | null = null;
    let detailCalls = 0;
    let releaseRefresh: (() => void) | null = null;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/req-1/duplicate-decision") {
        deleteRequest = { method: init?.method, body: JSON.parse(String(init?.body)) };
        return jsonOk({ requirementId: "req-1", processingState: "active", decision: null, version: 0 });
      }
      if (path === "/api/requirements/req-1") {
        detailCalls += 1;
        if (detailCalls === 1) return jsonOk(suppressed);
        // 撤销后的刷新先挂起，用来断言详情不会被替换成骨架屏。
        return new Promise<Response>((resolve) => { releaseRefresh = () => resolve(jsonOk(detail())); });
      }
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();

    fireEvent.click(screen.getByRole("button", { name: "撤销判定（恢复活跃）" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销判定" }));

    await waitFor(() => expect(deleteRequest).toEqual({ method: "DELETE", body: { expectedVersion: 3 } }));
    expect(await screen.findByText(/已撤销判定，需求恢复为活跃/)).toBeInTheDocument();
    // 静默刷新：详情标题仍在，不会被骨架屏替换。
    expect(screen.getByRole("heading", { name: "需要报表" })).toBeInTheDocument();
    await waitFor(() => expect(releaseRefresh).not.toBeNull());
    await act(async () => { releaseRefresh!(); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销判定（恢复活跃）" })).not.toBeInTheDocument());
  });

  it("labels chat-paste rows and filters the pool by source", async () => {
    const chatRow = { ...row, id: "req-chat", title: "聊天粘贴需求", sourceType: "web_manual", sourceChannel: "售后", source: { sourceType: "web_manual", intakeOrigin: "chat_paste" } };
    const manualRow = { ...row, id: "req-manual", title: "手工录入需求", sourceType: "web_manual", sourceChannel: "销售", source: { sourceType: "web_manual" } };
    const requested: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      requested.push(path);
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [chatRow, manualRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);

    const chatTitle = await screen.findByText("聊天粘贴需求");
    const chatLine = chatTitle.closest("tr");
    if (!chatLine) throw new Error("chat-paste row was not rendered");
    const chatBadge = chatLine.querySelector(".source-badge");
    expect(chatBadge).toHaveTextContent("聊天粘贴·售后");
    expect(chatBadge).toHaveAttribute("title", "来自聊天粘贴 · 售后");
    expect(chatLine.className).toContain("is-source-chat_paste");
    const manualTitle = screen.getByText("手工录入需求").closest("tr");
    if (!manualTitle) throw new Error("manual row was not rendered");
    const manualBadge = manualTitle.querySelector(".source-badge");
    expect(manualBadge).toHaveTextContent("手工·销售");
    expect(manualBadge).toHaveAttribute("title", "来自手工录入 · 销售");
    expect(manualTitle.className).toContain("is-source-web_manual");

    fireEvent.click(screen.getByRole("tab", { name: "聊天粘贴" }));
    await waitFor(() => expect(requested.some((path) => path.includes("/api/requirements?") && path.includes("source=chat_paste"))).toBe(true));
    expect(screen.getByRole("tab", { name: "聊天粘贴" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the chat-paste origin on the requirement detail", async () => {
    const chatRow = { ...row, id: "req-chat", title: "聊天粘贴需求", sourceType: "web_manual", sourceChannel: "售后", source: { sourceType: "web_manual", intakeOrigin: "chat_paste" } };
    mockPanel({ rows: [chatRow], detailBody: detail({ ...chatRow }) });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow("聊天粘贴需求");
    expect(screen.getByText("来自聊天粘贴 · 售后")).toBeInTheDocument();
    // 非 TB 来源不挂字段徽标；没有提出人时来源网格整块不渲染。
    expect(screen.queryAllByText("TB")).toHaveLength(0);
    expect(document.querySelectorAll(".req-field-label .tb-badge")).toHaveLength(0);
    expect(screen.queryByText("执行人")).not.toBeInTheDocument();
  });

  it("labels base-form fields by source and hides Teambition-only empty fields", async () => {
    const baseRow = {
      ...row,
      id: "req-base",
      sourceRequirementId: null,
      sourceType: "base_form",
      sourceChannel: "售后",
      title: "收集表需求",
      pipeline: { pull: "collected", analysis: "analyzed", owner: "not_required", push: "pushed" },
    };
    mockPanel({
      rows: [baseRow],
      detailBody: detail({
        ...baseRow,
        source: { sourceType: "base_form", proposerName: "贾浩" },
        analysis: { module: "码表", confidence: "中", priority: "P3" },
      }),
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow("收集表需求");

    // 非 TB 来源不挂字段来源徽标，整页没有 TB；标签只保留字段名。
    expect(screen.queryAllByText("TB")).toHaveLength(0);
    expect(document.querySelectorAll(".req-field-label .tb-badge")).toHaveLength(0);
    expect(screen.getAllByText("标题").length).toBeGreaterThan(0);
    expect(screen.getAllByText("描述").length).toBeGreaterThan(0);
    // 提出人有值 → 保留；TB 专属的五个字段（执行人/状态/链接/创建时间/更新时间）不渲染。
    // 提出人有值 → 保留（原始 payload 快照里也有该名字，这里只断言至少出现一次）。
    expect(screen.getAllByText("贾浩").length).toBeGreaterThan(0);
    expect(screen.queryByText("执行人")).not.toBeInTheDocument();
    expect(screen.queryByText("状态")).not.toBeInTheDocument();
    expect(screen.queryByText("链接")).not.toBeInTheDocument();
    expect(screen.queryByText("更新时间")).not.toBeInTheDocument();
  });

  it("explains where the requirement came from on the detail page", async () => {
    const chatRow = { ...row, id: "req-chat", title: "聊天粘贴需求", sourceType: "web_manual", sourceChannel: "售后", source: { sourceType: "web_manual", intakeOrigin: "chat_paste", proposerName: "王工", createdAt: "2026-11-19T02:00:00.000Z" } };
    mockPanel({ rows: [chatRow], detailBody: detail({ ...chatRow }) });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow("聊天粘贴需求");

    // 5c-1：详情底部「这条需求怎么来的」，来源与渠道分列展示。
    const origin = screen.getByLabelText("这条需求怎么来的");
    expect(within(origin).getByText("聊天粘贴")).toBeInTheDocument();
    expect(within(origin).getByText("售后")).toBeInTheDocument();
    expect(within(origin).getByText("王工")).toBeInTheDocument();
    expect(within(origin).getByText(/2026/)).toBeInTheDocument();
  });

  it("renders source tabs with counts and filters immediately without applying draft inputs", async () => {
    const requested: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      requested.push(path);
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/source-counts") return jsonOk({ counts: { teambition: 320, web_manual: 8, base_form: 5, chat_paste: 4, all: 337 } });
      if (path.startsWith("/api/requirements/export")) return new Response("", { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } });
      if (path.startsWith("/api/requirements/")) return jsonOk(detail());
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);

    const all = await screen.findByRole("tab", { name: /全部来源/ });
    expect(within(all).getByText("337")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /^Teambition/ })).getByText("320")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /^多维表格/ })).getByText("5")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /^手工/ })).getByText("8")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /^聊天粘贴/ })).getByText("4")).toBeInTheDocument();
    expect(all).toHaveAttribute("aria-selected", "true");

    // 切换 Tab 立即生效；尚未点「筛选」的搜索框草稿不能一起发出去。
    fireEvent.change(screen.getByLabelText("搜索需求标题"), { target: { value: "未提交的搜索" } });
    fireEvent.click(screen.getByRole("tab", { name: /^多维表格/ }));
    await waitFor(() => expect(requested.some((path) => path.includes("/api/requirements?") && path.includes("source=base_form") && !path.includes("q="))).toBe(true));
    expect(window.location.search).toContain("source=base_form");
    expect(screen.getByRole("tab", { name: /^多维表格/ })).toHaveAttribute("aria-selected", "true");
  });

  it("preselects the source tab from a deep link", async () => {
    window.history.replaceState(null, "", "/?source=chat_paste");
    mockPanel();
    render(<RequirementsPanel onRefresh={() => undefined} />);

    expect(await screen.findByRole("tab", { name: "聊天粘贴" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => typeof input === "string" && /\/api\/requirements\?.*source=chat_paste/.test(input))).toBe(true));
  });

  it("keeps the source tabs usable when the counts endpoint is unavailable", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/source-counts") return new Response("boom", { status: 500 });
      return jsonOk({ items: [row], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);

    expect(await screen.findByText("需要报表")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全部来源" })).toHaveAttribute("aria-selected", "true");
    // 计数拿不到就不显示数字，不显示假的 0。
    expect(document.querySelectorAll(".source-tab-count")).toHaveLength(0);
  });

  it("hides source counts outside the active processing view", async () => {
    mockPanel({ sourceCounts: { teambition: 320, web_manual: 8, base_form: 5, chat_paste: 4, all: 337 } });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    expect(await screen.findByText("需要报表")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".source-tab-count")).toHaveLength(5));

    // 计数是「活跃」口径；切到全部/已压制后列表行数会更多，隐藏计数避免误读。
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() => expect(document.querySelectorAll(".source-tab-count")).toHaveLength(0));
    fireEvent.click(screen.getByRole("button", { name: "仅活跃" }));
    await waitFor(() => expect(document.querySelectorAll(".source-tab-count")).toHaveLength(5));
  });

  it("marks non-default sources with a row color bar but leaves Teambition rows plain", async () => {
    const baseRow = { ...row, id: "req-base", title: "收集表需求", sourceType: "base_form", sourceChannel: "销售", source: { sourceType: "base_form" } };
    const tbRow = { ...row, id: "req-tb", title: "TB需求", sourceType: "teambition", sourceChannel: null };
    const noChannelRow = { ...row, id: "req-manual-nc", title: "无渠道手工需求", sourceType: "web_manual", sourceChannel: null, source: { sourceType: "web_manual" } };
    mockPanel({ rows: [baseRow, tbRow, noChannelRow] });
    render(<RequirementsPanel onRefresh={() => undefined} />);

    const baseLine = (await screen.findByText("收集表需求")).closest("tr");
    if (!baseLine) throw new Error("base-form row was not rendered");
    expect(baseLine.querySelector(".source-badge")).toHaveTextContent("多维表格·销售");
    expect(baseLine.className).toContain("is-source-base_form");
    const tbLine = screen.getByText("TB需求").closest("tr");
    if (!tbLine) throw new Error("TB row was not rendered");
    expect(within(tbLine).queryByText(/多维表格|手工|聊天粘贴/)).not.toBeInTheDocument();
    expect(tbLine.className).not.toContain("is-source-");

    // 渠道为空时只显示来源名，不出现「·null」「·undefined」或空括号。
    const noChannelLine = screen.getByText("无渠道手工需求").closest("tr");
    if (!noChannelLine) throw new Error("no-channel row was not rendered");
    const noChannelBadge = noChannelLine.querySelector(".source-badge");
    expect(noChannelBadge).toHaveTextContent(/^手工$/);
    expect(noChannelBadge?.querySelector(".source-badge-channel")).toBeNull();
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
    const integratedScoring = {
      current: {
        id: "score-integrated", requirementId: "req-1", version: 1, status: "current" as const, origin: "ai" as const,
        sourceVersion: 1, analysisVersion: 2, ruleVersionId: "rule-v2",
        inputs: { user: { pain: 3, frequency: 4 }, market: { sellingPoint: 1, competitor: 1 }, strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 3, technicalRisk: 2, resource: 2 } },
        alpha: 0.8, score: 6.4, priority: "P3" as const, scoreConfidence: "中" as const, scoreConfidenceReason: "频次不足", safetyFlag: false,
        basis: { "user.pain": { reason: "减少重复操作", evidence: ["减少操作步骤"], assumption: false } }, rationale: "单条反馈", actorId: null, changeReason: null, createdAt: "2026-10-28T01:00:00.000Z",
      },
      aiSuggestion: null,
      history: [] as unknown[],
      formula: { text: "formula", thresholds: { p0: 45, p1: 25, p2: 10 } },
    };
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
        scoring: integratedScoring,
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
    expect(screen.getByText("整体置信度")).toBeInTheDocument();
    expect(screen.getByText("U · 用户价值")).toBeInTheDocument();
    expect(screen.getByText(/改善用户效率/)).toBeInTheDocument();
    expect(screen.getByText(/理由：减少重复操作/)).toBeInTheDocument();
    expect(screen.getByText(/证据：减少操作步骤/)).toBeInTheDocument();
    expect(screen.getAllByText("需要补充信息")).toHaveLength(2);
    expect(screen.getByText("C · 成本")).toBeInTheDocument();

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

  it("links to the Base record when the server provides a direct URL", async () => {
    mockPanel({ detailBody: detail({ baseRecordId: "recvxwGs5Js0PA", baseRecordUrl: "https://tenant.feishu.cn/base/app?table=t&record=recvxwGs5Js0PA" }) });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    await openFirstRow();
    const link = await screen.findByRole("link", { name: "在飞书 Base 中打开" });
    expect(link).toHaveAttribute("href", "https://tenant.feishu.cn/base/app?table=t&record=recvxwGs5Js0PA");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
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
    await chooseArcoOption("选择负责人", "Alex Chen");
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
    await chooseArcoOption("TB负责人筛选", "毕梓浩");
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements?q=%E6%8A%A5%E8%A1%A8&executorName=%E6%AF%95%E6%A2%93%E6%B5%A9&processingState=active&limit=25", expect.anything()));
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
    // ARCO-05：details/summary 改为受控按钮 + 条件渲染；aria-expanded/aria-controls 表达展开状态。
    const moreFiltersButton = screen.getByRole("button", { name: /更多筛选/ });
    expect(moreFiltersButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("负责人筛选")).not.toBeInTheDocument();
    fireEvent.click(moreFiltersButton);
    expect(moreFiltersButton).toHaveAttribute("aria-expanded", "true");
    expect(moreFiltersButton).toHaveAttribute("aria-controls", "requirement-more-filters");
    const moreFilters = document.getElementById("requirement-more-filters");
    if (!moreFilters) throw new Error("更多筛选区域未渲染");
    expect(within(moreFilters).getByLabelText("负责人筛选")).toBeInTheDocument();
    expect(within(moreFilters).getByLabelText("分析状态筛选")).toBeInTheDocument();
    expect(within(moreFilters).getByLabelText("推送状态筛选")).toBeInTheDocument();
    expect(within(moreFilters).getByLabelText("批次 ID 筛选")).toBeInTheDocument();
    // 再次点击收起后条件区域卸载
    fireEvent.click(moreFiltersButton);
    expect(moreFiltersButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("批次 ID 筛选")).not.toBeInTheDocument();

    await chooseArcoOption("TB负责人筛选", "毕梓浩");
    // 草稿未提交时不显示"已生效"，点「筛选」后才出现
    expect(screen.queryByText(/个筛选已生效/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(await screen.findByText("1 个筛选已生效")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.queryByText(/个筛选已生效/)).not.toBeInTheDocument();
    expect(arcoSelectText("TB负责人筛选").trim()).toBe("全部 TB 负责人");

    // UI 修复：更多筛选是自定义浮层，点击面板外部或按 Escape 都应关闭，避免遮挡工具栏。
    fireEvent.click(moreFiltersButton);
    expect(moreFiltersButton).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(document.body);
    expect(moreFiltersButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(moreFiltersButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(moreFiltersButton).toHaveAttribute("aria-expanded", "false");
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
    const deleteTrigger = within(renamedRow).getByRole("button", { name: "删除" });
    fireEvent.click(deleteTrigger);
    const personDialog = await screen.findByRole("alertdialog");
    expect(personDialog).toHaveAccessibleName("确认删除");
    expect(personDialog).toHaveAccessibleDescription(/删除|解除/);
    fireEvent.click(within(personDialog).getByRole("button", { name: "取消" }));
    // Arco Modal 有退出动画，DOM 会在下一帧移除，等待关闭完成再断言。
    await waitFor(() => { expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    // 取消后焦点回到触发按钮。
    await waitFor(() => expect(deleteTrigger).toHaveFocus());
    expect(screen.getByText("新成员改名")).toBeInTheDocument();

    fireEvent.click(deleteTrigger);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("人员已删除，相关模块已解除分配。")).toBeInTheDocument();
    // 确认删除后触发按钮随行移除，焦点不能被留在已关闭的对话框里。
    expect(document.activeElement?.closest('[role="alertdialog"]')).toBeNull();
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
    await chooseArcoOption("模块责任人员", "贾浩");
    fireEvent.click(screen.getByRole("button", { name: "新增模块" }));
    expect(await screen.findByText("已发布模块字典 v3，后续 AI 分析将使用新版本。")).toBeInTheDocument();

    const mapRow = screen.getByText("地图").closest("tr");
    if (!mapRow) throw new Error("Module row was not rendered");
    // 行内编辑：该行的名称与负责人单元格变成输入控件，保存也在行内
    fireEvent.click(within(mapRow).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("编辑功能模块名称"), { target: { value: "导航" } });
    await chooseArcoOption("编辑模块责任人员", "贾浩");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("导航")).toBeInTheDocument();

    const voiceRow = screen.getByText("语音提醒").closest("tr");
    if (!voiceRow) throw new Error("Created module row was not rendered");
    fireEvent.click(within(voiceRow).getByRole("button", { name: "删除" }));
    const moduleDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(moduleDialog).getByRole("button", { name: "取消" }));
    // Arco Modal 有退出动画，DOM 会在下一帧移除，等待关闭完成再断言。
    await waitFor(() => { expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
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
    await chooseArcoOption("新建来源渠道", "售后");
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
    await chooseArcoOption("新建来源渠道", "售后");
    fireEvent.change(screen.getByLabelText("新建需求描述"), { target: { value: "用户希望导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    await waitFor(() => expect(keys.length).toBe(2));
    expect(keys[0]).toBe(keys[1]);
  });

  // PRD-26 / 5a：聊天粘贴 → 草稿填表单；草稿不入库，提交仍走 POST /api/requirements。
  it("fills the intake form from pasted chat, marks AI fields and creates only after the user submits", async () => {
    const draftCalls: string[] = [];
    const posts: { body: Record<string, unknown> }[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        draftCalls.push(String(init.body));
        return Response.json({
          draft: { title: "导出骑行报表", description: "售后反馈用户希望导出报表", sourceChannel: "售后", requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: "小王", aiFilled: ["title", "description", "sourceChannel", "proposer"] },
          similar: [{ id: "req-9", platformRequirementId: "RQ-000009", title: "导出报表", sourceType: "teambition" }],
        });
      }
      if (path === "/api/requirements" && init?.method === "POST") {
        posts.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return Response.json({ requirementId: "req-new", platformRequirementId: "RQ-000042", sourceType: "web_manual", status: "collected" }, { status: 201 });
      }
      if (path.startsWith("/api/requirements?") && path.includes("q=")) return Response.json({ items: [{ id: "req-9", platformRequirementId: "RQ-000009", title: "导出报表", sourceType: "teambition", sourceChannel: null }], nextCursor: null });
      if (path.startsWith("/api/requirements/")) return Response.json(intakeDetail);
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "小王：客户想导出骑行报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    await waitFor(() => expect(screen.getByLabelText("新建需求标题")).toHaveValue("导出骑行报表"));
    expect(JSON.parse(draftCalls[0]!)).toEqual({ text: "小王：客户想导出骑行报表" });
    expect(screen.getByLabelText("新建需求描述")).toHaveValue("售后反馈用户希望导出报表");
    expect(screen.getAllByText(/AI 填充/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/聊天中的提出人：小王/)).toBeInTheDocument();
    expect(screen.getByText(/RQ-000009 · 导出报表/)).toBeInTheDocument();
    // 抽取本身不创建需求
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({ title: "导出骑行报表", description: "售后反馈用户希望导出报表", sourceChannel: "售后", intakeOrigin: "chat_paste", proposerName: "小王" });
  });

  it("shows the server message and keeps manual entry available when chat extraction fails", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({ error: { code: "RATE_LIMITED", message: "操作太频繁，请稍后再试。" } }, { status: 429 });
      }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    expect(await screen.findByText("操作太频繁，请稍后再试。")).toBeInTheDocument();
    // 表单未被改写，仍可手工填写
    expect(screen.getByLabelText("新建需求标题")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "手工填写" } });
    expect(screen.getByLabelText("新建需求标题")).toHaveValue("手工填写");
  });

  // 5a 补丁：同一个提交意图内幂等键不因「重新整理草稿」而轮换，失败重试不会重复建需求。
  it("keeps the same idempotency key when the draft is re-extracted after a failed submit", async () => {
    const keys: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({
          draft: { title: "导出骑行报表", description: "售后反馈用户希望导出报表", sourceChannel: "售后", requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: null, aiFilled: ["title", "description", "sourceChannel"] },
          similar: [], fallback: false, aiFilledCount: 3,
        });
      }
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
    fireEvent.click(await screen.findByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    await waitFor(() => expect(screen.getByLabelText("新建需求标题")).toHaveValue("导出骑行报表"));
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // 同一段聊天再次整理：草稿与表单一致，不弹冲突确认，键保持不变。
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    await waitFor(() => expect(screen.getByLabelText("新建需求标题")).toHaveValue("导出骑行报表"));
    expect(screen.queryByText("草稿与已填内容冲突")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    await waitFor(() => expect(keys.length).toBe(2));
    expect(keys[0]).toBe(keys[1]);
  });

  // 5a 补丁：已填内容先确认，默认合并只补空白字段，不静默冲掉用户输入。
  it("merges the draft into only the empty fields when the form already has content", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({
          draft: { title: "AI 标题", description: "AI 整理后的描述", sourceChannel: "售后", requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: "小王", aiFilled: ["title", "description", "sourceChannel"] },
          similar: [], fallback: false, aiFilledCount: 3,
        });
      }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "手工标题" } });
    await chooseArcoOption("新建来源渠道", "销售");
    fireEvent.click(screen.getByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    expect(await screen.findByText("草稿与已填内容冲突")).toBeInTheDocument();
    expect(screen.getByText(/标题、来源渠道/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "只补空白字段" }));
    // 已填标题和渠道保留，只有空白描述被草稿补上；标记只挂在真正由 AI 写入的字段上。
    expect(screen.getByLabelText("新建需求标题")).toHaveValue("手工标题");
    expect(screen.getByLabelText("新建需求描述")).toHaveValue("AI 整理后的描述");
    expect(arcoSelectText("新建来源渠道")).toContain("销售");
    expect(screen.getAllByTitle("由 AI 根据聊天内容填充，请核对后再提交")).toHaveLength(1);
  });

  it("overwrites the filled fields only after the user confirms it", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({
          draft: { title: "AI 标题", description: "AI 整理后的描述", sourceChannel: "售后", requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: null, aiFilled: ["title", "description", "sourceChannel"] },
          similar: [], fallback: false, aiFilledCount: 3,
        });
      }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "手工标题" } });
    await chooseArcoOption("新建来源渠道", "销售");
    fireEvent.click(screen.getByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    expect(await screen.findByText("草稿与已填内容冲突")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "覆盖已填字段" }));
    expect(screen.getByLabelText("新建需求标题")).toHaveValue("AI 标题");
    expect(arcoSelectText("新建来源渠道")).toContain("售后");
    expect(screen.getAllByTitle("由 AI 根据聊天内容填充，请核对后再提交")).toHaveLength(3);
  });

  // 5a 补丁：用户一编辑，「AI 填充」标记就该撤销，否则标记会失真。
  it("removes the AI-filled mark as soon as the user edits a field", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({
          draft: { title: "AI 标题", description: "AI 整理后的描述", sourceChannel: "售后", requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: null, aiFilled: ["title", "description", "sourceChannel"] },
          similar: [], fallback: false, aiFilledCount: 3,
        });
      }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    await waitFor(() => expect(screen.getByLabelText("新建需求标题")).toHaveValue("AI 标题"));
    expect(screen.getAllByTitle("由 AI 根据聊天内容填充，请核对后再提交")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "人工改写后的标题" } });
    expect(screen.getAllByTitle("由 AI 根据聊天内容填充，请核对后再提交")).toHaveLength(2);
  });

  it("shows how long to wait and the chat word count when extraction is rate limited", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({ error: { code: "RATE_LIMITED", message: "操作太频繁，请稍后再试。" } }, { status: 429, headers: { "Retry-After": "42" } });
      }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    expect(screen.getByText("7/20000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    expect(await screen.findByText(/还需等待约 42 秒/)).toBeInTheDocument();
  });

  // 5a 补丁：服务端 fallback=true 时必须说明「未经过 AI 整理」，不能让人以为已经整理好。
  it("warns when the draft fell back to the masked transcript", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({
          draft: { title: "张伟 2026-11-18 09:12", description: "（手机号已掩码）：希望导出报表", sourceChannel: null, requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: "（姓名已掩码）", aiFilled: [] },
          similar: [], fallback: true, aiFilledCount: 0,
        });
      }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "张伟：希望导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    expect(await screen.findByText(/AI 没能整理这段聊天/)).toBeInTheDocument();
    expect(screen.getByLabelText("新建需求标题")).toHaveValue("张伟 2026-11-18 09:12");
    expect(screen.queryAllByTitle("由 AI 根据聊天内容填充，请核对后再提交")).toHaveLength(0);
    expect(screen.queryByText(/聊天中的提出人/)).not.toBeInTheDocument();
  });

  it("rejects over-long fields before calling the create endpoint", async () => {
    const posts: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements" && init?.method === "POST") { posts.push(path); return Response.json({}, { status: 201 }); }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "标".repeat(201) } });
    await chooseArcoOption("新建来源渠道", "售后");
    fireEvent.change(screen.getByLabelText("新建需求描述"), { target: { value: "用户希望导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    expect(await screen.findByText(/标题不能超过 200 字/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  // 5a 补丁：409 表示同键不同内容（上一次可能已创建），给用户换新键重提的出口。
  it("offers a new-key retry when the idempotency key conflicts", async () => {
    const keys: string[] = [];
    let detailOpened = false;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return Response.json({
          draft: { title: "导出骑行报表", description: "售后反馈用户希望导出报表", sourceChannel: "售后", requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: null, aiFilled: ["title", "description", "sourceChannel"] },
          similar: [], fallback: false, aiFilledCount: 3,
        });
      }
      if (path === "/api/requirements" && init?.method === "POST") {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        if (keys.length === 1) return Response.json({ error: { code: "CONFLICT", message: "该幂等键已用于不同的提交内容。" } }, { status: 409 });
        return Response.json({ requirementId: "req-new", sourceType: "web_manual", status: "collected" }, { status: 201 });
      }
      if (path.startsWith("/api/requirements/")) { detailOpened = true; return Response.json(intakeDetail); }
      if (path === "/api/people") return Response.json({ items: [] });
      return Response.json({ items: [intakeRow], nextCursor: null });
    });
    render(<RequirementsPanel onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    await waitFor(() => expect(screen.getByLabelText("新建需求标题")).toHaveValue("导出骑行报表"));
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    expect(await screen.findByText(/该幂等键已用于不同的提交内容。/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "换新键重提" }));
    await waitFor(() => expect(detailOpened).toBe(true));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  // PRD-31 R3：草稿生成后立即按草稿标题查询并展示；草稿自带的 similar 不直接展示。
  it("queries similar requirements right after a draft and clears them when re-extraction fails", async () => {
    let drafts = 0;
    const similarRow = { id: "req-9", platformRequirementId: "RQ-000009", title: "导出报表", sourceType: "teambition", sourceChannel: null };
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        drafts += 1;
        if (drafts === 1) return Response.json({
          draft: { title: "导出骑行报表", description: "售后反馈用户希望导出报表", sourceChannel: "售后", requirementType: null, productModel: null, constraintNotes: null, intakeModule: null, proposer: null, aiFilled: ["title", "description", "sourceChannel"] },
          similar: [{ id: "draft-only", platformRequirementId: "RQ-000777", title: "草稿自带相似项", sourceType: "teambition" }],
          fallback: false, aiFilledCount: 3,
        });
        return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "AI 暂时无法整理聊天内容，请手工填写需求。" } }, { status: 503 });
      }
      if (path.startsWith("/api/requirements?")) return Response.json({ items: [similarRow], nextCursor: null });
      if (path === "/api/function-modules") return Response.json({ items: [] });
      return Response.json({ items: [] });
    });
    render(<IntakeForm onCreated={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));

    // 草稿生成后立即按草稿标题查询；展示的是查询结果，草稿 similar 不出现在界面。
    expect(await screen.findByText(/RQ-000009 · 导出报表/)).toBeInTheDocument();
    expect(screen.queryByText(/RQ-000777/)).not.toBeInTheDocument();
    // 再整理失败：上一次的相似提示必须清空，不能配着新错误继续展示。
    fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
    expect(await screen.findByText("AI 暂时无法整理聊天内容，请手工填写需求。")).toBeInTheDocument();
    expect(screen.queryByText(/RQ-000009/)).not.toBeInTheDocument();
  });

  it("shows title-based similar requirements on blur and never blocks submission (PRD-31)", async () => {
    const similarRow = { id: "req-9", platformRequirementId: "RQ-000009", title: "导出报表", sourceType: "teambition", sourceChannel: null };
    let posted = false;
    const onCreated = vi.fn();
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements" && init?.method === "POST") {
        posted = true;
        return Response.json({ requirementId: "req-new" }, { status: 201 });
      }
      if (path.startsWith("/api/requirements?")) return Response.json({ items: [similarRow], nextCursor: null });
      if (path === "/api/function-modules") return Response.json({ items: [] });
      return Response.json({ items: [] });
    });
    render(<IntakeForm onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "导出报表" } });
    fireEvent.blur(screen.getByLabelText("新建需求标题"));

    expect(await screen.findByText(/RQ-000009 · 导出报表/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /RQ-000009 · 导出报表/ });
    // 点开相似需求走新标签页，不丢当前表单。
    expect(link).toHaveAttribute("href", "?requirement=req-9");
    expect(link).toHaveAttribute("target", "_blank");

    fireEvent.change(screen.getByLabelText("新建需求描述"), { target: { value: "希望导出骑行报表" } });
    await chooseArcoOption("新建来源渠道", "售后");
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    await waitFor(() => expect(posted).toBe(true));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("req-new"));
  });

  it("silently hides the similar hint when the lookup fails and still allows submission (PRD-31)", async () => {
    let lookupCalls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements" && init?.method === "POST") return Response.json({ requirementId: "req-new-2" }, { status: 201 });
      if (path.startsWith("/api/requirements?")) {
        lookupCalls += 1;
        return new Response(JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "upstream" } }), { status: 503, headers: { "content-type": "application/json" } });
      }
      if (path === "/api/function-modules") return Response.json({ items: [] });
      return Response.json({ items: [] });
    });
    const onCreated = vi.fn();
    render(<IntakeForm onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "查询会失败的需求" } });
    fireEvent.blur(screen.getByLabelText("新建需求标题"));
    await waitFor(() => expect(lookupCalls).toBeGreaterThan(0));
    // 失败静默：不展示错误、不展示 loading、不出现提示块。
    expect(screen.queryByText(/相似需求/)).not.toBeInTheDocument();
    expect(screen.queryByText(/查询失败/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("新建需求描述"), { target: { value: "描述" } });
    await chooseArcoOption("新建来源渠道", "售后");
    fireEvent.click(screen.getByRole("button", { name: "提交并进入分析" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("req-new-2"));
  });

  it("silently hides the similar hint when the lookup exceeds 2 seconds (PRD-31)", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path.startsWith("/api/requirements?")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        });
      }
      if (path === "/api/function-modules") return Response.json({ items: [] });
      return Response.json({ items: [] });
    });
    render(<IntakeForm onCreated={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "新建需求" }));
    fireEvent.change(screen.getByLabelText("新建需求标题"), { target: { value: "超时的相似查询" } });
    vi.useFakeTimers();
    try {
      fireEvent.blur(screen.getByLabelText("新建需求标题"));
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByText(/相似需求/)).not.toBeInTheDocument();
    expect(screen.queryByText(/查询失败/)).not.toBeInTheDocument();
  });

  // 客户端 30 秒超时：中断请求、给明确文案、按钮恢复可点。
  it("times out an extraction after 30 seconds and re-enables the button", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/requirements/intake-draft" && init?.method === "POST") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        });
      }
      if (path === "/api/function-modules") return Response.json({ items: [] });
      return Response.json({ items: [] });
    });
    render(<IntakeForm onCreated={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "从聊天粘贴" }));
    fireEvent.change(screen.getByLabelText("聊天内容"), { target: { value: "客户想导出报表" } });
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "整理成需求草稿" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(screen.getByText("整理超时，请重试或手工填写。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "整理成需求草稿" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("PriorityOverrideSection (V02-T26)", () => {
  const baseDetail = {
    id: "req-1",
    processingState: "active",
    effectivePriority: "P3",
    priorityOverride: null,
    analysisContext: null,
    scoring: { current: { version: 2 }, aiSuggestion: null, history: [], formula: { text: "formula", thresholds: { p0: 45, p1: 25, p2: 10 } } },
  } as unknown as RequirementDetail;

  it("shows the effective priority and saves a manual override with a reason", async () => {
    let body: Record<string, unknown> | undefined;
    const onSaved = vi.fn();
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") { body = JSON.parse(String(init.body)) as Record<string, unknown>; return jsonOk({ requirementId: "req-1", priorityOverride: { priority: "P1", reason: body.reason, actorId: "pm-1", at: "2026-11-03T00:00:00.000Z" }, effectivePriority: "P1" }); }
      return jsonOk({});
    });
    render(<PriorityOverrideSection detail={baseDetail} onSaved={onSaved} />);
    expect(screen.getByText("P3")).toBeInTheDocument();
    expect(screen.getByText(/取自当前评分版本（v2）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置人工优先级" }));
    fireEvent.change(screen.getByLabelText("人工优先级原因"), { target: { value: "产品会议决定提前" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/priority-override", expect.objectContaining({ method: "PUT" })));
    expect(body).toEqual({ priority: "P1", reason: "产品会议决定提前" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("warns that Base keeps the scored priority when the manual override differs", () => {
    const detail = {
      ...baseDetail,
      effectivePriority: "P0",
      priorityOverride: { priority: "P0", reason: "老板要求", actorId: "pm-1", at: "2026-11-03T00:00:00.000Z" },
      scoring: { current: { version: 2, priority: "P3" }, aiSuggestion: null, history: [], formula: { text: "formula", thresholds: { p0: 45, p1: 25, p2: 10 } } },
    } as unknown as RequirementDetail;
    render(<PriorityOverrideSection detail={detail} onSaved={() => undefined} />);
    expect(screen.getByRole("note")).toHaveTextContent("Base 的「AI优先级建议」仍是评分结果 P3");
  });

  it("does not warn when there is no override or it matches the scored priority", () => {
    render(<PriorityOverrideSection detail={baseDetail} onSaved={() => undefined} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    cleanup();
    const same = {
      ...baseDetail,
      priorityOverride: { priority: "P3", reason: "确认", actorId: "pm-1", at: "2026-11-03T00:00:00.000Z" },
      scoring: { current: { version: 2, priority: "P3" }, aiSuggestion: null, history: [], formula: { text: "formula", thresholds: { p0: 45, p1: 25, p2: 10 } } },
    } as unknown as RequirementDetail;
    render(<PriorityOverrideSection detail={same} onSaved={() => undefined} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("clears an existing override (priority: null) and shows who/when/why", async () => {
    let body: Record<string, unknown> | undefined;
    const detail = {
      ...baseDetail,
      effectivePriority: "P0",
      priorityOverride: { priority: "P0", reason: "旧覆盖", actorId: "pm-0", at: "2026-11-01T00:00:00.000Z" },
    } as unknown as RequirementDetail;
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") { body = JSON.parse(String(init.body)) as Record<string, unknown>; return jsonOk({ requirementId: "req-1", priorityOverride: null, effectivePriority: "P3" }); }
      return jsonOk({});
    });
    render(<PriorityOverrideSection detail={detail} onSaved={() => undefined} />);
    expect(screen.getByText("已人工覆盖")).toBeInTheDocument();
    expect(screen.getByText("旧覆盖")).toBeInTheDocument();
    expect(screen.getByText("pm-0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除人工优先级" }));
    fireEvent.change(screen.getByLabelText("人工优先级原因"), { target: { value: "恢复评分结果" } });
    fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/priority-override", expect.objectContaining({ method: "PUT" })));
    expect(body).toEqual({ priority: null, reason: "恢复评分结果" });
  });

  it("disables editing for suppressed requirements", () => {
    const detail = { ...baseDetail, processingState: "suppressed_duplicate" } as unknown as RequirementDetail;
    render(<PriorityOverrideSection detail={detail} onSaved={() => undefined} />);
    expect(screen.getByRole("button", { name: "设置人工优先级" })).toBeDisabled();
  });
});

describe("AnalysisContextSection (V02-T26)", () => {
  const detail = {
    id: "req-1",
    processingState: "active",
    analysisContext: { note: "旧上下文", updatedAt: "2026-11-02T00:00:00.000Z", updatedBy: "pm-1" },
  } as unknown as RequirementDetail;

  it("saves the context and then forces a re-analysis from the same button", async () => {
    const calls: Array<{ url: string; method: string | undefined; body: Record<string, unknown> | undefined }> = [];
    const onSaved = vi.fn();
    fetchMock.mockImplementation(async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ url: String(input), method: init?.method, body });
      return jsonOk({ requirementId: "req-1", status: "queued", analysisContext: { note: body?.context, updatedAt: "2026-11-03T00:00:00.000Z", updatedBy: "pm-1" } }, 202);
    });
    render(<AnalysisContextSection detail={detail} onSaved={onSaved} />);
    expect((screen.getByRole("textbox", { name: "补充上下文" }) as HTMLTextAreaElement).value).toBe("旧上下文");
    fireEvent.change(screen.getByRole("textbox", { name: "补充上下文" }), { target: { value: "  硬件仅支持 C706  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存并重新分析" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const contextCall = calls.find((call) => call.url === "/api/requirements/req-1/analysis-context");
    const retryCall = calls.find((call) => call.url === "/api/analysis/req-1/retry");
    expect(contextCall?.method).toBe("PUT");
    expect(contextCall?.body).toEqual({ context: "硬件仅支持 C706" });
    expect(retryCall?.method).toBe("POST");
    expect(retryCall?.body).toEqual({ force: true });
  });

  it("keeps the saved context but reports a readable 409 when re-analysis cannot start", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/requirements/req-1/analysis-context") return jsonOk({ requirementId: "req-1", analysisContext: { note: "x", updatedAt: "2026-11-03T00:00:00.000Z", updatedBy: "pm-1" } });
      if (String(input) === "/api/analysis/req-1/retry" && init?.method === "POST") return jsonOk({ error: { code: "CONFLICT", message: "conflict" } }, 409);
      return jsonOk({});
    });
    render(<AnalysisContextSection detail={detail} onSaved={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox", { name: "补充上下文" }), { target: { value: "新上下文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并重新分析" }));
    await waitFor(() => expect(screen.getByText(/补充上下文已保存，但重新分析未开始/)).toBeInTheDocument());
  });
});

describe("AuditPanel event-type filter", () => {
  const event = { id: "ev-1", actorId: "pm-1", eventType: "analysis.retry_requested", entityType: "requirement", entityId: "req-12345678", result: "succeeded", safeDetails: {}, occurredAt: "2026-11-03T00:00:00.000Z" };

  it("sends the typed event type to the server", async () => {
    fetchMock.mockImplementation(async () => jsonOk({ items: [event] }));
    render(<AuditPanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/audit?limit=50", expect.anything()));
    fireEvent.change(screen.getByLabelText("事件类型筛选"), { target: { value: "  owner.manually_mapped  " } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/audit?eventType=owner.manually_mapped&limit=50", expect.anything()));
  });

  it("clicking an event type in the table filters by that type", async () => {
    fetchMock.mockImplementation(async () => jsonOk({ items: [event] }));
    render(<AuditPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "analysis.retry_requested" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/audit?eventType=analysis.retry_requested&limit=50", expect.anything()));
    expect((screen.getByLabelText("事件类型筛选") as HTMLInputElement).value).toBe("analysis.retry_requested");
  });
});

describe("OpsPanel", () => {
  const gatesBody = () => ({
    ready: false,
    gates: [
      { id: "G1", title: "正式 Base 全链路", requirement: "通知实收与回退演练", auto: { status: "pass", detail: "已推送 279 条" }, manual: { required: true, confirmed: false }, status: "pending" },
      { id: "G3", title: "待匹配需求有确定去向", requirement: "无待匹配且未推送", auto: { status: "pass", detail: "没有待匹配且未推送的活跃需求" }, manual: { required: false, confirmed: false }, status: "pass" },
    ],
  });
  const metricsBody = () => ({
    window: { days: 7, since: "2026-11-03T00:00:00.000Z" },
    sync: { total: 4, succeeded: 4, partialFailure: 0, failed: 0, successRate: 100, avgDurationSeconds: 1.2, lastCompletedAt: "2026-11-03T01:00:00.000Z" },
    analysis: { total: 5, analyzed: 4, failedRetryable: 1, running: 0, successRate: 80, avgDurationSeconds: 2.5, lowConfidence: 1, lowConfidenceRate: 25, failureCodes: [{ code: "AI_TIMEOUT", count: 2 }] },
    owner: { autoMapped: 10, manuallyMapped: 2, pendingMapping: 1, notRequired: 3 },
    push: { total: 6, pushed: 6, failed: 0, successRate: 100, avgDurationSeconds: 0.8 },
    duplicate: { confirmedSuppressed: 2, suspected: 1 },
    scoring: { aiSuggested: 5, manual: 1, aiApplied: 2, adoptionRate: 66.7 },
  });
  const job = { id: "job-1", jobType: "base_push", status: "failed", dedupeKey: "base-push:req-1", attemptCount: 5, maxAttempts: 5, availableAt: "2026-11-03T00:00:00.000Z", lockedUntil: null, lastErrorCode: "BASE_TIMEOUT", lastErrorSummary: "upstream timed out", createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T01:00:00.000Z", requirementId: "req-12345678" };

  it("renders failed and stuck jobs from the read-only endpoint", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health/ready") return jsonOk({ status: "ready", database: "connected", migrations: { latest: "0027_source_missing.sql", expected: "0027_source_missing.sql", upToDate: true } });
      if (path.startsWith("/api/ops/metrics")) return jsonOk({ metrics: metricsBody() });
      if (path === "/api/ops/gates") return jsonOk(gatesBody());
      return jsonOk({ now: "2026-11-03T02:00:00.000Z", items: { failed: [job], stuck: [{ ...job, id: "job-2", status: "running" }] } });
    });
    render(<OpsPanel />);
    expect(await screen.findByRole("heading", { name: "作业运维" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ops/jobs?limit=50", expect.anything()));
    expect(screen.getAllByText("base_push").length).toBe(2);
    expect(screen.getAllByText("BASE_TIMEOUT").length).toBe(2);
    expect(screen.getAllByText("upstream timed out").length).toBe(2);
    expect(screen.getAllByText("5 / 5").length).toBe(2);
    expect(screen.getByText(/迁移：已应用 0027_source_missing.sql，与代码一致/)).toBeInTheDocument();
    expect(screen.getByText("同步成功率")).toBeInTheDocument();
    expect(screen.getAllByText("100%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/分析失败码：AI_TIMEOUT×2/)).toBeInTheDocument();
    expect(screen.getByText("G1 · 正式 Base 全链路")).toBeInTheDocument();
    expect(screen.getByText("记录证据")).toBeInTheDocument();
  });

  it("records evidence for a manual gate", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health/ready") return jsonOk({ status: "ready" });
      if (path.startsWith("/api/ops/metrics")) return jsonOk({ metrics: metricsBody() });
      if (path === "/api/ops/gates") return jsonOk(gatesBody());
      if (path.startsWith("/api/ops/gates/")) {
        calls.push({ url: path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return jsonOk({ gateId: "G1", confirmed: true });
      }
      return jsonOk({ now: "2026-11-03T02:00:00.000Z", items: { failed: [], stuck: [] } });
    });
    render(<OpsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "记录证据" }));
    fireEvent.change(screen.getByLabelText("G1 证据"), { target: { value: "通知截图 2026-11-12" } });
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toEqual({ url: "/api/ops/gates/G1", method: "PUT", body: { confirmed: true, evidence: "通知截图 2026-11-12" } });
  });

  it("switches the metrics window to 30 days", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health/ready") return jsonOk({ status: "ready" });
      if (path.startsWith("/api/ops/metrics")) return jsonOk({ metrics: metricsBody() });
      return jsonOk({ now: "2026-11-03T02:00:00.000Z", items: { failed: [], stuck: [] } });
    });
    render(<OpsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "近 30 天" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/ops/metrics?days=30"), expect.anything()));
  });

  it("warns when the database migration lags behind the code", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health/ready") return jsonOk({ status: "ready", migrations: { latest: "0019_scoring_v2.sql", expected: "0027_source_missing.sql", upToDate: false } });
      return jsonOk({ now: "2026-11-03T02:00:00.000Z", items: { failed: [], stuck: [] } });
    });
    render(<OpsPanel />);
    expect(await screen.findByText(/代码期望 0027_source_missing.sql/)).toBeInTheDocument();
  });

  it("shows empty states and keeps the refresh action", async () => {
    fetchMock.mockImplementation(async () => jsonOk({ now: "2026-11-03T02:00:00.000Z", items: { failed: [], stuck: [] } }));
    render(<OpsPanel />);
    expect(await screen.findByText("没有失败作业")).toBeInTheDocument();
    expect(screen.getByText("没有卡住的作业")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /刷新/ })).toBeEnabled();
  });
});

// ---------- 方案 A：集团需求池（同应用、数据隔离） ----------

describe("集团需求池 UI（方案 A）", () => {
  const groupRow = {
    id: "group-req-1",
    sourceRequirementId: "tb-g-1",
    title: "集团需求样例",
    sourceVersion: 1,
    pipeline: { pull: "synced", analysis: "pending", owner: "pending_mapping", push: "pending" },
    ownerName: null,
    updatedAt: "2026-11-21T00:00:00.000Z",
    source: { created: "2026-11-21T00:00:00.000Z", description: "集团池描述" },
  };
  const groupCounts = { teambition: 7, web_manual: 0, base_form: 0, chat_paste: 0, all: 7 };
  function groupDetail(overrides: Record<string, unknown> = {}) {
    return { ...groupRow, analysis: null, analyses: [], pool: "group", ...overrides };
  }

  it("requests the group scope, hides source tabs and reports only the all count", async () => {
    const calls: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      calls.push(path);
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path === "/api/requirements/source-counts?pool=group") return jsonOk({ counts: groupCounts });
      if (path.startsWith("/api/requirements/export")) return new Response("", { status: 200 });
      if (path.startsWith("/api/requirements/")) return jsonOk(groupDetail());
      return jsonOk({ items: [groupRow], nextCursor: null });
    });
    const onCount = vi.fn();
    render(<RequirementsPanel scope="group" onRefresh={() => undefined} onGroupCountChange={onCount} />);

    expect(await screen.findByText("集团需求样例")).toBeInTheDocument();
    // 集团池只有一个 TB 来源：不渲染五个来源 Tab。
    expect(screen.queryByRole("tablist", { name: "需求来源" })).toBeNull();
    // 列表请求显式带 pool=group，且不带 source。
    const listCall = calls.find((path) => path.startsWith("/api/requirements?"));
    expect(listCall).toContain("pool=group");
    expect(listCall).not.toContain("source=");
    // 只取 all 作为页头条数。
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(7));
    expect(calls).toContain("/api/requirements/source-counts?pool=group");
  });

  it("exports the group scope and never sends pool on detail or write calls", async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      calls.push({ path, method: init?.method });
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/source-counts")) return jsonOk({ counts: groupCounts });
      if (path.startsWith("/api/requirements/export")) return new Response("\uFEFF平台ID\r\nRQ-000001", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "x-rq-truncated": "false" } });
      if (path.startsWith("/api/requirements/")) return jsonOk(groupDetail());
      return jsonOk({ items: [groupRow], nextCursor: null });
    });
    render(<RequirementsPanel scope="group" onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "导出 CSV" }));
    await waitFor(() => expect(calls.some((call) => call.path.startsWith("/api/requirements/export?"))).toBe(true));
    const exportPath = calls.find((call) => call.path.startsWith("/api/requirements/export?"))!.path;
    expect(exportPath).toContain("pool=group");
    // 详情与写接口一律不带 pool（服务端按 UUID 推导归属）。
    expect(calls.filter((call) => call.method === "PUT" || call.method === "POST").every((call) => !call.path.includes("pool="))).toBe(true);
    fireEvent.click(await screen.findByText("集团需求样例"));
    await screen.findByRole("heading", { name: /集团需求样例/ });
    const detailCall = calls.find((call) => call.path === "/api/requirements/group-req-1");
    expect(detailCall).toBeTruthy();
  });

  it("guards cross-pool details by detail.pool even without a server 404", async () => {
    window.history.replaceState(null, "", "/?requirement=product-req-1#group-requirements");
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/source-counts")) return jsonOk({ counts: groupCounts });
      if (path.startsWith("/api/requirements/")) return jsonOk(groupDetail({ id: "product-req-1", pool: "product", title: "产品池需求" }));
      return jsonOk({ items: [groupRow], nextCursor: null });
    });
    render(<RequirementsPanel scope="group" onRefresh={() => undefined} />);

    // 服务端返回 200 + pool=product：页面按 404 展示，不渲染对方数据。
    expect(await screen.findByText("请求的资源不存在或已被删除。")).toBeInTheDocument();
    expect(screen.getByText("无法载入需求详情")).toBeInTheDocument();
    expect(screen.queryByText("产品池需求")).toBeNull();
  });

  it("labels group details with a pool chip while keeping the TB field labels", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/source-counts")) return jsonOk({ counts: groupCounts });
      if (path.startsWith("/api/requirements/")) return jsonOk(groupDetail());
      return jsonOk({ items: [groupRow], nextCursor: null });
    });
    render(<RequirementsPanel scope="group" onRefresh={() => undefined} />);
    fireEvent.click(await screen.findByText("集团需求样例"));
    const heading = await screen.findByRole("heading", { name: /集团需求样例/ });
    expect(within(heading).getByText("集团池")).toBeInTheDocument();
    // 详情仍按 TB 展示来源与字段标签；「无来源徽标」只限制列表行。
    expect(screen.getAllByText("TB").length).toBeGreaterThan(0);
    expect(screen.getByText("执行人")).toBeInTheDocument();
  });

  it("renders two source cards, blocks empty allowlists and sends the group payload", async () => {
    let createBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources" && init?.method === "POST") {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk({ id: "source-g", pool: "group", projectName: "需求收集与管理", enabled: false, schedule: { enabled: false, weekday: 1, weekdays: [1], time: "09:00", timezone: "Asia/Shanghai" }, executorAllowlist: ["贾浩"] }, 201);
      }
      if (path.startsWith("/api/ops/metrics")) return jsonOk({ metrics: {} });
      return jsonOk({ items: [] });
    });
    render(<SourcesPanel sources={[source]} loadState="ready" onRefresh={() => undefined} />);
    const groupCard = screen.getByRole("region", { name: "集团需求池来源配置" });
    expect(within(groupCard).getByLabelText("集团池项目名称")).toHaveValue("需求收集与管理");
    // 空名单：保存与启用同步都禁用，并给出明确提示。
    expect(within(groupCard).getByRole("button", { name: "创建集团池来源" })).toBeDisabled();
    expect(within(groupCard).getByLabelText("启用集团池同步")).toBeDisabled();
    expect(within(groupCard).getByText(/请至少填写 1 个执行人/)).toBeInTheDocument();

    const addInput = within(groupCard).getByLabelText("添加执行人");
    fireEvent.change(addInput, { target: { value: " 贾浩 " } });
    fireEvent.keyDown(addInput, { key: "Enter" });
    expect(within(groupCard).getByText("贾浩")).toBeInTheDocument();
    expect(within(groupCard).getByRole("button", { name: "创建集团池来源" })).toBeEnabled();

    fireEvent.click(within(groupCard).getByRole("button", { name: "创建集团池来源" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sources", expect.objectContaining({ method: "POST" })));
    expect(createBody).toMatchObject({ pool: "group", projectName: "需求收集与管理", executorAllowlist: ["贾浩"] });
  });

  it("lists unresolved executor names from a 400 without losing the draft", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/sources" && init?.method === "POST") {
        return jsonOk({ error: { code: "VALIDATION_FAILED", message: "执行人未解析", details: { unresolvedExecutorNames: ["李四"] } } }, 400);
      }
      if (path.startsWith("/api/ops/metrics")) return jsonOk({ metrics: {} });
      return jsonOk({ items: [] });
    });
    render(<SourcesPanel sources={[]} loadState="ready" onRefresh={() => undefined} />);
    const groupCard = screen.getByRole("region", { name: "集团需求池来源配置" });
    const addInput = within(groupCard).getByLabelText("添加执行人");
    fireEvent.change(addInput, { target: { value: "李四" } });
    fireEvent.keyDown(addInput, { key: "Enter" });
    fireEvent.click(within(groupCard).getByRole("button", { name: "创建集团池来源" }));

    expect(await within(groupCard).findByText(/李四：请填写 Teambition 组织目录中的准确姓名/)).toBeInTheDocument();
    expect(within(groupCard).getByText("李四")).toBeInTheDocument();
    expect(within(groupCard).getByRole("button", { name: "创建集团池来源" })).toBeEnabled();
  });

  it("sends the batch pool filter and shows the pool chip plus filtered count", async () => {
    const batch = { id: "batch-g-1", status: "succeeded", triggerType: "scheduled", totalCount: 3, succeededCount: 3, failedCount: 0, filteredCount: 12, pool: "group", startedAt: "2026-11-21T01:00:00.000Z" };
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/batches/batch-g-1") return jsonOk({ ...batch, completedAt: null, items: [] });
      return jsonOk({ items: [batch], nextCursor: null });
    });
    render(<BatchesPanel onRefresh={() => undefined} pool="group" />);
    expect(await screen.findByText("集团池")).toBeInTheDocument();
    const listCall = fetchMock.mock.calls.map((call) => String(call[0])).find((path) => path.startsWith("/api/batches?"));
    expect(listCall).toContain("pool=group");
    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(await screen.findByText(/名单外跳过 12/)).toBeInTheDocument();
  });

  it("switches the sync records batch pool and states that audit has no pool filter", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      return jsonOk({ items: [], nextCursor: null, path });
    });
    render(<SyncRecordsPanel onRefresh={() => undefined} />);
    await waitFor(() => expect(fetchMock.mock.calls.map((call) => String(call[0])).some((path) => path.startsWith("/api/batches?"))).toBe(true));
    expect(screen.getByText("审计日志暂不支持按池筛选。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "集团池" }));
    await waitFor(() => expect(fetchMock.mock.calls.map((call) => String(call[0])).some((path) => path.startsWith("/api/batches?") && path.includes("pool=group"))).toBe(true));
  });

  it("switches the ops page scope and keeps product as the default", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/health/ready") return jsonOk({ status: "ready" });
      if (path.startsWith("/api/ops/gates")) return jsonOk({ ready: true, gates: [] });
      if (path.startsWith("/api/ops/metrics")) return jsonOk({ metrics: { window: { days: 7, since: "2026-11-14T00:00:00.000Z" }, sync: { total: 0, succeeded: 0, partialFailure: 0, failed: 0, successRate: null, avgDurationSeconds: null, lastCompletedAt: null }, analysis: { total: 0, analyzed: 0, failedRetryable: 0, running: 0, successRate: null, avgDurationSeconds: null, lowConfidence: 0, lowConfidenceRate: null, failureCodes: [] }, owner: { autoMapped: 0, manuallyMapped: 0, pendingMapping: 0, notRequired: 0 }, push: { total: 0, pushed: 0, failed: 0, successRate: null, avgDurationSeconds: null }, duplicate: { confirmedSuppressed: 0, suspected: 0 }, scoring: { aiSuggested: 0, manual: 0, aiApplied: 0, adoptionRate: null } } });
      return jsonOk({ now: "2026-11-21T02:00:00.000Z", items: { failed: [], stuck: [] } });
    });
    render(<OpsPanel />);
    await waitFor(() => expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain("/api/ops/jobs?limit=50"));
    // 产品池保留「上线 Gate」整块。
    expect(await screen.findByText("上线 Gate")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "集团池" }));
    await waitFor(() => expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain("/api/ops/jobs?limit=50&pool=group"));
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain("/api/ops/metrics?days=7&pool=group");
    // 集团池：产品口径的 Gate 整块不渲染，避免 G1「已推送 334 条」误导。
    expect(screen.queryByText("上线 Gate")).toBeNull();
    expect(screen.queryByText(/G1/)).toBeNull();
    // 切回产品池恢复。
    fireEvent.click(screen.getByRole("button", { name: "产品池" }));
    expect(await screen.findByText("上线 Gate")).toBeInTheDocument();
  });
});

describe("集团需求池切池守卫与创建入口（P2 修复）", () => {
  const productRow = {
    id: "req-1",
    sourceRequirementId: "tb-1",
    title: "产品池需求标题",
    sourceVersion: 2,
    pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" },
    ownerName: "Ada",
    updatedAt: "2026-10-09T00:00:00.000Z",
    source: { created: "2026-10-08T00:00:00.000Z", description: "产品池描述" },
  };
  const productDetail = { ...productRow, pool: "product", analysis: null, analyses: [] };
  const counts = { teambition: 0, web_manual: 0, base_form: 0, chat_paste: 0, all: 0 };

  function mockPoolApi(rows: unknown[] = []) {
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path === "/api/people") return jsonOk({ items: [] });
      if (path.startsWith("/api/requirements/source-counts")) return jsonOk({ counts });
      if (path === "/api/requirements/req-1") return jsonOk(productDetail);
      if (path.startsWith("/api/requirements/")) return jsonOk({ items: rows, nextCursor: null });
      return jsonOk({ items: rows, nextCursor: null });
    });
  }

  it("shows a 404 detail state instead of the previous pool's detail when the scope switches", async () => {
    window.history.replaceState(null, "", "/?requirement=req-1");
    mockPoolApi();
    const { rerender } = render(<RequirementsPanel scope="product" onRefresh={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "产品池需求标题" })).toBeInTheDocument();

    rerender(<RequirementsPanel scope="group" onRefresh={() => undefined} />);

    // 切池后详情区必须进入错误态，且不再出现上一池的需求标题。
    expect(await screen.findByText("请求的资源不存在或已被删除。")).toBeInTheDocument();
    expect(screen.getByText("无法载入需求详情")).toBeInTheDocument();
    expect(screen.queryByText("产品池需求标题")).toBeNull();

    // 切回产品池：详情按原池恢复（守卫是双向的，不能修成单向坏掉）。
    rerender(<RequirementsPanel scope="product" onRefresh={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "产品池需求标题" })).toBeInTheDocument();
    expect(screen.queryByText("无法载入需求详情")).toBeNull();
  });

  it("hides the manual intake entries in the group pool, including the empty state", async () => {
    mockPoolApi([]);
    render(<RequirementsPanel scope="group" onRefresh={() => undefined} />);
    // 空态也不渲染跨池写入入口。
    expect(await screen.findByText("没有匹配的需求")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建需求" })).toBeNull();
    expect(screen.queryByRole("button", { name: "从聊天粘贴" })).toBeNull();

    // 产品池不受影响：两个创建入口都还在。
    const { rerender } = render(<RequirementsPanel scope="group" onRefresh={() => undefined} />);
    rerender(<RequirementsPanel scope="product" onRefresh={() => undefined} />);
    expect(await screen.findByRole("button", { name: "新建需求" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从聊天粘贴" })).toBeInTheDocument();
  });
});
