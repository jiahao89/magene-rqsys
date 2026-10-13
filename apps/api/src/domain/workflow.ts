export type PullState = "pending" | "running" | "synced" | "failed";
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
    time: string | null;
    timezone: string | null;
  };
  ownerNames: string[];
  fieldMap: Record<string, string>;
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
