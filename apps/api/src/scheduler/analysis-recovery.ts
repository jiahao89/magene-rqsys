// 分析阶段自动恢复：把两类"没有人再管"的需求收敛回可执行状态，不需要人工点重试。
//
// 背景：线上 314 条需求里有 8 条没分析完——
//   1. analysis='failed_retryable'：可重试失败，但没有任何东西会去重试，永远停着；
//   2. analysis='running' 但对应作业已终态或不存在：handler 崩溃残留，状态永久卡住。
//
// 本模块只读需求/分析/作业/审计仓储，并在 domain/transitions 允许的迁移内落状态、补排作业；
// 不启动定时器、不调用模型、不碰同步/推送/通知语义。调用方（调度 poll）决定节奏并负责打日志。
//
// 幂等与防循环：
//   - 重试复用现有 dedupe key（analysis:<id>:sv<v>:after<pav>）；已有 queued/running 作业时跳过。
//     作业已终态失败时 enqueue 会复用同一 key（Postgres 仓储是 ON CONFLICT ...
//     WHERE status IN ('failed','cancelled')，把行重置回 queued），不会留下第二个作业。
//   - running 残留只在作业缺失/终态时回退；queued/running 且租约有效的作业一律不动。
//     仅当 running 作业租约已过期且 attempt_count 已用尽（claimNext 再也认领不了、complete 也没有
//     活着的进程能收尾）时，先用 complete 的 fencing 终结僵尸作业，再回退需求状态。
//   - 同一需求同一源版本累计自动调度重试上限 MAX_SCHEDULER_ANALYSIS_RETRIES；达到上限后写一条
//     result='failed' 的审计（reason='retry_budget_exhausted'）并停止自动重试，避免无限循环。
//   - 单条需求或单个阶段失败只进入 report.errors，绝不向调用方抛错，保证 poll 继续执行。

import { randomUUID } from "node:crypto";
import type {
  AnalysisRunRepository, AuditEventRepository, PipelineJobRepository, RequirementQueryRepository,
} from "../application/repositories.js";
import type { PipelineJobRecord, RequirementRecord } from "../domain/persistence.js";

/** 单轮扫描上限：避免一次 tick 拉太多需求。 */
export const ANALYSIS_RECOVERY_SCAN_LIMIT = 20;
/** 同一需求同一源版本累计自动调度重试上限；达到后放弃并留审计。 */
export const MAX_SCHEDULER_ANALYSIS_RETRIES = 3;
/** 审计反查窗口：调度重试预算按同一需求的历次调度重试事件累计（窗口内足够覆盖，见下方注释）。 */
const AUDIT_SCAN_LIMIT = 200;

/** 恢复逻辑只依赖的仓储切片，便于用内存桩做纯服务测试。 */
export type AnalysisRecoveryRepositories = {
  requirements: Pick<RequirementQueryRepository, "search" | "updateAnalysisState">;
  analyses: Pick<AnalysisRunRepository, "latest">;
  jobs: Pick<PipelineJobRepository, "findByDedupeKey" | "enqueue" | "complete">;
  audit: Pick<AuditEventRepository, "append" | "search">;
};

export type AnalysisRetryAction = "enqueued" | "skipped" | "exhausted";

export interface AnalysisRetryOutcome {
  requirementId: string;
  action: AnalysisRetryAction;
  /** enqueued/已存在作业等具体原因；调用方只用于日志与测试断言。 */
  reason: string;
  dedupeKey: string;
  priorAnalysisVersion: number;
}

export type AnalysisStuckAction = "reverted" | "skipped";

export interface AnalysisStuckOutcome {
  requirementId: string;
  action: AnalysisStuckAction;
  reason: "job_missing" | "job_terminal" | "job_live" | "job_reclaimed";
}

export interface AnalysisRecoveryReport {
  retried: AnalysisRetryOutcome[];
  recovered: AnalysisStuckOutcome[];
  /** 单条需求/单个阶段的异常。调用方只记录，不因此让整轮 poll 失败。 */
  errors: string[];
}

/** analysis 重试作业的 dedupe key；与手动重试端点保持同一格式。 */
export function analysisRetryDedupeKey(
  requirement: Pick<RequirementRecord, "id" | "sourceVersion">,
  priorAnalysisVersion: number,
): string {
  return `analysis:${requirement.id}:sv${requirement.sourceVersion}:after${priorAnalysisVersion}`;
}

