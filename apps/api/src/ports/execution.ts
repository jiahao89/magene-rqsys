// 执行端口：将"谁来运行作业"与"作业编排逻辑"解耦。
// 本地测试使用 NoopExecution 或回调注入；目标 Miaoda 适配器在 Ticket 00 验证后接入。

import type { JobRun, SyncStage } from "../jobs/types.js";

export interface ExecutionPort {
  // 执行指定 run 的指定阶段。返回成功或失败（含错误类别）。
  // 实现不应在此处持久化状态——编排层负责通过 storage port 推进状态。
  executeStage(
    run: JobRun,
    stage: SyncStage,
  ): Promise<{ status: "succeeded" | "failed"; errorClass?: string }>;
}

// 测试用回调执行器：允许测试注入每阶段的确定性结果。
export class CallbackExecution implements ExecutionPort {
  constructor(
    private readonly handler: (
      run: JobRun,
      stage: SyncStage,
    ) => Promise<{ status: "succeeded" | "failed"; errorClass?: string }>,
  ) {}

  async executeStage(
    run: JobRun,
    stage: SyncStage,
  ): Promise<{ status: "succeeded" | "failed"; errorClass?: string }> {
    return this.handler(run, stage);
  }
}

// 立即成功的执行器，用于只关心编排逻辑的测试。
export class AlwaysSucceedExecution implements ExecutionPort {
  async executeStage(): Promise<{ status: "succeeded" }> {
    return { status: "succeeded" };
  }
}
