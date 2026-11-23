// PRD 提示词（S2）：覆盖前置评估、生成、复制、版本回填、失败态与超时。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PrdPromptSection } from "./prd-prompt";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
});

const assessmentOutput = {
  background: "夜间骑行提示音过大",
  goal: "降低夜间提示音干扰",
  scope: { in: ["音量分级"], out: ["改硬件"] },
  value: "提升夜间体验",
  feasibility: { technical: "固件可调", cost: "3 人日", dependency: "C706 固件", risk: "法规" },
  verdict: "advance" as const,
  verdictReason: "场景明确",
  confidence: "high" as const,
  assumptions: ["夜间占比 15%"],
  openQuestions: ["是否保留最低音量"],
  investigationPrompt: "调查夜间骑行接受度",
};

const assessment = {
  id: "assessment-3",
  requirementId: "req-1",
  version: 3,
  status: "succeeded",
  promptVersion: "rq-assessment-v1",
  model: "stub-model",
  inputs: { background: "", goal: "", scenario: "" },
  output: assessmentOutput,
  errorCode: null,
  createdBy: null,
  createdAt: "2026-11-21T01:00:00.000Z",
};

const PROMPT = "## 角色与任务\n你是资深产品经理。\n\n## 背景与问题\n夜间提示音问题。";

function prdVersion(version: number, options: { status?: "running" | "succeeded" | "failed"; notes?: string; prompt?: string; errorCode?: string | null } = {}) {
  const status = options.status ?? "succeeded";
  return {
    id: `prd-${version}`,
    version,
    status,
    output: status === "succeeded" ? { prompt: options.prompt ?? PROMPT, assumptions: ["假设：夜间骑行占比约 15%"], openQuestions: ["最低提示音量是否保留？"] } : null,
    investigationNotes: options.notes ?? "",
    assessmentVersion: 3,
    errorCode: options.errorCode ?? (status === "failed" ? "provider_error" : null),
    model: "stub-model",
    promptVersion: "rq-prd-prompt-v1",
    createdAt: `2026-11-21T0${version}:00:00.000Z`,
    completedAt: status === "running" ? null : `2026-11-21T0${version}:01:00.000Z`,
  };
}

function jsonOk(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function mockApi(options: { assessments?: unknown[]; prdItems?: unknown[]; post?: (body: Record<string, unknown>, signal?: AbortSignal | null) => Promise<Response> } = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const path = typeof input === "string" ? input : new Request(input).url;
    if (path.endsWith("/assessments")) return jsonOk({ items: options.assessments ?? [assessment] });
    if (path.endsWith("/prd-prompts") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return options.post ? options.post(body, init.signal ?? null) : jsonOk(prdVersion(1), 201);
    }
    if (path.endsWith("/prd-prompts")) return jsonOk({ items: options.prdItems ?? [] });
    return jsonOk({});
  });
}

