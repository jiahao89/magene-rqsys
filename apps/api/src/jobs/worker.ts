import { FixturePolicyError } from "../sync/test-fixture.js";
import type { PipelineJobRecord } from "../domain/persistence.js";
import type { PipelineJobRepository, SyncBatchRepository } from "../application/repositories.js";
import { NON_RETRYABLE_SYNC_ITEM_CODES, SyncDataError, type SyncJobRunner } from "../sync/service.js";
import { computeBackoffMs, isRetryable } from "../retry/policy.js";
import { classifyJobError } from "./classify-error.js";
import { JobDeferredError } from "./deferred.js";

// jobType → 重试策略阶段映射（复用 retry/policy.ts 的阶段退避）
const STAGE_FOR_JOB_TYPE = { sync: "pull", analysis: "analysis", base_push: "push", kano_run: "analysis" } as const;

export interface PipelineJobWorkerOptions {
  jobs: PipelineJobRepository;
  /** 重排同步作业时把批次置回 running，让来源并发守卫覆盖"排队等重试"的窗口。 */
  batches?: Pick<SyncBatchRepository, "reopen">;
  // SyncJobRunner 由组合层装配（加载来源配置并委托 SyncOrchestrator），worker 保持与来源解耦
  sync?: SyncJobRunner;
  handlers?: Partial<Record<PipelineJobRecord["jobType"], (job: PipelineJobRecord) => Promise<void>>>;
  workerId: string;
  leaseMs: number;
  now?: () => Date;
}
export type WorkerResult = { kind: "idle" } | { kind: "succeeded"; jobId: string } | { kind: "failed"; jobId: string } | { kind: "deferred"; jobId: string };

export class PipelineJobWorker {
  private readonly now: () => Date;
  constructor(private readonly options: PipelineJobWorkerOptions) {
    if (!options.workerId.trim()) throw new Error("workerId must not be empty");
    if (!Number.isFinite(options.leaseMs) || options.leaseMs <= 0) throw new Error("leaseMs must be positive");
    this.now = options.now ?? (() => new Date());
  }

