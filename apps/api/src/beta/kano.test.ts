// V02-T14 接缝测试：Kano 模块公共行为——掩码输入、受控候选类型、证据 ref 校验、提示词形状。
import test from "node:test";
import assert from "node:assert/strict";
import { KANO_PROMPT_VERSION, buildKanoRequest, kanoPrompt, validateKanoReport } from "./kano.js";

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
