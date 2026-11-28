import { z } from "zod";
import { BasisSchema, ScoringValidationError, scorePriorityWithThresholds, type PriorityThresholds } from "./scoring.js";

export const TRIAGE_V4_FORMULA_TYPE = "pragmatic_triage_v4" as const;
export const TRIAGE_V4_FORMULA_TEXT = "score = clamp(0, 100, impact×12 + urgency×8 + costAdj + strategicAdj); 安全红警→P0, 严重缺陷(影响≥4)→不低于P1";
export const TRIAGE_V4_DEFAULT_THRESHOLDS: PriorityThresholds = { p0: 80, p1: 60, p2: 40 };
export const TRIAGE_BASIS_KEYS = ["impact", "urgency"] as const;
export type TriageBasisKey = (typeof TRIAGE_BASIS_KEYS)[number];

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const TriageCostTierSchema = z.enum(["S", "M", "L"]);
export type TriageCostTier = z.infer<typeof TriageCostTierSchema>;

export const TriageGuardrailSchema = z.enum(["safety_p0", "severe_bug_p1"]);
export type TriageGuardrail = z.infer<typeof TriageGuardrailSchema>;

export const TriageScoringSchema = z.strictObject({
  impact: int(1, 5),
  urgency: int(1, 5),
  safetyFlag: z.boolean().default(false),
  strategicMatch: z.boolean().default(false),
  scoreConfidence: z.enum(["高", "中", "低"]),
  scoreConfidenceReason: z.string().trim().min(1),
  basis: z.strictObject({
    impact: BasisSchema,
    urgency: BasisSchema,
  }),
  rationale: z.string().trim().min(1),
}).superRefine((value, context) => {
  for (const key of TRIAGE_BASIS_KEYS) {
    const basis = value.basis[key];
    if (!basis.assumption && basis.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["basis", key, "evidence"],
        message: `evidence is required for ${key} unless assumption=true`,
      });
    }
  }
});
export type TriageScoringPayload = z.infer<typeof TriageScoringSchema>;

export const TriageStoredInputsSchema = z.strictObject({
  version: z.literal("v4"),
  impact: int(1, 5),
  urgency: int(1, 5),
  costTier: TriageCostTierSchema.nullable().default(null),
  strategicMatch: z.boolean().default(false),
  guardrail: TriageGuardrailSchema.nullable().default(null),
});
export type TriageStoredInputs = z.infer<typeof TriageStoredInputsSchema>;

export const ManualTriageUpdateSchema = z.strictObject({
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  costTier: TriageCostTierSchema.nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});
export type ManualTriageUpdate = z.infer<typeof ManualTriageUpdateSchema>;

export const ManualV4ScoringUpdateSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  version: z.literal("v4"),
  impact: int(1, 5),
  urgency: int(1, 5),
  costTier: TriageCostTierSchema.nullable().optional(),
  strategicMatch: z.boolean().optional(),
  safetyFlag: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500),
});
export type ManualV4ScoringUpdate = z.infer<typeof ManualV4ScoringUpdateSchema>;

export interface ComputedTriageScore {
  score: number;
  priority: "P0" | "P1" | "P2" | "P3";
  guardrail: TriageGuardrail | null;
  costAdjustment: number;
  strategicAdjustment: number;
}

export function isV4ScoringInputs(value: unknown): value is TriageStoredInputs {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { version?: unknown }).version === "v4";
}

export function computeTriageScore(
  input: {
    impact: number;
    urgency: number;
    costTier?: TriageCostTier | null;
    strategicMatch?: boolean;
    safetyFlag?: boolean;
    typeSuggestion?: string | null;
  },
  thresholds: PriorityThresholds = TRIAGE_V4_DEFAULT_THRESHOLDS,
): ComputedTriageScore {
  if (!Number.isInteger(input.impact) || input.impact < 1 || input.impact > 5) {
    throw new ScoringValidationError("impact must be an integer between 1 and 5");
  }
  if (!Number.isInteger(input.urgency) || input.urgency < 1 || input.urgency > 5) {
    throw new ScoringValidationError("urgency must be an integer between 1 and 5");
  }
  const base = input.impact * 12 + input.urgency * 8;
  const costAdjustment = input.costTier === "S" ? 5 : input.costTier === "L" ? -10 : 0;
  const strategicAdjustment = input.strategicMatch ? 10 : 0;
  const score = Math.max(0, Math.min(100, base + costAdjustment + strategicAdjustment));
  const rawPriority = scorePriorityWithThresholds(score, thresholds);

  if (input.safetyFlag === true) {
    return { score, priority: "P0", guardrail: "safety_p0", costAdjustment, strategicAdjustment };
  }
  if (input.typeSuggestion === "质量修复" && input.impact >= 4 && (rawPriority === "P2" || rawPriority === "P3")) {
    return { score, priority: "P1", guardrail: "severe_bug_p1", costAdjustment, strategicAdjustment };
  }
  return { score, priority: rawPriority, guardrail: null, costAdjustment, strategicAdjustment };
}

export function validateTriageScoringEvidence(payload: TriageScoringPayload, sourceText: string): void {
  const compact = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "");
  const source = compact(sourceText);
  for (const key of TRIAGE_BASIS_KEYS) {
    const basis = payload.basis[key];
    for (const evidence of basis.evidence) {
      const quote = compact(evidence);
      if (quote.length === 0 || !source.includes(quote)) {
        throw new ScoringValidationError(`triage scoring evidence does not occur in source text: ${key}`);
      }
    }
  }
}
