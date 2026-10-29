// 重复/忽略决策的领域类型与派生规则。
// 决策按稳定身份 (source_config_id, teambition_requirement_id) 保存，与需求行生命周期解耦：
// 应用内删除记录、TB 全量/增量重推后，决策仍然生效。
export type ResolutionDecision = "duplicate" | "ignored" | "confirmed_unique";
export type ResolutionReviewState = "suspected" | "confirmed";
export type ProcessingState = "active" | "suppressed_duplicate" | "suppressed_ignored";

export interface RequirementResolutionRecord {
  decision: ResolutionDecision;
  reviewState: ResolutionReviewState;
  canonicalRequirementId: string | null;
  canonicalTbRequirementId: string | null;
  reason: string | null;
  version: number;
  decidedBy: string;
  decidedAt: string;
}

/** 只有“已确认”的 duplicate/ignored 才压制处理；suspected 永不压制（避免误合并藏需求）。 */
export function effectiveProcessingState(
  resolution: Pick<RequirementResolutionRecord, "decision" | "reviewState"> | null | undefined,
): ProcessingState {
  if (!resolution || resolution.reviewState !== "confirmed") return "active";
  if (resolution.decision === "duplicate") return "suppressed_duplicate";
  if (resolution.decision === "ignored") return "suppressed_ignored";
  return "active";
}

/** 处理链路统一闸口：false 表示不进入 AI 分析/Base 推送/通知。 */
export function isProcessingSuppressed(state: ProcessingState | null | undefined): boolean {
  return (state ?? "active") !== "active";
}
