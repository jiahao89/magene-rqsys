import type { ValidatedAnalysis } from "./contract.js";
import { AiProviderError, type AiProvider } from "./provider.js";
import { recommendationScores } from "./priority-rule.js";

export interface AnalysisRun {
  id: string;
  requirementId: string;
  sourceVersion: number;
  analysisVersion: number;
  status: "running" | "analyzed" | "failed_retryable";
  provider: string;
  model: string;
  promptVersion: string;
  moduleDictionaryVersion: number;
  priorityRuleVersionId: string | null;
  startedAt: string;
  completedAt: string | null;
  result: ValidatedAnalysis | null;
  safeErrorCode: string | null;
  safeErrorSummary: string | null;
}

export interface AnalysisRepository {
  append(input: Omit<AnalysisRun, "id" | "status" | "completedAt" | "result" | "safeErrorCode" | "safeErrorSummary">): Promise<AnalysisRun>;
  complete(id: string, result: Partial<AnalysisRun>): Promise<AnalysisRun | null>;
  latest(requirementId: string): Promise<AnalysisRun | null>;
  listByRequirement(requirementId: string): Promise<AnalysisRun[]>;
}

export interface AnalysisServiceInput {
  requirementId: string;
  sourceVersion: number;
  sourcePersisted: boolean;
  title: string;
  description: string;
  context: string;
  piiMarkers: string[];
  dictionary: { version: number; modules: string[] };
  priorityRule: {
    id: string;
    version: number;
    compute: (scores: { user: number; market: number; business: number; technology: number }) => "P0" | "P1" | "P2" | "P3";
  } | null;
  promptVersion?: string;
  model?: string;
  generatedAt?: string;
}

export interface AnalysisExecutionOptions {
  repository: AnalysisRepository;
  provider: AiProvider;
  now?: () => Date;
}

export class AnalysisPersistenceError extends Error {
  constructor(message: string) { super(message); this.name = "AnalysisPersistenceError"; }
}

function safeFailure(error: unknown): { code: string; summary: string } {
  if (error instanceof AiProviderError) return { code: error.code, summary: error.message };
  return { code: "analysis_failure", summary: "Analysis failed and can be retried." };
}

export async function runAnalysis(input: AnalysisServiceInput, options: AnalysisExecutionOptions): Promise<AnalysisRun> {
  if (!input.sourcePersisted) throw new AnalysisPersistenceError("Analysis requires a persisted source snapshot.");
  const previous = await options.repository.latest(input.requirementId);
  const analysisVersion = (previous?.analysisVersion ?? 0) + 1;
  const startedAt = input.generatedAt ?? (options.now ?? (() => new Date()))().toISOString();
  const run = await options.repository.append({
    requirementId: input.requirementId,
    sourceVersion: input.sourceVersion,
    analysisVersion,
    provider: options.provider.name,
    model: input.model ?? options.provider.model,
    promptVersion: input.promptVersion ?? options.provider.promptVersion,
    moduleDictionaryVersion: input.dictionary.version,
    priorityRuleVersionId: input.priorityRule?.id ?? null,
    startedAt,
  });
  try {
    const result = await options.provider.analyze({
      title: input.title,
      description: input.description,
      context: input.context,
      piiMarkers: input.piiMarkers,
      dictionary: input.dictionary,
      priorityRule: input.priorityRule,
    });
    // 已发布规则时用确定性规则从 U/M/S/C 建议计算优先级（不丢弃规则、不信任模型自评）；
    // 规则未发布时 priority 保持为空
    const priority = input.priorityRule
      ? input.priorityRule.compute(recommendationScores(result))
      : result.priority;
    const completed = await options.repository.complete(run.id, {
      status: "analyzed", result: { ...result, priority }, completedAt: (options.now ?? (() => new Date()))().toISOString(),
      safeErrorCode: null, safeErrorSummary: null,
    });
    if (!completed) throw new AnalysisPersistenceError("Analysis run could not be completed.");
    return completed;
  } catch (error) {
    if (error instanceof AnalysisPersistenceError) throw error;
    const failure = safeFailure(error);
    const failed = await options.repository.complete(run.id, {
      status: "failed_retryable", completedAt: (options.now ?? (() => new Date()))().toISOString(),
      safeErrorCode: failure.code, safeErrorSummary: failure.summary,
    });
    if (!failed) throw new AnalysisPersistenceError("Failed analysis could not be recorded.");
    return failed;
  }
}
