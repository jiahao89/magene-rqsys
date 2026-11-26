// 0030：需求评估服务。按需生成一条新版本：先落 running 行，再调用模型，成功 complete / 失败 fail。
// 单飞：同一需求存在未超时的 running 版本时直接 409，不调模型、不新建版本；超过 2 分钟的 running
// 在 claim 时先转 failed/timeout 再放行（GET 侧由路由的 expireStaleRunning 兜底）。
// 失败版本保留 error_code 供追溯；模型调用只带脱敏后的需求与补充内容，不写 Base、不改需求本体。
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { maskPii } from "../analysis/contract.js";
import { AiProviderError, assertAiBaseUrlConfigured, getAiProviderConfig, parseModelJson, type AiProviderConfig, type FetchLike } from "../analysis/provider.js";
import { OpenAiHttpError, requestOpenAiChatContent } from "../analysis/openai-http.js";
import type { AuditEventRepository, RequirementAssessmentRepository } from "../application/repositories.js";
import type { AnalysisRunRecord, RequirementAssessmentRecord, RequirementRecord } from "../domain/persistence.js";
import type { RequirementAssessmentInput } from "../contracts/pipeline.js";
import { ASSESSMENT_PROMPT_VERSION, buildAssessmentMessages } from "./prompt.js";
import { repairAssessmentOutput } from "./repair.js";

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
  /** 落库的失败子类型：`contract:<字段路径>`，便于线上直接定位是哪一版契约坏了。 */
  get detail(): string {
    return `contract:${this.fields.join(",") || "root"}`;
  }
}

/**
 * 其它输出类失败（空内容、供应商返回的不是标准响应包、非 JSON）：
 * 都归 analysis_failure，但用 detail 记录子类型，避免线上只剩一个笼统错误码。
 */
export class AssessmentOutputError extends AiProviderError {
  constructor(public readonly detail: string, message: string) {
    super("analysis_failure", message);
    this.name = "AssessmentOutputError";
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

function mapOpenAiError(error: OpenAiHttpError): AiProviderError {
  if (error.kind === "envelope") return new AssessmentOutputError("envelope", error.message);
  if (error.kind === "empty_content") return new AssessmentOutputError("empty_content", error.message);
  return new AiProviderError(error.kind, error.message, error.httpStatus);
}

export function createAssessmentRunner(options: {
  assessments: RequirementAssessmentRepository;
  /** 修复层触发时写审计，保证「修过」这件事可观测、不是静默兜底；缺省不写。 */
  audit?: Pick<AuditEventRepository, "append">;
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
      assertAiBaseUrlConfigured(config.baseUrl);
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
        let content: string;
        try {
          content = await requestOpenAiChatContent({
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            temperature: config.temperature,
            timeoutMs: config.timeoutMs,
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
        // 0033：deepseek-flash 偶发尾随逗号/提前闭合/中文键名；只做确定性修复，且必须通过完整契约。
        const repaired = repairAssessmentOutput(content, {
          parse: parseModelJson,
          validate: (value) => {
            const parsed = AssessmentOutputSchema.safeParse(value);
            return parsed.success
              ? { ok: true, value: parsed.data }
              : { ok: false, fields: contractFieldPaths(parsed.error) };
          },
        });
        if (!repaired.ok) {
          if (repaired.kind === "non_json") throw new AssessmentOutputError("non_json", "AI provider returned non-JSON content.");
          throw new AssessmentContractError(repaired.fields ?? []);
        }
        // 落库前归一化假设前缀，保证历史版本都满足契约；其余字段保持模型输出。
        const parsedOutput = repaired.output as z.infer<typeof AssessmentOutputSchema>;
        const output = { ...parsedOutput, assumptions: parsedOutput.assumptions.map(normalizeAssumption) };
        const completed = await options.assessments.complete(record.id, output as Record<string, unknown>, now().toISOString());
        // 版本在本次调用期间被判超时（已被标 failed）：不把迟到结果写回成功。
        if (!completed) throw new AiProviderError("timeout", "Assessment version is no longer running.");
        // 修复层触发要留痕：只记修复类型与版本，不含模型输出内容；审计失败不影响评估结果。
        const repairs = repaired.repairs ?? [];
        if (repairs.length > 0) {
          try {
            await options.audit?.append({
              id: randomUUID(),
              actorId,
              eventType: "assessment.output_repaired",
              entityType: "requirement",
              entityId: requirement.id,
              result: "succeeded",
              safeDetails: { version: record.version, promptVersion: ASSESSMENT_PROMPT_VERSION, repairs: repairs.join(","), model: config.model },
              occurredAt: now().toISOString(),
            });
          } catch { /* 审计是旁路，不能改变评估结果 */ }
        }
        return completed;
      } catch (error) {
        const code = error instanceof AiProviderError ? error.code : "analysis_failure";
        // 失败子类型：契约失败带字段路径；输出类失败带分类；其它异常标 unexpected，便于线上定位。
        const detail = error instanceof AssessmentContractError
          ? error.detail
          : error instanceof AssessmentOutputError
            ? error.detail
            : error instanceof AiProviderError
              ? null
              : "unexpected";
        await options.assessments.fail(record.id, code, now().toISOString(), detail).catch(() => null);
        throw error instanceof AiProviderError ? error : new AiProviderError("analysis_failure", "AI assessment failed.");
      }
    },
  };
}
