// 内存作业存储 + 推进逻辑实现：用于本地测试和小规模验证。
// 目标 Miaoda 适配器在 Ticket 00 验证后接入，替换此类。
// 此实现保证：幂等键唯一映射、同身份活跃互斥（不变量 1）、lease 校验、
// 阶段结果追加只读。

import {
  JobNotFoundError,
  LeaseNotHeldError,
  type JobStorage,
} from "../ports/storage.js";
import { decideClaim, isLeaseValidAt, nextStage } from "./claim.js";
import type {
  AdvanceRequest,
  ClaimOutcome,
  ClaimRequest,
  JobRun,
  StageResult,
} from "./types.js";

export class InMemoryJobStorage implements JobStorage {
  private readonly runs = new Map<string, JobRun>(); // id -> run
  private readonly idempotencyIndex = new Map<string, string>(); // idempotencyKey -> runId
  private readonly identityIndex = new Map<string, string>(); // sourceConfigId:teambitionRequirementId -> 最近 runId

  async claim(request: ClaimRequest): Promise<ClaimOutcome> {
    const existingId = this.idempotencyIndex.get(request.idempotencyKey) ?? null;
    const existing = existingId ? (this.runs.get(existingId) ?? null) : null;

    const identityKey = `${request.sourceConfigId}:${request.teambitionRequirementId}`;
    const activeId = this.identityIndex.get(identityKey) ?? null;
    const activeForIdentity = activeId ? (this.runs.get(activeId) ?? null) : null;

    const outcome = decideClaim(existing, request, activeForIdentity);

    // 持久化结果
    this.runs.set(outcome.run.id, outcome.run);
    this.idempotencyIndex.set(request.idempotencyKey, outcome.run.id);
    this.identityIndex.set(identityKey, outcome.run.id);

    return outcome;
  }

  async advance(request: AdvanceRequest): Promise<JobRun> {
    const run = this.runs.get(request.runId);
    if (!run) {
      throw new JobNotFoundError(request.runId);
    }

    // lease 校验：worker 必须仍持有有效 lease
    if (run.workerId !== request.workerId || !isLeaseValidAt(run, request.now)) {
      throw new LeaseNotHeldError(request.runId, request.workerId);
    }

    // 阶段校验：推进的必须是当前阶段
    if (run.currentStage !== request.stage) {
      throw new Error(
        `Stage mismatch: expected ${run.currentStage ?? "none"}, got ${request.stage}`,
      );
    }

    const updated = applyStageResult(run, request);
    this.runs.set(updated.id, updated);
    return updated;
  }

  async findByIdempotencyKey(key: string): Promise<JobRun | null> {
    const id = this.idempotencyIndex.get(key);
    if (!id) return null;
    return (this.runs.get(id) ?? null);
  }

  async findById(id: string): Promise<JobRun | null> {
    return this.runs.get(id) ?? null;
  }
}

// 应用阶段结果到 run：成功则推进到下一阶段或标记 succeeded；失败则标记 failed。
// 成功阶段不回滚（不变量 2）。
function applyStageResult(run: JobRun, request: AdvanceRequest): JobRun {
  const stageResult: StageResult = {
    stage: request.stage,
    status: request.status,
    attempt: run.attempt,
    ...(request.errorClass === undefined
      ? {}
      : { errorClass: request.errorClass }),
    finishedAt: request.now,
  };

  const updatedResults = [...run.stageResults, stageResult];

  if (request.status === "succeeded") {
    const next = nextStage({ ...run, stageResults: updatedResults });
    if (next === null) {
      // 全部阶段成功
      return {
        ...run,
        stageResults: updatedResults,
        currentStage: null,
        status: "succeeded",
        workerId: null,
        leaseExpiresAt: null,
        updatedAt: request.now,
      };
    }
    return {
      ...run,
      stageResults: updatedResults,
      currentStage: next,
      updatedAt: request.now,
    };
  }

  // 失败：标记 failed，保留 worker（lease 仍有效，重试时会重新 claim）
  return {
    ...run,
    stageResults: updatedResults,
    status: "failed",
    updatedAt: request.now,
  };
}
