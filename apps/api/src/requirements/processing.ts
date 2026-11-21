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
  RequirementScoringRepository,
  RequirementQueryRepository,
  SourceConfigRepository,
  SourceSnapshotRepository,
  SystemFlagRepository,
} from "../application/repositories.js";
import type { RequirementRecord, SourcePool } from "../domain/persistence.js";
import { randomUUID } from "node:crypto";
import { computeUmcScore } from "../analysis/scoring.js";
import { DEFAULT_FUNCTION_MODULES } from "../domain/team-directory.js";
import { analysisModelContext } from "../analysis/context.js";
import { AnalysisRepositoryAdapter } from "../analysis/repository-adapter.js";
import { buildPriorityRule } from "../analysis/priority-rule.js";
import { runAnalysis } from "../analysis/service.js";
import { createDeepSeekProvider, type AiProvider } from "../analysis/provider.js";
import { createAnalysisAdvancer, createSourceMetadataAdvancer } from "../pipeline/advance.js";
import { createBasePushService, type BasePushServiceDeps } from "../base/push-service.js";
import { basePushIdempotencyKey } from "../jobs/idempotency.js";
import { KANO_PROMPT_VERSION, buildKanoRequest, createDeepSeekKanoProvider, kanoPrompt, validateKanoReport, KanoProviderError } from "../beta/kano.js";
import type { FeishuBasePushAdapter } from "../base/client.js";
import { noteAiQuotaFailure, readAiPause } from "../ops/ai-pause.js";
import type { OpsAlertConfig } from "../ops/alerts.js";

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
    scoring?: RequirementScoringRepository;
    analyses: AnalysisRunRepository;
    jobs: PipelineJobRepository;
    people: PersonMappingRepository;
    basePushes: BasePushRunRepository;
    audit: AuditEventRepository;
    sourceSnapshots: SourceSnapshotRepository;
    // V02-S02：团队目录花名册——手工需求无来源配置时掩码线索的唯一来源，不得跳过。
    directory?: { listPeople(): Promise<Array<{ name: string }>> };
    // I3-3：全局开关（AI 额度暂停）。缺省时不做暂停判定（测试/本地无表兼容）。
    flags?: SystemFlagRepository;
  };
  /** I3-3：额度暂停告警通道；未配置 webhook 时仍会暂停，只是不发送。 */
  opsAlerts?: { config: OpsAlertConfig; fetcher?: typeof fetch };
  /** I3-3：暂停阈值（组合根从环境变量读取）。 */
  aiPause?: { threshold?: number; windowMinutes?: number; pauseMinutes?: number };
  /** Base 传输与字段映射由组合根按环境装配；缺省（本地无 Base 凭据）时仅推送作业不可用。 */
  base?: FeishuBasePushAdapter | undefined;
  baseFields: BasePushServiceDeps["baseFields"];
  /**
   * 0031：按池选择 Base 目标（产品池 / 集团池各自一张表）。
   * 未提供时退回单一 `base`（旧装配/测试）；提供了但缺该池条目时，推送失败记 base_config_missing，
   * **绝不回落到另一个池的表**。
   */
  baseTargets?: Partial<Record<SourcePool, { base: FeishuBasePushAdapter; baseFields: BasePushServiceDeps["baseFields"] }>>;
  /** 夹具守卫环境（各组合根从同一组环境变量构建，作业体在每个外部调用前复检）。 */
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

/** 目录读取失败留痕的节流窗口：目录长时间不可用时不要每条需求刷一条审计/日志。 */
const ROSTER_FAILURE_THROTTLE_MS = 5 * 60_000;
let lastRosterFailureAt = 0;

/** 测试用：重置节流状态，避免模块级状态让用例互相影响。 */
export function resetRosterFailureThrottle(): void {
  lastRosterFailureAt = 0;
}

/**
 * 团队目录花名册（PII 掩码名单）。手工需求没有来源配置，目录是掩码线索的唯一来源。
 * 读取失败不阻断分析/评估，但**不再静默**：写一条审计并按进程节流打一行 stderr，
 * 让「掩码覆盖降级」在运维侧可见（否则姓名会以原始文本进入模型）。
 */
