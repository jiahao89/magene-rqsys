import assert from "node:assert/strict";
import test from "node:test";
import {
  SCORING_BASIS_KEYS,
  ScoringSchema,
  computeUmcScore,
  scorePriority,
  validateScoringEvidence,
  type ScoringInputs,
} from "./scoring.js";

const carLightInputs: ScoringInputs = {
  user: { pain: 3, frequency: 4 },
  market: { sellingPoint: 1, competitor: 1 },
  strategy: { roadmap: 1, dependency: 1 },
  cost: { workload: 3, technicalRisk: 2, resource: 2 },
};

const basis = Object.fromEntries(SCORING_BASIS_KEYS.map((key) => [key, {
  reason: `${key} 的依据`,
  evidence: key === "user.pain" ? ["用户描述循环选择太难受"] : [],
  assumption: key !== "user.pain",
}]));

const validScoring = {
  inputs: carLightInputs,
  alpha: 0.8,
  safetyFlag: false,
  scoreConfidence: "中" as const,
  scoreConfidenceReason: "频次与竞品依据不足",
  basis,
  rationale: "交互价值明确，但证据有限",
  proposedScore: 6.40,
};

test("V02-S06 scoring: fixed formula reproduces calibration examples", () => {
  assert.deepEqual(computeUmcScore(carLightInputs, 0.8), {
    score: 6.4,
    priority: "P3",
    breakdown: { user: 12, market: 1, strategy: 1, cost: 3, userAdjusted: 9.6 },
  });
  assert.equal(computeUmcScore({
    user: { pain: 4, frequency: 4 },
    market: { sellingPoint: 1, competitor: 1 },
    strategy: { roadmap: 1, dependency: 1 },
    cost: { workload: 3, technicalRisk: 3, resource: 2 },
  }, 0.8).score, 8.53);
  assert.deepEqual(computeUmcScore({
    user: { pain: 4, frequency: 4 },
    market: { sellingPoint: 1, competitor: 1 },
    strategy: { roadmap: 1, dependency: 1 },
    cost: { workload: 3, technicalRisk: 3, resource: 2 },
  }, 1.5), { score: 16, priority: "P2", breakdown: { user: 16, market: 1, strategy: 1, cost: 3, userAdjusted: 24 } });
  assert.equal(computeUmcScore({
    user: { pain: 4, frequency: 5 },
    market: { sellingPoint: 2, competitor: 2 },
    strategy: { roadmap: 1, dependency: 1 },
    cost: { workload: 4, technicalRisk: 4, resource: 4 },
  }, 0.8).score, 15.2);
  assert.equal(computeUmcScore({
    user: { pain: 4, frequency: 4 },
    market: { sellingPoint: 2, competitor: 2 },
    strategy: { roadmap: 1, dependency: 1 },
    cost: { workload: 3, technicalRisk: 4, resource: 3 },
  }, 0.8).score, 12.16);
  assert.equal(computeUmcScore({
    user: { pain: 3, frequency: 2 },
    market: { sellingPoint: 1, competitor: 1 },
    strategy: { roadmap: 1, dependency: 1 },
    cost: { workload: 3, technicalRisk: 2, resource: 3 },
  }, 0.8).score, 3.2);
});

test("V02-S06 scoring: P0-P3 boundaries are inclusive at 45/25/10", () => {
  assert.equal(scorePriority(45), "P0");
  assert.equal(scorePriority(44.99), "P1");
  assert.equal(scorePriority(25), "P1");
  assert.equal(scorePriority(24.99), "P2");
  assert.equal(scorePriority(10), "P2");
  assert.equal(scorePriority(9.99), "P3");
});

test("V02-S06 scoring: schema requires nine inputs, valid alpha and all basis keys", () => {
  assert.equal(ScoringSchema.safeParse(validScoring).success, true);
  assert.equal(ScoringSchema.safeParse({ ...validScoring, alpha: 0.85 }).success, false);
  assert.equal(ScoringSchema.safeParse({ ...validScoring, alpha: 2.1 }).success, false);
  assert.equal(ScoringSchema.safeParse({ ...validScoring, basis: {} }).success, false);
  assert.equal(ScoringSchema.safeParse({ ...validScoring, inputs: { ...carLightInputs, user: { pain: 6, frequency: 4 } } }).success, false);
});

test("V02-S06 scoring: evidence must occur in source unless assumption is explicit", () => {
  const source = "用户描述循环选择太难受；夜间骑行每周 1–2 次。";
  assert.doesNotThrow(() => validateScoringEvidence(validScoring, source));
  assert.throws(() => validateScoringEvidence({ ...validScoring, basis: { ...basis, "user.pain": { reason: "x", evidence: ["不存在的证据"], assumption: false } } }, source), /evidence does not occur/);
  assert.doesNotThrow(() => validateScoringEvidence({ ...validScoring, basis: { ...basis, "user.pain": { reason: "假设", evidence: [], assumption: true } } }, source));
});
