import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalysisRequest, maskPii, validateAnalysisOutput } from "./contract.js";
import { createDeepSeekProvider, getAiProviderConfig, type AiProvider, type FetchLike } from "./provider.js";
import type { ValidatedAnalysis } from "./contract.js";
import { runAnalysis, type AnalysisRepository, type AnalysisRun, type AnalysisServiceInput } from "./service.js";

const dictionary = { version: 3, modules: ["基础数据", "其他", "待分类"] };
const validResult = {
  module: "基础数据",
  confidence: "中",
  confidence_reason: "标题提到查询功能。",
  evidence: ["支持查询和筛选"],
  recommendations: {
    user: { recommendation: "改善检索", rationale: "用户提到查询", evidence: ["支持查询和筛选"] },
    market: { recommendation: "需进一步调研", rationale: "缺乏市场证据", evidence: [], missing_evidence: true },
    business: { recommendation: "提升运营效率", rationale: "AI 推断", evidence: [], missing_evidence: true },
    technology: { recommendation: "评估实现方案", rationale: "未提供技术细节", evidence: [], missing_evidence: true },
  },
  facts: [{ text: "支持查询和筛选", evidence: "支持查询和筛选" }],
  inferences: [{ text: "可能提升效率", ai_inference: true }],
  missing_inputs: ["目标用户"],
  blind_spots: ["业务价值待确认"],
  priority: null,
};

function serviceInput(overrides: Partial<AnalysisServiceInput> = {}): AnalysisServiceInput {
  return {
    requirementId: "r-1", sourceVersion: 2, sourcePersisted: true,
    title: "支持查询", description: "支持查询和筛选", context: "仅提供必要业务信息",
    piiMarkers: ["张三", "13800138000", "alice@example.com"],
    dictionary, priorityRule: null,
    promptVersion: "prompt-v1", model: "deepseek-flash", generatedAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

class MemoryAnalysisRepository implements AnalysisRepository {
  runs: AnalysisRun[] = [];
  pmFields = { pmStatus: "待处理", confirmedModule: "人工确认模块" };
  async append(input: Omit<AnalysisRun, "id" | "status" | "completedAt" | "result" | "safeErrorCode" | "safeErrorSummary">) {
    const run: AnalysisRun = { ...input, id: `run-${input.analysisVersion}`, status: "running", completedAt: null, result: null, safeErrorCode: null, safeErrorSummary: null };
    this.runs.push(run); return run;
  }
  async complete(id: string, result: Partial<AnalysisRun>) {
    const run = this.runs.find((item) => item.id === id);
    assert.ok(run);
    Object.assign(run, result);
    return run;
  }
  async latest(requirementId: string) {
    return [...this.runs].reverse().find((item) => item.requirementId === requirementId) ?? null;
  }
  async listByRequirement(requirementId: string) {
    return this.runs.filter((item) => item.requirementId === requirementId);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("buildAnalysisRequest masks listed identity PII and pattern-matched contact details in all model text", () => {
  const request = buildAnalysisRequest({
    title: "张三的需求", description: "联系 alice@example.com 或 13800138000", context: "负责人张三",
    piiMarkers: ["张三"], dictionary, priorityRule: null,
  });
  const serialized = JSON.stringify(request);
  for (const raw of ["张三", "alice@example.com", "13800138000"]) assert.equal(serialized.includes(raw), false);
  assert.equal(request.priorityRule, null);
});

test("validateAnalysisOutput accepts a fully evidenced contract and rejects bad module/evidence/priority/inference", () => {
  assert.deepEqual(validateAnalysisOutput(validResult, { dictionary, priorityRule: null, sourceText: "支持查询和筛选" }), validResult);
  assert.throws(() => validateAnalysisOutput({ ...validResult, module: "未批准模块" }, { dictionary, priorityRule: null, sourceText: "支持查询和筛选" }));
  assert.throws(() => validateAnalysisOutput({ ...validResult, evidence: ["不在原文的说法"] }, { dictionary, priorityRule: null, sourceText: "支持查询和筛选" }));
  assert.throws(() => validateAnalysisOutput({ ...validResult, priority: "P1" }, { dictionary, priorityRule: null, sourceText: "支持查询和筛选" }));
  assert.throws(() => validateAnalysisOutput({ ...validResult, inferences: [{ text: "推断" }] }, { dictionary, priorityRule: null, sourceText: "支持查询和筛选" }));
});

test("provider config does not invent credentials when AI_API_KEY is unset", () => {
  const config = getAiProviderConfig({});
  assert.equal(config.apiKey, undefined);
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  assert.equal(config.model, "deepseek-flash");
});

test("DeepSeek provider sends JSON-mode request and parses structured response via injected fetch", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  const fetchStub: FetchLike = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    authorization = new Headers(init?.headers).get("authorization");
    return jsonResponse({ choices: [{ message: { content: JSON.stringify(validResult) } }] });
  };
  const provider = createDeepSeekProvider({ apiKey: "test-secret", fetch: fetchStub });
  const result = await provider.analyze({ title: "支持查询", description: "支持查询和筛选", context: "", piiMarkers: [], dictionary, priorityRule: null });
  assert.deepEqual(result, validResult);
  assert.equal(authorization, "Bearer test-secret");
  assert.equal(requestBody?.response_format && JSON.stringify(requestBody.response_format), JSON.stringify({ type: "json_object" }));
});

test("analysis orchestration appends versions, safely records provider failures, and does not touch PM fields", async () => {
  const repository = new MemoryAnalysisRepository();
  const service = runAnalysis;
  const provider: AiProvider = { name: "test", model: "test-model", promptVersion: "test-v1", analyze: async () => validResult as ValidatedAnalysis };
  const first = await service(serviceInput(), { repository, provider });
  assert.equal(first.status, "analyzed");
  assert.equal(first.analysisVersion, 1);
  assert.equal(first.result?.priority, null);

  const failedProvider: AiProvider = { name: "test", model: "test-model", promptVersion: "test-v1", analyze: async () => { throw new Error("provider leaked alice@example.com key=private-secret"); } };
  const second = await service(serviceInput(), { repository, provider: failedProvider });
  assert.equal(second.status, "failed_retryable");
  assert.equal(second.analysisVersion, 2);
  assert.equal(second.safeErrorSummary?.includes("alice@example.com"), false);
  assert.equal(second.safeErrorSummary?.includes("private-secret"), false);
  assert.deepEqual(repository.pmFields, { pmStatus: "待处理", confirmedModule: "人工确认模块" });
  assert.equal((await repository.listByRequirement("r-1")).length, 2);
});

test("analysis is refused until the source snapshot has persisted", async () => {
  const repository = new MemoryAnalysisRepository();
  await assert.rejects(() => runAnalysis(serviceInput({ sourcePersisted: false }), { repository, provider: { name: "test", model: "test-model", promptVersion: "test-v1", analyze: async () => validResult as ValidatedAnalysis } }));
  assert.equal(repository.runs.length, 0);
});

test("analysis config keeps API credential absent rather than making an external call", async () => {
  let called = false;
  const provider = createDeepSeekProvider({ ...getAiProviderConfig({}), apiKey: undefined, fetch: async () => { called = true; return jsonResponse({}); } });
  await assert.rejects(() => provider.analyze({ title: "t", description: "", context: "", piiMarkers: [], dictionary, priorityRule: null }));
  assert.equal(called, false);
  assert.equal(maskPii("张三 alice@example.com", ["张三"]).includes("alice@example.com"), false);
});
