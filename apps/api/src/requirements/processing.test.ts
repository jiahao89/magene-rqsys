// V02-T01 接缝测试：收录后主流程共用模块（requirements/processing.ts）。
// 只测模块公共接口的行为——入队规则、掩码名单、版本守卫与推进编排；
// 完整 HTTP→worker→Base 链路由既有套件覆盖（T01-AC05），不在此重复。
import test from "node:test";
import assert from "node:assert/strict";
import { analysisPiiMarkers, createRequirementWorkflow, type RequirementWorkflowDeps, type TouchedRequirement } from "./processing.js";
import { isIntakeComplete } from "../domain/workflow.js";
import type { RequirementRecord } from "../domain/persistence.js";
import type { AiProvider, ProviderAnalysisInput } from "../analysis/provider.js";
import type { ValidatedAnalysis } from "../analysis/contract.js";

test("intake readiness covers TB synced and manual collected states", () => {
  assert.equal(isIntakeComplete("synced"), true);
  assert.equal(isIntakeComplete("collected"), true);
  for (const state of ["pending", "running", "failed"] as const) assert.equal(isIntakeComplete(state), false);
});

test("pii markers cover roster plus proposer and executor without duplicates or empties", () => {
  const markers = analysisPiiMarkers(
    { proposerName: "张三", executorName: "张三" },
    ["李四", "", "王五", "李四"],
  );
  assert.deepEqual(markers, ["李四", "王五", "张三"]);
});

function makeRequirement(id: string): RequirementRecord {
  return {
    id, platformRequirementId: "RQ-000001", sourceType: "teambition", sourceChannel: null, sourceConfigId: "source-1", teambitionRequirementId: `tb-${id}`, teambitionUniqueId: null,
    title: "需要报表", description: "用户张三希望导出报表", scope: "码表", acceptanceCriteria: null, productModel: "码表 C606", constraintNotes: "需兼容旧表带", requirementType: "体验优化", supplementUrl: "https://example.com/t/1?token=secret", intakeModule: null,
    proposerUserId: null, proposerName: "张三", executorUserId: null, executorName: null,
    sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null, attachmentRefs: [], sourceCustomFields: [], sourcePayload: {},
    sourceHash: "h", substantiveHash: "s1", sourceVersion: 1, latestBatchId: null, baseRecordId: null, lastPushedAt: null,
    pipeline: { pull: "synced", analysis: "pending", owner: "not_required", push: "pending" },
    manualOwner: null, lastPushedOwner: null, duplicateOfRequirementId: null,
    firstSeenAt: "2026-10-08T00:00:00.000Z", lastSeenAt: "2026-10-08T00:00:00.000Z", createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z",
  };
}

function analyzedResult(): ValidatedAnalysis {
  const dimension = { recommendation: "u", rationale: "r", evidence: ["需要报表"] };
  return {
    module: "报表分析", confidence: "中", confidence_reason: "r", evidence: ["需要报表"],
    recommendations: { user: dimension, market: dimension, business: dimension, technology: dimension },
    facts: [], inferences: [], missing_inputs: [], blind_spots: [], priority: null,
  };
}

type EnqueuedJob = { jobType: string; dedupeKey: string; payload: Record<string, unknown> };

function harness(options: { providerResult?: ValidatedAnalysis | Error } = {}) {
  const enqueued: EnqueuedJob[] = [];
  const analysisStates: string[] = [];
  let providerInput: ProviderAnalysisInput | null = null;
  const requirements = new Map([["req-1", makeRequirement("req-1")], ["req-2", makeRequirement("req-2")]]);
  const repositories = {
    requirements: {
      async get(id: string) { return requirements.get(id) ?? null; },
      async updateAnalysisState(_id: string, to: string) { analysisStates.push(to); },
      async setOwner() { throw new Error("not expected in these cases"); },
      async setPushState() {},
      async setBaseRecord() {},
    },
    sources: { async get() { return { id: "source-1", externalProjectId: "project-1", ownerNames: ["李四", "王五"] }; }, async list() { return []; }, async update() {}, async create() {} },
    dictionaries: { async list() { return [{ version: 3, status: "published", entries: ["报表分析"] }]; }, async get() { return null; }, async create() { throw new Error(); }, async publish() { throw new Error(); } },
    priorityRules: { async getPublished() { return null; }, async get() { return null; }, async list() { return []; }, async create() { throw new Error(); }, async publish() { throw new Error(); } },
    analyses: {
      async latest() { return null; },
      async listByRequirement() { return []; },
      async append(input: Record<string, unknown>) { return { status: "running", completedAt: null, result: null, safeErrorCode: null, safeErrorSummary: null, ...input, id: "run-1", analysisVersion: 1 }; },
      async complete(_id: string, result: Record<string, unknown>) { return { requirementId: "req-1", sourceVersion: 1, startedAt: "2026-10-08T00:00:00.000Z", provider: "stub", model: "stub", promptVersion: "p1", moduleDictionaryVersion: 3, priorityRuleVersionId: null, id: "run-1", analysisVersion: 1, ...result }; },
    },
    jobs: { async enqueue(job: EnqueuedJob) { enqueued.push(job); return {} as never; } },
    people: { async resolveActive() { return null; } },
    basePushes: { async findByIdempotencyKey() { return null; } },
    audit: { async append() {} },
    sourceSnapshots: { async getAtVersion() { return null; } },
  } as unknown as RequirementWorkflowDeps["repositories"];
  const deps: RequirementWorkflowDeps = {
    repositories,
    baseFields: { requirementId: "TB需求ID", owner: "执行人", source: {}, ai: {}, pm: [] },
    fixtureEnvironment: {},
    createProvider: () => ({
      name: "stub", model: "stub-model", promptVersion: "p1",
      async analyze(input: ProviderAnalysisInput) {
        providerInput = input;
        const result = options.providerResult;
        if (result instanceof Error) throw result;
        return result ?? analyzedResult();
      },
    }) satisfies AiProvider,
  };
  return { deps, enqueued, analysisStates, providerInput: () => providerInput };
}

