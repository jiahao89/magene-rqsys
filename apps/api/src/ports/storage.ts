// 作业存储端口：定义 claim / lease / 推进的接口契约。
// 目标 Miaoda 适配器在 Ticket 00 验证后接入；本地测试使用 InMemoryJobStorage。

import type { ClaimRequest, ClaimOutcome, AdvanceRequest, JobRun } from "../jobs/types.js";

export interface JobStorage {
  // 尝试 claim 一个 run：按幂等键查找已有 run 或创建新 run，
  // 按 lease 有效性返回不同 ClaimOutcome。
  claim(request: ClaimRequest): Promise<ClaimOutcome>;

  // 推进 run 的阶段状态：成功则记录并推进 currentStage，失败则标记 failed。
  // 返回更新后的 run；若 run 不存在或 worker 不持有 lease，抛错。
  advance(request: AdvanceRequest): Promise<JobRun>;

  // 按 idempotencyKey 读取 run（只读，用于校验幂等性）。
  findByIdempotencyKey(key: string): Promise<JobRun | null>;

  // 按 id 读取 run。
  findById(id: string): Promise<JobRun | null>;
}

export class JobNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`Job run not found: ${runId}`);
    this.name = "JobNotFoundError";
  }
}

export class LeaseNotHeldError extends Error {
  constructor(public readonly runId: string, public readonly workerId: string) {
    super(`Worker ${workerId} does not hold a valid lease on run ${runId}`);
    this.name = "LeaseNotHeldError";
  }
}