describe("PrdPromptSection (S2)", () => {
  it("disables generation when there is no succeeded assessment and never calls the model", async () => {
    mockApi({ assessments: [{ ...assessment, status: "failed", output: null }] });
    render(<PrdPromptSection requirementId="req-1" />);

    expect(await screen.findByRole("heading", { name: "PRD 提示词" })).toBeInTheDocument();
    expect(await screen.findByText(/先生成一条成功的需求评估/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往需求评估" })).toHaveAttribute("href", "#req-assessment-heading");
    expect(screen.getByLabelText("调研结论")).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成 PRD 提示词" })).toBeDisabled();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/prd-prompts") && (call[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("generates a version with the assessment and investigation notes, then copies the full prompt", async () => {
    let posted: Record<string, unknown> | undefined;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockApi({
      post: async (body) => {
        posted = body;
        return jsonOk(prdVersion(1, { notes: String(body.investigationNotes) }), 201);
      },
    });
    render(<PrdPromptSection requirementId="req-1" />);

    fireEvent.change(await screen.findByLabelText("调研结论"), { target: { value: "访谈 6 位夜间骑行者，均希望可调音量。" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 PRD 提示词" }));

    expect(await screen.findByText(/v1 已生成/)).toBeInTheDocument();
    expect(posted).toMatchObject({ assessmentId: "assessment-3", investigationNotes: "访谈 6 位夜间骑行者，均希望可调音量。" });
    // 结果区展示提示词、10 个章节与假设/待确认。
    expect(screen.getByLabelText("PRD 提示词内容")).toHaveTextContent("## 角色与任务");
    expect(screen.getByLabelText("提示词包含的章节").textContent).toContain("输出要求（PRD 结构）");
    expect(screen.getByText("假设：夜间骑行占比约 15%")).toBeInTheDocument();
    expect(screen.getByText("最低提示音量是否保留？")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPT));
    expect(await screen.findByRole("button", { name: "已复制" })).toBeInTheDocument();
    // 不自动复制：只有点击后才写入剪贴板。
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("keeps the notes and surfaces the server failure when generation is rejected", async () => {
    mockApi({ post: async () => jsonOk({ error: { code: "ASSESSMENT_REQUIRED", message: "缺少成功评估" } }, 409) });
    render(<PrdPromptSection requirementId="req-1" />);

    fireEvent.change(await screen.findByLabelText("调研结论"), { target: { value: "保留这段输入" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 PRD 提示词" }));

    expect(await screen.findByText(/请先生成一条成功的需求评估/)).toBeInTheDocument();
    expect(screen.getByLabelText("调研结论")).toHaveValue("保留这段输入");
    expect(screen.getByRole("button", { name: "生成 PRD 提示词" })).toBeEnabled();
  });

  it("shows rate limiting and provider failures without dropping the draft", async () => {
    mockApi({ post: async () => new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "too many" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "37" } }) });
    render(<PrdPromptSection requirementId="req-1" />);
    fireEvent.change(await screen.findByLabelText("调研结论"), { target: { value: "草稿不能丢" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 PRD 提示词" }));
    expect(await screen.findByText(/请 37 秒后重试/)).toBeInTheDocument();
    expect(screen.getByLabelText("调研结论")).toHaveValue("草稿不能丢");
  });

  it("switches history versions and refills that version's investigation notes", async () => {
    mockApi({
      prdItems: [
        prdVersion(2, { notes: "第二版调研结论", prompt: "## 角色与任务\nv2" }),
        prdVersion(1, { notes: "第一版调研结论", prompt: "## 角色与任务\nv1" }),
      ],
    });
    render(<PrdPromptSection requirementId="req-1" />);

    expect(await screen.findByLabelText("PRD 提示词内容")).toHaveTextContent("v2");
    expect(screen.getByLabelText("调研结论")).toHaveValue("第二版调研结论");

    fireEvent.click(screen.getByRole("button", { name: /v1 · 已生成/ }));

    expect(screen.getByLabelText("PRD 提示词内容")).toHaveTextContent("v1");
    expect(screen.getByLabelText("调研结论")).toHaveValue("第一版调研结论");
    expect(screen.getAllByText(/v1 · 已生成/).length).toBeGreaterThan(0);
  });

  it("times out at the client deadline and keeps the notes", async () => {
    mockApi({
      post: (_body, signal) => new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    });
    render(<PrdPromptSection requirementId="req-1" timeoutMs={20} />);

    fireEvent.change(await screen.findByLabelText("调研结论"), { target: { value: "超时也要保留" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 PRD 提示词" }));

    expect(await screen.findByText(/生成超时（最长约 95 秒）/)).toBeInTheDocument();
    expect(screen.getByLabelText("调研结论")).toHaveValue("超时也要保留");
  });

  it("refetches assessments when the detail page reports a fresh one", async () => {
    // P2（2026-11-23）：详情页生成评估成功后，同页提示词块要自己解锁，不能要求刷新页面。
    let assessments: unknown[] = [];
    fetchMock.mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : new Request(input).url;
      if (path.endsWith("/assessments")) return jsonOk({ items: assessments });
      if (path.endsWith("/prd-prompts")) return jsonOk({ items: [] });
      return jsonOk({});
    });
    const { rerender } = render(<PrdPromptSection requirementId="req-1" />);
    expect(await screen.findByText(/先生成一条成功的需求评估/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成 PRD 提示词" })).toBeDisabled();

    assessments = [assessment];
    rerender(<PrdPromptSection requirementId="req-1" assessmentRevision={1} />);

    await waitFor(() => expect(screen.queryByText(/先生成一条成功的需求评估/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "生成 PRD 提示词" })).toBeEnabled();
    expect(screen.getByText(/评估 v3/)).toBeInTheDocument();
  });

  it("shows the empty state without generating", async () => {
    mockApi();
    render(<PrdPromptSection requirementId="req-1" />);
    expect(await screen.findByText("还没有 PRD 提示词")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成 PRD 提示词" })).toBeEnabled();
  });
});
