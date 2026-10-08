// 流水线状态迁移规则：pull/analysis/owner/push 四个独立状态的合法迁移。
// 关键不变量（AGENTS.md）：
// - pull、analysis、owner-mapping、push 状态独立；低置信、缺优先级或首轮 AI 失败
//   永不阻塞本来合格的推送。
// - AI 输出与 PM 确认字段分离：自动映射不覆盖 manually_mapped。

import type {
  AnalysisState,
  OwnerState,
  PullState,
  PushState,
  RequirementPipelineState,
} from "./workflow.js";

export type PipelineStageKey = "pull" | "analysis" | "owner" | "push";
type PipelineStateOf<K extends PipelineStageKey> = RequirementPipelineState[K];

// 各阶段合法迁移表。重试将 failed 重置回 pending/running；
// 已成功阶段可因后续批次/新版本重新执行（synced → running、analyzed → running、pushed → running）。
export const PIPELINE_TRANSITIONS: {
  pull: Record<PullState, readonly PullState[]>;
  analysis: Record<AnalysisState, readonly AnalysisState[]>;
  owner: Record<OwnerState, readonly OwnerState[]>;
  push: Record<PushState, readonly PushState[]>;
} = {
  pull: {
    pending: ["running"],
    running: ["synced", "failed"],
    synced: ["running"], // 后续同步批次重新拉取
    failed: ["pending", "running"], // 重试
  },
  analysis: {
    pending: ["running"],
    running: ["analyzed", "failed_retryable"],
    analyzed: ["running"], // 源实质变化后的新分析版本
    failed_retryable: ["pending", "running"], // 新建分析版本重试
  },
  owner: {
    pending_mapping: ["auto_mapped", "manually_mapped", "not_required"],
    auto_mapped: ["manually_mapped"], // 操作员可覆盖自动映射
    manually_mapped: [], // 人工确认字段不被自动流程改写
    not_required: ["pending_mapping"], // 需求获得执行人后重新进入映射
  },
  push: {
    pending: ["running"],
    running: ["pushed", "failed"],
    pushed: ["running"], // 实质变化需要重新推送
    failed: ["pending", "running"], // 重试
  },
};

// 判断迁移是否合法。
export function canTransition<K extends PipelineStageKey>(
  stage: K,
  from: PipelineStateOf<K>,
  to: PipelineStateOf<K>,
): boolean {
  const table = PIPELINE_TRANSITIONS[stage] as Record<string, readonly string[]>;
  return table[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly stage: PipelineStageKey,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid ${stage} transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

// 校验迁移，非法时抛错。
export function assertTransition<K extends PipelineStageKey>(
  stage: K,
  from: PipelineStateOf<K>,
  to: PipelineStateOf<K>,
): void {
  if (!canTransition(stage, from, to)) {
    throw new InvalidTransitionError(stage, from, to);
  }
}

// 自动/映射建议不覆盖人工确认字段：
// - 当前 manually_mapped：保留人工结果，无论建议是什么。
// - 其他状态：有执行人则 auto_mapped，无执行人则 not_required（无负责人需求可导入、可空负责人推送）。
export function applyAutoOwnerSuggestion(current: OwnerState, hasExecutor: boolean): OwnerState {
  if (current === "manually_mapped") return "manually_mapped";
  return hasExecutor ? "auto_mapped" : "not_required";
}

// 推送资格判断：分析状态（低置信、缺优先级、首轮失败）不阻塞本来合格的推送。
// 合格条件：pull 已同步、owner 已完成映射处理（auto/manually/not_required）、push 待推送或失败待重试。
export function isPushEligible(state: RequirementPipelineState): boolean {
  if (state.pull !== "synced") return false;
  const ownerResolved =
    state.owner === "auto_mapped" ||
    state.owner === "manually_mapped" ||
    state.owner === "not_required";
  if (!ownerResolved) return false;
  return state.push === "pending" || state.push === "failed";
}
