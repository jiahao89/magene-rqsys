import { z } from "zod";
import { REQUIREMENT_INTAKE_TYPES } from "../contracts/pipeline.js";

export interface AnalysisDictionary {
  version: number;
  modules: string[];
}

export interface AnalysisPriorityRule {
  id: string;
  version: number;
  // 输入是四维建议取值（规则评分映射的查找键）；取值不在映射中时返回 null（优先级留空，不做默认猜测）。
  compute: (values: { user: string; market: string; business: string; technology: string }) => "P0" | "P1" | "P2" | "P3" | null;
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
// 身份标识补充（工单 13）：中国大陆 18 位身份证号、24 位 hex 平台用户 ID（Teambition 形态）、@提及。
const ID_CARD = /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])\d{3}[\dXx]\b/g;
const PLATFORM_USER_ID = /(?<![\w\d])[0-9a-f]{24}(?![\w\d])/gi;
// 边界不能用 \s：中文正文里「用户@张三反馈…」没有空格，@提及会被漏掩码。
// 排除 \w 前缀以避免误伤邮箱（a@b.c 中 @ 前是字母数字）。
const MENTION = /(^|[^\w@])@[\w\u4e00-\u9fa5-]{2,30}/gu;
const LABELLED_PERSON_NAME = /((?:反馈人|联系人|提出人|申请人|用户姓名|姓名)\s*[-－‐‑‒–—−:：]\s*)[^-－‐‑‒–—−\s【】,:：；;]+/giu;

export function maskPii(text: string, markers: string[]): string {
  let masked = text;
  for (const marker of [...new Set(markers)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    masked = masked.split(marker).join("（已掩码）");
  }
  return masked
    .replace(EMAIL, "（邮箱已掩码）")
    .replace(PHONE, "（手机号已掩码）")
    .replace(ID_CARD, "（证件号已掩码）")
    .replace(PLATFORM_USER_ID, "（用户ID已掩码）")
    .replace(MENTION, "$1（提及已掩码）")
    .replace(LABELLED_PERSON_NAME, "$1（姓名已掩码）")
    .replace(SECRET, "（敏感信息已掩码）");
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

// V02-T08：六层人群固定枚举（PRD 2.2）；不建第七层，地区/产品线是其它上下文。
export const AUDIENCE_LEVELS = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
export type AudienceLevel = (typeof AUDIENCE_LEVELS)[number];
export const AUDIENCE_LEVEL_NAMES: Record<AudienceLevel, string> = {
  L1: "职业级 Pro", L2: "竞技级 Racing", L3: "爱好者/专业入门 Enthusiast",
  L4: "健身锻炼 Fitness", L5: "休闲娱乐 Recreation", L6: "通勤代步 Commuter",
};

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
  // V02-T08：受控需求类型建议（不覆盖人工录入值）与 0..n 条 L1-L6 人群建议。
  // 缺省 null / [] 表示模型未给出——展示层呈现"待判断"，不推断"不适用"。
  typeSuggestion: z.enum(REQUIREMENT_INTAKE_TYPES).nullable().default(null),
  audience: z.array(z.object({ level: z.enum(AUDIENCE_LEVELS), reason: z.string().min(1), evidence: EvidenceList })).default([]),
}).strict();

export type ValidatedAnalysis = z.infer<typeof AnalysisSchema>;

export function validateAnalysisOutput(
  value: unknown,
  options: { dictionary: AnalysisDictionary; priorityRule: AnalysisPriorityRule | null; sourceText: string },
): ValidatedAnalysis {
  // Priority is deterministic workflow output, never a model decision. Ignore any
  // provider-supplied value; runAnalysis computes it from U/M/S/C only when a
  // calibrated rule is published, otherwise it stays null.
  const modelOutput = typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>), priority: null }
    : value;
  const result = AnalysisSchema.parse(modelOutput);
  const allowedModules = new Set([...options.dictionary.modules, "无法识别"]);
  if (!allowedModules.has(result.module)) throw new Error("Analysis output uses an uncontrolled module");
  const sourceText = options.sourceText;
  const evidence = [
    ...result.evidence,
    ...Object.values(result.recommendations).flatMap((item) => item.evidence),
    ...result.facts.map((item) => item.evidence),
    ...result.audience.flatMap((item) => item.evidence),
  ];
  if (evidence.some((quote) => !sourceText.includes(quote))) throw new Error("Analysis evidence does not occur in source text");
  // facts 声称是"源文事实"：同样必须能在源文里找到，防止需求正文里的提示注入
  // 伪造出源文没有的"事实"进入结构化结果与详情页。
  if (result.facts.some((item) => !sourceText.includes(item.text))) throw new Error("Analysis fact does not occur in source text");
  return { ...result, priority: null };
}
