// 一次性诊断脚本：用线上同一 prompt/模型/参数复现评估路径的 analysis_failure 子类型。
// 不进产品代码；跑完删除。密钥只从 /tmp/rqenv/.env.local 读取，不打印。
import { readFileSync, writeFileSync } from "node:fs";
import { createAssessmentRunner } from "../apps/api/src/assessment/service.js";
import type { RequirementRecord, AnalysisRunRecord, RequirementAssessmentRecord } from "../apps/api/src/domain/persistence.js";

const envText = readFileSync("/tmp/rqenv/.env.local", "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

const requirement = {
  id: "repro-req",
  title: "验收测试：手工录入需求（可忽略）",
  description: "用于验证 web_manual 需求不显示重复处理区块，验证后可由 PM 手动忽略。",
  scope: null,
  acceptanceCriteria: null,
  sourceChannel: "终端用户",
  productModel: null,
  requirementType: null,
  constraintNotes: null,
  intakeModule: null,
} as unknown as RequirementRecord;

const structured = JSON.parse(readFileSync("/tmp/rqenv/analysis-v9.json", "utf8"));
const analysis = {
  status: "analyzed",
  structuredResult: structured,
  moduleSuggestion: "无法识别",
  confidenceReason: "源文本自述为手工录入的验收测试条目并标注可忽略，不含任何产品功能信息，无法映射到受控模块。",
} as unknown as AnalysisRunRecord;

const inputs = {
  background: "DeepSeek 切换后验收：一条手工录入的测试需求，用于验证 AI 评估链路是否可用。",
  goal: "确认生成评估不报错、能落库，且内容是完整结论而不是空壳。",
  scenario: "测试人员在线上验收页依次点击重新分析、生成评估、生成 PRD 提示词时使用。",
};

let seq = 0;
const results: unknown[] = [];
const rawBodies: string[] = [];

const loggedFetch: typeof fetch = async (input, init) => {
  const started = Date.now();
  const response = await fetch(input, init);
  const clone = response.clone();
  const text = await clone.text();
  rawBodies.push(JSON.stringify({ status: response.status, ms: Date.now() - started, body: text.slice(0, 20000) }));
  return response;
};

const repo = {
  async create() {
    seq += 1;
    const record = {
      id: `repro-${seq}`, requirementId: requirement.id, version: seq, status: "running",
      promptVersion: "rq-assessment-v1", model: process.env.AI_MODEL ?? null, inputs,
      createdBy: "repro", createdAt: new Date().toISOString(), completedAt: null, output: null, errorCode: null,
    } as unknown as RequirementAssessmentRecord;
    return { outcome: "created" as const, record };
  },
  async complete(id: string, output: Record<string, unknown>) {
    return { id, status: "succeeded", output } as unknown as RequirementAssessmentRecord;
  },
  async fail(id: string, errorCode: string) {
    return { id, status: "failed", errorCode } as unknown as RequirementAssessmentRecord;
  },
  async list() { return []; },
  async expireStaleRunning() { return 0; },
};

const runner = createAssessmentRunner({ assessments: repo as never, fetch: loggedFetch });

const rounds = Number(process.argv[2] ?? 6);
for (let i = 0; i < rounds; i += 1) {
  const started = Date.now();
  try {
    const record = await runner.run({ requirement, inputs, actorId: "repro", analysis });
    results.push({ round: i + 1, ok: true, ms: Date.now() - started, outputKeys: Object.keys(record.output ?? {}) });
  } catch (error) {
    const err = error as Error & { code?: string; fields?: string[] };
    results.push({ round: i + 1, ok: false, ms: Date.now() - started, code: err.code ?? null, name: err.name, message: err.message, fields: err.fields ?? null });
  }
  writeFileSync("/tmp/rqenv/repro-results.json", JSON.stringify(results, null, 2));
  writeFileSync("/tmp/rqenv/repro-bodies.json", JSON.stringify(rawBodies, null, 2));
}

console.log(JSON.stringify(results, null, 2));
