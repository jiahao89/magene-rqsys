// 优先级规则：确定性解释已发布的规则 JSON，从 U/M/S/C 建议计算优先级。
// 规则 JSON 契约（priority_rule_versions.rules）：{ thresholds: { p0: number; p1: number; p2: number } }
// 得分 = 四维建议中证据完整（missing_evidence !== true）的维度数（0-4）；
// score >= p0 → P0；>= p1 → P1；>= p2 → P2；否则 P3。
// 规则 JSON 不符合契约时返回 null（priority 保持为空，不臆测语义）。

import type { AnalysisPriorityRule, ValidatedAnalysis } from "./contract.js";
import type { PriorityLevel, PriorityRuleVersionRecord } from "../domain/persistence.js";

type RecommendationShape = { missing_evidence?: unknown };

// 从校验后的 U/M/S/C 建议推导维度得分：证据完整 1 分，missing_evidence 0 分。
export function recommendationScores(result: ValidatedAnalysis): { user: number; market: number; business: number; technology: number } {
  const score = (item: RecommendationShape): number => (item.missing_evidence === true ? 0 : 1);
  return {
    user: score(result.recommendations.user),
    market: score(result.recommendations.market),
    business: score(result.recommendations.business),
    technology: score(result.recommendations.technology),
  };
}

// 已发布规则版本 → AnalysisPriorityRule；规则 JSON 不符合契约时返回 null。
export function buildPriorityRule(record: PriorityRuleVersionRecord): AnalysisPriorityRule | null {
  const rules = record.rules as { thresholds?: { p0?: unknown; p1?: unknown; p2?: unknown } } | null;
  const thresholds = rules?.thresholds;
  const p0 = typeof thresholds?.p0 === "number" ? thresholds.p0 : undefined;
  const p1 = typeof thresholds?.p1 === "number" ? thresholds.p1 : undefined;
  const p2 = typeof thresholds?.p2 === "number" ? thresholds.p2 : undefined;
  if (p0 === undefined || p1 === undefined || p2 === undefined) return null;
  return {
    id: record.id,
    version: record.version,
    compute: (scores): PriorityLevel => {
      const total = scores.user + scores.market + scores.business + scores.technology;
      return total >= p0 ? "P0" : total >= p1 ? "P1" : total >= p2 ? "P2" : "P3";
    },
  };
}
