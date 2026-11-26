// 2026-11-21：PRD 提示词生成服务。按需生成一条新版本：先落 running 行，再调用模型，成功 complete / 失败 fail。
// 口径（规格 §4/§6）：一次模型调用；单飞（同需求 running → 409）；running 超 2 分钟转 failed/timeout；
// 不做模板降级——失败落 failed 版本、保留 PM 输入、返回稳定错误码，供下次重试生成新版本。
import { z } from "zod";
import { maskPii } from "../analysis/contract.js";
import { AI_BASE_URL_MISSING_MESSAGE, getAiProviderConfig, parseModelJson, type AiProviderConfig, type FetchLike } from "../analysis/provider.js";
import { OpenAiHttpError, requestOpenAiChatContent } from "../analysis/openai-http.js";
import type { RequirementPrdPromptRepository } from "../application/repositories.js";
import type { AnalysisRunRecord, RequirementAssessmentRecord, RequirementPrdPromptRecord, RequirementRecord } from "../domain/persistence.js";
import { PRD_PROMPT_SECTIONS, PRD_PROMPT_VERSION, buildPrdPromptMessages } from "./prompt.js";

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_INVESTIGATION_NOTES = 8_000;

/** 规格 §4：running 超过 2 分钟转 failed/timeout；GET/POST 都在 claim 时先做过期。 */
export const PRD_PROMPT_RUNNING_STALE_MS = 120_000;

/** 同一需求已有未超时的 running 版本：路由映射 409 PRD_PROMPT_IN_PROGRESS。 */
export class PrdPromptInProgressError extends Error {
  readonly code = "prd_prompt_in_progress";
  constructor() {
    super("prd_prompt_in_progress");
    this.name = "PrdPromptInProgressError";
  }
}

export type PrdPromptFailureCode =
  | "timeout"
  | "rate_limited"
  | "auth_error"
  | "request_error"
  | "provider_error"
  | "invalid_output";

/** 生成失败：只带稳定错误码、状态码与字段路径，不含模型正文。 */
export class PrdPromptFailure extends Error {
  constructor(
    public readonly code: PrdPromptFailureCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PrdPromptFailure";
  }
}

const OutputSchema = z.object({
  prompt: z.string().min(1).max(MAX_INVESTIGATION_NOTES * 2),
  assumptions: z.array(z.string().min(1).max(300)).max(8),
  openQuestions: z.array(z.string().min(1).max(300)).max(8),
}).strict();

function mapOpenAiError(error: OpenAiHttpError): PrdPromptFailure {
  if (error.kind === "timeout") return new PrdPromptFailure("timeout", error.message);
  if (error.kind === "rate_limited") return new PrdPromptFailure("rate_limited", error.message, error.httpStatus);
  if (error.kind === "auth_error") return new PrdPromptFailure("auth_error", error.message, error.httpStatus);
  if (error.kind === "request_error") return new PrdPromptFailure("request_error", error.message, error.httpStatus);
  if (error.kind === "envelope" || error.kind === "empty_content") return new PrdPromptFailure("invalid_output", error.message);
  return new PrdPromptFailure("provider_error", error.message, error.httpStatus);
}

/** 输出禁止项（规格 §3/§7 PP7）：只用于判定，不把命中内容写日志。 */
const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: "phone", pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { name: "url", pattern: /https?:\/\//i },
  { name: "feishu_id", pattern: /\b(?:bascn|cli_|tbl|fld|rec)[A-Za-z0-9_]{8,}\b/ },
  { name: "secret", pattern: /\b(?:sk|lark)-[A-Za-z0-9_-]{8,}\b/ },
];

/** PRD 提示词必须是 1,500–8,000 字、10 个固定章节按序、无 PII/密钥/内部 ID/裸 URL。 */
export interface PrdPromptValidation { ok: boolean; output?: { prompt: string; assumptions: string[]; openQuestions: string[] }; fields?: string[] }
export function validatePrdPromptOutput(raw: unknown): PrdPromptValidation {
  const parsed = OutputSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join(".")).filter(Boolean))].sort();
    return { ok: false, fields: fields.length ? fields : ["root"] };
  }
  const { prompt } = parsed.data;
  const fields: string[] = [];
  if (prompt.length < 1_500) fields.push("prompt.length");
  if (prompt.length > 8_000) fields.push("prompt.length");
  const headings = prompt.match(/^## .+$/gm) ?? [];
  const expected = [...PRD_PROMPT_SECTIONS];
  if (headings.length !== expected.length || headings.some((heading, index) => heading.trim() !== expected[index])) fields.push("prompt.sections");
  // 假设统一全角「假设：」前缀（与评估同口径），保证历史版本都满足契约。
  const assumptions = parsed.data.assumptions.map((value) => `假设：${value.trim().replace(/^假设\s*[:：]?\s*/, "").trim()}`);
  const text = [prompt, ...assumptions, ...parsed.data.openQuestions].join("\n");
  if (FORBIDDEN.some((item) => item.pattern.test(text))) fields.push("forbidden_content");
  if (fields.length) return { ok: false, fields };
  return { ok: true, output: { prompt, assumptions, openQuestions: parsed.data.openQuestions.map((value) => value.trim()) } };
}

