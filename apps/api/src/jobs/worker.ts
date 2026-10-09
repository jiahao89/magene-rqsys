import type { PipelineJobRecord } from "../domain/persistence.js";
import type { PipelineJobRepository } from "../application/repositories.js";
import type { SyncJobRunner } from "../sync/service.js";
import { computeBackoffMs } from "../retry/policy.js";

// jobType → 重试策略阶段映射（复用 retry/policy.ts 的阶段退避）
const STAGE_FOR_JOB_TYPE = { sync: "pull", analysis: "analysis", base_push: "push" } as const;

export interface PipelineJobWorkerOptions {
  jobs: PipelineJobRepository;
  // SyncJobRunner 由组合层装配（加载来源配置并委托 SyncOrchestrator），worker 保持与来源解耦
  sync?: SyncJobRunner;
  handlers?: Partial<Record<PipelineJobRecord["jobType"], (job: PipelineJobRecord) => Promise<void>>>;
  workerId: string;
  leaseMs: number;
  now?: () => Date;
}
export type WorkerResult = { kind: "idle" } | { kind: "succeeded"; jobId: string } | { kind: "failed"; jobId: string };

export class PipelineJobWorker {
  private readonly now: () => Date;
  constructor(private readonly options: PipelineJobWorkerOptions) {
    if (!options.workerId.trim()) throw new Error("workerId must not be empty");
    if (!Number.isFinite(options.leaseMs) || options.leaseMs <= 0) throw new Error("leaseMs must be positive");
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<WorkerResult> {
    const now = this.now().toISOString();
    const job = await this.options.jobs.claimNext(this.options.workerId, this.options.leaseMs, now);
    if (!job) return { kind: "idle" };
    try {
      await this.dispatch(job);
      // fencing：仅当 attempt 仍等于认领时的值才接受结果（工单 15）；
      // 返回 null 说明租约已被其他 worker 重新认领，本 worker 迟到的结果被拒绝且不覆盖新状态。
      const completed = await this.options.jobs.complete(job.id, { expectedAttempt: job.attemptCount, status: "succeeded", now: this.now().toISOString() });
      if (!completed) return { kind: "failed", jobId: job.id };
      return { kind: "succeeded", jobId: job.id };
    } catch (error) {
      // 重试策略：有剩余尝试则按阶段退避重排（保留先前成功结果）；超限或永久错误进入终态
      const stage = STAGE_FOR_JOB_TYPE[job.jobType];
      const terminal =
        error instanceof UnsupportedJobTypeError ||
        job.attemptCount >= job.maxAttempts ||
        stage === undefined;
      if (terminal) {
        const code = error instanceof UnsupportedJobTypeError ? "unsupported_job_type" : "max_attempts_reached";
        const recorded = await this.options.jobs.complete(job.id, {
          expectedAttempt: job.attemptCount,
          status: "failed", errorCode: code,
          errorSummary: code === "unsupported_job_type"
            ? "No handler is registered for this job type."
            : "Max attempts reached; manual retry is available.",
          now: this.now().toISOString(),
        });
        // 结果被新 worker 拒绝（fencing）：新认领者接管，本 worker 放弃
        if (!recorded) return { kind: "failed", jobId: job.id };
        return { kind: "failed", jobId: job.id };
      }
      const backoffMs = computeBackoffMs({ stage, attempt: job.attemptCount + 1 });
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
      const { batchId, sourceId, triggerType, actorId, onlyIds } = job.payload as Record<string, unknown>;
      if (typeof batchId !== "string" || typeof sourceId !== "string" || (triggerType !== "manual" && triggerType !== "scheduled") || (actorId !== null && typeof actorId !== "string")) throw new Error("Invalid sync job payload");
      if (onlyIds !== undefined && (!Array.isArray(onlyIds) || !onlyIds.every((id) => typeof id === "string"))) throw new Error("Invalid sync job payload: onlyIds");
      const result = await this.options.sync({ batchId, sourceConfigId: sourceId, trigger: triggerType, actorId, ...(Array.isArray(onlyIds) ? { onlyIds: onlyIds as string[] } : {}) });
      // 批次失败/部分失败 → 触发重试策略（保留已成功条目，重试由编排器幂等处理）
      if (result.status === "failed" || result.status === "partial_failure") throw new Error("sync completed with retryable failures");
      return;
    }
    throw new UnsupportedJobTypeError(job.jobType);
  }
}

class UnsupportedJobTypeError extends Error {
  constructor(jobType: string) { super(`No handler for ${jobType}`); }
}
