import type { AnalysisRunRepository } from "../application/repositories.js";
import type { AnalysisRunRecord, PriorityLevel } from "../domain/persistence.js";
import type { AnalysisRun, AnalysisRepository } from "./service.js";

function fromRecord(record: AnalysisRunRecord): AnalysisRun {
  const structured = record.structuredResult as AnalysisRun["result"] | null;
  return {
    id: record.id,
    requirementId: record.requirementId,
    sourceVersion: record.sourceVersion,
    analysisVersion: record.analysisVersion,
    status: record.status,
    provider: record.provider ?? "deepseek",
    model: record.model ?? "unknown",
    promptVersion: record.promptVersion ?? "unknown",
    moduleDictionaryVersion: record.moduleDictionaryVersion ?? 0,
    priorityRuleVersionId: record.priorityRuleVersionId,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    result: structured && record.moduleSuggestion && record.confidence && record.confidenceReason
      ? { ...structured, module: record.moduleSuggestion, confidence: record.confidence === "high" ? "高" : record.confidence === "medium" ? "中" : "低", confidence_reason: record.confidenceReason, priority: record.priority }
      : null,
    safeErrorCode: record.safeErrorCode,
    safeErrorSummary: record.safeErrorSummary,
  };
}

export class AnalysisRepositoryAdapter implements AnalysisRepository {
  constructor(private readonly storage: AnalysisRunRepository) {}

  async append(input: Parameters<AnalysisRepository["append"]>[0]): Promise<AnalysisRun> {
    const record = await this.storage.append({
      requirementId: input.requirementId,
      sourceVersion: input.sourceVersion,
      analysisVersion: input.analysisVersion,
      startedAt: input.startedAt,
    });
    return { ...fromRecord(record), ...input, id: record.id, status: record.status, completedAt: record.completedAt, result: null, safeErrorCode: null, safeErrorSummary: null };
  }

  async complete(id: string, result: Partial<AnalysisRun>): Promise<AnalysisRun | null> {
    const storageResult: Parameters<AnalysisRunRepository["complete"]>[1] = {
      status: result.status === "analyzed" ? "analyzed" : "failed_retryable",
      ...(result.result ? {
        moduleSuggestion: result.result.module,
        confidence: result.result.confidence === "高" ? "high" : result.result.confidence === "中" ? "medium" : "low",
        confidenceReason: result.result.confidence_reason,
        ...(result.result.priority ? { priority: result.result.priority as PriorityLevel } : {}),
        structuredResult: result.result as unknown as Record<string, unknown>,
      } : {}),
      ...(result.provider ? { provider: result.provider } : {}),
      ...(result.model ? { model: result.model } : {}),
      ...(result.promptVersion ? { promptVersion: result.promptVersion } : {}),
      ...(result.priorityRuleVersionId ? { priorityRuleVersionId: result.priorityRuleVersionId } : {}),
      ...(result.moduleDictionaryVersion !== undefined ? { moduleDictionaryVersion: result.moduleDictionaryVersion } : {}),
      ...(result.safeErrorCode ? { safeErrorCode: result.safeErrorCode } : {}),
      ...(result.safeErrorSummary ? { safeErrorSummary: result.safeErrorSummary } : {}),
      completedAt: result.completedAt ?? new Date().toISOString(),
    };
    const record = await this.storage.complete(id, storageResult);
    return record ? { ...fromRecord(record), ...result, id: record.id, status: record.status } : null;
  }

  async latest(requirementId: string): Promise<AnalysisRun | null> {
    const record = await this.storage.latest(requirementId);
    return record ? fromRecord(record) : null;
  }

  async listByRequirement(requirementId: string): Promise<AnalysisRun[]> {
    return (await this.storage.listByRequirement(requirementId)).map(fromRecord);
  }
}
