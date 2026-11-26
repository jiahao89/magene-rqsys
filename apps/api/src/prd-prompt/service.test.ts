// 2026-11-21：PRD 提示词服务用例（stub provider，不发真实请求）。
import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementAssessmentRecord, RequirementPrdPromptRecord, RequirementRecord } from "../domain/persistence.js";
import { PrdPromptFailure, PrdPromptInProgressError, createPrdPromptRunner, validatePrdPromptOutput } from "./service.js";
import { PRD_PROMPT_SECTIONS } from "./prompt.js";

const requirement = {
  id: "req-1", title: "坡段数量与坡度", description: "骑行中显示坡段", scope: null, acceptanceCriteria: null,
  sourceChannel: "终端用户", productModel: "C706", requirementType: "新增功能", constraintNotes: "固件内存有限",
  intakeModule: "骑行数据", sourceVersion: 3, sourceUrl: "https://teambition.example/task/1",
  proposerName: "张三", executorName: "李四",
} as unknown as RequirementRecord;

const assessment = {
  id: "assessment-1", requirementId: "req-1", version: 3, status: "succeeded", promptVersion: "rq-assessment-v1", model: "m",
  inputs: {}, errorCode: null, createdAt: "2026-11-21T00:00:00.000Z", completedAt: "2026-11-21T00:00:01.000Z",
  output: {
    background: "冬季爬坡投诉", goal: "提前看到坡段", scope: { in: ["坡段预览"], out: ["导航"] },
    value: "体验提升", feasibility: { technical: "可做", cost: "中", dependency: "地图数据", risk: "中" },
    verdict: "advance", verdictReason: "收益明确", confidence: "medium",
    assumptions: ["假设：地图数据可商用"], openQuestions: ["精度要求？"],
  },
} as unknown as RequirementAssessmentRecord;

// 章节齐全且长度过 1,500 字的合规正文；extra 用于追加反例内容。
const body = (extra = "") =>
  PRD_PROMPT_SECTIONS.map((section, index) => `${section}\n第 ${index + 1} 章正文。`).join("\n\n") + `\n\n${"补充材料说明。".repeat(200)}${extra}`;

function output(overrides: Record<string, unknown> = {}) {
  return { prompt: body(), assumptions: ["假设：地图数据可商用"], openQuestions: ["坡度精度要求是多少？"], ...overrides };
}

function harness(options: {
  response?: unknown;
  status?: number;
  failFetch?: Error;
  claim?: "created" | "in_progress";
  failComplete?: boolean;
} = {}) {
  const records: RequirementPrdPromptRecord[] = [];
  let modelInput: { system?: string | undefined; user?: string | undefined } | null = null;
  let calls = 0;
  const prdPrompts = {
    async create(input: { requirementId: string; promptVersion: string; model: string | null; inputs: Record<string, unknown>; at: string; staleAfterMs: number }) {
      if (options.claim === "in_progress") {
        return { outcome: "in_progress" as const, record: { ...baseRecord(), status: "running" as const } };
      }
      const record: RequirementPrdPromptRecord = {
        id: `prd-${records.length + 1}`, requirementId: input.requirementId, version: records.length + 1, status: "running",
        promptVersion: input.promptVersion, model: input.model, inputs: input.inputs, output: null, errorCode: null,
        createdAt: input.at, completedAt: null,
      };
      records.push(record);
      return { outcome: "created" as const, record };
    },
    async complete(id: string, value: Record<string, unknown>, at: string) {
      if (options.failComplete) return null;
      const record = records.find((item) => item.id === id)!;
      record.status = "succeeded"; record.output = value; record.completedAt = at;
      return record;
    },
    async fail(id: string, errorCode: string, at: string) {
      const record = records.find((item) => item.id === id)!;
      record.status = "failed"; record.errorCode = errorCode; record.completedAt = at;
      return record;
    },
    async list(requirementId: string) { return records.filter((item) => item.requirementId === requirementId).sort((a, b) => b.version - a.version); },
    async expireStaleRunning() { return 0; },
  };
  const fetcher = async (_url: string, init?: RequestInit) => {
    calls += 1;
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ role: string; content: string }> };
    modelInput = { system: parsed.messages[0]?.content, user: parsed.messages[1]?.content };
    if (options.failFetch) throw options.failFetch;
    const status = options.status ?? 200;
    const payload = status >= 400 ? { error: "boom" } : { choices: [{ message: { content: typeof options.response === "string" ? options.response : JSON.stringify(options.response ?? output()) } }] };
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  const runner = createPrdPromptRunner({
    prdPrompts: prdPrompts as never,
    config: { apiKey: "test-key", baseUrl: "https://ai.example", model: "stub", timeoutMs: 5_000, temperature: 0.2, promptVersion: "rq-prd-prompt-v1" },
    fetch: fetcher as never,
    now: () => new Date("2026-11-21T00:00:00.000Z"),
  });
  return { runner, records, get modelInput() { return modelInput; }, get calls() { return calls; } };
}

