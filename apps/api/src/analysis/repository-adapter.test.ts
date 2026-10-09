import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisRunRecord } from "../domain/persistence.js";
import type { AnalysisRunRepository } from "../application/repositories.js";
import { AnalysisRepositoryAdapter } from "./repository-adapter.js";
import type { AnalysisRun } from "./service.js";

function record(overrides: Partial<AnalysisRunRecord> = {}): AnalysisRunRecord {
  return {
    id: "run-1", requirementId: "r-1", sourceVersion: 1, analysisVersion: 1, status: "running",
    moduleSuggestion: null, confidence: null, confidenceReason: null, priority: null, structuredResult: null,
    provider: null, model: null, promptVersion: null, moduleDictionaryVersion: null, priorityRuleVersionId: null,
    safeErrorCode: null, safeErrorSummary: null, startedAt: "2026-10-08T00:00:00.000Z", completedAt: null,
    ...overrides,
  };
}

const successfulResult: NonNullable<AnalysisRun["result"]> = {
  module: "基础数据", confidence: "中", confidence_reason: "引用了原文", evidence: ["支持查询"],
  recommendations: {
    user: { recommendation: "优化查询", rationale: "用户场景", evidence: ["支持查询"] },
    market: { recommendation: "需要补充", rationale: "无证据", evidence: [], missing_evidence: true },
    business: { recommendation: "提升效率", rationale: "AI 推断", evidence: [], missing_evidence: true },
    technology: { recommendation: "待评估", rationale: "细节不足", evidence: [], missing_evidence: true },
  },
  facts: [{ text: "用户需要查询", evidence: "支持查询" }], inferences: [{ text: "可能提升效率", ai_inference: true }],
  missing_inputs: [], blind_spots: [], priority: null,
};

test("analysis repository adapter appends then completes a separate durable analysis version", async () => {
  const stored: AnalysisRunRecord[] = [];
  const storage: AnalysisRunRepository = {
    append: async (input) => {
      const created = record({ requirementId: input.requirementId, sourceVersion: input.sourceVersion, analysisVersion: input.analysisVersion, startedAt: input.startedAt });
      stored.push(created); return created;
    },
    complete: async (id, result) => {
      const target = stored.find((run) => run.id === id);
      if (!target) return null;
      Object.assign(target, {
        status: result.status,
        moduleSuggestion: result.moduleSuggestion ?? null,
        confidence: result.confidence ?? null,
        confidenceReason: result.confidenceReason ?? null,
        priority: result.priority ?? null,
        structuredResult: result.structuredResult ?? null,
        provider: result.provider ?? null,
        model: result.model ?? null,
        promptVersion: result.promptVersion ?? null,
        moduleDictionaryVersion: result.moduleDictionaryVersion ?? null,
        priorityRuleVersionId: result.priorityRuleVersionId ?? null,
        safeErrorCode: result.safeErrorCode ?? null,
        safeErrorSummary: result.safeErrorSummary ?? null,
        completedAt: result.completedAt,
      });
      return target;
    },
    latest: async (requirementId) => [...stored].reverse().find((run) => run.requirementId === requirementId) ?? null,
    listByRequirement: async (requirementId) => stored.filter((run) => run.requirementId === requirementId),
  };
  const adapter = new AnalysisRepositoryAdapter(storage);
  const run = await adapter.append({
    requirementId: "r-1", sourceVersion: 1, analysisVersion: 1, provider: "deepseek", model: "deepseek-flash",
    promptVersion: "prompt-v1", moduleDictionaryVersion: 4, priorityRuleVersionId: null, startedAt: "2026-10-08T00:00:00.000Z",
  });
  assert.equal(run.status, "running");
  const completed = await adapter.complete(run.id, { status: "analyzed", provider: "deepseek", model: "deepseek-flash", promptVersion: "prompt-v1", moduleDictionaryVersion: 4, result: successfulResult, completedAt: "2026-10-08T00:01:00.000Z" });
  assert.equal(completed?.status, "analyzed");
  assert.deepEqual(completed?.result, successfulResult);
  assert.equal(stored[0]?.provider, "deepseek");
  assert.equal(stored[0]?.moduleDictionaryVersion, 4);
  assert.equal((await adapter.latest("r-1"))?.analysisVersion, 1);
  assert.equal((await adapter.listByRequirement("r-1")).length, 1);
});
