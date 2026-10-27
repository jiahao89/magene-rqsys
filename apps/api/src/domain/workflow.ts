export type PullState = "pending" | "running" | "synced" | "failed" | "collected";
export type AnalysisState =
  | "pending"
  | "running"
  | "analyzed"
  | "failed_retryable";
export type OwnerState =
  | "pending_mapping"
  | "auto_mapped"
  | "manually_mapped"
  | "not_required";
export type PushState = "pending" | "running" | "pushed" | "failed";
export type BatchState = "running" | "succeeded" | "partial_failure" | "failed";

export interface RequirementPipelineState {
  pull: PullState;
  analysis: AnalysisState;
  owner: OwnerState;
  push: PushState;
}

export interface SourceProjectConfig {
  id: string;
  projectId: string;
  projectName: string;
  requirementTypeId: string;
  enabled: boolean;
  schedule: {
    enabled: boolean;
    weekday: number | null;
    weekdays?: number[] | null;
    time: string | null;
    timezone: string | null;
  };
  ownerNames: string[];
  fieldMap: Record<string, string>;
}

/**
 * 收录完成判定（V02-S00）：后台就绪判断基于来源事实已持久化，而不是所有来源都 pull=synced。
 * T01 阶段仅 TB 拉取的 synced 视为收录完成；V02-T02/T04 扩展手工来源的 collected 语义。
 */
export function isIntakeComplete(pull: PullState): boolean {
  // collected：Web 手工收录（V02-T02 预留语义）；TB 拉取的 synced 语义不变。
  return pull === "synced" || pull === "collected";
}

/** Normalize PostgreSQL TIME values to the API's minute-precision HH:mm clock. */
export function normalizeScheduleTime(value: string | null): string | null {
  if (value === null) return null;
  const match = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.exec(value);
  return match ? match[0].slice(0, 5) : value;
}

export interface NormalizedTeambitionRequirement {
  sourceProjectId: string;
  sourceRequirementId: string;
  title: string;
  sourceUniqueId: number | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceCreatorId: string | null;
  sourceExecutorId: string | null;
  sourceStatusId: string | null;
  sourceTypeId: string | null;
  mappedFields: Record<string, unknown>;
  sourcePayload: Record<string, unknown>;
}
