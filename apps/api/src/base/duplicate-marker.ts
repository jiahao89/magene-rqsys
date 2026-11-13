// Q2：Base 重复行标记（2026-11-10 决策：不通知）。
//
// 人工确认重复/忽略后，需求被压制、不再进入正常 Base 推送；因此标记不能走 base_push 作业，
// 而是在判定保存/撤销时直接写两个可选文本字段：
//   - 标记字段：重复（主记录 RQ-xxxx） / 已忽略 / 空字符串（撤销时清除）
//   - 主记录链接（可选）：主需求的 Web 深链
// 只写这两个字段，不碰业务/PM/通知字段，也不产生通知。字段未配置或行尚未推送时直接跳过；
// 目标 Base 缺字段（1254045）记为 field_missing，判定本身不受影响。

import { FeishuApiError } from "./transport.js";
import type { BaseClient, BaseFieldMap } from "./client.js";
import { DEFAULT_WEB_BASE_URL, requirementDeepLink } from "./push-service.js";

export interface DuplicateMarkInput {
  /** 需求当前对应的 Base 记录；尚未推送时为 null。 */
  recordId: string | null;
  /** null=撤销判定，清除标记。 */
  decision: "duplicate" | "ignored" | null;
  canonicalRequirementId?: string | null;
  canonicalPlatformRequirementId?: string | null;
}

export type DuplicateMarkResult =
  | { outcome: "skipped" }
  | { outcome: "marked" | "cleared" }
  | { outcome: "field_missing" }
  | { outcome: "failed"; errorCode: string };

export async function markDuplicateInBase(
  deps: { base: Pick<BaseClient, "update">; fields: BaseFieldMap; webBaseUrl?: string | null },
  input: DuplicateMarkInput,
): Promise<DuplicateMarkResult> {
  const mapping = deps.fields.duplicate;
  if (!mapping || !input.recordId) return { outcome: "skipped" };

  const delta: Record<string, unknown> = {};
  delta[mapping.mark] = input.decision === "duplicate"
    ? `重复${input.canonicalPlatformRequirementId ? `（主记录 ${input.canonicalPlatformRequirementId}）` : ""}`
    : input.decision === "ignored"
      ? "已忽略"
      : "";
  if (mapping.canonicalLink) {
    delta[mapping.canonicalLink] = input.decision === "duplicate" && input.canonicalRequirementId
      ? requirementDeepLink(deps.webBaseUrl ?? DEFAULT_WEB_BASE_URL, input.canonicalRequirementId)
      : "";
  }

  try {
    await deps.base.update(input.recordId, delta);
    return { outcome: input.decision === null ? "cleared" : "marked" };
  } catch (error) {
    if (error instanceof FeishuApiError && error.apiCode === 1254045) return { outcome: "field_missing" };
    const errorCode = error instanceof FeishuApiError
      ? `FEISHU_${error.action.replace(/\s+/g, "_").toUpperCase()}`
      : "BASE_DUPLICATE_MARK_FAILED";
    return { outcome: "failed", errorCode };
  }
}
