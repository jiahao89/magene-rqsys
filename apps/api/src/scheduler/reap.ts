// 孤儿批次回收：把永远停在 running 的同步批次收敛为 failed。
//
// 背景：批次一旦停在 running，来源的并发守卫会拒绝后续每一次同步（409），
// 来源被静默锁死，只能手工改库恢复。
//
// 覆盖三种"没有活人能收尾"的情形：
//   1. sync 作业不存在        —— 进程在建批次与入队之间死亡
//   2. sync 作业已终态        —— 收敛机会已经过去
//   3. sync 作业 running 且尝试次数已用尽、租约已过期
//      —— claimNext 要求 attempt_count < max_attempts，complete 要求进程活着且 attempt 匹配，
//         这种作业既不能被认领、也不能被收尾，批次会永久卡住。必须由回收器兜底。
//
// 判定不靠单纯的时间猜测：前两种看作业状态，第三种同时要求"尝试用尽 + 租约过期"。

import type { PipelineJobRepository, SyncBatchRepository } from "../application/repositories.js";

export interface ReapedBatch {
  batchId: string;
  sourceConfigId: string;
  reason: "sync job missing" | "sync job terminal" | "sync job exhausted";
}

/** 批次创建与作业入队之间的正常间隔。小于该年龄的批次一律放过，避免误杀。 */
export const REAP_MIN_AGE_MS = 120_000;

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/**
 * 同步作业的 dedupe key 有两种历史格式：
 *   - 调度路径：`sync:<batchId>`
 *   - 手动路径：`sync:<sourceConfigId>:<batchIdempotencyKey>`
 * 只查一种会把另一条路径的健康批次误判成"作业不存在"，因此两种都查。
 */
function syncJobKeys(batch: { id: string; sourceConfigId: string; idempotencyKey: string }): string[] {
  return [`sync:${batch.id}`, `sync:${batch.sourceConfigId}:${batch.idempotencyKey}`];
}

export async function reapOrphanedBatches(params: {
  batches: SyncBatchRepository;
  jobs: Pick<PipelineJobRepository, "findByDedupeKey" | "complete">;
  now: Date;
  /** 单轮扫描上限，避免一次 tick 拉太多数据。 */
  limit?: number;
  minAgeMs?: number;
}): Promise<ReapedBatch[]> {
  const minAgeMs = params.minAgeMs ?? REAP_MIN_AGE_MS;
  const nowIso = params.now.toISOString();
  const cutoff = params.now.getTime() - minAgeMs;
  const { items } = await params.batches.list({ status: "running", limit: params.limit ?? 50 });
  const reaped: ReapedBatch[] = [];

  for (const batch of items) {
    if (new Date(batch.startedAt).getTime() > cutoff) continue;

    let job: Awaited<ReturnType<NonNullable<PipelineJobRepository["findByDedupeKey"]>>> | null = null;
    for (const key of syncJobKeys(batch)) {
      job = (await params.jobs.findByDedupeKey?.(key)) ?? null;
      if (job) break;
    }

    // 作业仍在 queued/running 且还有重试机会 → 租约机制会接管，不动它
    const leaseExpired = !job?.lockedUntil || new Date(job.lockedUntil).getTime() <= params.now.getTime();
    const exhausted = job?.status === "running" && job.attemptCount >= job.maxAttempts && leaseExpired;

    const reason: ReapedBatch["reason"] | null = !job
      ? "sync job missing"
      : TERMINAL_JOB_STATUSES.has(job.status) ? "sync job terminal"
        : exhausted ? "sync job exhausted"
          : null;
    if (!reason) continue;

    if (exhausted && job) {
      // 尝试用尽的 running 作业只能由回收器终结。complete 的 SQL 自带
      // `status='running' AND attempt_count=$expected` 谓词（fencing），
      // 并在 settleSyncBatch 下用同一条 CTE 原子收敛批次，避免两步之间再留孤儿。
      const settledJob = await params.jobs.complete(job.id, {
        expectedAttempt: job.attemptCount,
        status: "failed",
        errorCode: "lease_expired",
        errorSummary: "Reclaimed: attempts exhausted with an expired lease.",
        now: nowIso,
        settleSyncBatch: true,
      });
      // 被别的实例抢先处理（返回 null）→ 轮不到我们
      if (settledJob) reaped.push({ batchId: batch.id, sourceConfigId: batch.sourceConfigId, reason });
      continue;
    }

    const settled = await params.batches.complete(batch.id, {
      status: "failed",
      totalCount: batch.totalCount,
      succeededCount: batch.succeededCount,
      failedCount: batch.failedCount,
      errorSummary: `Reclaimed orphaned batch: ${reason}.`,
      completedAt: nowIso,
    });
    if (settled) reaped.push({ batchId: batch.id, sourceConfigId: batch.sourceConfigId, reason });
  }
  return reaped;
}
