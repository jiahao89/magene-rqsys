import test from "node:test";
import assert from "node:assert/strict";
import { computeTriageScore, TRIAGE_V4_DEFAULT_THRESHOLDS, TRIAGE_V4_FORMULA_TYPE, validateTriageScoringEvidence } from "./scoring-v4.js";
import { buildPriorityRule } from "./priority-rule.js";
import { validateAnalysisOutput } from "./contract.js";
import { runAnalysis } from "./service.js";
import type { PriorityRuleVersionRecord } from "../domain/persistence.js";

test("computeTriageScore applies linear formula, cost tiers, strategic bonus, and clamp", () => {
  // neutral 3/3 -> 3*12 + 3*8 = 60 -> P1
  const neutral = computeTriageScore({ impact: 3, urgency: 3 });
  assert.equal(neutral.score, 60);
  assert.equal(neutral.priority, "P1");
  assert.equal(neutral.guardrail, null);

  // small cost (+5) + strategic (+10) -> 75 -> P1
  const boosted = computeTriageScore({ impact: 3, urgency: 3, costTier: "S", strategicMatch: true });
  assert.equal(boosted.score, 75);
  assert.equal(boosted.priority, "P1");

  // large cost (-10) -> 50 -> P2
  const heavy = computeTriageScore({ impact: 3, urgency: 3, costTier: "L" });
  assert.equal(heavy.score, 50);
  assert.equal(heavy.priority, "P2");

  // clamp to 100
  const max = computeTriageScore({ impact: 5, urgency: 5, costTier: "S", strategicMatch: true });
  assert.equal(max.score, 100);
  assert.equal(max.priority, "P0");
});

test("computeTriageScore enforces safety_p0 and severe_bug_p1 guardrails", () => {
  const safety = computeTriageScore({ impact: 1, urgency: 1, safetyFlag: true });
  assert.equal(safety.score, 20);
  assert.equal(safety.priority, "P0");
  assert.equal(safety.guardrail, "safety_p0");

  const severeBug = computeTriageScore({ impact: 4, urgency: 1, typeSuggestion: "质量修复" });
  assert.equal(severeBug.score, 56);
  assert.equal(severeBug.priority, "P1");
  assert.equal(severeBug.guardrail, "severe_bug_p1");

  const nonBug = computeTriageScore({ impact: 4, urgency: 1, typeSuggestion: "新增功能" });
  assert.equal(nonBug.priority, "P2");
  assert.equal(nonBug.guardrail, null);
});

test("buildPriorityRule compiles pragmatic_triage_v4 with quarterlyFocus and thresholds", () => {
  const record: PriorityRuleVersionRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    version: 4,
    status: "published",
    rules: {
      formulaType: TRIAGE_V4_FORMULA_TYPE,
      thresholds: TRIAGE_V4_DEFAULT_THRESHOLDS,
      quarterlyFocus: ["  导航稳定性 ", "功率计生态", ""],
    },
    validationEvidence: [],
    createdBy: "pm-1",
    createdAt: "2026-11-28T00:00:00.000Z",
    publishedAt: "2026-11-28T00:00:00.000Z",
  };
  const rule = buildPriorityRule(record);
  assert.ok(rule);
  assert.equal(rule.formulaType, TRIAGE_V4_FORMULA_TYPE);
  assert.deepEqual(rule.quarterlyFocus, ["导航稳定性", "功率计生态"]);
  assert.equal(rule.computeTriageScore?.({ impact: 4, urgency: 4 }).priority, "P0");
});

test("validateAnalysisOutput and runAnalysis support triageScoring without legacy recommendations", async () => {
  const sourceText = "骑行中导航频繁闪退\n用户在长途骑行时导航崩溃";
  const output = validateAnalysisOutput({
    module: "导航",
    confidence: "高",
    confidence_reason: "描述明确",
    evidence: ["骑行中导航频繁闪退"],
    facts: [{ text: "用户在长途骑行时导航崩溃", evidence: "用户在长途骑行时导航崩溃" }],
    inferences: [{ text: "核心骑行流程受阻", ai_inference: true }],
    missing_inputs: ["复现固件版本"],
    blind_spots: [],
    priority: null,
    typeSuggestion: "质量修复",
    audience: [],
    triageScoring: {
      impact: 4,
      urgency: 3,
      safetyFlag: false,
      strategicMatch: true,
      scoreConfidence: "中",
      scoreConfidenceReason: "缺少崩溃率数据",
      basis: {
        impact: { reason: "核心导航崩溃", evidence: ["骑行中导航频繁闪退"], assumption: false },
        urgency: { reason: "缺少频次，按中性3分估算", evidence: [], assumption: true },
      },
      rationale: "核心导航崩溃且命中本季导航稳定性重点",
    },
  }, {
    dictionary: { version: 1, modules: ["导航"] },
    priorityRule: null,
    sourceText,
  });
  assert.equal(output.triageScoring?.impact, 4);
  assert.throws(() => validateTriageScoringEvidence({
    ...output.triageScoring!,
    basis: {
      ...output.triageScoring!.basis,
      impact: { reason: "伪造", evidence: ["不存在的原文"], assumption: false },
    },
  }, sourceText));

  const rule = buildPriorityRule({
    id: "11111111-1111-4111-8111-111111111111",
    version: 4,
    status: "published",
    rules: { formulaType: TRIAGE_V4_FORMULA_TYPE, thresholds: { p0: 80, p1: 60, p2: 40 }, quarterlyFocus: ["导航稳定性"] },
    validationEvidence: [],
    createdBy: "pm",
    createdAt: "2026-11-28T00:00:00.000Z",
    publishedAt: "2026-11-28T00:00:00.000Z",
  })!;

  let savedRun: Record<string, unknown> | null = null;
  const completed = await runAnalysis({
    requirementId: "req-1",
    sourceVersion: 1,
    sourcePersisted: true,
    title: "骑行中导航频繁闪退",
    description: "用户在长途骑行时导航崩溃",
    context: "",
    piiMarkers: [],
    dictionary: { version: 1, modules: ["导航"] },
    priorityRule: rule,
  }, {
    repository: {
      async append(input) { return { ...input, id: "run-1", status: "running", completedAt: null, result: null, safeErrorCode: null, safeErrorSummary: null }; },
      async complete(_id, patch) { savedRun = patch as Record<string, unknown>; return { id: "run-1", requirementId: "req-1", sourceVersion: 1, analysisVersion: 1, status: "analyzed", provider: "deepseek", model: "deepseek-flash", promptVersion: "rq-analysis-v5", moduleDictionaryVersion: 1, priorityRuleVersionId: rule.id, startedAt: "2026-11-28T00:00:00.000Z", completedAt: "2026-11-28T00:00:01.000Z", result: patch.result ?? null, safeErrorCode: null, safeErrorSummary: null }; },
      async latest() { return null; },
      async listByRequirement() { return []; },
    },
    provider: {
      name: "deepseek",
      model: "deepseek-flash",
      promptVersion: "rq-analysis-v4",
      async analyze() { return output; },
    },
  });
  // impact=4*12 + urgency=3*8 + strategic(+10) = 82 >= 80 => P0
  assert.equal(completed.result?.priority, "P0");
  assert.ok(savedRun);
});
