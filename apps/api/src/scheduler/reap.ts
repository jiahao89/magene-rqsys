// 孤儿批次回收：把永远停在 running 的同步批次收敛为 failed。
//
// 背景：批次一旦停在 running，来源的并发守卫会拒绝后续每一次同步（409），
// 来源被静默锁死，只能手工改库恢复。worker 的租约 + 终态收敛已覆盖大部分路径，
// 这里兜底的是「批次已创建但作业从未入队或被丢弃」——那种情况下没有作业可以承接收敛。
//
// 判定不靠时间猜测：只要该批次的 sync 作业不存在、或已进入终态，而批次仍是 running，
// 它就是确定的孤儿。仅用一个最小年龄窗口避开「批次刚建、作业尚未入队」的正常间隙。

import type { PipelineJobRepository, SyncBatchRepository } from "../application/repositories.js";

export interface ReapedBatch {
  batchId: string;
  sourceConfigId: string;
  reason: "sync job missing" | "sync job terminal";
}

/** 批次创建与作业入队之间的正常间隔。小于该年龄的批次一律放过，避免误杀。 */
export const REAP_MIN_AGE_MS = 120_000;

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export async function reapOrphanedBatches(params: {
  batches: SyncBatchRepository;
  jobs: Pick<PipelineJobRepository, "findByDedupeKey">;
  now: Date;
  /** 单轮扫描上限，避免一次 tick 拉太多数据。 */
  limit?: number;
  minAgeMs?: number;
}): Promise<ReapedBatch[]> {
  const minAgeMs = params.minAgeMs ?? REAP_MIN_AGE_MS;
  const cutoff = params.now.getTime() - minAgeMs;
  const { items } = await params.batches.list({ status: "running", limit: params.limit ?? 50 });
  const reaped: ReapedBatch[] = [];

  for (const batch of items) {
    if (new Date(batch.startedAt).getTime() > cutoff) continue;
    const job = await params.jobs.findByDedupeKey?.(`sync:${batch.id}`);
    // 作业不存在 → 批次永远无人收敛；作业已终态 → 收敛机会已经过去。
    const reason: ReapedBatch["reason"] | null = !job
      ? "sync job missing"
      : TERMINAL_JOB_STATUSES.has(job.status) ? "sync job terminal" : null;
    if (!reason) continue; // 作业仍在 queued/running：租约机制会接管，不动它

    const settled = await params.batches.complete(batch.id, {
      status: "failed",
      totalCount: batch.totalCount,
      succeededCount: batch.succeededCount,
      failedCount: batch.failedCount,
      errorSummary: `Reclaimed orphaned batch: ${reason}.`,
      completedAt: params.now.toISOString(),
    });
    if (settled) reaped.push({ batchId: batch.id, sourceConfigId: batch.sourceConfigId, reason });
  }
  return reaped;
}
