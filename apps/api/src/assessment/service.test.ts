import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError } from "../analysis/provider.js";
import { ASSESSMENT_PROMPT_VERSION } from "./prompt.js";
import { AssessmentContractError, createAssessmentRunner } from "./service.js";
import type { AuditEventRecord, RequirementAssessmentRecord, RequirementRecord } from "../domain/persistence.js";

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
    errorDetail: null,
    createdBy: "actor-1",
    createdAt: "2026-11-20T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function harness(respond: () => Response) {
  const calls: { created: unknown[]; completed: unknown[]; failed: string[]; failedDetails: (string | null)[] } = { created: [], completed: [], failed: [], failedDetails: [] };
  const audits: AuditEventRecord[] = [];
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
    async fail(_id: string, code: string, at: string, detail?: string | null) {
      calls.failed.push(code);
      calls.failedDetails.push(detail ?? null);
      current = assessment({ status: "failed", errorCode: code, errorDetail: detail ?? null, completedAt: at });
      return current;
    },
    async list() { return [current]; },
    async expireStaleRunning() { return 0; },
  };
  const bodies: Record<string, unknown>[] = [];
  const runner = createAssessmentRunner({
    assessments,
    audit: { append: async (event) => { audits.push(event); } },
    config: { apiKey: "sk-test", baseUrl: "https://ai.example", model: "m", timeoutMs: 1_000, temperature: 0, promptVersion: "p" },
    fetch: async (_input, init) => { bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return respond(); },
    now: () => new Date("2026-11-20T00:00:10.000Z"),
  });
  return { runner, calls, bodies, assessments, audits };
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

test("评估路径把花名册姓名并入掩码，名单不再为空", async () => {
  const h = harness(() => envelope(output));
  await h.runner.run({
    requirement,
    inputs: { background: "刘媛媛反馈冬天掉电快，希望显示电量百分比" },
    actorId: "actor-1",
    piiMarkers: ["刘媛媛"],
  });
  const user = (h.bodies[0]!.messages as { role: string; content: string }[]).find((message) => message.role === "user")!.content;
  assert.equal(user.includes("刘媛媛"), false);
  assert.match(user, /（已掩码）/);

  // 老调用方不传名单时保持原行为（固定模式仍脱敏），不会因为新增参数报错。
  const legacy = harness(() => envelope(output));
  await legacy.runner.run({ requirement, inputs: { background: "刘媛媛反馈冬天掉电快" }, actorId: "actor-1" });
  const legacyUser = (legacy.bodies[0]!.messages as { role: string; content: string }[]).find((message) => message.role === "user")!.content;
  assert.equal(legacyUser.includes("刘媛媛"), true);
});

// 0033：模型偶发坏 JSON 的确定性修复与失败子类型落库。
test("评估输出带尾随逗号时由修复层救回，并写修复审计", async () => {
  const withTrailingComma = JSON.stringify(output).replace(/}$/, ",}");
  const h = harness(() => envelope(withTrailingComma));
  const result = await h.runner.run({ requirement, inputs: {}, actorId: "actor-1" });
  assert.equal(result.status, "succeeded");
  const completed = h.calls.completed[0] as Record<string, unknown>;
  assert.deepEqual(completed, { ...output, assumptions: ["假设：电量百分比在当前平台可读"] });
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0]!.eventType, "assessment.output_repaired");
  assert.equal(h.audits[0]!.entityId, requirement.id);
  assert.deepEqual(h.audits[0]!.safeDetails, { version: 1, promptVersion: ASSESSMENT_PROMPT_VERSION, repairs: "trailing_comma", model: "m" });
  assert.deepEqual(h.calls.failed, []);
});

test("评估输出把 feasibility 键写成中文时按白名单改回英文键", async () => {
  const localized = JSON.stringify({ ...output, feasibility: { 技术: "可读电量", 成本: "低", 依赖: "无", 风险: "低温估算偏差" } });
  const h = harness(() => envelope(localized));
  const result = await h.runner.run({ requirement, inputs: {}, actorId: "actor-1" });
  assert.equal(result.status, "succeeded");
  const completed = h.calls.completed[0] as { feasibility: Record<string, unknown> };
  assert.deepEqual(Object.keys(completed.feasibility).sort(), ["cost", "dependency", "risk", "technical"]);
  assert.equal(h.audits[0]!.safeDetails.repairs, "keys");
  assert.deepEqual(h.calls.failed, []);
});

test("评估输出提前闭合根对象后继续输出键，合并后按成功落库", async () => {
  const text = JSON.stringify(output);
  const splitAt = text.indexOf(',"openQuestions"');
  assert.ok(splitAt > 0);
  const malformed = `${text.slice(0, splitAt)}}${text.slice(splitAt)}`;
  const h = harness(() => envelope(malformed));
  const result = await h.runner.run({ requirement, inputs: {}, actorId: "actor-1" });
  assert.equal(result.status, "succeeded");
  assert.equal(h.audits[0]!.safeDetails.repairs, "early_close");
});

test("修复层救不回来时落 failed，并把失败子类型写进 error_detail", async () => {
  const notJson = harness(() => envelope("这不是 JSON"));
  await assert.rejects(() => notJson.runner.run({ requirement, inputs: {}, actorId: "actor-1" }), (error: unknown) => error instanceof AiProviderError && error.code === "analysis_failure");
  assert.deepEqual(notJson.calls.failed, ["analysis_failure"]);
  assert.deepEqual(notJson.calls.failedDetails, ["non_json"]);
  assert.deepEqual(notJson.audits, []);

  const contract = harness(() => envelope({ ...output, feasibility: { ...output.feasibility, cost: "" } }));
  await assert.rejects(() => contract.runner.run({ requirement, inputs: {}, actorId: "actor-1" }), (error: unknown) => error instanceof AssessmentContractError);
  assert.deepEqual(contract.calls.failedDetails, ["contract:feasibility.cost"]);

  const envelopeShape = harness(() => Response.json({ unexpected: true }));
  await assert.rejects(() => envelopeShape.runner.run({ requirement, inputs: {}, actorId: "actor-1" }), (error: unknown) => error instanceof AiProviderError);
  assert.deepEqual(envelopeShape.calls.failedDetails, ["envelope"]);
});

test("评估响应体挂死时由统一超时中断并落 failed/timeout", async () => {
  const h = harness(() => envelope(output));
  const aborting = new AbortController();
  const runner = createAssessmentRunner({
    assessments: h.assessments,
    config: { apiKey: "sk-test", baseUrl: "https://ai.example", model: "m", timeoutMs: 40, temperature: 0, promptVersion: "p" },
    fetch: async (_input, init) => {
      init?.signal?.addEventListener("abort", () => aborting.abort());
      const body = new ReadableStream({
        start(controller) {
          aborting.signal.addEventListener("abort", () =>
            controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => new Date("2026-11-20T00:00:10.000Z"),
  });
  await assert.rejects(
    () => runner.run({ requirement, inputs: {}, actorId: "actor-1" }),
    (error: unknown) => error instanceof AiProviderError && error.code === "timeout",
  );
  assert.deepEqual(h.calls.failed, ["timeout"]);
});
