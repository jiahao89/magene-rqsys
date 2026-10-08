// 调度触发的幂等键：同一调度窗口的重复触发应复用同一键，保证不创建重复 run。
// 此模块复用 jobs/idempotency.ts 的 buildScheduledIdempotencyKey，提供调度层便捷封装。

import { buildScheduledIdempotencyKey } from "../jobs/idempotency.js";
import type { ScheduledWindow } from "./due.js";

// 从 ScheduledWindow 生成幂等键：用 window.start 作为窗口标识。
export function buildScheduledRunIdempotencyKey(params: {
  sourceProjectId: string;
  sourceRequirementId: string;
  window: ScheduledWindow;
}): string {
  return buildScheduledIdempotencyKey({
    sourceProjectId: params.sourceProjectId,
    sourceRequirementId: params.sourceRequirementId,
    scheduleWindow: params.window.start,
  });
}