  /**
   * 启动租约续约定时器。返回停止函数（可重复调用）。
   * 续约失败（租约被接管）时停止继续续约，把结果交给 fencing 判定。
   */
  private startHeartbeat(job: PipelineJobRecord): () => void {
    const renew = this.options.jobs.renewLease?.bind(this.options.jobs);
    if (!renew) return () => {};
    const periodMs = Math.max(100, Math.floor(this.options.leaseMs / 3));
    let stopped = false;
    const timer = setInterval(() => {
      if (stopped) return;
      void renew(job.id, { expectedAttempt: job.attemptCount, leaseMs: this.options.leaseMs, now: this.now().toISOString() })
        .then((stillOurs) => { if (!stillOurs) stop(); })
        .catch(() => { /* 续约失败不影响 handler；租约过期后由 fencing/reaper 接管 */ });
    }, periodMs);
    // 不阻止进程退出
    if (typeof timer.unref === "function") timer.unref();
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    };
    return stop;
  }

  async runOnce(): Promise<WorkerResult> {
    const now = this.now().toISOString();
    const job = await this.options.jobs.claimNext(this.options.workerId, this.options.leaseMs, now);
    if (!job) return { kind: "idle" };
    // 心跳：dispatch 可能远超租约（314 条同步、限流的 Base 批量）。不续约的话租约过期后
    // 另一个实例会认领同一作业并发执行同一 handler，产生重复的 AI 调用/Base 写入；
    // fencing 只保护最终写入，挡不住副作用。这里在 dispatch 期间按租约的 1/3 周期续约。
    const stopHeartbeat = this.startHeartbeat(job);
    try {
      await this.dispatch(job);
      // fencing：仅当 attempt 仍等于认领时的值才接受结果（工单 15）；
      // 返回 null 说明租约已被其他 worker 重新认领，本 worker 迟到的结果被拒绝且不覆盖新状态。
      stopHeartbeat();
      const completed = await this.options.jobs.complete(job.id, { expectedAttempt: job.attemptCount, status: "succeeded", now: this.now().toISOString() });
      if (!completed) return { kind: "failed", jobId: job.id };
      return { kind: "succeeded", jobId: job.id };
    } catch (error) {
      stopHeartbeat();
      // 延后：条件补齐后应再执行，记为可被同键入队重置的 cancelled，不进入重试退避、也不当作失败。
      if (error instanceof JobDeferredError) {
        await this.options.jobs.complete(job.id, {
          expectedAttempt: job.attemptCount, status: "cancelled", errorCode: error.reason,
          errorSummary: "Deferred until the blocking condition is resolved; re-enqueued automatically.",
          now: this.now().toISOString(),
        });
        return { kind: "deferred", jobId: job.id };
      }
      // 重试策略：有剩余尝试则按阶段退避重排（保留先前成功结果）；超限或永久错误进入终态
      const stage = STAGE_FOR_JOB_TYPE[job.jobType];
      // 错误分类：认证失败、4xx、飞书字段/权限契约错误（1254xxx）等永久性错误直接终态。
      // 此前只看尝试次数，这类错误会被白白重试 4–5 次，最后报 "Max attempts reached"，
      // 把"配置错了"伪装成"偶发失败"。
      const errorClass = classifyJobError(error);
      const permanent = stage !== undefined && !isRetryable(stage, errorClass);
      const terminal =
        error instanceof UnsupportedJobTypeError ||
        error instanceof FixturePolicyError ||
        error instanceof SyncDataError ||
        permanent ||
        job.attemptCount >= job.maxAttempts ||
        stage === undefined;
      if (terminal) {
        const code = error instanceof FixturePolicyError ? "fixture_policy_denied"
          : error instanceof SyncDataError ? "sync_data_errors"
            : error instanceof UnsupportedJobTypeError ? "unsupported_job_type" : permanent ? `permanent_${errorClass}` : "max_attempts_reached";
        const recorded = await this.options.jobs.complete(job.id, {
          expectedAttempt: job.attemptCount,
          status: "failed", errorCode: code,
          // sync 作业的任何终态失败都必须收敛批次。此前只在夹具策略拒绝时收敛，
          // 其他错误（网关 4xx/5xx、网络、数据库异常）会让批次永远停在 running，
          // 之后每次同步都被并发守卫拒绝（409），来源被静默锁死，只能手工改库恢复。
          // settleSyncBatch 的 SQL 自带保护：仅当 job_type='sync' 且作业已 failed
          // 且批次仍为 running 时才置 failed，不会覆盖已收敛的批次。
          ...(job.jobType === "sync" ? { settleSyncBatch: true } : {}),
          errorSummary: code === "fixture_policy_denied" ? `Synthetic acceptance policy denied (${error instanceof FixturePolicyError ? error.reason : "unspecified"}); restore a safe configuration before retrying.` : code === "sync_data_errors"
            ? `Source records failed validation (${(error as SyncDataError).codes.join(", ")}); fix the source data and retry the failed items.`
            : code === "unsupported_job_type"
            ? "No handler is registered for this job type."
            : permanent ? `Permanent failure (${errorClass}); configuration must be corrected before retry.` : "Max attempts reached; manual retry is available.",
          now: this.now().toISOString(),
        });
        // 结果被新 worker 拒绝（fencing）：新认领者接管，本 worker 放弃
        if (!recorded) return { kind: "failed", jobId: job.id };
        return { kind: "failed", jobId: job.id };
      }
      const backoffMs = computeBackoffMs({ stage, attempt: job.attemptCount + 1, errorClass });
      // 批次在重排期间已落 partial_failure/failed，不再占用来源并发守卫（守卫只看 status='running'），
      // 这段窗口里可以另起一个批次并发拉取同一来源。重排前先把它置回 running。
      if (job.jobType === "sync" && this.options.batches?.reopen && typeof job.payload["batchId"] === "string") {
        try { await this.options.batches.reopen(job.payload["batchId"]); }
        catch { /* 置回失败不阻断重排：批次会在下次终态或回收时收敛 */ }
      }
      // 安全摘要：错误详情不含密钥或 provider 原始响应
      await this.options.jobs.reschedule(job.id, {
        expectedAttempt: job.attemptCount,
        backoffMs, errorCode: "worker_handler_failed",
        errorSummary: "Job handler failed; scheduled for retry.", now: this.now().toISOString(),
      });
      return { kind: "failed", jobId: job.id };
    }
  }

  private async dispatch(job: PipelineJobRecord): Promise<void> {
    const injected = this.options.handlers?.[job.jobType];
    if (injected) return injected(job);
    if (job.jobType === "sync") {
      if (!this.options.sync) throw new Error("Sync worker dependency is unavailable");
      const { batchId, sourceId, triggerType, actorId, onlyIds, testFixture, mode } = job.payload as Record<string, unknown>;
      if (typeof batchId !== "string" || typeof sourceId !== "string" || (triggerType !== "manual" && triggerType !== "scheduled") || (actorId !== null && typeof actorId !== "string")) throw new Error("Invalid sync job payload");
      if (onlyIds !== undefined && (!Array.isArray(onlyIds) || !onlyIds.every((id) => typeof id === "string"))) throw new Error("Invalid sync job payload: onlyIds");
      if (testFixture !== undefined && typeof testFixture !== "boolean") throw new Error("Invalid sync job payload: testFixture");
      if (mode !== undefined && mode !== "full_pipeline" && mode !== "source_only") throw new Error("Invalid sync job payload: mode");
      const result = await this.options.sync({ batchId, sourceConfigId: sourceId, trigger: triggerType, actorId, mode: mode === "source_only" ? "source_only" : "full_pipeline", ...(Array.isArray(onlyIds) ? { onlyIds: onlyIds as string[] } : {}), ...(testFixture === true ? { testFixture: true } : {}) });
      // 批次失败/部分失败 → 触发重试策略（保留已成功条目，重试由编排器幂等处理）。
      // 例外：失败项全是数据类错误（如源记录缺 ID）时，重跑整批只会把全部条目再拉一遍再失败，
      // 最后报 max_attempts 把数据问题伪装成偶发故障。这类直接终态，人工按条目重试。
      if (result.status === "partial_failure" || result.status === "failed") {
        const codes = result.failedCodes ?? [];
        if (codes.length > 0 && codes.every((code) => NON_RETRYABLE_SYNC_ITEM_CODES.has(code))) {
          throw new SyncDataError(codes);
        }
        throw new Error("sync completed with retryable failures");
      }
      return;
    }
    throw new UnsupportedJobTypeError(job.jobType);
  }
}

class UnsupportedJobTypeError extends Error {
  constructor(jobType: string) { super(`No handler for ${jobType}`); }
}