export async function loadDirectoryRosterNames(deps: {
  directory?: { listPeople(): Promise<Array<{ name: string | null }>> } | undefined;
  audit?: AuditEventRepository | undefined;
  log?: ((line: string) => void) | undefined;
  now?: (() => Date) | undefined;
}): Promise<string[]> {
  try {
    const people = await deps.directory?.listPeople() ?? [];
    return people.map((person) => person.name).filter((name): name is string => Boolean(name));
  } catch (error) {
    const nowMs = (deps.now ?? (() => new Date()))().getTime();
    const firstInWindow = nowMs - lastRosterFailureAt >= ROSTER_FAILURE_THROTTLE_MS;
    if (firstInWindow) lastRosterFailureAt = nowMs;
    const errorClass = String((error as { name?: unknown } | null)?.name ?? "Error");
    deps.log?.(`directory roster unavailable (${errorClass}); PII masking falls back to requirement names only`);
    if (firstInWindow && deps.audit) {
      try {
        await deps.audit.append({
          id: randomUUID(),
          actorId: null,
          eventType: "analysis.roster_unavailable",
          entityType: "team_directory",
          entityId: "roster",
          result: "failed",
          safeDetails: { stage: "roster", reason: "directory_read_failed", errorClass },
          occurredAt: new Date(nowMs).toISOString(),
        });
      } catch { /* 审计失败不阻断分析；掩码仍按剩余名单执行 */ }
    }
    return [];
  }
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

  /** 掩码名单 = 团队目录花名册（+TB 来源花名册，由调用方并入）。失败留痕由 loadDirectoryRosterNames 负责。 */
  async function loadRosterNames(): Promise<string[]> {
    return loadDirectoryRosterNames({ directory: deps.repositories.directory, audit: deps.repositories.audit, log });
  }

  // I3-3：自动分析入队前读取一次暂停状态（按 tick 读一次，避免逐条查库）。
  async function analysisPausedAt(now: Date): Promise<boolean> {
    return (await readAiPause(deps.repositories.flags, now)).paused;
  }

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
      // I3-3：额度暂停期间不自动入队首分析；需求保持 pending，恢复后由补排器接手。
      const paused = await analysisPausedAt(new Date(now));
      let queued = 0;
      for (const touched of input.touched) {
        const current = await deps.repositories.requirements.get(touched.id);
        if (!current) continue;
        if (touched.analysisRequired) {
          if (paused) continue;
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
      // 重复/忽略已确认：不进入 AI 分析（作业可能早于决策入队，这里再拦一次）。
      if ((requirement.processingState ?? "active") !== "active") return;
      const expectedSubstantiveHash = job.payload.substantiveHash;
      if (typeof expectedSubstantiveHash === "string" && expectedSubstantiveHash !== requirement.substantiveHash) return;
      // 手工来源没有 TB 来源配置：不依赖它加载（V02-T04 起花名册改由团队目录提供）。
      const source = requirement.sourceConfigId ? await deps.repositories.sources.get(requirement.sourceConfigId) : null;
      if (requirement.sourceConfigId && !source) throw new Error("Analysis source configuration was not found");
      const rosterNames = [...new Set([...(source?.ownerNames ?? []), ...(await loadRosterNames())])];
      const dictionary = await loadPublishedDictionary();
      const priorityRule = await loadPriorityRule();
      // 幂等前置检查：同一 sourceVersion 已有成功分析时不再重复调用模型（worker 重试/租约接管都会走到这里）。
      // force=true 用于人工发起的"重跑分析"（重新校准评分/补充上下文后复算）：跳过该检查产生新分析版本。
      const latestRun = await deps.repositories.analyses.latest(requirement.id);
      if (job.payload.force !== true && latestRun?.status === "analyzed" && latestRun.sourceVersion === requirement.sourceVersion) return;
      const provider = createProvider();
      await deps.repositories.requirements.updateAnalysisState(requirement.id, "running");
      const run = await runAnalysis({
        requirementId: requirement.id, sourceVersion: requirement.sourceVersion, sourcePersisted: true,
        title: requirement.title, description: requirement.description ?? "", context: analysisModelContext(requirement),
        piiMarkers: analysisPiiMarkers(requirement, rosterNames),
        dictionary, priorityRule,
      }, { repository: new AnalysisRepositoryAdapter(deps.repositories.analyses), provider });
      // V02-S06：分析成功且评分合法时，落 AI 建议版本；评分持久化失败不改变主分析终态。
      if (run.status === "analyzed" && run.result?.scoring && run.result.priority && deps.repositories.scoring) {
        try {
          const computed = computeUmcScore(run.result.scoring.inputs, run.result.scoring.alpha);
          await deps.repositories.scoring.createAi({
            requirementId: requirement.id,
            sourceVersion: run.sourceVersion,
            analysisVersion: run.analysisVersion,
            ruleVersionId: priorityRule?.id ?? null,
            inputs: run.result.scoring.inputs as unknown as Record<string, unknown>,
            alpha: run.result.scoring.alpha,
            score: computed.score,
            priority: run.result.priority,
            scoreConfidence: run.result.scoring.scoreConfidence,
            scoreConfidenceReason: run.result.scoring.scoreConfidenceReason,
            safetyFlag: run.result.scoring.safetyFlag,
            basis: run.result.scoring.basis as unknown as Record<string, unknown>,
            rationale: run.result.scoring.rationale,
            auditEvent: { id: randomUUID(), actorId: typeof job.payload.actorId === "string" ? job.payload.actorId : null, eventType: "scoring.suggested", entityType: "requirement", result: "succeeded", safeDetails: { scoreVersion: run.analysisVersion, score: computed.score, priority: run.result.priority }, occurredAt: new Date().toISOString() },
          });
        } catch (cause) {
          log(`scoring suggestion persistence failed for ${requirement.id}: ${(cause as Error)?.name ?? "unknown"}`);
        }
      } else if (run.status === "analyzed" && run.result?.scoring && !run.result.priority) {
        // 没有已发布评分规则时按口径不落评分建议，但要留痕：否则运维分不清「AI 没给分」和「给了但没落库」。
        try {
          await deps.repositories.audit.append({
            id: randomUUID(),
            actorId: typeof job.payload.actorId === "string" ? job.payload.actorId : null,
            eventType: "scoring.suggested_skipped_no_rule",
            entityType: "requirement",
            entityId: requirement.id,
            result: "succeeded",
            safeDetails: { reason: "no_published_priority_rule", analysisVersion: run.analysisVersion },
            occurredAt: new Date().toISOString(),
          });
        } catch { /* 留痕失败不改变分析终态 */ }
      }
      // I3-3：额度耗尽（429）在窗口内达到阈值时暂停自动分析入队并告警；失败不影响主链路。
      if (run.status !== "analyzed" && run.safeErrorCode === "rate_limited") {
        try {
          await noteAiQuotaFailure({
            analyses: deps.repositories.analyses, flags: deps.repositories.flags,
            audit: deps.repositories.audit, now: new Date(),
            ...(deps.opsAlerts ? { alerts: deps.opsAlerts } : {}),
            ...(deps.aiPause ?? {}),
          });
        } catch (cause) {
          log(`ai quota pause check failed: ${(cause as Error)?.name ?? "unknown"}`);
        }
      }
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
      // 作业 max_attempts=1 且不自动重试：任何失败都必须落到 run.failed，
      // 否则运行永久停在 running、需求 Kano 功能被活动守卫锁死（复查 #2）。
      const failSafe = async (code: string, summary: string): Promise<void> => {
        try { await deps.repositories.requirements.failKanoRun?.(runId, code, summary); }
        catch (cause) { log(`kano run ${runId} failed to record failure: ${(cause as Error)?.name ?? "unknown"}`); }
      };
      try {
        const run = await deps.repositories.requirements.getKanoRun?.(runId);
        if (!run || run.status !== "running") return;
        const requirement = await deps.repositories.requirements.get(run.requirementId);
        if (!requirement) { await failSafe("KANO_REQUIREMENT_MISSING", "Kano requirement was not found."); return; }
          const evidence = ((await deps.repositories.requirements.listKanoEvidence?.() ?? []).find((version) => version.version === run.evidenceVersion)) ?? null;
        // 输入门禁：资料必须仍是 approved 且未标记 PII（导入后被退休/标记的版本不再可用）。
        if (!evidence || evidence.status !== "approved" || evidence.piiFlagged) {
          await failSafe("KANO_EVIDENCE_UNAVAILABLE", "选定资料版本不可用（未批准或含未脱敏内容）。");
          return;
        }
        // Kano 与主分析共用同一套掩码名单（目录 + TB 来源花名册），避免来源姓名漏码。
        const kanoSource = requirement.sourceConfigId ? await deps.repositories.sources.get(requirement.sourceConfigId) : null;
        const markers = analysisPiiMarkers(requirement, [...new Set([...(kanoSource?.ownerNames ?? []), ...(await loadRosterNames())])]);
        const provider = (deps.createKanoProvider ?? (() => createDeepSeekKanoProvider()))();
        const raw = await provider.run(kanoPrompt(buildKanoRequest(
          { title: requirement.title, description: requirement.description, audienceTags: requirement.audienceTags, audienceConfirmed: requirement.audienceConfirmed, piiMarkers: markers },
          { version: evidence.version, title: evidence.title, summary: evidence.summary, evidenceFragments: evidence.evidenceFragments, coverageNotes: evidence.coverageNotes, knownAudiences: evidence.knownAudiences },
        )));
        const report = validateKanoReport(raw, { version: evidence.version, title: evidence.title, summary: evidence.summary, evidenceFragments: evidence.evidenceFragments, coverageNotes: evidence.coverageNotes, knownAudiences: evidence.knownAudiences });
        // 报告层永远标记 AI 假设（待验证）；PM 复核是独立动作，不在此实现。
        await deps.repositories.requirements.completeKanoRun?.(runId, { ...report, researchStatus: "AI假设（待验证）", promptVersion: run.promptVersion, evidenceVersion: run.evidenceVersion }, provider.model);
      } catch (error) {
        const code = error instanceof KanoProviderError ? `KANO_${error.code.toUpperCase()}` : error instanceof Error && error.name === "ZodError" ? "KANO_INVALID_OUTPUT" : "KANO_FAILED";
        const summary = error instanceof KanoProviderError ? error.message : "Kano run failed; manual retry is available.";
        await failSafe(code, summary);
        // 作业按成功结算（不自动重试，绝不触碰主分析/推送/通知状态）；用户手动重跑生成新版本。
      }
    },

    /** base_push 作业体：夹具守卫与版本守卫后经推送服务幂等执行；记账失败不重推外部。 */
    async handleBasePushJob(job: { payload: Record<string, unknown> }): Promise<void> {
      const requirementId = job.payload.requirementId;
      if (typeof requirementId !== "string") throw new Error("Invalid base_push job payload");
      const requirement = await deps.repositories.requirements.get(requirementId);
      if (!requirement) throw new Error("Base push requirement was not found");
      // 重复/忽略已确认：不推送 Base、不生成通知。
      if ((requirement.processingState ?? "active") !== "active") return;
      // TB 行推送使用来源项目 ID 作为 Base 项目字段；手工行无来源配置，
      // 平台键切换前的过渡空值由 V02-T03 以需求平台 ID 替代。
      const source = requirement.sourceConfigId ? await deps.repositories.sources.get(requirement.sourceConfigId) : null;
      if (requirement.sourceConfigId && !source?.externalProjectId) throw new Error("Base push source project is not configured");
      // 0031：按需求归属池选择 Base 表；集团池未配置时记 base_config_missing 并终态，绝不回落产品表。
      const pool: SourcePool = (source?.pool ?? "product");
      const target = deps.baseTargets
        ? deps.baseTargets[pool] ?? null
        : (deps.base ? { base: deps.base, baseFields: deps.baseFields } : null);
      if (!target) return failBaseConfigMissing(deps, requirement, job, pool);
      const expectedSourceVersion = job.payload.sourceVersion;
      if (typeof expectedSourceVersion === "number" && expectedSourceVersion !== requirement.sourceVersion) return;
      const latestAnalysis = await deps.repositories.analyses.latest(requirement.id);
      const expectedAnalysisVersion = job.payload.analysisVersion;
      if (typeof expectedAnalysisVersion === "number" && expectedAnalysisVersion !== (latestAnalysis?.analysisVersion ?? 0)) return;
      const service = createBasePushService({
        requirements: deps.repositories.requirements, people: deps.repositories.people, basePushes: deps.repositories.basePushes,
        audit: deps.repositories.audit, analyses: deps.repositories.analyses, ...(deps.repositories.scoring ? { scoring: deps.repositories.scoring } : {}), sourceSnapshots: deps.repositories.sourceSnapshots,
        base: target.base, sourceProjectId: source?.externalProjectId ?? "", baseFields: target.baseFields, pool, actorId: typeof job.payload.actorId === "string" ? job.payload.actorId : null,
      });
      const idempotencyKey = typeof job.payload.idempotencyKey === "string"
        ? job.payload.idempotencyKey
        : basePushIdempotencyKey(requirementId, requirement.sourceVersion, latestAnalysis?.analysisVersion ?? 0);
      const outcome = await service.pushRequirement(requirementId, idempotencyKey);
      // 推送期间内容前进（例如 A→B→A 的竞态）：本次推的是旧版本，为当前版本补一次入队。
      try {
        await enqueueSupersededPush(deps, requirementId, requirement.sourceVersion, typeof job.payload.actorId === "string" ? job.payload.actorId : null);
      } catch (cause) {
        log(`superseded base push compensation failed for ${requirementId}: ${(cause as Error)?.name ?? "unknown"}`);
      }
      if (outcome.kind === "error") {
        // 只有确定不可重试的失败（字段/权限/4xx/响应无法判定）才判终态；
        // 网络、429、5xx 等瞬时故障必须交回重试策略，否则一次抖动会把需求永久标记为推送失败。
        if (!outcome.retryable) {
          const permanent = new Error("Base push failed permanently; fix the Base configuration or data and retry manually.");
          permanent.name = "BasePushPermanentError";
          throw permanent;
        }
        throw new Error("Base push failed; retry is available.");
      }
      // Base 行已写成功、仅本地记账失败：作业按成功处理，绝不重推外部（会重复写 Base）。
      if (outcome.kind === "pushed_unrecorded") {
        log(`base push wrote record ${outcome.baseRecordId} but bookkeeping failed: ${outcome.detail}`);
      }
    },
  };
}

