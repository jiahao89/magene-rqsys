import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError } from "../analysis/provider.js";
import { ASSESSMENT_PROMPT_VERSION } from "./prompt.js";
import { AssessmentContractError, createAssessmentRunner } from "./service.js";
import type { RequirementAssessmentRecord, RequirementRecord } from "../domain/persistence.js";

const requirement = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "低温掉电",
  description: "客户电话 13812345678，零下十度骑三小时关机，希望显示电量百分比。",
  scope: null,
  acceptanceCriteria: null,
  sourceChannel: "终端用户",
  productModel: "C606",
  requirementType: "性能优化",
  constraintNotes: null,
  intakeModule: null,
} as unknown as RequirementRecord;

const output = {
  background: "低温场景电量掉得快",
  goal: "让用户知道剩余电量并提前提醒",
  scope: { in: ["显示电量百分比"], out: ["更换电池"] },
  value: "减少骑行中意外关机",
  feasibility: { technical: "已在固件内可读电量", cost: "低", dependency: "无", risk: "低温电量估算偏差" },
  verdict: "advance",
  verdictReason: "用户价值明确且实现成本低",
  confidence: "medium",
  assumptions: ["电量百分比在当前平台可读"],
  openQuestions: ["低温下的电量曲线是否需要标定"],
  investigationPrompt: "目标用户：冬季骑行者……",
};