function baseRecord(): RequirementPrdPromptRecord {
  return { id: "prd-1", requirementId: "req-1", version: 1, status: "running", promptVersion: "rq-prd-prompt-v1", model: "stub", inputs: {}, output: null, errorCode: null, createdAt: "2026-11-21T00:00:00.000Z", completedAt: null };
}

test("生成成功：落 running→succeeded，返回结构化提示词与版本", async () => {
  const h = harness();
  const record = await h.runner.run({ requirement, assessment, investigationNotes: "访谈 5 位用户", actorId: "op" });
  assert.equal(record.status, "succeeded");
  assert.equal(record.version, 1);
  assert.equal((record.output as { prompt: string }).prompt.includes(PRD_PROMPT_SECTIONS[0]!), true);
  assert.equal(h.records[0]!.status, "succeeded");
  // 输入侧：调研结论原样落库，供版本回填。
  assert.equal((h.records[0]!.inputs as { investigationNotes: string }).investigationNotes, "访谈 5 位用户");
});

test("调研结论与需求事实发送前过 PII 掩码，提出人不进模型", async () => {
  const h = harness();
  await h.runner.run({ requirement, assessment, investigationNotes: "客户张三反馈（13800000000）", actorId: "op", piiMarkers: ["张三"] });
  const user = h.modelInput?.user ?? "";
  assert.equal(user.includes("张三"), false, "花名册姓名必须被掩码");
  assert.equal(user.includes("13800000000"), false);
  assert.equal(h.modelInput?.system?.includes("## 4. 十个章节"), true);
});

test("输出不合规（缺章节/过短/PII）落 failed/invalid_output，不写半成品", async () => {
  const cases: Array<{ name: string; value: unknown }> = [
    { name: "缺章节", value: output({ prompt: "## 角色与任务\n只有一章" }) },
    { name: "含裸 URL", value: output({ prompt: body("参考 https://example.com") }) },
    { name: "含邮箱", value: output({ openQuestions: ["联系 pm@example.com 确认"] }) },
  ];
  for (const item of cases) {
    const h = harness({ response: item.value });
    // 不合规一律抛 invalid_output（路由映射 503），同时落 failed 版本、不写半成品。
    await assert.rejects(() => h.runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" }),
      (error: unknown) => error instanceof PrdPromptFailure && error.code === "invalid_output", item.name);
    assert.equal(h.records[0]!.status, "failed", item.name);
    assert.equal(h.records[0]!.errorCode, "invalid_output", item.name);
    assert.equal(h.records[0]!.output, null, item.name);
  }
});

test("假设缺前缀时在成功路径上归一化为「假设：」", async () => {
  const h = harness({ response: output({ assumptions: ["地图数据可商用"] }) });
  const record = await h.runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" });
  assert.equal(record.status, "succeeded");
  assert.deepEqual((record.output as { assumptions: string[] }).assumptions, ["假设：地图数据可商用"]);
});

