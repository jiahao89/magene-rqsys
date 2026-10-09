import assert from "node:assert/strict";
import test from "node:test";
import type { PriorityRuleVersionRecord } from "../domain/persistence.js";
import { buildPriorityRule, recommendationValues } from "./priority-rule.js";
import { runAnalysis } from "./service.js";
import type { ValidatedAnalysis } from "./contract.js";

const base = {
  module: "报表分析",
  confidence: "中" as const,
  confidence_reason: "理由",
  evidence: ["原文片段"],
  facts: [],
  inferences: [],
  missing_inputs: [],
  blind_spots: [],
  priority: null,
};

function analysis(recommendation: string): ValidatedAnalysis {
  const item = () => ({ recommendation, rationale: "理由", evidence: ["原文片段"] });
  return {
    ...base,
    recommendations: { user: item(), market: item(), business: item(), technology: item() },
  } as ValidatedAnalysis;
}

// 校准过的规则：每维建议取值映射到已批准分数；阈值把四维总分映射到 P0–P3。
const scoring = {
  user: { 强: 3, 中: 2, 弱: 1 },
  market: { 强: 3, 中: 2, 弱: 1 },
  business: { 强: 3, 中: 2, 弱: 1 },
  technology: { 强: 3, 中: 2, 弱: 1 },
};
const ruleRecord: PriorityRuleVersionRecord = {
  id: "rule-1", version: 1, status: "published",
  rules: { scoring, thresholds: { p0: 11, p1: 8, p2: 4 } },
  validationEvidence: [{ cohort: "2026-Q3", cases: 12 }], createdBy: null, createdAt: "2026-01-01T00:00:00.000Z", publishedAt: "2026-01-01T00:00:00.000Z",
};

test("recommendationValues 提取四维建议取值作为评分映射的查找键", () => {
  assert.deepEqual(recommendationValues(analysis("中")), { user: "中", market: "中", business: "中", technology: "中" });
});

test("buildPriorityRule：按已批准评分映射与阈值确定性映射 P0–P3", () => {
  const rule = buildPriorityRule(ruleRecord);
  assert.ok(rule);
  assert.equal(rule.compute({ user: "强", market: "强", business: "强", technology: "强" }), "P0");
  assert.equal(rule.compute({ user: "中", market: "中", business: "中", technology: "中" }), "P1");
  assert.equal(rule.compute({ user: "弱", market: "弱", business: "弱", technology: "弱" }), "P2");
});

test("buildPriorityRule：建议取值不在评分映射中时优先级为 null（宁缺毋滥）", () => {
  const rule = buildPriorityRule(ruleRecord)!;
  assert.equal(rule.compute({ user: "强", market: "强", business: "强", technology: "未知取值" }), null);
});

test("buildPriorityRule：证据缺失与否不影响分数——禁止把 missing_evidence 计为优先级分数", () => {
  // 建议取值相同、证据完整度不同的两条分析必须得到同一优先级
  const withEvidence = { ...analysis("中"), recommendations: {
    ...analysis("中").recommendations,
    market: { recommendation: "中", rationale: "理由", evidence: [], missing_evidence: true },
  } } as ValidatedAnalysis;
  assert.deepEqual(recommendationValues(withEvidence), recommendationValues(analysis("中")));
});

test("buildPriorityRule：规则缺少评分映射、阈值或校准证据时不得用于计算（priority 留空）", () => {
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: { thresholds: { p0: 11, p1: 8, p2: 5 } } }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: { scoring, } }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: { scoring, thresholds: { p0: "high" } } }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: { scoring: { ...scoring, user: {} }, thresholds: { p0: 11, p1: 8, p2: 5 } } }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: { scoring, thresholds: { p0: 3, p1: 8, p2: 5 } } }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, validationEvidence: [] }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: null as never }), null);
});

test("runAnalysis：已发布且校准的规则驱动优先级；无规则或未校准规则时保持 null", async () => {
  const fakeProvider = {
    name: "deepseek", model: "m", promptVersion: "p",
    async analyze() { return analysis("中") as ValidatedAnalysis; },
  };
  const repository = {
    async append(input: unknown) { return { ...(input as object), id: "run-1", status: "running", completedAt: null, result: null, safeErrorCode: null, safeErrorSummary: null }; },
    async complete(_id: string, result: unknown) { return { status: "analyzed", result: (result as { result?: unknown }).result ?? null }; },
    async latest() { return null; },
    async listByRequirement() { return []; },
  };
  const input = { requirementId: "r", sourceVersion: 1, sourcePersisted: true, title: "t", description: "d", context: "", piiMarkers: [], dictionary: { version: 1, modules: ["报表分析"] } };

  // 无规则 → priority 保持 null（规则未发布时优先级为空）
  const noRule = await runAnalysis({ ...input, priorityRule: null }, { repository: repository as never, provider: fakeProvider });
  assert.equal(noRule.result?.priority ?? null, null);

  // 已发布且校准的规则 → 确定性计算覆盖模型自评（四维"中"= 8 分 ≥ p1 → P1）
  const withRule = await runAnalysis({ ...input, priorityRule: buildPriorityRule(ruleRecord)! }, { repository: repository as never, provider: fakeProvider });
  assert.equal(withRule.result?.priority, "P1");

  // 规则存在但未经校准 → 不用于计算（buildPriorityRule 返回 null，priority 留空，不产生伪精确优先级）
  const uncalibrated = await runAnalysis({ ...input, priorityRule: buildPriorityRule({ ...ruleRecord, validationEvidence: [] })! }, { repository: repository as never, provider: fakeProvider });
  assert.equal(uncalibrated.result?.priority ?? null, null);
});
