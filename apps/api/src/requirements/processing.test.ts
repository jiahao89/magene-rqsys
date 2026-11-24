// V02-T01 接缝测试：收录后主流程共用模块（requirements/processing.ts）。
// 只测模块公共接口的行为——入队规则、掩码名单、版本守卫与推进编排；
// 完整 HTTP→worker→Base 链路由既有套件覆盖（T01-AC05），不在此重复。
import test from "node:test";
import assert from "node:assert/strict";
import { analysisPiiMarkers, createRequirementWorkflow, enqueueSupersededPush, loadDirectoryRosterNames, resetRosterFailureThrottle, type RequirementWorkflowDeps, type TouchedRequirement } from "./processing.js";
import { FeishuApiError } from "../base/transport.js";
import { AiProviderError } from "../analysis/provider.js";
import { isIntakeComplete } from "../domain/workflow.js";
import type { AuditEventRecord, RequirementRecord } from "../domain/persistence.js";
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
    title: "需要报表", description: "用户张三希望导出报表", scope: "码表", acceptanceCriteria: null, productModel: "码表 C606", constraintNotes: "需兼容旧表带", requirementType: "体验优化", supplementUrl: "https://example.com/t/1?token=secret", intakeModule: null, audienceTags: [], audienceConfirmed: false, audienceVersion: 0,
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
    facts: [], inferences: [], missing_inputs: [], blind_spots: [], typeSuggestion: null, audience: [], priority: null,
  };
}

type EnqueuedJob = { jobType: string; dedupeKey: string; payload: Record<string, unknown> };

function harness(options: { providerResult?: ValidatedAnalysis | Error } = {}) {
  const enqueued: EnqueuedJob[] = [];
  const analysisStates: string[] = [];
  const closeCalls: Array<{ at: string; requirementId?: string }> = [];
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
      async closeSupersededRunning(at: string, requirementId?: string) { closeCalls.push({ at, ...(requirementId === undefined ? {} : { requirementId }) }); return 1; },
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
  return { deps, enqueued, analysisStates, closeCalls, providerInput: () => providerInput };
}


test("push compensation enqueues the current version when content advanced during the push", async () => {
  const h = harness();
  const current = { ...makeRequirement("req-1"), sourceVersion: 3, pipeline: { pull: "synced" as const, analysis: "analyzed" as const, owner: "not_required" as const, push: "pending" as const } };
  const repositories = {
    ...h.deps.repositories,
    requirements: { ...h.deps.repositories.requirements, get: async () => current },
    analyses: { ...h.deps.repositories.analyses, latest: async () => ({ status: "analyzed", analysisVersion: 3 }) as never },
  } as unknown as RequirementWorkflowDeps["repositories"];
  assert.equal(await enqueueSupersededPush({ repositories }, "req-1", 2, "operator"), true);
  assert.deepEqual(ofJobType(h.enqueued, "base_push").map((job) => job.dedupeKey), ["base-push:req-1:sv3:av3"]);
});

test("push compensation stays quiet when the version did not move or the analysis is not terminal", async () => {
  const h = harness();
  const sameVersion = { ...makeRequirement("req-1"), sourceVersion: 3, pipeline: { pull: "synced" as const, analysis: "pending" as const, owner: "not_required" as const, push: "pending" as const } };
  const repositories = {
    ...h.deps.repositories,
    requirements: { ...h.deps.repositories.requirements, get: async () => sameVersion },
    analyses: { ...h.deps.repositories.analyses, latest: async () => ({ status: "analyzed", analysisVersion: 3 }) as never },
  } as unknown as RequirementWorkflowDeps["repositories"];
  // 版本没变：不是被取代的推送，不补推。
  assert.equal(await enqueueSupersededPush({ repositories }, "req-1", 3, null), false);
  // 分析仍在跑：交给分析终态推进器，不抢先重复入队。
  const running = { ...sameVersion, sourceVersion: 4 };
  const runningRepositories = {
    ...h.deps.repositories,
    requirements: { ...h.deps.repositories.requirements, get: async () => running },
    analyses: { ...h.deps.repositories.analyses, latest: async () => ({ status: "running", analysisVersion: 3 }) as never },
  } as unknown as RequirementWorkflowDeps["repositories"];
  assert.equal(await enqueueSupersededPush({ repositories: runningRepositories }, "req-1", 2, null), false);
  assert.equal(ofJobType(h.enqueued, "base_push").length, 0);
});
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