function assessment(overrides: Partial<RequirementAssessmentRecord> = {}): RequirementAssessmentRecord {
  return {
    id: "assessment-1",
    requirementId: requirement.id,
    version: 1,
    status: "running",
    promptVersion: ASSESSMENT_PROMPT_VERSION,
    model: "m",
    inputs: {},
    output: null,
    errorCode: null,
    createdBy: "actor-1",
    createdAt: "2026-11-20T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function harness(respond: () => Response) {
  const calls: { created: unknown[]; completed: unknown[]; failed: string[] } = { created: [], completed: [], failed: [] };
  let current = assessment();
  const assessments: import("../application/repositories.js").RequirementAssessmentRepository = {
    async create(input: unknown) {
      calls.created.push(input);
      current = assessment({ inputs: (input as { inputs: Record<string, unknown> }).inputs });
      return { outcome: "created" as const, record: current };
    },
    async complete(_id: string, result: Record<string, unknown>, at: string) {
      calls.completed.push(result);
      current = assessment({ status: "succeeded", output: result, completedAt: at });
      return current;
    },
    async fail(_id: string, code: string, at: string) {
      calls.failed.push(code);
      current = assessment({ status: "failed", errorCode: code, completedAt: at });
      return current;
    },
    async list() { return [current]; },
    async expireStaleRunning() { return 0; },
  };
  const bodies: Record<string, unknown>[] = [];
  const runner = createAssessmentRunner({
    assessments,
    config: { apiKey: "sk-test", baseUrl: "https://ai.example", model: "m", timeoutMs: 1_000, temperature: 0, promptVersion: "p" },
    fetch: async (_input, init) => { bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return respond(); },
    now: () => new Date("2026-11-20T00:00:10.000Z"),
  });
  return { runner, calls, bodies, assessments };
}

function envelope(content: unknown): Response {
  return Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
}

test("assessment runner stores a running version, masks PII, validates the contract and completes it", async () => {
  const h = harness(() => envelope(output));
  const result = await h.runner.run({ requirement, inputs: { background: "客户说冬天掉电快" }, actorId: "actor-1" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.version, 1);
  assert.deepEqual(h.calls.created[0], {
    requirementId: requirement.id,
    promptVersion: ASSESSMENT_PROMPT_VERSION,
    model: "m",
    inputs: { background: "客户说冬天掉电快", goal: "", scenario: "" },
    createdBy: "actor-1",
    at: "2026-11-20T00:00:10.000Z",
    staleAfterMs: 120_000,
  });
  const messages = h.bodies[0]!.messages as { role: string; content: string }[];
  const user = messages.find((message) => message.role === "user")!.content;
  assert.equal(user.includes("13812345678"), false);
  assert.match(user, /手机号已掩码/);
  const system = messages.find((message) => message.role === "system")!.content;
  assert.match(system, /需求评估 Skill/);
  assert.match(system, /investigationPrompt/);
  assert.match(system, /assumptions/);
  assert.deepEqual(h.calls.completed[0], { ...output, assumptions: ["假设：电量百分比在当前平台可读"] });
  assert.deepEqual(h.calls.failed, []);
});

test("assessment runner records a failed version for provider errors and invalid contracts", async () => {
  const limited = harness(() => new Response("busy", { status: 429 }));
  await assert.rejects(() => limited.runner.run({ requirement, inputs: {}, actorId: "actor-1" }), (error: unknown) => error instanceof AiProviderError && error.code === "rate_limited");
  assert.deepEqual(limited.calls.failed, ["rate_limited"]);

  const invalid = harness(() => envelope({ background: "x" }));
  await assert.rejects(() => invalid.runner.run({ requirement, inputs: {}, actorId: "actor-1" }), (error: unknown) => error instanceof AiProviderError && error.code === "analysis_failure");
  assert.deepEqual(invalid.calls.failed, ["analysis_failure"]);

  const broken = harness(() => Response.json({ unexpected: true }));
  await assert.rejects(() => broken.runner.run({ requirement, inputs: {}, actorId: "actor-1" }), (error: unknown) => error instanceof AiProviderError && error.code === "analysis_failure");
  assert.deepEqual(broken.calls.failed, ["analysis_failure"]);
});

test("assessment runner refuses a second concurrent version without calling the model", async () => {
  const h = harness(() => envelope(output));
  const running = assessment();
  h.assessments.create = async (input: unknown) => {
    h.calls.created.push(input);
    return { outcome: "in_progress" as const, record: running };
  };
  await assert.rejects(
    () => h.runner.run({ requirement, inputs: {}, actorId: "actor-1" }),
    (error: unknown) => (error as { code?: string }).code === "assessment_in_progress",
  );
  assert.equal(h.bodies.length, 0);
  assert.deepEqual(h.calls.completed, []);
  assert.deepEqual(h.calls.failed, []);
});

test("assessment runner passes the existing analysis into the model input", async () => {
  const h = harness(() => envelope(output));
  const analysis = {
    id: "analysis-1", requirementId: requirement.id, sourceVersion: 1, analysisVersion: 1, status: "analyzed",
    moduleSuggestion: "电源管理", confidence: "medium", confidenceReason: "低温证据来自用户描述", priority: null,
    structuredResult: {
      facts: [{ text: "零下十度骑三小时关机", evidence: "零下十度骑三小时关机" }],
      inferences: [{ text: "低温导致电量估算偏差", ai_inference: true }],
      missing_inputs: ["低温剩余电量曲线"],
      blind_spots: ["未区分电池老化"],
      typeSuggestion: "性能优化",
    },
    provider: "deepseek", model: "m", promptVersion: "p", moduleDictionaryVersion: 7, priorityRuleVersionId: null,
    safeErrorCode: null, safeErrorSummary: null, startedAt: "2026-11-20T00:00:00.000Z", completedAt: "2026-11-20T00:00:05.000Z",
  } as unknown as import("../domain/persistence.js").AnalysisRunRecord;
  await h.runner.run({ requirement, inputs: {}, actorId: "actor-1", analysis });
  const messages = h.bodies[0]!.messages as { role: string; content: string }[];
  const user = messages.find((message) => message.role === "user")!.content;
  assert.match(user, /现有 AI 分析/);
  assert.match(user, /零下十度骑三小时关机/);
  assert.match(user, /低温剩余电量曲线/);
  assert.match(user, /性能优化/);
});

test("assessment runner ignores unknown output keys but still validates known fields", async () => {
  const h = harness(() => envelope({ ...output, extra: "ignored", feasibility: { ...output.feasibility, notes: "ignored" } }));
  const result = await h.runner.run({ requirement, inputs: {}, actorId: "actor-1" });
  assert.equal(result.status, "succeeded");
  const completed = h.calls.completed[0] as Record<string, unknown>;
  assert.equal("extra" in completed, false);
  assert.equal("notes" in (completed.feasibility as Record<string, unknown>), false);
});

test("assessment contract failures report only field paths", async () => {
  const h = harness(() => envelope({ ...output, scope: { in: [], out: [] }, feasibility: { ...output.feasibility, cost: "" } }));
  await assert.rejects(
    () => h.runner.run({ requirement, inputs: {}, actorId: "actor-1" }),
    (error: unknown) => error instanceof AssessmentContractError
      && error.fields.includes("scope.in")
      && error.fields.includes("feasibility.cost"),
  );
  assert.deepEqual(h.calls.failed, ["analysis_failure"]);
});

test("assessment stores all three input keys, keeping empty strings", async () => {
  const h = harness(() => envelope(output));
  await h.runner.run({ requirement, inputs: {}, actorId: "actor-1" });
  assert.deepEqual((h.calls.created[0] as { inputs: unknown }).inputs, { background: "", goal: "", scenario: "" });
  const partial = harness(() => envelope(output));
  await partial.runner.run({ requirement, inputs: { background: "冬季投诉", scenario: "通勤" }, actorId: "actor-1" });
  assert.deepEqual((partial.calls.created[0] as { inputs: unknown }).inputs, { background: "冬季投诉", goal: "", scenario: "通勤" });
});

test("assessment normalizes assumption prefixes to full-width 假设： before persisting", async () => {
  const h = harness(() => envelope({ ...output, assumptions: ["假设: 低温电量估算偏差", "低温下电量曲线需要标定", "假设：已有平台能力"] }));
  const result = await h.runner.run({ requirement, inputs: {}, actorId: "actor-1" });
  const stored = (h.calls.completed[0] as { assumptions: string[] }).assumptions;
  assert.deepEqual(stored, ["假设：低温电量估算偏差", "假设：低温下电量曲线需要标定", "假设：已有平台能力"]);
  assert.deepEqual((result.output as { assumptions: string[] }).assumptions, stored);
});
