// 0030：需求评估服务。按需生成一条新版本：先落 running 行，再调用模型，成功 complete / 失败 fail。
// 单飞：同一需求存在未超时的 running 版本时直接 409，不调模型、不新建版本；超过 2 分钟的 running
// 在 claim 时先转 failed/timeout 再放行（GET 侧由路由的 expireStaleRunning 兜底）。
// 失败版本保留 error_code 供追溯；模型调用只带脱敏后的需求与补充内容，不写 Base、不改需求本体。
import { z } from "zod";
import { maskPii } from "../analysis/contract.js";
import { AiProviderError, getAiProviderConfig, parseModelJson, type AiProviderConfig, type FetchLike } from "../analysis/provider.js";
import type { RequirementAssessmentRepository } from "../application/repositories.js";
import type { AnalysisRunRecord, RequirementAssessmentRecord, RequirementRecord } from "../domain/persistence.js";
import type { RequirementAssessmentInput } from "../contracts/pipeline.js";
import { ASSESSMENT_PROMPT_VERSION, buildAssessmentMessages } from "./prompt.js";

const ENDPOINT = "/chat/completions";

/** PRD §4.10.5：2×默认 60s 模型超时；超过它的 running 视为卡死。 */
export const ASSESSMENT_RUNNING_STALE_MS = 120_000;

/** 同一需求已有未超时的 running 版本：路由映射 409 ASSESSMENT_IN_PROGRESS。 */
export class AssessmentInProgressError extends Error {
  readonly code = "assessment_in_progress";
  constructor() {
    super("assessment_in_progress");
    this.name = "AssessmentInProgressError";
  }
}

/** 输出契约不匹配：只携带字段路径（字段名，不含模型内容），路由据此落脱敏日志。 */
export class AssessmentContractError extends AiProviderError {
  constructor(public readonly fields: string[]) {
    super("analysis_failure", `AI provider returned an invalid assessment contract (${fields.join(", ") || "root"}).`);
    this.name = "AssessmentContractError";
  }
}

/** PRD §4.10.4：assumptions 统一全角「假设：」前缀（模型偶尔输出半角冒号或漏掉前缀）。 */
export function normalizeAssumption(value: string): string {
  const body = value.trim().replace(/^假设\s*[:：]?\s*/, "");
  return `假设：${body.trim()}`;
}

/** 只取字段路径并去重排序；数组下标保留为 scope.in，避免把模型正文带进日志。 */
function contractFieldPaths(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.path.map(String).join(".")).filter(Boolean))].sort();
}

// 与 skill §6 / PRD §4.10.4 逐键一致（dependency/risk 为单数，前端按同一契约渲染）。
// z.object 默认忽略未知键：模型偶尔多写一个字段不再整条失败；已知字段仍严格校验。
const AssessmentOutputSchema = z.object({
  background: z.string().min(1),
  goal: z.string().min(1),
  scope: z.object({ in: z.array(z.string().min(1)).min(1).max(8), out: z.array(z.string().min(1)).max(8) }),
  value: z.string().min(1),
  feasibility: z.object({
    technical: z.string().min(1),
    cost: z.string().min(1),
    dependency: z.string().min(1),
    risk: z.string().min(1),
  }),
  verdict: z.enum(["advance", "hold", "investigate"]),
  verdictReason: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  assumptions: z.array(z.string().min(1)).max(8),
  openQuestions: z.array(z.string().min(1)).max(8),
  investigationPrompt: z.string().min(1),
});

export interface AssessmentRunner {
  run(input: {
    requirement: RequirementRecord;
    inputs: RequirementAssessmentInput;
    actorId: string;
    analysis?: AnalysisRunRecord | null;
    /** PII 掩码名单（来源花名册 + 提出人/执行人）；缺省时只按需求字段本身脱敏。 */
    piiMarkers?: string[];
  }): Promise<RequirementAssessmentRecord>;
}

const EnvelopeSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }).passthrough() }).passthrough()).min(1),
}).passthrough();