test("no published scoring rule leaves an audit marker instead of dropping the AI scoring silently", async () => {
  const scoring = {
    inputs: { user: { pain: 3, frequency: 3 }, market: { sellingPoint: 2, competitor: 2 }, strategy: { roadmap: 2, dependency: 2 }, cost: { workload: 2, technicalRisk: 2, resource: 2 } },
    alpha: 1, safetyFlag: false, scoreConfidence: "中", scoreConfidenceReason: "r", basis: {}, rationale: "r",
  };
  const h = harness({ providerResult: { ...analyzedResult(), priority: null, scoring } as never });
  const audits: Array<Record<string, unknown>> = [];
  (h.deps.repositories.audit as unknown as { append: (event: Record<string, unknown>) => Promise<void> }).append = async (event) => { audits.push(event); };
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1", sourceVersion: 1, actorId: "operator" } });
  const marker = audits.find((event) => event.eventType === "scoring.suggested_skipped_no_rule");
  assert.ok(marker, "无规则时必须留一条审计");
  assert.deepEqual(marker!.safeDetails, { reason: "no_published_priority_rule", analysisVersion: 1 });
  assert.equal(marker!.result, "succeeded");
});

test("handleAnalysisJob with a failing provider still lands a retryable terminal state and queues the push", async () => {
  const h = harness({ providerResult: new Error("provider unavailable") });
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1" } });
  assert.deepEqual(h.analysisStates, ["running", "failed_retryable"]);
  assert.equal(ofJobType(h.enqueued, "base_push").length, 1);
});

test("a successful analysis closes superseded running rows for that requirement", async () => {
  const h = harness();
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1" } });
  assert.deepEqual(h.analysisStates, ["running", "analyzed"]);
  assert.equal(h.closeCalls.length, 1);
  assert.equal(h.closeCalls[0]?.requirementId, "req-1");
  assert.equal(Number.isNaN(Date.parse(h.closeCalls[0]!.at)), false);
});

test("a failed analysis does not close superseded running rows", async () => {
  const h = harness({ providerResult: new Error("provider unavailable") });
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1" } });
  assert.deepEqual(h.analysisStates, ["running", "failed_retryable"]);
  assert.equal(h.closeCalls.length, 0);
});

test("handleAnalysisJob drops stale jobs whose substantive hash no longer matches", async () => {
  const h = harness();
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1", substantiveHash: "outdated" } });
  assert.deepEqual(h.analysisStates, []);
  assert.equal(h.providerInput(), null);
  assert.equal(ofJobType(h.enqueued, "base_push").length, 0);
});

