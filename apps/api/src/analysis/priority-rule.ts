// 优先级规则：确定性解释已发布的规则 JSON，从 U/M/S/C 建议计算优先级。
// 规则 JSON 契约（priority_rule_versions.rules）：
// {
//   scoring: { user: { <建议取值>: number }, market: {...}, business: {...}, technology: {...} },
//   thresholds: { p0: number; p1: number; p2: number }
// }
// 评分映射必须表达"已批准的 U/M/S/C 评分"——分数来自规则数据本身，代码不发明公式；
// 禁止把证据是否缺失（missing_evidence）计数为业务优先级分数（工单 13）。
// thresholds 把四维分数总和映射到 P0–P3（score >= p0 → P0；>= p1 → P1；>= p2 → P2；否则 P3）。
// 以下任一情况规则不得用于计算（buildPriorityRule 返回 null，优先级保持为空）：
//   1. 缺少 scoring 表或 thresholds；
//   2. 校准证据（validationEvidence）为空——未校准的规则不产生伪精确优先级；
//   3. 建议取值不在评分映射中（宁缺毋滥，不做默认值）。

import type { AnalysisPriorityRule, ValidatedAnalysis } from "./contract.js";
import type { PriorityLevel, PriorityRuleVersionRecord } from "../domain/persistence.js";

type ScoringMap = Record<string, number>;
type RulePayload = {
  scoring?: Partial<Record<"user" | "market" | "business" | "technology", ScoringMap>>;
  thresholds?: { p0?: unknown; p1?: unknown; p2?: unknown };
};

// 从校验后的 U/M/S/C 建议提取各维建议取值（评分映射的查找键）。
export function recommendationValues(result: ValidatedAnalysis): { user: string; market: string; business: string; technology: string } {
  return {
    user: result.recommendations.user.recommendation,
    market: result.recommendations.market.recommendation,
    business: result.recommendations.business.recommendation,
    technology: result.recommendations.technology.recommendation,
  };
}

// 已发布规则版本 → AnalysisPriorityRule；规则契约不完整或未经校准时返回 null（优先级留空）。
export function buildPriorityRule(record: PriorityRuleVersionRecord): AnalysisPriorityRule | null {
  const rules = record.rules as RulePayload | null;
  const scoring = rules?.scoring;
  const thresholds = rules?.thresholds;
  if (!scoring || !thresholds) return null;
  // 校准证据：规则必须携带非空的校准证据才可用于计算。
  if (!Array.isArray(record.validationEvidence) || record.validationEvidence.length === 0) return null;
  const dimensions = ["user", "market", "business", "technology"] as const;
  const maps: Partial<Record<(typeof dimensions)[number], ScoringMap>> = {};
  for (const dimension of dimensions) {
    const map = scoring[dimension];
    if (!map || typeof map !== "object") return null;
    const entries = Object.entries(map);
    if (entries.length === 0) return null;
    const validated: ScoringMap = {};
    for (const [value, score] of entries) {
      if (typeof value !== "string" || value.length === 0) return null;
      if (typeof score !== "number" || !Number.isFinite(score)) return null;
      validated[value] = score;
    }
    maps[dimension] = validated;
  }
  const p0 = typeof thresholds.p0 === "number" ? thresholds.p0 : undefined;
  const p1 = typeof thresholds.p1 === "number" ? thresholds.p1 : undefined;
  const p2 = typeof thresholds.p2 === "number" ? thresholds.p2 : undefined;
  if (p0 === undefined || p1 === undefined || p2 === undefined) return null;
  if (!(p0 >= p1 && p1 >= p2)) return null;
  const userMap = maps.user!, marketMap = maps.market!, businessMap = maps.business!, technologyMap = maps.technology!;
  const dimensionScore = (map: ScoringMap, value: string): number | null => {
    const score = map[value];
    return score === undefined ? null : score;
  };
  return {
    id: record.id,
    version: record.version,
    compute: (values): PriorityLevel | null => {
      const user = dimensionScore(userMap, values.user);
      const market = dimensionScore(marketMap, values.market);
      const business = dimensionScore(businessMap, values.business);
      const technology = dimensionScore(technologyMap, values.technology);
      if (user === null || market === null || business === null || technology === null) return null;
      const total = user + market + business + technology;
      return total >= p0 ? "P0" : total >= p1 ? "P1" : total >= p2 ? "P2" : "P3";
    },
  };
}