/**
 * 0031：目标池的 Base 未配置（当前只有集团池会走到）。
 * 记一次失败推送（base_config_missing）+ 审计 + 推送状态 failed，并抛永久失败让 worker 不再重试。
 * **绝不回落到产品池表**：宁可这一条推不上去，也不把集团需求写进产品 PM 表。
 */
async function failBaseConfigMissing(
  deps: RequirementWorkflowDeps,
  requirement: RequirementRecord,
  job: { payload: Record<string, unknown> },
  pool: SourcePool,
): Promise<never> {
  const completedAt = new Date().toISOString();
  const actorId = typeof job.payload.actorId === "string" ? job.payload.actorId : null;
  const idempotencyKey = typeof job.payload.idempotencyKey === "string"
    ? job.payload.idempotencyKey
    : basePushIdempotencyKey(requirement.id, requirement.sourceVersion, 0);
  try {
    const latest = await deps.repositories.basePushes.latest(requirement.id);
    const run = await deps.repositories.basePushes.append({
      requirementId: requirement.id, sourceVersion: requirement.sourceVersion,
      pushVersion: (latest?.pushVersion ?? 0) + 1, idempotencyKey, startedAt: completedAt,
    });
    await deps.repositories.basePushes.updateResult(run.id, {
      status: "failed", safeErrorCode: "base_config_missing",
      safeErrorSummary: "Base table is not configured for this requirement pool; push skipped.",
      completedAt,
    });
  } catch { /* 记账失败不掩盖"配置缺失"本身 */ }
  try { if (requirement.pipeline.push !== "failed") await deps.repositories.requirements.setPushState(requirement.id, "failed"); }
  catch { /* 推送状态是咨询性的：永久失败已由作业终态表达 */ }
  try {
    await deps.repositories.audit.append({
      id: randomUUID(), actorId, eventType: "base.push", entityType: "requirement", entityId: requirement.id, result: "failed",
      safeDetails: { sourceVersion: requirement.sourceVersion, errorClass: "base_config_missing", pool }, occurredAt: completedAt,
    });
  } catch { /* 审计失败不改变终态 */ }
  const error = new Error("Base push skipped: the target pool's Base table is not configured.");
  error.name = "BasePushPermanentError";
  throw error;
}

