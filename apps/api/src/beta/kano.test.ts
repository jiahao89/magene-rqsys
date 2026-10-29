// V02-T14 接缝测试：Kano 模块公共行为——掩码输入、受控候选类型、证据 ref 校验、提示词形状。
import test from "node:test";
import assert from "node:assert/strict";
import { KANO_PROMPT_VERSION, buildKanoRequest, createDeepSeekKanoProvider, kanoPrompt, validateKanoReport } from "./kano.js";

const evidence = {
  version: 2, title: "合成访谈总结", summary: "竞技用户重视训练完成度分析。",
  evidenceFragments: [{ ref: "S1", text: "竞技用户重视训练完成度分析" }, { ref: "S2", text: "爱好者关注数据可读性" }],
  coverageNotes: "L2/L3 合并；L1 缺样本。", knownAudiences: ["L2", "L3"],
};

test("kano request masks requirement text before it reaches the prompt", () => {
  const request = buildKanoRequest({ title: "用户@张三 需要 13800138000 联系", description: "邮箱 a@b.com", audienceTags: ["L2"], audienceConfirmed: true }, evidence);
  assert.equal(request.requirementTitle.includes("张三"), false);
  assert.equal(request.requirementTitle.includes("13800138000"), false);
  assert.equal(request.requirementDescription.includes("a@b.com"), false);
  const prompt = kanoPrompt(request);
  // 资料作为数据整体进入提示词；掩码后的需求文本不回流原文
  assert.equal(prompt.includes("S1"), true);
  assert.equal(prompt.includes("13800138000"), false);
});

test("kano report validation: controlled types, evidence refs must exist, no stats fields", () => {
  const valid = {
    capabilities: [{ capability: "训练计划导出", audience: "L2", positiveQuestion: "如果产品支持导出训练计划，你的感受是？", negativeQuestion: "如果不支持，你的感受是？", simulatedLeaning: { option: "喜欢", rationale: "竞技用户重视分析" }, candidateType: "期望型", explanation: "证据显示用户重视完成度分析。", evidence: ["S1"] }],
    gaps: ["L1 缺直接样本"], confidence: "中", confidenceReason: "仅覆盖 L2/L3。",
  };
  const report = validateKanoReport(valid, evidence);
  assert.equal(report.capabilities[0]!.candidateType, "期望型");
  // 伪造引用：资料版本中不存在的 ref 拒绝（AC05）
  assert.throws(() => validateKanoReport({ ...valid, capabilities: [{ ...valid.capabilities[0], evidence: ["S9"] }] }, evidence), /does not exist/);
  // 未知候选类型拒绝（AC04）；“一维质量”按别名归一为期望型由提示词约束，schema 只收规范类别
  assert.throws(() => validateKanoReport({ ...valid, capabilities: [{ ...valid.capabilities[0], candidateType: "一维质量" }] }, evidence));
  // 不存在的统计字段：多余键拒绝（strict schema，样本数/比例无处可放）
  assert.throws(() => validateKanoReport({ ...valid, sampleSize: 30 }, evidence));
});

test("kano prompt version is pinned", () => {
  assert.equal(KANO_PROMPT_VERSION, "rq-kano-v1");
});

function kanoFetch(captured: { url?: string; body?: Record<string, unknown>; aborted?: boolean }, content = "{}") {
  return (async (input: unknown, init?: { body?: unknown; signal?: AbortSignal }) => {
    captured.url = String(input);
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    init?.signal?.addEventListener("abort", () => { captured.aborted = true; });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("kano provider shares the main analysis defaults: empty env values fall back instead of passing through", async () => {
  const saved = { ...process.env };
  try {
    process.env.AI_BASE_URL = ""; process.env.AI_MODEL = ""; process.env.AI_TIMEOUT_MS = ""; process.env.AI_API_KEY = "k";
    const captured: { url?: string; body?: Record<string, unknown> } = {};
    const provider = createDeepSeekKanoProvider({ fetch: kanoFetch(captured) });
    assert.equal(provider.model, "deepseek-flash", "同一份 AI_MODEL 默认值，不能和主分析分叉");
    await provider.run("p");
    assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
    assert.equal(captured.body?.model, "deepseek-flash");
  } finally {
    process.env = saved;
  }
});

test("kano provider treats an empty AI_TIMEOUT_MS as unset rather than a zero-ms abort", async () => {
  const saved = { ...process.env };
  try {
    process.env.AI_TIMEOUT_MS = ""; process.env.AI_API_KEY = "k";
    const captured: { aborted?: boolean } = {};
    const provider = createDeepSeekKanoProvider({ fetch: kanoFetch(captured) });
    await provider.run("p");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(captured.aborted ?? false, false);
  } finally {
    process.env = saved;
  }
});

test("kano provider omits temperature for AI_TEMPERATURE=none and accepts fenced JSON", async () => {
  const saved = { ...process.env };
  try {
    process.env.AI_TEMPERATURE = "none"; process.env.AI_API_KEY = "k";
    const captured: { body?: Record<string, unknown> } = {};
    const provider = createDeepSeekKanoProvider({ fetch: kanoFetch(captured, "```json\n{\"ok\":true}\n```") });
    assert.deepEqual(await provider.run("p"), { ok: true });
    assert.equal("temperature" in (captured.body ?? {}), false);
  } finally {
    process.env = saved;
  }
});