test("handleAnalysisJob force re-runs an already analyzed requirement and still skips the guard otherwise", async () => {
  // 回归：幂等守卫会短路"重跑分析"，导致 retry 请求返回 202 但实际不调用模型。
  // force=true 是人工重跑/补充上下文后重算的显式入口，必须绕过守卫并产生新的分析版本。
  const h = harness();
  const repositories = {
    ...h.deps.repositories,
    analyses: {
      ...h.deps.repositories.analyses,
      async latest() { return { status: "analyzed", sourceVersion: 1, analysisVersion: 1 } as never; },
    },
  } as unknown as RequirementWorkflowDeps["repositories"];
  const workflow = createRequirementWorkflow({ ...h.deps, repositories });

  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1" } });
  assert.deepEqual(h.analysisStates, [], "无 force 时幂等守卫直接返回，不调用模型");

  await workflow.handleAnalysisJob({ payload: { requirementId: "req-1", force: true } });
  assert.deepEqual(h.analysisStates, ["running", "analyzed"], "force=true 时真正重跑分析");
  assert.ok(h.providerInput(), "force 时必须实际调用模型");
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

test("handleBasePushJob only terminalizes non-retryable Base failures", async () => {
  // 回归：此前任何 FEISHU_* 错误都被当作永久失败，429/5xx/网络抖动也会终态。
  const failingWorkflow = (error: Error) => {
    const h = harness();
    const repositories = {
      ...h.deps.repositories,
      basePushes: {
        async findByIdempotencyKey() { return null; },
        async latestSuccessful() { return null; },
        async latest() { return null; },
        async append(input: Record<string, unknown>) { return { ...input, id: "push-run-1", status: "running", pushVersion: 1, baseRecordId: null, safeErrorCode: null, safeErrorSummary: null, completedAt: null }; },
        async updateResult() { return null; },
      },
      sourceSnapshots: { async getAtVersion() { return null; } },
    } as unknown as RequirementWorkflowDeps["repositories"];
    return createRequirementWorkflow({ ...h.deps, repositories, base: { push: async () => { throw error; } } as never });
  };
  const job = { payload: { requirementId: "req-1", sourceVersion: 1, analysisVersion: 0 } };
  for (const transient of [new FeishuApiError("http", "record update", 503), new TypeError("fetch failed")]) {
    await assert.rejects(
      () => failingWorkflow(transient).handleBasePushJob(job),
      (error: unknown) => !(error instanceof Error && error.name === "BasePushPermanentError") && /retry is available/.test(String((error as Error)?.message)),
    );
  }
  await assert.rejects(
    () => failingWorkflow(new FeishuApiError("api", "record create", undefined, 1254061)).handleBasePushJob(job),
    (error: unknown) => error instanceof Error && error.name === "BasePushPermanentError",
  );
});

test("V02-T14 handleKanoRunJob completes a run via a controlled provider and isolates the main pipeline", async () => {
  const h = harness();
  const kanoRuns = new Map<string, { id: string; status: string; requirementId: string; evidenceVersion: number; sourceVersion: number }>([["run-1", { id: "run-1", status: "running", requirementId: "req-1", evidenceVersion: 2, sourceVersion: 1 }]]);
  const evidenceVersions = [{ id: "ev-1", version: 2, title: "t", summary: "s", evidenceFragments: [{ ref: "S1", text: "x" }], coverageNotes: null, knownAudiences: [], knownScenes: null, interviewDate: null, sourceUrl: null, sourceSection: null, status: "approved", piiFlagged: false, createdBy: "m", createdAt: "2026-10-25T00:00:00.000Z", approvedBy: null, approvedAt: null }];
  const deps = {
    ...h.deps,
    createKanoProvider: () => ({
      model: "stub-kano",
      async run() {
        return { capabilities: [{ capability: "训练计划导出", audience: "L2", positiveQuestion: "p", negativeQuestion: "n", simulatedLeaning: { option: "喜欢", rationale: "r" }, candidateType: "期望型", explanation: "e", evidence: ["S1"] }], gaps: [], confidence: "中", confidenceReason: "r" };
      },
    }),
    repositories: {
      ...h.deps.repositories,
      requirements: {
        ...h.deps.repositories.requirements,
        getKanoRun: async (id: string) => kanoRuns.get(id) ? { id, requirementId: "req-1", runVersion: 1, status: kanoRuns.get(id)!.status, sourceVersion: 1, audienceSnapshot: { tags: [], confirmed: false }, evidenceVersion: 2, promptVersion: "rq-kano-v1", model: null, result: null, safeErrorCode: null, safeErrorSummary: null, createdBy: "op", createdAt: "2026-10-25T00:00:00.000Z", completedAt: null } : null,
        listKanoEvidence: async () => evidenceVersions,
        completeKanoRun: async (id: string) => { kanoRuns.set(id, { id, status: "succeeded", requirementId: "req-1", evidenceVersion: 2, sourceVersion: 1 }); return null; },
        failKanoRun: async (id: string) => { kanoRuns.set(id, { id, status: "failed", requirementId: "req-1", evidenceVersion: 2, sourceVersion: 1 }); return null; },
      },
    } as never,
  };
  const workflow = createRequirementWorkflow(deps);
  await workflow.handleKanoRunJob({ payload: { kanoRunId: "run-1", requirementId: "req-1" } });
  assert.equal(kanoRuns.get("run-1")?.status, "succeeded");
  // 主流程隔离：不产生主分析/推送作业，不改需求分析状态（AC07）
  assert.equal(ofJobType(h.enqueued, "analysis").length, 0);
  assert.equal(ofJobType(h.enqueued, "base_push").length, 0);
  assert.deepEqual(h.analysisStates, []);
});

test("V02-T14 handleKanoRunJob fails safely on invalid provider output without retrying", async () => {
  const h = harness();
  const statuses = new Map<string, string>([["run-2", "running"]]);
  const evidenceVersions = [{ id: "ev-1", version: 2, title: "t", summary: "s", evidenceFragments: [{ ref: "S1", text: "x" }], coverageNotes: null, knownAudiences: [], knownScenes: null, interviewDate: null, sourceUrl: null, sourceSection: null, status: "approved", piiFlagged: false, createdBy: "m", createdAt: "2026-10-25T00:00:00.000Z", approvedBy: null, approvedAt: null }];
  const deps = {
    ...h.deps,
    createKanoProvider: () => ({ model: "stub-kano", async run() { return { bogus: true }; } }),
    repositories: {
      ...h.deps.repositories,
      requirements: {
        ...h.deps.repositories.requirements,
        getKanoRun: async (id: string) => ({ id, requirementId: "req-1", runVersion: 2, status: statuses.get(id) ?? "running", sourceVersion: 1, audienceSnapshot: { tags: [], confirmed: false }, evidenceVersion: 2, promptVersion: "rq-kano-v1", model: null, result: null, safeErrorCode: null, safeErrorSummary: null, createdBy: "op", createdAt: "2026-10-25T00:00:00.000Z", completedAt: null }),
        listKanoEvidence: async () => evidenceVersions,
        completeKanoRun: async () => null,
        failKanoRun: async (id: string, code: string) => { statuses.set(id, "failed"); (deps as { lastCode?: string }).lastCode = code; return null; },
      },
    } as never,
  };
  const workflow = createRequirementWorkflow(deps);
  await workflow.handleKanoRunJob({ payload: { kanoRunId: "run-2" } });
  assert.equal(statuses.get("run-2"), "failed");
  // 作业本身按成功结算（不抛错 → worker 不自动重试）
});

test("AI 额度暂停期间 dispatchAfterSync 不入队首分析（I3-3）", async () => {
  const h = harness();
  const flags = {
    async get() { return { value: { until: new Date(Date.now() + 3_600_000).toISOString() }, updatedAt: new Date().toISOString() }; },
    async set() {},
  } as never;
  (h.deps.repositories as { flags?: unknown }).flags = flags;
  const workflow = createRequirementWorkflow(h.deps);
  await workflow.dispatchAfterSync({
    touched: [{ id: "req-1", sourceVersion: 1, substantiveHash: "s", analysisRequired: true }],
    actorId: "operator",
  });
  assert.equal(h.enqueued.filter((job) => job.jobType === "analysis").length, 0);
});

test("rate_limited 失败达到阈值时写入 AI 暂停标记（I3-3）", async () => {
  const h = harness({ providerResult: new AiProviderError("rate_limited", "HTTP 429") });
  let stored: Record<string, unknown> | null = null;
  const flags = {
    async get() { return stored ? { value: stored, updatedAt: new Date().toISOString() } : null; },
    async set(_name: string, value: Record<string, unknown>) { stored = value; },
  } as never;
  (h.deps.repositories as { flags?: unknown }).flags = flags;
  (h.deps.repositories.analyses as unknown as { countRecentFailures?: () => Promise<number> }).countRecentFailures = async () => 3;
  await createRequirementWorkflow(h.deps).handleAnalysisJob({ payload: { requirementId: "req-1" } });
  assert.equal((stored as Record<string, unknown> | null)?.["reason"], "ai_rate_limited");
});

test("group-pool Base push records base_config_missing and never falls back to the product table", async () => {
  // 0031：集团池独立 Base 表；缺配置时宁可这条推不上去，也不能写进产品 PM 表。
  const h = harness();
  const productPushes: unknown[] = [];
  const runs: Array<Record<string, unknown>> = [];
  const results: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let pushStateFailed = false;
  const repositories = {
    ...h.deps.repositories,
    sources: { async get() { return { id: "source-1", pool: "group", externalProjectId: "project-1", ownerNames: [] }; } },
    basePushes: {
      async latest() { return { pushVersion: 4 } as never; },
      async append(input: Record<string, unknown>) {
        runs.push(input);
        return { ...input, id: "push-run-1", status: "running", baseRecordId: null, safeErrorCode: null, safeErrorSummary: null, completedAt: null } as never;
      },
      async updateResult(id: string, result: Record<string, unknown>) { results.push({ id, ...result }); return null; },
      async findByIdempotencyKey() { return null; },
      async latestSuccessful() { return null; },
    },
    requirements: {
      ...h.deps.repositories.requirements,
      async setPushState(_id: string, state: string) { if (state === "failed") pushStateFailed = true; },
    },
    audit: { async append(event: Record<string, unknown>) { audits.push(event); } },
  } as unknown as RequirementWorkflowDeps["repositories"];
  const workflow = createRequirementWorkflow({
    ...h.deps,
    repositories,
    baseTargets: { product: { base: { push: async () => { productPushes.push("product"); throw new Error("must not be used"); } } as never, baseFields: h.deps.baseFields } },
  });

  await assert.rejects(
    () => workflow.handleBasePushJob({ payload: { requirementId: "req-1", sourceVersion: 1 } }),
    (error: unknown) => error instanceof Error && error.name === "BasePushPermanentError",
  );
  assert.equal(productPushes.length, 0, "集团池缺配置时绝不能把需求写进产品表");
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.pushVersion, 5);
  assert.equal(results[0]!.safeErrorCode, "base_config_missing");
  assert.equal(pushStateFailed, true);
  const audit = audits.find((event) => event.eventType === "base.push");
  assert.equal(audit?.result, "failed");
  assert.equal((audit?.safeDetails as Record<string, unknown>).errorClass, "base_config_missing");
  assert.equal((audit?.safeDetails as Record<string, unknown>).pool, "group");
});

test("group-pool Base push uses the group target, never the product adapter", async () => {
  const h = harness();
  const pushed: string[] = [];
  let usedFields: Record<string, unknown> | null = null;
  const repositories = {
    ...h.deps.repositories,
    sources: { async get() { return { id: "source-1", pool: "group", externalProjectId: "project-1", ownerNames: [] }; } },
    basePushes: {
      async findByIdempotencyKey() { return null; },
      async latestSuccessful() { return null; },
      async latest() { return null; },
      async append(input: Record<string, unknown>) { return { ...input, id: "push-run-2", status: "running", baseRecordId: null, safeErrorCode: null, safeErrorSummary: null, completedAt: null } as never; },
      async updateResult() { return null; },
    },
  } as unknown as RequirementWorkflowDeps["repositories"];
  const workflow = createRequirementWorkflow({
    ...h.deps,
    repositories,
    baseTargets: {
      product: { base: { push: async () => { pushed.push("product"); throw new Error("must not be used"); } } as never, baseFields: h.deps.baseFields },
      group: {
        base: { push: async () => { pushed.push("group"); usedFields = { sourceUrl: "TB链接" }; return { recordId: "rec-1", created: true, omittedFields: [] }; } } as never,
        baseFields: { ...h.deps.baseFields, source: { sourceUrl: "TB链接" } },
      },
    },
  });

  await workflow.handleBasePushJob({ payload: { requirementId: "req-1", sourceVersion: 1, analysisVersion: 0 } });
  assert.deepEqual(pushed, ["group"]);
  assert.deepEqual(usedFields, { sourceUrl: "TB链接" });
});

test("目录花名册读取失败写审计而不是静默降级为空名单", async () => {
  resetRosterFailureThrottle();
  const audits: AuditEventRecord[] = [];
  const failing = { directory: { async listPeople(): Promise<Array<{ name: string }>> { throw new TypeError("directory down"); } }, audit: { async append(event: AuditEventRecord) { audits.push(event); } } as never };
  assert.deepEqual(await loadDirectoryRosterNames(failing), []);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.eventType, "analysis.roster_unavailable");
  assert.equal(audits[0]!.result, "failed");
  assert.deepEqual(audits[0]!.safeDetails, { stage: "roster", reason: "directory_read_failed", errorClass: "TypeError" });

  // 节流窗口内再次失败不重复写审计；正常读取返回姓名并过滤空名。
  assert.deepEqual(await loadDirectoryRosterNames(failing), []);
  assert.equal(audits.length, 1);
  assert.deepEqual(await loadDirectoryRosterNames({ directory: { async listPeople() { return [{ name: "张三" }, { name: "" }]; } } }), ["张三"]);
});

