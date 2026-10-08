// 同步流水线统一阶段定义。与 domain/workflow.ts 的分阶段状态互补，
// 此处 SyncStage 用于调度 / 重试 / 审计层的阶段定位，不直接耦合上游状态机。

export type SyncStage = "pull" | "analysis" | "owner_mapping" | "push";

// 阶段执行顺序，用于校验重试只能向前推进、不能回滚已成功阶段。
export const STAGE_ORDER: readonly SyncStage[] = [
  "pull",
  "analysis",
  "owner_mapping",
  "push",
] as const;

export type JobStatus =
  | "pending" // 已创建，等待 worker claim
  | "running" // 已被 worker claim，lease 仍有效
  | "succeeded" // 所有阶段成功
  | "failed" // 某阶段失败，仍可重试
  | "dead"; // 超出最大尝试次数，进入死信

export type TriggerKind = "scheduled" | "manual";

// 幂等键类型别名，强调同一键的重复触发不创建重复工作。
export type IdempotencyKey = string;

// 单个阶段的一次执行结果。仅记录状态与错误类别，不含原始载荷或个人信息。
export interface StageResult {
  stage: SyncStage;
  status: "succeeded" | "failed";
  attempt: number; // 该阶段第几次尝试（从 1 开始）
  errorClass?: string; // 失败时的错误类别（如 "network" / "provider_5xx" / "validation"）
  finishedAt: string; // ISO 8601
}

// 持久作业运行状态。设计为可序列化存储，便于 storage port 实现。
export interface JobRun {
  id: string; // run UUID（crypto.randomUUID() 生成）
  sourceProjectId: string;
  sourceRequirementId: string;
  trigger: TriggerKind;
  idempotencyKey: IdempotencyKey;
  status: JobStatus;
  attempt: number; // 整体尝试次数（从 1 开始）
  currentStage: SyncStage | null; // 当前执行阶段，null 表示尚未开始
  stageResults: StageResult[]; // 已完成阶段的结果，按完成顺序追加
  workerId: string | null; // 当前持有 lease 的 worker
  leaseExpiresAt: string | null; // ISO 8601，null 表示尚未 claim
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// claim 请求：用于在 storage 上创建或接管 run。
export interface ClaimRequest {
  sourceProjectId: string;
  sourceRequirementId: string;
  trigger: TriggerKind;
  idempotencyKey: IdempotencyKey;
  workerId: string;
  leaseDurationMs: number;
  now: string; // ISO 8601，调用方传入以保证确定性
}

// claim 结果判别联合，覆盖不变量 1 与 3 的全部路径。
export type ClaimOutcome =
  | { kind: "claimed"; run: JobRun } // 新建并 claim
  | { kind: "already_active"; run: JobRun } // 同幂等键已有有效 lease 的 run
  | { kind: "lease_expired_reclaimed"; run: JobRun } // 回收过期 lease 并重新 claim
  | { kind: "terminal_rejected"; run: JobRun }; // 同幂等键的 run 已终态，不重复创建

// 完成阶段的请求。
export interface AdvanceRequest {
  runId: string;
  stage: SyncStage;
  status: "succeeded" | "failed";
  errorClass?: string;
  workerId: string;
  now: string;
}
