// 基于来源配置的周调度任务创建：计算到期调度窗口并创建同步批次（幂等键按窗口去重）。
// 边界：本模块是作业创建逻辑的本地实现；目标环境的定时触发由妙搭 automation 承担
// （spark scope gated，工单 00/08）。重复调用同一窗口不会创建重复批次或重复任务。

import type { PipelineJobRepository, SyncBatchRepository, SourceConfigRepository } from "../application/repositories.js";
import { computeLastDueWindow } from "./due.js";

export interface DueSyncJobOutcome {
  sourceConfigId: string;
  batchId: string | null;
  window: string | null;
  enabled: boolean;
}

export async function createDueSyncJobs(params: {
  sources: SourceConfigRepository;
  batches: SyncBatchRepository;
  jobs: PipelineJobRepository;
  now: Date;
}): Promise<DueSyncJobOutcome[]> {
  const outcomes: DueSyncJobOutcome[] = [];
  for (const source of await params.sources.list()) {
    if (!source.enabled || !source.scheduleEnabled) {
      outcomes.push({ sourceConfigId: source.id, batchId: null, window: null, enabled: false });
      continue;
    }
    // DDL 约束保证 schedule_enabled 时时区/时间非空；TS 侧显式守卫
    if (!source.scheduleLocalTime || !source.scheduleTimezone) {
      outcomes.push({ sourceConfigId: source.id, batchId: null, window: null, enabled: true });
      continue;
    }
    const window = computeLastDueWindow(
      { enabled: true, weekday: source.scheduleWeekday, time: source.scheduleLocalTime, timezone: source.scheduleTimezone },
      params.now,
    );
    if (!window) {
      outcomes.push({ sourceConfigId: source.id, batchId: null, window: null, enabled: true });
      continue;
    }
    // 批次级幂等键：同一调度窗口的重复触发复用同一批次（sync_batches 唯一约束兜底）
    const idempotencyKey = `sched:${source.id}:_batch_:${window.start}`;
    const batch = await params.batches.create({
      sourceConfigId: source.id, triggerType: "scheduled", actorId: null,
      idempotencyKey, startedAt: params.now.toISOString(),
    });
    // 任务幂等键按批次去重：同批次的重复入队复用同一任务
    await params.jobs.enqueue({
      jobType: "sync", dedupeKey: `sync:${batch.id}`,
      payload: { batchId: batch.id, sourceId: source.id, triggerType: "scheduled", actorId: null },
      availableAt: params.now.toISOString(),
    });
    outcomes.push({ sourceConfigId: source.id, batchId: batch.id, window: window.start, enabled: true });
  }
  return outcomes;
}