test("撤销负责人的 base_push 作业把 clearOwner 传给 Base 适配器", async () => {
  // 冒烟回归：撤销后 Base 执行人残留，收件人也跟着残留。
  const h = harness();
  const seen: Array<Record<string, unknown>> = [];
  const repositories = {
    ...h.deps.repositories,
    basePushes: {
      async findByIdempotencyKey() { return null; },
      async latestSuccessful() { return null; },
      async latest() { return null; },
      async append(input: Record<string, unknown>) { return { ...input, id: "push-run-1", status: "running", pushVersion: 1, baseRecordId: null, safeErrorCode: null, safeErrorSummary: null, completedAt: null }; },
      async updateResult() { return null; },
    },
    sourceSnapshots: { async getAtVersion() { return null; } },
  } as unknown as RequirementWorkflowDeps["repositories"];
  const workflow = createRequirementWorkflow({ ...h.deps, repositories, base: { push: async (input: Record<string, unknown>) => { seen.push(input); return { recordId: "record-1", created: false, omittedFields: [] }; } } as never });
  await workflow.handleBasePushJob({ payload: { requirementId: "req-1", sourceVersion: 1, analysisVersion: 0, idempotencyKey: "push:req-1:v1", clearOwner: true } });
  assert.equal(seen[0]?.clearOwner, true);
});