/** 推送期间内容前进了（同步把 push_state 重置为 pending）：为当前版本补入队一次推送，
 *  避免旧版本推送的完成态把 pending 覆盖后无人再推（A→B→A 竞态）。分析未到终态时交给分析终态推进器。 */
export async function enqueueSupersededPush(
  deps: { repositories: RequirementWorkflowDeps["repositories"] },
  requirementId: string,
  pushedSourceVersion: number,
  actorId: string | null,
): Promise<boolean> {
  const current = await deps.repositories.requirements.get(requirementId);
  if (!current || current.sourceVersion === pushedSourceVersion) return false;
  if (current.pipeline.push !== "pending") return false;
  const latest = await deps.repositories.analyses.latest(requirementId);
  if (!latest || (latest.status !== "analyzed" && latest.status !== "failed_retryable")) return false;
  await deps.repositories.jobs.enqueue({
    jobType: "base_push",
    dedupeKey: basePushIdempotencyKey(requirementId, current.sourceVersion, latest.analysisVersion),
    payload: { requirementId, actorId, sourceVersion: current.sourceVersion, analysisVersion: latest.analysisVersion },
    availableAt: new Date().toISOString(),
  });
  return true;
}

export type RequirementWorkflow = ReturnType<typeof createRequirementWorkflow>;
