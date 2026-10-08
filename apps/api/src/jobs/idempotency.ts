// 幂等键生成：为同一 (sourceConfigId, teambitionRequirementId, trigger, triggerTime) 的
// 调度 / 手动触发生成稳定键，保证重复触发不创建重复工作（不变量 1）。

import { randomUUID } from "node:crypto";

// 调度触发的幂等键：同一调度窗口内的重复触发应复用同一键。
// 窗口键由调度器按 (scheduleId, scheduledWindowStart) 计算，避免机器本地时区影响。
export function buildScheduledIdempotencyKey(params: {
  sourceConfigId: string;
  teambitionRequirementId: string;
  scheduleWindow: string; // ISO 8601 窗口起点，由 scheduler 计算
}): string {
  return `sched:${params.sourceConfigId}:${params.teambitionRequirementId}:${params.scheduleWindow}`;
}

// 手动触发的幂等键：每次手动触发生成唯一 UUID，允许手动重试。
// 若需要"同一次手动意图不重复"，调用方可在前端按意图生成确定性键传入。
export function buildManualIdempotencyKey(params: {
  sourceConfigId: string;
  teambitionRequirementId: string;
}): string {
  // 包含随机 UUID，允许同源多次手动触发但每次独立；调用方若要合并需自己管理键。
  return `manual:${params.sourceConfigId}:${params.teambitionRequirementId}:${randomUUID()}`;
}

// 校验幂等键格式：最小长度 8，最大 128，非空且不含控制字符。
export function isValidIdempotencyKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if (key.length < 8 || key.length > 128) return false;
  // 禁止包含控制字符（0x00-0x1F 和 0x7F）
  return !/[\x00-\x1f\x7f]/.test(key);
}