/** 分析摘要：只取事实/推断/缺失/盲点与建议，不传完整 analysis JSON。 */
function analysisSummary(record: AnalysisRunRecord | null | undefined): Record<string, unknown> | null {
  if (!record || record.status !== "analyzed" || !record.structuredResult) return null;
  const result = record.structuredResult as Record<string, unknown>;
  const texts = (value: unknown) => Array.isArray(value)
    ? value.map((item) => (typeof (item as { text?: unknown } | null)?.text === "string" ? ((item as { text: string }).text) : (typeof item === "string" ? item : null))).filter((item): item is string => Boolean(item))
    : [];
  return {
    analysisVersion: record.analysisVersion,
    sourceVersion: record.sourceVersion,
    facts: texts(result.facts),
    inferences: texts(result.inferences),
    missingInputs: texts(result.missing_inputs),
    blindSpots: texts(result.blind_spots),
    moduleSuggestion: record.moduleSuggestion,
    typeSuggestion: result.typeSuggestion ?? null,
    confidence: record.confidence,
    confidenceReason: record.confidenceReason,
  };
}

export interface PrdPromptRunner {
  run(input: {
    requirement: RequirementRecord;
    assessment: RequirementAssessmentRecord;
    investigationNotes: string;
    actorId: string;
    analysis?: AnalysisRunRecord | null;
    /** PII 掩码名单（来源花名册 + 目录花名册 + 提出人/执行人）。 */
    piiMarkers?: string[];
  }): Promise<RequirementPrdPromptRecord>;
}

export function createPrdPromptRunner(options: {
  prdPrompts: RequirementPrdPromptRepository;
  config?: Partial<AiProviderConfig>;
  fetch?: FetchLike;
  now?: () => Date;
}): PrdPromptRunner {
  const config = { ...getAiProviderConfig(), ...options.config };
  const configuredTimeout = options.config?.timeoutMs ?? Number(process.env.PRD_PROMPT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_TIMEOUT_MS;
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  return {
    async run({ requirement, assessment, investigationNotes, actorId, analysis, piiMarkers }) {
      if (!config.apiKey) throw new PrdPromptFailure("auth_error", "AI provider credential is not configured.");
      if (!config.baseUrl) throw new PrdPromptFailure("request_error", AI_BASE_URL_MISSING_MESSAGE);
      const notes = investigationNotes.trim();
      if (notes.length > MAX_INVESTIGATION_NOTES) throw new PrdPromptFailure("invalid_output", "investigation_notes_too_long");
      const startedAt = now().toISOString();
      // 版本回填要还原 PM 原文，因此原样落库；送模型的是脱敏后的文本（见下方 maskPii）。
      const storedInputs = {
        requirementSnapshot: {
          title: requirement.title,
          description: requirement.description,
          scope: requirement.scope,
          acceptanceCriteria: requirement.acceptanceCriteria,
          sourceChannel: requirement.sourceChannel,
          requirementType: requirement.requirementType,
          productModel: requirement.productModel,
          constraintNotes: requirement.constraintNotes,
          intakeModule: requirement.intakeModule,
          sourceVersion: requirement.sourceVersion,
        },
        analysis: analysisSummary(analysis),
        assessmentId: assessment.id,
        assessmentVersion: assessment.version,
        investigationNotes: notes,
      };
      const claim = await options.prdPrompts.create({
        requirementId: requirement.id,
        promptVersion: PRD_PROMPT_VERSION,
        model: config.model,
        inputs: storedInputs,
        createdBy: actorId,
        at: startedAt,
        staleAfterMs: PRD_PROMPT_RUNNING_STALE_MS,
      });
      if (claim.outcome === "in_progress") throw new PrdPromptInProgressError();
      const record = claim.record;

      try {
        const messages = buildPrdPromptMessages({ requirement, assessment, investigationNotes: notes, analysis });
        // 与评估/主分析同口径：需求事实与调研结论都过 PII 掩码，名单来自来源与团队目录。
        const maskedUser = maskPii(messages.user, piiMarkers ?? []);
        let content: string;
        try {
          content = await requestOpenAiChatContent({
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            temperature: config.temperature,
            timeoutMs,
            messages: [
              { role: "system", content: messages.system },
              { role: "user", content: maskedUser },
            ],
            fetch: fetcher,
          });
        } catch (error) {
          if (error instanceof OpenAiHttpError) throw mapOpenAiError(error);
          throw error;
        }
        let raw: unknown;
        try {
          raw = parseModelJson(content);
        } catch {
          throw new PrdPromptFailure("invalid_output", "AI provider returned non-JSON content.");
        }
        const validated = validatePrdPromptOutput(raw);
        if (!validated.ok || !validated.output) throw new PrdPromptFailure("invalid_output", `AI provider returned an invalid PRD prompt (${(validated.fields ?? []).join(", ")}).`);
        const completed = await options.prdPrompts.complete(record.id, validated.output as unknown as Record<string, unknown>, now().toISOString());
        // 版本在本次调用期间被判超时（已被标 failed）：不把迟到结果写回成功。
        if (!completed) throw new PrdPromptFailure("timeout", "PRD prompt version is no longer running.");
        return completed;
      } catch (error) {
        const failure = error instanceof PrdPromptFailure ? error : new PrdPromptFailure("provider_error", "PRD prompt generation failed.");
        await options.prdPrompts.fail(record.id, failure.code, now().toISOString()).catch(() => null);
        throw failure;
      }
    },
  };
}

export { MAX_INVESTIGATION_NOTES };
