import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAutoOwnerSuggestion,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isPushEligible,
} from "./transitions.js";
import type { RequirementPipelineState } from "./workflow.js";

function pipeline(overrides?: Partial<RequirementPipelineState>): RequirementPipelineState {
  return {
    pull: "pending",
    analysis: "pending",
    owner: "pending_mapping",
    push: "pending",
    ...overrides,
  };
}

test("pull 合法迁移：pending → running → synced/failed，failed → pending 重试", () => {
  assert.equal(canTransition("pull", "pending", "running"), true);
  assert.equal(canTransition("pull", "running", "synced"), true);
  assert.equal(canTransition("pull", "running", "failed"), true);
  assert.equal(canTransition("pull", "failed", "pending"), true);
  assert.equal(canTransition("pull", "failed", "running"), true);
  // 后续批次重新拉取
  assert.equal(canTransition("pull", "synced", "running"), true);
});

test("pull 非法迁移被拒绝", () => {
  assert.equal(canTransition("pull", "pending", "synced"), false);
  assert.equal(canTransition("pull", "synced", "failed"), false);
  assert.equal(canTransition("pull", "failed", "synced"), false);
});

test("analysis 合法迁移：failed_retryable → pending/running（新建版本重试）", () => {
  assert.equal(canTransition("analysis", "pending", "running"), true);
  assert.equal(canTransition("analysis", "running", "analyzed"), true);
  assert.equal(canTransition("analysis", "running", "failed_retryable"), true);
  assert.equal(canTransition("analysis", "failed_retryable", "pending"), true);
  assert.equal(canTransition("analysis", "analyzed", "running"), true);
  assert.equal(canTransition("analysis", "analyzed", "pending"), true); // 新源版本更新会使上一版本结果失效
});

test("owner 迁移：auto_mapped → manually_mapped 允许，人工映射不可被自动流程改写", () => {
  assert.equal(canTransition("owner", "pending_mapping", "auto_mapped"), true);
  assert.equal(canTransition("owner", "pending_mapping", "manually_mapped"), true);
  assert.equal(canTransition("owner", "pending_mapping", "not_required"), true);
  assert.equal(canTransition("owner", "auto_mapped", "manually_mapped"), true);
  // 关键保护：manually_mapped 是迁移终点，自动流程不能改写
  assert.equal(canTransition("owner", "manually_mapped", "auto_mapped"), false);
  assert.equal(canTransition("owner", "manually_mapped", "pending_mapping"), true); // TB 负责人实质变更后重新解析；无匹配时仓储保留 Base 手动负责人
  assert.equal(canTransition("owner", "not_required", "pending_mapping"), true);
});

test("push 合法迁移：failed → pending 重试，pushed → running 实质更新", () => {
  assert.equal(canTransition("push", "pending", "running"), true);
  assert.equal(canTransition("push", "running", "pushed"), true);
  assert.equal(canTransition("push", "running", "failed"), true);
  assert.equal(canTransition("push", "failed", "pending"), true);
  assert.equal(canTransition("push", "pushed", "running"), true);
  assert.equal(canTransition("push", "pushed", "failed"), false);
});

test("assertTransition 非法迁移抛 InvalidTransitionError", () => {
  assert.throws(() => assertTransition("pull", "synced", "failed"), InvalidTransitionError);
  assert.throws(() => assertTransition("owner", "manually_mapped", "auto_mapped"), /Invalid owner transition/);
  assert.doesNotThrow(() => assertTransition("push", "failed", "pending"));
});

test("不变量：自动映射建议不覆盖人工确认字段", () => {
  // manually_mapped 永远保留人工结果
  assert.equal(applyAutoOwnerSuggestion("manually_mapped", true), "manually_mapped");
  assert.equal(applyAutoOwnerSuggestion("manually_mapped", false), "manually_mapped");
  // 其他状态：有执行人 → auto_mapped
  assert.equal(applyAutoOwnerSuggestion("pending_mapping", true), "auto_mapped");
  assert.equal(applyAutoOwnerSuggestion("auto_mapped", true), "auto_mapped");
  // 无执行人 → not_required（无负责人需求可导入、可空负责人推送）
  assert.equal(applyAutoOwnerSuggestion("pending_mapping", false), "not_required");
  assert.equal(applyAutoOwnerSuggestion("not_required", false), "not_required");
});

test("不变量：低置信/缺优先级/首轮 AI 失败不阻塞合格推送", () => {
  // 分析失败不阻塞推送资格
  assert.equal(
    isPushEligible(
      pipeline({
        pull: "synced",
        analysis: "failed_retryable",
        owner: "auto_mapped",
        push: "pending",
      }),
    ),
    true,
  );
  // 分析 analyzed + 推送失败 → 可重试推送
  assert.equal(
    isPushEligible(
      pipeline({
        pull: "synced",
        analysis: "analyzed",
        owner: "manually_mapped",
        push: "failed",
      }),
    ),
    true,
  );
  // 无负责人需求（not_required）可空负责人推送
  assert.equal(
    isPushEligible(
      pipeline({
        pull: "synced",
        analysis: "pending",
        owner: "not_required",
        push: "pending",
      }),
    ),
    true,
  );
});

test("不变量：未完成前置阶段的推送不合格", () => {
  // pull 未同步
  assert.equal(
    isPushEligible(
      pipeline({ pull: "running", owner: "auto_mapped", push: "pending" }),
    ),
    false,
  );
  // owner 映射处理未完成
  assert.equal(
    isPushEligible(pipeline({ pull: "synced", owner: "pending_mapping", push: "pending" })),
    false,
  );
  // push 已在运行或已推送
  assert.equal(
    isPushEligible(pipeline({ pull: "synced", owner: "auto_mapped", push: "running" })),
    false,
  );
  assert.equal(
    isPushEligible(pipeline({ pull: "synced", owner: "auto_mapped", push: "pushed" })),
    false,
  );
});
