import assert from "node:assert/strict";
import test from "node:test";
import type { PriorityRuleVersionRecord } from "../domain/persistence.js";
import { buildPriorityRule, recommendationScores } from "./priority-rule.js";
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

function analysis(recommendations: Record<string, { missing_evidence?: boolean }>): ValidatedAnalysis {
  const item = (r: { missing_evidence?: boolean }) => ({
    recommendation: "建议", rationale: "理由", evidence: r.missing_evidence === true ? [] : ["原文片段"],
    ...(r.missing_evidence === true ? { missing_evidence: true } : {}),
  });
  return {
    ...base,
    recommendations: {
      user: item(recommendations.user ?? {}),
      market: item(recommendations.market ?? {}),
      business: item(recommendations.business ?? {}),
      technology: item(recommendations.technology ?? {}),
    },
  } as ValidatedAnalysis;
}

const ruleRecord: PriorityRuleVersionRecord = {
  id: "rule-1", version: 1, status: "published",
  rules: { thresholds: { p0: 4, p1: 3, p2: 2 } },
  validationEvidence: [], createdBy: null, createdAt: "2026-01-01T00:00:00.000Z", publishedAt: "2026-01-01T00:00:00.000Z",
};

test("recommendationScores：证据完整维度得 1 分，missing_evidence 得 0 分", () => {
  assert.deepEqual(recommendationScores(analysis({})), { user: 1, market: 1, business: 1, technology: 1 });
  assert.deepEqual(
    recommendationScores(analysis({ market: { missing_evidence: true }, technology: { missing_evidence: true } })),
    { user: 1, market: 0, business: 1, technology: 0 },
  );
});

test("buildPriorityRule：按阈值确定性映射 P0–P3（不变量 4）", () => {
  const rule = buildPriorityRule(ruleRecord);
  assert.ok(rule);
  assert.equal(rule.compute(recommendationScores(analysis({}))), "P0");
  assert.equal(rule.compute(recommendationScores(analysis({ technology: { missing_evidence: true } }))), "P1");
  assert.equal(rule.compute(recommendationScores(analysis({ market: { missing_evidence: true }, technology: { missing_evidence: true } }))), "P2");
  assert.equal(rule.compute(recommendationScores(analysis({ market: { missing_evidence: true }, business: { missing_evidence: true }, technology: { missing_evidence: true } }))), "P3");
});

test("buildPriorityRule：规则 JSON 不符合契约时返回 null（priority 不臆测）", () => {
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: {} }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: { thresholds: { p0: "high" } } }), null);
  assert.equal(buildPriorityRule({ ...ruleRecord, rules: null as never }), null);
});

test("runAnalysis：已发布规则驱动优先级，规则未发布时保持 null", async () => {
  const fakeProvider = {
    name: "deepseek", model: "m", promptVersion: "p",
    async analyze() { return analysis({ technology: { missing_evidence: true } }) as ValidatedAnalysis; },
  };
  const repository = {
    async append(input: unknown) { return { ...(input as object), id: "run-1", status: "running", completedAt: null, result: null, safeErrorCode: null, safeErrorSummary: null }; },
    async complete(_id: string, result: unknown) { return { status: "analyzed", result: (result as { result?: unknown }).result ?? null }; },
    async latest() { return null; },
    async listByRequirement() { return []; },
  };

  // 无规则 → priority 保持 null（规则未发布时优先级为空）
  const noRule = await runAnalysis(
    { requirementId: "r", sourceVersion: 1, sourcePersisted: true, title: "t", description: "d", context: "", piiMarkers: [], dictionary: { version: 1, modules: ["报表分析"] }, priorityRule: null },
    { repository: repository as never, provider: fakeProvider },
  );
  assert.equal(noRule.result?.priority ?? null, null);

  // 有规则 → 确定性计算覆盖模型自评（3 分 ≥ p1 → P1）
  const withRule = await runAnalysis(
    { requirementId: "r", sourceVersion: 1, sourcePersisted: true, title: "t", description: "d", context: "", piiMarkers: [], dictionary: { version: 1, modules: ["报表分析"] }, priorityRule: buildPriorityRule(ruleRecord)! },
    { repository: repository as never, provider: fakeProvider },
  );
  assert.equal(withRule.result?.priority, "P1");
});
