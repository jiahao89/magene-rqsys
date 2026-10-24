// 收录后主流程（V02-T01 预重构）：安全分析输入准备与推进编排的共用实现。
// 根仓 server.ts 与妙搭 runtime.ts 的三个作业体在此收敛为一处业务行为；
// 平台启动、身份、数据库驱动、Base 传输装配与 worker 生命周期仍由各自组合根注入。
// 就绪判断（收录完成）见 domain/workflow.ts 的 isIntakeComplete：后台就绪基于来源事实
// 已持久化，T01 阶段仅 TB synced；V02-T02/T04 扩展手工来源的 collected 语义。

import type {
  AnalysisRunRepository,
  AuditEventRepository,
  BasePushRunRepository,
  ModuleDictionaryRepository,
  PersonMappingRepository,
  PipelineJobRepository,
  PriorityRuleRepository,
  RequirementQueryRepository,
  SourceConfigRepository,
  SourceSnapshotRepository,
} from "../application/repositories.js";
import type { RequirementRecord } from "../domain/persistence.js";
import { DEFAULT_FUNCTION_MODULES } from "../domain/team-directory.js";
import { analysisModelContext } from "../analysis/context.js";
import { AnalysisRepositoryAdapter } from "../analysis/repository-adapter.js";
import { buildPriorityRule } from "../analysis/priority-rule.js";
import { runAnalysis } from "../analysis/service.js";
import { createDeepSeekProvider, type AiProvider } from "../analysis/provider.js";
import { createAnalysisAdvancer, createSourceMetadataAdvancer } from "../pipeline/advance.js";
import { createBasePushService, type BasePushServiceDeps } from "../base/push-service.js";
import { basePushIdempotencyKey } from "../jobs/idempotency.js";
import { assertFixtureWorkAllowed, isSyntheticFixtureRequirement } from "../sync/test-fixture.js";
import { KANO_PROMPT_VERSION, buildKanoRequest, createDeepSeekKanoProvider, kanoPrompt, validateKanoReport, KanoProviderError } from "../beta/kano.js";
import type { FeishuBasePushAdapter } from "../base/client.js";

/** 同步批次触及的需求（来自 sync persistence；手工收录在 V02-T04 起复用同一形状）。 */
export interface TouchedRequirement {
  id: string;
  sourceVersion: number;
  substantiveHash: string;
  analysisRequired: boolean;
}

export interface RequirementWorkflowDeps {
  repositories: {
    requirements: RequirementQueryRepository;
    sources: SourceConfigRepository;
    dictionaries: ModuleDictionaryRepository;
    priorityRules: PriorityRuleRepository;
    analyses: AnalysisRunRepository;
    jobs: PipelineJobRepository;
    people: PersonMappingRepository;
    basePushes: BasePushRunRepository;
    audit: AuditEventRepository;
    sourceSnapshots: SourceSnapshotRepository;
  };
  /** Base 传输与字段映射由组合根按环境装配；缺省（本地无 Base 凭据）时仅推送作业不可用。 */
  base?: FeishuBasePushAdapter | undefined;
  baseFields: BasePushServiceDeps["baseFields"];
  /** 夹具守卫环境（各组合根从同一组环境变量构建，作业体在每个外部调用前复检）。 */
  fixtureEnvironment: NodeJS.ProcessEnv;
  /** 默认按环境构造 DeepSeek；测试可注入受控 provider。 */
  createProvider?: (() => AiProvider) | undefined;
  /** 入队分析上限（root 本地开发 RQSYS_MAX_ANALYSIS_PER_SYNC；0/缺省不限制）。 */
  analysisEnqueueCap?: number | undefined;
  /** 诊断日志出口（默认 stderr）：“外部写成功但本地记账失败”等信号经此落地。 */
  log?: ((line: string) => void) | undefined;
  /** V02-T14：Kano Beta provider；缺省按环境构造 DeepSeek（测试注入受控实现）。 */
  createKanoProvider?: (() => import("../beta/kano.js").KanoProvider) | undefined;
}

