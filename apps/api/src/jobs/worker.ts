import type { PipelineJobRecord } from "../domain/persistence.js";
import type { PipelineJobRepository } from "../application/repositories.js";
import type { SyncJobRunner } from "../sync/service.js";

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
      const completed = await this.options.jobs.complete(job.id, { status: "succeeded", now: this.now().toISOString() });
      if (!completed) throw new Error("claimed job disappeared before completion");
      return { kind: "succeeded", jobId: job.id };
    } catch (error) {
      const code = error instanceof UnsupportedJobTypeError ? "unsupported_job_type" : "worker_handler_failed";
      // 安全摘要：错误详情不含密钥或 provider 原始响应
      await this.options.jobs.complete(job.id, {
        status: "failed", errorCode: code,
        errorSummary: code === "unsupported_job_type" ? "No handler is registered for this job type." : "Job handler failed; retry is available.",
        now: this.now().toISOString(),
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
      if (result.status === "failed" || result.status === "partial_failure") throw new Error("sync completed with retryable failures");
      return;
    }
    throw new UnsupportedJobTypeError(job.jobType);
  }
}

class UnsupportedJobTypeError extends Error {
  constructor(jobType: string) { super(`No handler for ${jobType}`); }
}