function providerError(status: number): AiProviderError {
  if (status === 401 || status === 403) return new AiProviderError("auth_error", `AI provider authentication failed (HTTP ${status}).`, status);
  if (status === 429) return new AiProviderError("rate_limited", `AI provider rate limit reached (HTTP ${status}).`, status);
  if (status >= 500) return new AiProviderError("provider_error", `AI provider request failed (HTTP ${status}).`, status);
  return new AiProviderError("request_error", `AI provider rejected the request (HTTP ${status}).`, status);
}

export function createAssessmentRunner(options: {
  assessments: RequirementAssessmentRepository;
  config?: Partial<AiProviderConfig>;
  fetch?: FetchLike;
  now?: () => Date;
}): AssessmentRunner {
  const config = { ...getAiProviderConfig(), ...options.config };
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  return {
    async run({ requirement, inputs, actorId, analysis, piiMarkers }) {
      if (!config.apiKey) throw new AiProviderError("auth_error", "AI provider credential is not configured.");
      const startedAt = now().toISOString();
      // PRD §4.10.3：inputs 固定落三个键，空字符串保留（全空也允许生成），便于版本追溯与 hash 对比。
      const storedInputs = {
        background: inputs.background ?? "",
        goal: inputs.goal ?? "",
        scenario: inputs.scenario ?? "",
      };
      const claim = await options.assessments.create({
        requirementId: requirement.id,
        promptVersion: ASSESSMENT_PROMPT_VERSION,
        model: config.model,
        inputs: storedInputs,
        createdBy: actorId,
        at: startedAt,
        staleAfterMs: ASSESSMENT_RUNNING_STALE_MS,
      });
      if (claim.outcome === "in_progress") throw new AssessmentInProgressError();
      const record = claim.record;

      try {
        const messages = buildAssessmentMessages({
          requirement: {
            title: requirement.title,
            description: requirement.description,
            scope: requirement.scope,
            acceptanceCriteria: requirement.acceptanceCriteria,
            sourceChannel: requirement.sourceChannel,
            productModel: requirement.productModel,
            requirementType: requirement.requirementType,
            constraintNotes: requirement.constraintNotes,
            intakeModule: requirement.intakeModule,
          },
          supplements: storedInputs,
          analysis,
        });
        // 与主分析路径同口径：花名册姓名也进掩码，不能只靠需求字段本身。
        const maskedUser = maskPii(messages.user, piiMarkers ?? []);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        let response: Response;
        try {
          response = await fetcher(`${config.baseUrl}${ENDPOINT}`, {
            method: "POST",
            headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model: config.model,
              ...(config.temperature === null ? {} : { temperature: config.temperature }),
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: messages.system },
                { role: "user", content: maskedUser },
              ],
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw new AiProviderError("timeout", "AI provider request timed out.");
          throw new AiProviderError("network_error", "AI provider is unavailable.");
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) throw providerError(response.status);
        const content = EnvelopeSchema.parse(await response.json()).choices[0]?.message.content;
        if (!content?.trim()) throw new AiProviderError("analysis_failure", "AI provider returned empty content.");
        let raw: unknown;
        try {
          raw = parseModelJson(content);
        } catch {
          throw new AiProviderError("analysis_failure", "AI provider returned non-JSON content.");
        }
        const parsed = AssessmentOutputSchema.safeParse(raw);
        if (!parsed.success) throw new AssessmentContractError(contractFieldPaths(parsed.error));
        // 落库前归一化假设前缀，保证历史版本都满足契约；其余字段保持模型输出。
        const output = { ...parsed.data, assumptions: parsed.data.assumptions.map(normalizeAssumption) };
        const completed = await options.assessments.complete(record.id, output as Record<string, unknown>, now().toISOString());
        // 版本在本次调用期间被判超时（已被标 failed）：不把迟到结果写回成功。
        if (!completed) throw new AiProviderError("timeout", "Assessment version is no longer running.");
        return completed;
      } catch (error) {
        const code = error instanceof AiProviderError ? error.code : "analysis_failure";
        await options.assessments.fail(record.id, code, now().toISOString()).catch(() => null);
        throw error instanceof AiProviderError ? error : new AiProviderError("analysis_failure", "AI assessment failed.");
      }
    },
  };
}
