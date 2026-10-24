// 基于来源配置的周调度任务创建：计算到期调度窗口并创建同步批次（幂等键按窗口去重）。
// 边界：本模块是作业创建逻辑的本地实现；目标环境的定时触发由妙搭 automation 承担
// （spark scope gated，工单 00/08）。重复调用同一窗口不会创建重复批次或重复任务。

import type { PipelineJobRepository, SyncBatchRepository, SourceConfigRepository } from "../application/repositories.js";
import type { SyncBatchRecord } from "../domain/persistence.js";
import { computeLastDueWindow } from "./due.js";

export interface DueSyncJobOutcome {
  sourceConfigId: string;
  batchId: string | null;
  window: string | null;
  enabled: boolean;
  /** 该来源本轮处理失败的原因。其他来源仍会继续处理，不因单个来源失败而中断。 */
  error?: string;
}

export async function createDueSyncJobs(params: {
  sources: SourceConfigRepository;
  batches: SyncBatchRepository;
  jobs: PipelineJobRepository;
  now: Date;
  /** 已通过服务端 POC/时效守卫的合成验收来源；未设置时保持正式行为。 */
  fixtureSourceId?: string;
}): Promise<DueSyncJobOutcome[]> {
  const outcomes: DueSyncJobOutcome[] = [];
  const sources = await params.sources.list();
  if (params.fixtureSourceId && !sources.some((source) => source.id === params.fixtureSourceId)) {
    throw new Error("Scheduled fixture source was not found");
  }
  for (const source of sources) {
    if (params.fixtureSourceId && source.id !== params.fixtureSourceId) {
      outcomes.push({ sourceConfigId: source.id, batchId: null, window: null, enabled: false });
      continue;
    }
    if (!source.enabled || !source.scheduleEnabled) {
      outcomes.push({ sourceConfigId: source.id, batchId: null, window: null, enabled: false });
      continue;
    }
    // DDL 约束保证 schedule_enabled 时时区/时间非空；TS 侧显式守卫
    if (!source.scheduleLocalTime || !source.scheduleTimezone) {
      outcomes.push({ sourceConfigId: source.id, batchId: null, window: null, enabled: true });
      continue;
    }
    let window: ReturnType<typeof computeLastDueWindow> = null;
    let existingBatch: SyncBatchRecord | null | undefined;
    let batch: SyncBatchRecord | null = null;
    try {
      // 窗口换算与批次探测必须在 try 内：一个坏时区/坏配置的来源不能把整个循环炸出去，
      // 否则同一轮里其余来源的调度全部停摆。
      window = computeLastDueWindow(
        { enabled: true, weekday: source.scheduleWeekday, time: source.scheduleLocalTime, timezone: source.scheduleTimezone },
        params.now,
      );
      if (!window) {
        outcomes.push({ sourceConfigId: source.id, batchId: null, window: null, enabled: true });
        continue;
      }
      // 批次级幂等键：同一调度窗口的重复触发复用同一批次（sync_batches 唯一约束兜底）
      const idempotencyKey = `${params.fixtureSourceId ? "fixture-sched" : "sched"}:${source.id}:_batch_:${window.start}`;
      // 先探测是否已存在同窗口批次：只有本次新建的批次才允许在入队失败时就地标记失败，
      // 复用的既有批次可能已有在跑的任务，不能覆盖它的状态。
      // 无法确认批次是否本次新建时（仓储未实现该查询）返回 null 以外的未知值，
      // 此时保守处理：不标记失败，交由 batch reaper 兜底。
      existingBatch = await params.batches.findByIdempotencyKey?.(source.id, idempotencyKey);
      batch = await params.batches.create({
        sourceConfigId: source.id, triggerType: "scheduled", actorId: null,
        idempotencyKey, startedAt: params.now.toISOString(),
      });
      // 任务幂等键按批次去重：同批次的重复入队复用同一任务
      await params.jobs.enqueue({
        jobType: "sync", dedupeKey: `sync:${batch.id}`,
        payload: { batchId: batch.id, sourceId: source.id, triggerType: "scheduled", actorId: null, ...(params.fixtureSourceId ? { testFixture: true } : {}) },
        availableAt: params.now.toISOString(),
      });
      outcomes.push({ sourceConfigId: source.id, batchId: batch.id, window: window.start, enabled: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 批次已建但任务未入队时，批次会永远停在 running，后续同步将被并发守卫拒绝（409）。
      // 若该批次是本次新建的，就地收尾为 failed，避免它变成孤儿批次。
      if (batch && existingBatch === null) {
        try {
          await params.batches.complete(batch.id, {
            status: "failed", totalCount: 0, succeededCount: 0, failedCount: 0,
            errorSummary: `scheduler enqueue failed: ${message}`, completedAt: params.now.toISOString(),
          });
        } catch {
          // 收尾本身失败时保留原始错误，交由 batch reaper 兜底回收
        }
      }
      outcomes.push({ sourceConfigId: source.id, batchId: batch?.id ?? null, window: window?.start ?? null, enabled: true, error: message });
    }
  }
  return outcomes;
}