const ofJobType = (list: EnqueuedJob[], jobType: string) => list.filter((job) => job.jobType === jobType);

test("dispatchAfterSync enqueues first analysis per source version and caps local development volume", async () => {
  const h = harness();
  const workflow = createRequirementWorkflow({ ...h.deps, analysisEnqueueCap: 1 });
  const touched: TouchedRequirement[] = [
    { id: "req-1", sourceVersion: 1, substantiveHash: "s1", analysisRequired: true },
    { id: "req-2", sourceVersion: 1, substantiveHash: "s1", analysisRequired: true },
    { id: "req-2", sourceVersion: 1, substantiveHash: "s1", analysisRequired: false },
  ];
  await workflow.dispatchAfterSync({ touched, actorId: "operator" });
  // 上限 1：第二条需分析的需求不再入队；首条按源版本幂等键入队。
  const analyses = ofJobType(h.enqueued, "analysis");
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0]!.dedupeKey, "analysis:req-1:v1");
  // 仅元数据变化的需求走推进：无 TB 负责人 → not_required → 直接入队 base_push。
  const pushes = ofJobType(h.enqueued, "base_push");
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.dedupeKey, "base-push:req-2:sv1:av0");
});

test("handleAnalysisJob masks roster and requester names before the model call and advances after terminal state", async () => {
  const h = harness();
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1", sourceVersion: 1, actorId: "operator" } });
  const input = h.providerInput();
  assert.ok(input);
  // 花名册 + 提出人进入掩码名单；正文中的姓名已被替换（工单 13 最小化）。
  assert.deepEqual([...input.piiMarkers].sort(), ["张三", "李四", "王五"].sort());
  assert.equal(input.title.includes("张三"), false);
  assert.equal(input.dictionary.modules.join(), "报表分析");
  // V02-T05-AC05：批准上下文（产品/边界）进入模型输入；需求类型与来源链接（敏感参数）不发送。
  assert.equal(input.context.includes("码表 C606"), true);
  assert.equal(input.context.includes("需兼容旧表带"), true);
  assert.equal(input.context.includes("体验优化"), false);
  assert.equal(input.context.includes("example.com"), false);
  assert.deepEqual(h.analysisStates, ["running", "analyzed"]);
  // 终态推进：AI 不是推送门槛，分析完成后立即入队 base_push（无负责人 → not_required 路径）。
  const pushes = ofJobType(h.enqueued, "base_push");
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.dedupeKey, "base-push:req-1:sv1:av1");
});

test("handleAnalysisJob with a failing provider still lands a retryable terminal state and queues the push", async () => {
  const h = harness({ providerResult: new Error("provider unavailable") });
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1" } });
  assert.deepEqual(h.analysisStates, ["running", "failed_retryable"]);
  assert.equal(ofJobType(h.enqueued, "base_push").length, 1);
});

test("handleAnalysisJob drops stale jobs whose substantive hash no longer matches", async () => {
  const h = harness();
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1", substantiveHash: "outdated" } });
  assert.deepEqual(h.analysisStates, []);
  assert.equal(h.providerInput(), null);
  assert.equal(ofJobType(h.enqueued, "base_push").length, 0);
});

test("handleBasePushJob without a configured transport fails fast instead of pretending", async () => {
  const h = harness();
  const workflow = createRequirementWorkflow(h.deps);
  await assert.rejects(() => workflow.handleBasePushJob({ payload: { requirementId: "req-1" } }), /not configured/);
});

test("handleBasePushJob drops jobs whose source version no longer matches", async () => {
  const h = harness();
  const workflow = createRequirementWorkflow({ ...h.deps, base: { push: async () => { throw new Error("must not be called"); } } as never });
  await workflow.handleBasePushJob({ payload: { requirementId: "req-1", sourceVersion: 99 } });
  // 未触碰外部 Base、未抛错：版本守卫直接返回。
});