/**
 * running 需求可能对应的作业键。正在运行的 handler 不会留下新键，只能在下面三种既有键里命中：
 *   - after<latest>     手动/自动重试按入队时的最新分析版本生成；
 *   - after<latest-1>   handler 已 append 新分析版本（latest 已 +1），但作业键仍是入队时的 prior；
 *   - v<sourceVersion>  同步链路首次入队用的历史键（首轮分析可能正在跑）。
 * 只看其中一种会把活着的分析误判成崩溃残留。
 */
export function analysisRunningJobKeys(
  requirement: Pick<RequirementRecord, "id" | "sourceVersion">,
  priorAnalysisVersion: number,
): string[] {
  const keys = [analysisRetryDedupeKey(requirement, priorAnalysisVersion)];
  if (priorAnalysisVersion > 0) keys.push(analysisRetryDedupeKey(requirement, priorAnalysisVersion - 1));
  keys.push(`analysis:${requirement.id}:v${requirement.sourceVersion}`);
  return [...new Set(keys)];
}

function isActiveJob(job: PipelineJobRecord | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function isLeaseActive(job: PipelineJobRecord, now: Date): boolean {
  return job.lockedUntil !== null && new Date(job.lockedUntil).getTime() > now.getTime();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

type AuditEvent = Awaited<ReturnType<AuditEventRepository["search"]>>[number];

/**
 * 调度重试预算：只累计 actorId=null、result=succeeded 的 analysis.retry_requested 事件，
 * 且限定在同一个 sourceVersion 内。源版本变化会把 analysis 重置为 pending，天然重新计预算；
 * 同一 sourceVersion 内 analyzed→failed_retryable 不是合法迁移，因此不会跨轮混算。
 * 手动重试（actorId 非空）与入队失败（result=failed）都不占自动重试预算。
 */
function countSchedulerRetries(events: AuditEvent[], sourceVersion: number): number {
  return events.filter((event) =>
    event.eventType === "analysis.retry_requested" &&
    event.actorId === null &&
    event.result === "succeeded" &&
    event.safeDetails["source"] === "scheduler" &&
    event.safeDetails["sourceVersion"] === sourceVersion,
  ).length;
}

/** 放弃标记按 (sourceVersion, priorAnalysisVersion) 去重：同一残局不反复写 failed 审计。 */
function hasExhaustionMarker(events: AuditEvent[], sourceVersion: number, priorAnalysisVersion: number): boolean {
  return events.some((event) =>
    event.eventType === "analysis.retry_requested" &&
    event.result === "failed" &&
    event.safeDetails["source"] === "scheduler" &&
    event.safeDetails["sourceVersion"] === sourceVersion &&
    event.safeDetails["priorAnalysisVersion"] === priorAnalysisVersion &&
    event.safeDetails["reason"] === "retry_budget_exhausted",
  );
}

/**
 * 第二件事：running 卡死自动恢复。
 * 作业不存在 / 已终态 → 回退 failed_retryable（状态机允许），下一轮由重试逻辑接手；
 * queued/running 的活作业（含租约过期但还有重试机会、会被 claimNext 重新认领的）一律不动。
 */
async function recoverStuckRunningAnalyses(
  repositories: AnalysisRecoveryRepositories,
  now: Date,
  limit: number,
): Promise<{ outcomes: AnalysisStuckOutcome[]; errors: string[] }> {
  const nowIso = now.toISOString();
  const page = await repositories.requirements.search({ analysisState: "running", limit });
  const outcomes: AnalysisStuckOutcome[] = [];
  const errors: string[] = [];

  for (const requirement of page.items) {
    try {
      const latestAnalysis = await repositories.analyses.latest(requirement.id);
      const priorAnalysisVersion = latestAnalysis?.analysisVersion ?? 0;
      let live = false;
      let terminalJob: PipelineJobRecord | null = null;
      let zombieJob: PipelineJobRecord | null = null;

      for (const key of analysisRunningJobKeys(requirement, priorAnalysisVersion)) {
        const job = (await repositories.jobs.findByDedupeKey?.(key)) ?? null;
        if (!job) continue;
        if (job.status === "queued") {
          live = true;
          break;
        }
        if (job.status === "running") {
          if (isLeaseActive(job, now)) {
            live = true;
            break;
          }
          // 租约过期但还有重试机会：claimNext 会重新认领，仍算有活人收尾
          if (job.attemptCount < job.maxAttempts) {
            live = true;
            break;
          }
          // 尝试用尽且租约过期：既不能被认领也不能被收尾，是真正的僵尸作业
          zombieJob = job;
          continue;
        }
        terminalJob = job;
      }

      if (live) {
        outcomes.push({ requirementId: requirement.id, action: "skipped", reason: "job_live" });
        continue;
      }

      if (zombieJob) {
        // 用 complete 自带的 fencing（status='running' AND attempt_count=$expected）终结僵尸作业；
        // 返回 null 说明被其他实例重新认领或已收敛，此时不能再回退需求状态。
        const settled = await repositories.jobs.complete(zombieJob.id, {
          expectedAttempt: zombieJob.attemptCount,
          status: "failed",
          errorCode: "lease_expired",
          errorSummary: "Reclaimed: analysis attempts exhausted with an expired lease.",
          now: nowIso,
        });
        if (!settled) {
          outcomes.push({ requirementId: requirement.id, action: "skipped", reason: "job_reclaimed" });
          continue;
        }
      }

      const reason: AnalysisStuckOutcome["reason"] = terminalJob || zombieJob ? "job_terminal" : "job_missing";
      await repositories.requirements.updateAnalysisState(requirement.id, "failed_retryable");
      await repositories.audit.append({
        id: randomUUID(),
        actorId: null,
        eventType: "analysis.recovery",
        entityType: "requirement",
        entityId: requirement.id,
        result: "succeeded",
        safeDetails: {
          from: "running",
          to: "failed_retryable",
          reason,
          source: "scheduler",
          sourceVersion: requirement.sourceVersion,
          analysisVersion: priorAnalysisVersion,
        },
        occurredAt: nowIso,
      });
      outcomes.push({ requirementId: requirement.id, action: "reverted", reason });
    } catch (error) {
      // 单条失败不阻断整轮；状态可能已被并发修改，交由下一轮重新判断。
      errors.push(`requirement ${requirement.id}: recover running analysis: ${safeErrorMessage(error)}`);
    }
  }
  return { outcomes, errors };
}

/**
 * 第一件事：failed_retryable 自动重试。
 * 已有 queued/running 作业 → 跳过（同一轮不会重复入队）；作业 succeeded → 状态与作业不一致，
 * 不做自动动作；否则按 dedupe key 入队并写 analysis.retry_requested 审计（actorId=null）。
 */
async function retryFailedAnalyses(
  repositories: AnalysisRecoveryRepositories,
  now: Date,
  limit: number,
  maxRetries: number,
  excludeRequirementIds: ReadonlySet<string>,
): Promise<{ outcomes: AnalysisRetryOutcome[]; errors: string[] }> {
  const nowIso = now.toISOString();
  const page = await repositories.requirements.search({ pullState: "synced", analysisState: "failed_retryable", limit });
  const outcomes: AnalysisRetryOutcome[] = [];
  const errors: string[] = [];

  for (const requirement of page.items) {
    // 本轮刚由 running 回退的需求：下一轮再接手，避免同一个 poll 里"先回退又立刻重试"。
    if (excludeRequirementIds.has(requirement.id)) continue;

    // 入队失败时也要能落审计：priorAnalysisVersion 取到之前用 null 表示未知。
    let priorAnalysisVersion: number | null = null;
    let dedupeKey = "";
    try {
      const latestAnalysis = await repositories.analyses.latest(requirement.id);
      priorAnalysisVersion = latestAnalysis?.analysisVersion ?? 0;
      dedupeKey = analysisRetryDedupeKey(requirement, priorAnalysisVersion);

      const existing = (await repositories.jobs.findByDedupeKey?.(dedupeKey)) ?? null;
      if (isActiveJob(existing)) {
        outcomes.push({ requirementId: requirement.id, action: "skipped", reason: "job_active", dedupeKey, priorAnalysisVersion });
        continue;
      }
      if (existing?.status === "succeeded") {
        // 可重试失败状态却挂着一个成功作业：不做自动动作，避免无意义地再分析一次。
        outcomes.push({ requirementId: requirement.id, action: "skipped", reason: "job_succeeded", dedupeKey, priorAnalysisVersion });
        continue;
      }

      const events = await repositories.audit.search({ entityId: requirement.id, limit: AUDIT_SCAN_LIMIT });
      const schedulerRetries = countSchedulerRetries(events, requirement.sourceVersion);
      if (schedulerRetries >= maxRetries) {
        // 达到上限：最多留一条 failed 审计，之后每轮静默跳过，绝不无限重试。
        const alreadyReported = hasExhaustionMarker(events, requirement.sourceVersion, priorAnalysisVersion);
        if (!alreadyReported) {
          await repositories.audit.append({
            id: randomUUID(),
            actorId: null,
            eventType: "analysis.retry_requested",
            entityType: "requirement",
            entityId: requirement.id,
            result: "failed",
            safeDetails: {
              source: "scheduler",
              sourceVersion: requirement.sourceVersion,
              priorAnalysisVersion,
              analysisStatus: "retry_budget_exhausted",
              reason: "retry_budget_exhausted",
              attempt: schedulerRetries,
            },
            occurredAt: nowIso,
          });
        }
        outcomes.push({
          requirementId: requirement.id,
          action: "exhausted",
          reason: alreadyReported ? "already_reported" : "retry_budget_exhausted",
          dedupeKey,
          priorAnalysisVersion,
        });
        continue;
      }

      // 终态失败/取消的同一 key 作业会由仓储复用并重置回 queued；同轮重复执行也只会有一个作业。
      await repositories.jobs.enqueue({
        jobType: "analysis",
        dedupeKey,
        payload: {
          requirementId: requirement.id,
          sourceVersion: requirement.sourceVersion,
          substantiveHash: requirement.substantiveHash,
          actorId: null,
        },
        availableAt: nowIso,
      });
      await repositories.audit.append({
        id: randomUUID(),
        actorId: null,
        eventType: "analysis.retry_requested",
        entityType: "requirement",
        entityId: requirement.id,
        result: "succeeded",
        safeDetails: {
          source: "scheduler",
          sourceVersion: requirement.sourceVersion,
          priorAnalysisVersion,
          analysisStatus: "queued_new_job",
        },
        occurredAt: nowIso,
      });
      outcomes.push({ requirementId: requirement.id, action: "enqueued", reason: "queued_new_job", dedupeKey, priorAnalysisVersion });
    } catch (error) {
      errors.push(`requirement ${requirement.id}: auto retry analysis: ${safeErrorMessage(error)}`);
      // 入队失败留痕，便于排查；审计本身失败也不能向外抛（否则整轮恢复中断）。
      try {
        await repositories.audit.append({
          id: randomUUID(),
          actorId: null,
          eventType: "analysis.retry_requested",
          entityType: "requirement",
          entityId: requirement.id,
          result: "failed",
          safeDetails: {
            source: "scheduler",
            sourceVersion: requirement.sourceVersion,
            ...(priorAnalysisVersion === null ? {} : { priorAnalysisVersion }),
            analysisStatus: "enqueue_failed",
          },
          occurredAt: nowIso,
        });
      } catch {
        // 审计写入失败时只保留原始错误，不再掩盖它
      }
    }
  }
  return { outcomes, errors };
}

/**
 * 分析阶段恢复入口：先收敛 running 崩溃残留，再补排 failed_retryable。
 * 两阶段各自 try/catch，返回报告而不抛错；调用方只需打日志。
 */
export async function recoverAnalysisPipeline(
  params: AnalysisRecoveryRepositories & { now: Date; limit?: number; maxRetries?: number },
): Promise<AnalysisRecoveryReport> {
  const limit = params.limit ?? ANALYSIS_RECOVERY_SCAN_LIMIT;
  const maxRetries = params.maxRetries ?? MAX_SCHEDULER_ANALYSIS_RETRIES;
  const report: AnalysisRecoveryReport = { retried: [], recovered: [], errors: [] };
  const recoveredThisRound = new Set<string>();

  try {
    const running = await recoverStuckRunningAnalyses(params, params.now, limit);
    report.recovered.push(...running.outcomes);
    report.errors.push(...running.errors);
    for (const outcome of running.outcomes) {
      if (outcome.action === "reverted") recoveredThisRound.add(outcome.requirementId);
    }
  } catch (error) {
    report.errors.push(`running recovery phase: ${safeErrorMessage(error)}`);
  }

  try {
    const failed = await retryFailedAnalyses(params, params.now, limit, maxRetries, recoveredThisRound);
    report.retried.push(...failed.outcomes);
    report.errors.push(...failed.errors);
  } catch (error) {
    report.errors.push(`failed-retry phase: ${safeErrorMessage(error)}`);
  }

  return report;
}