test("模型返回非 JSON 落 failed/invalid_output", async () => {
  const h = harness({ response: "这不是 JSON" });
  await assert.rejects(() => h.runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" }), (error: unknown) => error instanceof PrdPromptFailure && error.code === "invalid_output");
  assert.equal(h.records[0]!.errorCode, "invalid_output");
});

test("供应商 5xx 落 failed/provider_error", async () => {
  const h = harness({ status: 500 });
  await assert.rejects(() => h.runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" }), (error: unknown) => error instanceof PrdPromptFailure && error.code === "provider_error");
  assert.equal(h.records[0]!.status, "failed");
  assert.equal(h.records[0]!.errorCode, "provider_error");
});

test("请求超时落 failed/timeout", async () => {
  const h = harness({ failFetch: Object.assign(new Error("aborted"), { name: "AbortError" }) });
  await assert.rejects(() => h.runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" }), (error: unknown) => error instanceof PrdPromptFailure && error.code === "timeout");
  assert.equal(h.records[0]!.errorCode, "timeout");
});

test("同需求已有 running 版本时直接 409，不调模型、不建版本", async () => {
  const h = harness({ claim: "in_progress" });
  await assert.rejects(() => h.runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" }), (error: unknown) => error instanceof PrdPromptInProgressError);
  assert.equal(h.calls, 0);
  assert.equal(h.records.length, 0);
});

test("连续生成得到 v1/v2，旧版本不被覆盖", async () => {
  const h = harness();
  await h.runner.run({ requirement, assessment, investigationNotes: "第一版", actorId: "op" });
  await h.runner.run({ requirement, assessment, investigationNotes: "第二版", actorId: "op" });
  const listed = await (h as unknown as { records: RequirementPrdPromptRecord[] }).records;
  assert.deepEqual(listed.map((item) => item.version), [1, 2]);
  assert.equal((listed[0]!.inputs as { investigationNotes: string }).investigationNotes, "第一版");
  assert.equal((listed[1]!.inputs as { investigationNotes: string }).investigationNotes, "第二版");
});

test("调研结论超 8,000 字直接失败且不建版本", async () => {
  const h = harness();
  await assert.rejects(() => h.runner.run({ requirement, assessment, investigationNotes: "x".repeat(8_001), actorId: "op" }));
  assert.equal(h.records.length, 0);
  assert.equal(h.calls, 0);
});

test("validatePrdPromptOutput 接受合规输出并归一化假设前缀", () => {
  const result = validatePrdPromptOutput(output({ assumptions: ["地图数据可商用"] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.output?.assumptions, ["假设：地图数据可商用"]);
});

test("供应商 429/401/403/400 分别分类并保留 httpStatus，不折叠为 provider_error", async () => {
  const cases: Array<[number, string]> = [
    [429, "rate_limited"],
    [401, "auth_error"],
    [403, "auth_error"],
    [400, "request_error"],
  ];
  for (const [status, code] of cases) {
    const h = harness({ status });
    await assert.rejects(
      () => h.runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" }),
      (error: unknown) => error instanceof PrdPromptFailure && error.code === code && error.httpStatus === status,
      `HTTP ${status}`,
    );
    assert.equal(h.records[0]!.errorCode, code);
  }
});

test("响应体挂死时按 timeout 收尾，不永久阻塞", async () => {
  const records: RequirementPrdPromptRecord[] = [];
  const aborting = new AbortController();
  const runner = createPrdPromptRunner({
    prdPrompts: {
      async create(input: {
        requirementId: string;
        promptVersion: string;
        model: string;
        inputs: RequirementPrdPromptRecord["inputs"];
        at: string;
      }) {
        const rec: RequirementPrdPromptRecord = {
          id: "prd-stall", requirementId: input.requirementId, version: 1, status: "running",
          promptVersion: input.promptVersion, model: input.model, inputs: input.inputs, output: null, errorCode: null,
          createdAt: input.at, completedAt: null,
        };
        records.push(rec);
        return { outcome: "created" as const, record: rec };
      },
      async complete() { return null; },
      async fail(id: string, errorCode: string, at: string) {
        const rec = records.find((item) => item.id === id)!;
        rec.status = "failed"; rec.errorCode = errorCode; rec.completedAt = at;
        return rec;
      },
      async list() { return records; },
      async expireStaleRunning() { return 0; },
    } as never,
    config: { apiKey: "test-key", baseUrl: "https://ai.example", model: "stub", timeoutMs: 40, temperature: 0, promptVersion: "rq-prd-prompt-v1" },
    fetch: async (_url, init) => {
      init?.signal?.addEventListener("abort", () => aborting.abort());
      const stream = new ReadableStream({
        start(controller) {
          aborting.signal.addEventListener("abort", () =>
            controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => new Date("2026-11-21T00:00:00.000Z"),
  });
  await assert.rejects(
    () => runner.run({ requirement, assessment, investigationNotes: "", actorId: "op" }),
    (error: unknown) => error instanceof PrdPromptFailure && error.code === "timeout",
  );
  assert.equal(records[0]!.errorCode, "timeout");
});
