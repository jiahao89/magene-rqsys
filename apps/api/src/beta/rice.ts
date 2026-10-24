// V02-T12：RICE 量纲配置（rice-v1，2026-10-25 按“简单好用”确认）与确定性计算。
// Reach=人次/月（>0）；Impact 三档（1 轻微/2 明显/3 重大）；Confidence=百分比 0–100（归一化 /100）；
// Effort=人周（>0）。分数 = R × I × (C/100) ÷ E，保留 1 位小数；
// 缺项/非法/非有限值一律返回 null（不输出 NaN/Infinity/0 分兜底），由展示层显示“待补充”。
export const RICE_CONFIG_VERSION = "rice-v1";
export const RICE_REACH_UNIT = "人次/月";
export const RICE_EFFORT_UNIT = "人周";
export const RICE_IMPACT_LEVELS = [
  { value: 1, label: "轻微改善" },
  { value: 2, label: "明显改善" },
  { value: 3, label: "重大改善" },
] as const;

export interface RiceScoreInputs { reach: string | null; impact: string | null; confidence: string | null; effort: string | null }

function finiteNumber(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeRiceScore(inputs: RiceScoreInputs): { score: number | null; status: "computed" | "incomplete" } {
  const reach = finiteNumber(inputs.reach);
  const impact = finiteNumber(inputs.impact);
  const confidence = finiteNumber(inputs.confidence);
  const effort = finiteNumber(inputs.effort);
  if (reach === null || impact === null || confidence === null || effort === null) return { score: null, status: "incomplete" };
  if (reach <= 0 || effort <= 0) return { score: null, status: "incomplete" };
  if (![1, 2, 3].includes(impact)) return { score: null, status: "incomplete" };
  if (confidence < 0 || confidence > 100) return { score: null, status: "incomplete" };
  const raw = (reach * impact * (confidence / 100)) / effort;
  if (!Number.isFinite(raw)) return { score: null, status: "incomplete" };
  return { score: Math.round(raw * 10) / 10, status: "computed" };
}
