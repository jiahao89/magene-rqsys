import { z } from "zod";

export interface AnalysisDictionary {
  version: number;
  modules: string[];
}

export interface AnalysisPriorityRule {
  id: string;
  version: number;
  compute: (scores: { user: number; market: number; business: number; technology: number }) => "P0" | "P1" | "P2" | "P3";
}

export interface AnalysisRequestInput {
  title: string;
  description: string;
  context: string;
  piiMarkers: string[];
  dictionary: AnalysisDictionary;
  priorityRule: AnalysisPriorityRule | null;
}

export interface SafeAnalysisRequest extends Omit<AnalysisRequestInput, "piiMarkers" | "priorityRule"> {
  priorityRule: { id: string; version: number } | null;
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d{1,3}[\s-]?)?1[3-9]\d{9}(?!\d)/g;
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|secret)\s*[:=]\s*\S+)/gi;

export function maskPii(text: string, markers: string[]): string {
  let masked = text;
  for (const marker of [...new Set(markers)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    masked = masked.split(marker).join("（已掩码）");
  }
  return masked.replace(EMAIL, "（邮箱已掩码）").replace(PHONE, "（手机号已掩码）").replace(SECRET, "（敏感信息已掩码）");
}

export function buildAnalysisRequest(input: AnalysisRequestInput): SafeAnalysisRequest {
  return {
    title: maskPii(input.title, input.piiMarkers),
    description: maskPii(input.description, input.piiMarkers),
    context: maskPii(input.context, input.piiMarkers),
    dictionary: input.dictionary,
    priorityRule: input.priorityRule ? { id: input.priorityRule.id, version: input.priorityRule.version } : null,
  };
}

const EvidenceList = z.array(z.string().min(1));
const RecommendationSchema = z.object({
  recommendation: z.string().min(1),
  rationale: z.string().min(1),
  evidence: EvidenceList,
  missing_evidence: z.boolean().optional(),
});
const AnalysisSchema = z.object({
  module: z.string().min(1),
  confidence: z.enum(["高", "中", "低"]),
  confidence_reason: z.string().min(1),
  evidence: EvidenceList.min(1),
  recommendations: z.object({ user: RecommendationSchema, market: RecommendationSchema, business: RecommendationSchema, technology: RecommendationSchema }),
  facts: z.array(z.object({ text: z.string().min(1), evidence: z.string().min(1) })),
  inferences: z.array(z.object({ text: z.string().min(1), ai_inference: z.literal(true) })),
  missing_inputs: z.array(z.string()),
  blind_spots: z.array(z.string()),
  priority: z.enum(["P0", "P1", "P2", "P3"]).nullable(),
}).strict();

export type ValidatedAnalysis = z.infer<typeof AnalysisSchema>;

export function validateAnalysisOutput(
  value: unknown,
  options: { dictionary: AnalysisDictionary; priorityRule: AnalysisPriorityRule | null; sourceText: string },
): ValidatedAnalysis {
  const result = AnalysisSchema.parse(value);
  const allowedModules = new Set([...options.dictionary.modules, "其他", "待分类"]);
  if (!allowedModules.has(result.module)) throw new Error("Analysis output uses an uncontrolled module");
  if ((result.priority !== null) !== (options.priorityRule !== null)) throw new Error("Priority must match published rule availability");
  const sourceText = options.sourceText;
  const evidence = [
    ...result.evidence,
    ...Object.values(result.recommendations).flatMap((item) => item.evidence),
    ...result.facts.map((item) => item.evidence),
  ];
  if (evidence.some((quote) => !sourceText.includes(quote))) throw new Error("Analysis evidence does not occur in source text");
  return result;
}