/**
 * 安全分析输入的掩码名单：来源花名册 + 需求提出人/执行人（工单 13 最小化规则）。
 * 用户 ID、联系方式、附件内容不进模型；同一姓名去重后按原顺序掩码。
 */
export function analysisPiiMarkers(
  requirement: Pick<RequirementRecord, "proposerName" | "executorName">,
  rosterNames: readonly string[],
): string[] {
  return [...new Set([...rosterNames, requirement.proposerName, requirement.executorName])]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function createRequirementWorkflow(deps: RequirementWorkflowDeps) {
  const log = deps.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const createProvider = deps.createProvider ?? (() => createDeepSeekProvider());
  const advanceAfterAnalysis = createAnalysisAdvancer({
    requirements: deps.repositories.requirements, people: deps.repositories.people,
    jobs: deps.repositories.jobs, audit: deps.repositories.audit,
  });
  const advanceAfterMetadataSync = createSourceMetadataAdvancer({
    requirements: deps.repositories.requirements, people: deps.repositories.people,
    jobs: deps.repositories.jobs, audit: deps.repositories.audit,
  });

  async function loadPublishedDictionary() {
    const published = (await deps.repositories.dictionaries.list()).find((version) => version.status === "published");
    return {
      version: published?.version ?? 0,
      modules: (published?.entries ?? DEFAULT_FUNCTION_MODULES).map((entry) => typeof entry === "string" ? entry : String((entry as { name?: unknown }).name ?? entry)),
    };
  }

  // 已发布规则接入确定性计算；规则 JSON 不符合契约时 buildPriorityRule 返回 null（优先级保持为空）。
  async function loadPriorityRule() {
    const ruleRecord = await deps.repositories.priorityRules.getPublished();
    return ruleRecord ? buildPriorityRule(ruleRecord) : null;
  }

  return {
    /**
     * 同步批次完成后的下游推进：需分析的需求按源版本幂等入队首分析；
     * 仅元数据变化的需求走源元数据推进（不产生新 AI 版本、不重置 PM 字段）。
     * 语义（工单 08/14 + V02-T01-AC02）：source_only 不触发任何下游，由调用方先行判断。
     */
    async dispatchAfterSync(input: { touched: readonly TouchedRequirement[]; actorId: string | null }): Promise<void> {
      const cap = deps.analysisEnqueueCap ?? 0;
      const now = new Date().toISOString();
      let queued = 0;
      for (const touched of input.touched) {
        const current = await deps.repositories.requirements.get(touched.id);
        if (!current) continue;
        if (touched.analysisRequired) {
          if (cap > 0 && queued >= cap) continue;
          queued += 1;
          await deps.repositories.jobs.enqueue({
            jobType: "analysis", dedupeKey: `analysis:${touched.id}:v${touched.sourceVersion}`,
            payload: { requirementId: touched.id, sourceVersion: touched.sourceVersion, substantiveHash: touched.substantiveHash, actorId: input.actorId }, availableAt: now,
          });
        } else {
          const latestAnalysis = await deps.repositories.analyses.latest(touched.id);
          await advanceAfterMetadataSync(touched.id, input.actorId, latestAnalysis?.analysisVersion ?? 0);
        }
      }
    },

    /** analysis 作业体：安全输入准备 → 运行 → 源版本守卫 → 终态推进。 */
    async handleAnalysisJob(job: { payload: Record<string, unknown> }): Promise<void> {
      const requirementId = job.payload.requirementId;
      if (typeof requirementId !== "string") throw new Error("Invalid analysis job payload");
      const requirement = await deps.repositories.requirements.get(requirementId);
      if (!requirement) throw new Error("Analysis requirement was not found");
      assertFixtureWorkAllowed({ sourceId: requirement.sourceConfigId ?? "", fixture: isSyntheticFixtureRequirement(requirement.teambitionRequirementId) }, deps.fixtureEnvironment, new Date());
      const expectedSubstantiveHash = job.payload.substantiveHash;
      if (typeof expectedSubstantiveHash === "string" && expectedSubstantiveHash !== requirement.substantiveHash) return;
      // 手工来源没有 TB 来源配置：不依赖它加载（V02-T04 起花名册改由团队目录提供）。
      const source = requirement.sourceConfigId ? await deps.repositories.sources.get(requirement.sourceConfigId) : null;
      if (requirement.sourceConfigId && !source) throw new Error("Analysis source configuration was not found");
      const dictionary = await loadPublishedDictionary();
      const priorityRule = await loadPriorityRule();
      const provider = createProvider();
      await deps.repositories.requirements.updateAnalysisState(requirement.id, "running");
      const run = await runAnalysis({
        requirementId: requirement.id, sourceVersion: requirement.sourceVersion, sourcePersisted: true,
        title: requirement.title, description: requirement.description ?? "", context: analysisModelContext(requirement),
        piiMarkers: analysisPiiMarkers(requirement, source?.ownerNames ?? []),
        dictionary, priorityRule,
      }, { repository: new AnalysisRepositoryAdapter(deps.repositories.analyses), provider });
      const current = await deps.repositories.requirements.get(requirement.id);
      if (!current || current.substantiveHash !== requirement.substantiveHash) return;
      await deps.repositories.requirements.updateAnalysisState(requirement.id, run.status === "analyzed" ? "analyzed" : "failed_retryable");
      // 工单 14：首次分析进入可见终态后继续负责人处理与 Base 推送——AI 不是推送门槛。
      await advanceAfterAnalysis(requirement.id, run.status === "analyzed" ? "analyzed" : "failed_retryable", typeof job.payload.actorId === "string" ? job.payload.actorId : null, run.analysisVersion);
    },

    /** V02-T14：kano_run 作业体。手动运行、输入快照来自 kano_runs 行；失败落 run.failed 且作业按成功
     *  结算（不自动重试，绝不触碰主分析/推送/通知状态）；用户手动重跑生成新版本。 */
    async handleKanoRunJob(job: { payload: Record<string, unknown> }): Promise<void> {
      const runId = job.payload.kanoRunId;
      if (typeof runId !== "string") throw new Error("Invalid kano_run job payload");
      const run = await deps.repositories.requirements.getKanoRun?.(runId);
      if (!run || run.status !== "running") return;
      const requirement = await deps.repositories.requirements.get(run.requirementId);
      if (!requirement) throw new Error("Kano requirement was not found");
      const evidence = ((await deps.repositories.requirements.listKanoEvidence?.() ?? []).find((version) => version.version === run.evidenceVersion)) ?? null;
      // 输入门禁：资料必须仍是 approved 且未标记 PII（导入后被退休/标记的版本不再可用）。
      if (!evidence || evidence.status !== "approved" || evidence.piiFlagged) {
        await deps.repositories.requirements.failKanoRun?.(runId, "KANO_EVIDENCE_UNAVAILABLE", "选定资料版本不可用（未批准或含未脱敏内容）。");
        return;
      }
      const provider = (deps.createKanoProvider ?? (() => createDeepSeekKanoProvider()))();
      try {
        const raw = await provider.run(kanoPrompt(buildKanoRequest(
          { title: requirement.title, description: requirement.description, audienceTags: requirement.audienceTags, audienceConfirmed: requirement.audienceConfirmed },
          { version: evidence.version, title: evidence.title, summary: evidence.summary, evidenceFragments: evidence.evidenceFragments, coverageNotes: evidence.coverageNotes, knownAudiences: evidence.knownAudiences },
        )));
        const report = validateKanoReport(raw, { version: evidence.version, title: evidence.title, summary: evidence.summary, evidenceFragments: evidence.evidenceFragments, coverageNotes: evidence.coverageNotes, knownAudiences: evidence.knownAudiences });
        // 报告层永远标记 AI 假设（待验证）；PM 复核是独立动作，不在此实现。
        await deps.repositories.requirements.completeKanoRun?.(runId, { ...report, researchStatus: "AI假设（待验证）", promptVersion: run.promptVersion, evidenceVersion: run.evidenceVersion }, provider.model);
      } catch (error) {
        const code = error instanceof KanoProviderError ? `KANO_${error.code.toUpperCase()}` : error instanceof Error && error.name === "ZodError" ? "KANO_INVALID_OUTPUT" : "KANO_FAILED";
        const summary = error instanceof KanoProviderError ? error.message : "Kano run failed; manual retry is available.";
        await deps.repositories.requirements.failKanoRun?.(runId, code, summary);
        // 作业按成功结算：Beta 失败不自动重试、不饿死主流程（AC02/AC07）。
      }
    },

    /** base_push 作业体：夹具守卫与版本守卫后经推送服务幂等执行；记账失败不重推外部。 */
    async handleBasePushJob(job: { payload: Record<string, unknown> }): Promise<void> {
      if (!deps.base) throw new Error("Base push transport is not configured");
      const requirementId = job.payload.requirementId;
      if (typeof requirementId !== "string") throw new Error("Invalid base_push job payload");
      const requirement = await deps.repositories.requirements.get(requirementId);
      if (!requirement) throw new Error("Base push requirement was not found");
      assertFixtureWorkAllowed({ sourceId: requirement.sourceConfigId ?? "", fixture: isSyntheticFixtureRequirement(requirement.teambitionRequirementId) }, deps.fixtureEnvironment, new Date());
      // TB 行推送使用来源项目 ID 作为 Base 项目字段；手工行无来源配置，
      // 平台键切换前的过渡空值由 V02-T03 以需求平台 ID 替代。
      const source = requirement.sourceConfigId ? await deps.repositories.sources.get(requirement.sourceConfigId) : null;
      if (requirement.sourceConfigId && !source?.externalProjectId) throw new Error("Base push source project is not configured");
      const expectedSourceVersion = job.payload.sourceVersion;
      if (typeof expectedSourceVersion === "number" && expectedSourceVersion !== requirement.sourceVersion) return;
      const latestAnalysis = await deps.repositories.analyses.latest(requirement.id);
      const expectedAnalysisVersion = job.payload.analysisVersion;
      if (typeof expectedAnalysisVersion === "number" && expectedAnalysisVersion !== (latestAnalysis?.analysisVersion ?? 0)) return;
      const service = createBasePushService({
        requirements: deps.repositories.requirements, people: deps.repositories.people, basePushes: deps.repositories.basePushes,
        audit: deps.repositories.audit, analyses: deps.repositories.analyses, sourceSnapshots: deps.repositories.sourceSnapshots,
        base: deps.base, sourceProjectId: source?.externalProjectId ?? "", baseFields: deps.baseFields, actorId: typeof job.payload.actorId === "string" ? job.payload.actorId : null,
      });
      const idempotencyKey = typeof job.payload.idempotencyKey === "string"
        ? job.payload.idempotencyKey
        : basePushIdempotencyKey(requirementId, requirement.sourceVersion, latestAnalysis?.analysisVersion ?? 0);
      const outcome = await service.pushRequirement(requirementId, idempotencyKey);
      if (outcome.kind === "error") throw new Error("Base push failed; retry is available.");
      // Base 行已写成功、仅本地记账失败：作业按成功处理，绝不重推外部（会重复写 Base）。
      if (outcome.kind === "pushed_unrecorded") {
        log(`base push wrote record ${outcome.baseRecordId} but bookkeeping failed: ${outcome.detail}`);
      }
    },
  };
}

export type RequirementWorkflow = ReturnType<typeof createRequirementWorkflow>;
