import { z } from "zod";

// V02-S06：评分 v2 的输入、证据/假设契约和确定性计算。
// AI 只给九项输入与 α；综合分和 P0–P3 永远由服务端用这里的固定公式计算。

export const SCORING_BASIS_KEYS = [
  "user.pain",
  "user.frequency",
  "market.sellingPoint",
  "market.competitor",
  "strategy.roadmap",
  "strategy.dependency",
  "cost.workload",
  "cost.technicalRisk",
  "cost.resource",
] as const;
export type ScoringBasisKey = (typeof SCORING_BASIS_KEYS)[number];

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const ScoringInputsSchema = z.strictObject({
  user: z.strictObject({ pain: int(1, 5), frequency: int(1, 5) }),
  market: z.strictObject({ sellingPoint: int(1, 3), competitor: int(1, 3) }),
  strategy: z.strictObject({ roadmap: int(1, 3), dependency: int(1, 3) }),
  cost: z.strictObject({ workload: int(1, 5), technicalRisk: int(1, 5), resource: int(1, 5) }),
});
export type ScoringInputs = z.infer<typeof ScoringInputsSchema>;

export const BasisSchema = z.strictObject({
  reason: z.string().trim().min(1),
  evidence: z.array(z.string().min(1)).max(20),
  assumption: z.boolean(),
});

const alphaSchema = z.number()
  .finite()
  .min(0.5)
  .max(2)
  .refine((value) => Math.abs(Math.round(value * 10) - value * 10) < 1e-9, "alpha must be a one-decimal value");

export const ScoringSchema = z.strictObject({
  inputs: ScoringInputsSchema,
  alpha: alphaSchema,
  safetyFlag: z.boolean().default(false),
  scoreConfidence: z.enum(["高", "中", "低"]),
  scoreConfidenceReason: z.string().trim().min(1),
  basis: z.record(z.string(), BasisSchema),
  rationale: z.string().trim().min(1),
  // 只用于说明模型自己的试算，不能作为落库/展示依据。显式 null 视为未提供。
  proposedScore: z.preprocess((value) => value === null ? undefined : value, z.number().finite().nonnegative().max(1000).optional()),
}).superRefine((value, context) => {
  for (const key of SCORING_BASIS_KEYS) {
    const basis = value.basis[key];
    if (!basis) {
      context.addIssue({ code: "custom", path: ["basis", key], message: `missing basis for ${key}` });
      continue;
    }
    if (!basis.assumption && basis.evidence.length === 0) {
      context.addIssue({ code: "custom", path: ["basis", key, "evidence"], message: `evidence is required for ${key} unless assumption=true` });
    }
  }
  const unknownKeys = Object.keys(value.basis).filter((key) => !SCORING_BASIS_KEYS.includes(key as ScoringBasisKey));
  if (unknownKeys.length > 0) context.addIssue({ code: "custom", path: ["basis"], message: `unknown basis keys: ${unknownKeys.join(",")}` });
});
export type ScoringPayload = z.infer<typeof ScoringSchema>;

export interface ScoreBreakdown {
  user: number;
  market: number;
  strategy: number;
  cost: number;
  userAdjusted: number;
}

export interface ComputedScore {
  score: number;
  priority: "P0" | "P1" | "P2" | "P3";
  breakdown: ScoreBreakdown;
}

export const SCORING_FORMULA_TEXT = "U=pain×frequency; M=sellingPoint×competitor; S=roadmap×dependency; C=MAX(workload,technicalRisk,resource); score=round2(U×alpha×(1+0.6M+0.4S)/C)";
export const SCORING_THRESHOLDS = { p0: 45, p1: 25, p2: 10 } as const;

export const ManualScoringUpdateSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  inputs: ScoringInputsSchema,
  alpha: alphaSchema,
  safetyFlag: z.boolean().optional().default(false),
  reason: z.string().trim().min(1).max(500),
});
export type ManualScoringUpdate = z.infer<typeof ManualScoringUpdateSchema>;

export const ApplyAiScoringSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  aiVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});
export type ApplyAiScoring = z.infer<typeof ApplyAiScoringSchema>;

export class ScoringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringValidationError";
  }
}

export function scorePriority(score: number): ComputedScore["priority"] {
  if (score >= 45) return "P0";
  if (score >= 25) return "P1";
  if (score >= 10) return "P2";
  return "P3";
}

/** 固定评分 v2 公式；只接受已校验范围的值。 */
export function computeUmcScore(inputs: ScoringInputs, alpha: number): ComputedScore {
  if (!Number.isFinite(alpha) || alpha < 0.5 || alpha > 2) throw new ScoringValidationError("alpha is out of range");
  const user = inputs.user.pain * inputs.user.frequency;
  const market = inputs.market.sellingPoint * inputs.market.competitor;
  const strategy = inputs.strategy.roadmap * inputs.strategy.dependency;
  const cost = Math.max(inputs.cost.workload, inputs.cost.technicalRisk, inputs.cost.resource);
  if (!Number.isFinite(cost) || cost <= 0) throw new ScoringValidationError("cost must be positive");
  const userAdjusted = Math.round(user * alpha * 10) / 10;
  const raw = (userAdjusted * (1 + 0.6 * market + 0.4 * strategy)) / cost;
  if (!Number.isFinite(raw)) throw new ScoringValidationError("score is not finite");
  const score = Math.round(raw * 100) / 100;
  return {
    score,
    priority: scorePriority(score),
    breakdown: { user, market, strategy, cost, userAdjusted },
  };
}

/**
 * 校验评分依据证据是否出现在本次源文里。
 * 允许 assumption=true 的空证据；不允许把不存在的引用/编造依据带入正式评分。
 */
export function validateScoringEvidence(payload: ScoringPayload, sourceText: string): void {
  const compact = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "");
  const source = compact(sourceText);
  for (const key of SCORING_BASIS_KEYS) {
    const basis = payload.basis[key]!;
    for (const evidence of basis.evidence) {
      if (!source.includes(compact(evidence))) {
        throw new ScoringValidationError(`scoring evidence does not occur in source text: ${key}`);
      }
    }
  }
}

export function assertScoringPayload(value: unknown, sourceText: string): ScoringPayload {
  const parsed = ScoringSchema.safeParse(value);
  if (!parsed.success) throw new ScoringValidationError(parsed.error.issues[0]?.message ?? "invalid scoring payload");
  validateScoringEvidence(parsed.data, sourceText);
  return parsed.data;
}
