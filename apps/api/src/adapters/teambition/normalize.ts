import { createHash } from "node:crypto";
import type { NormalizedTeambitionRequirement } from "../../domain/workflow.js";
import type {
  TeambitionCustomField,
  TeambitionFieldMap,
  TeambitionTaskRecord,
} from "./raw-types.js";

function parseCustomFields(
  raw: TeambitionTaskRecord["custom_fields"],
): TeambitionCustomField[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || raw.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as TeambitionCustomField[])
      : [];
  } catch {
    return [];
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function allowlistedSourcePayload(
  task: TeambitionTaskRecord,
  fields: TeambitionCustomField[],
  mappedIds: Set<string>,
): Record<string, unknown> {
  const allowed = fields
    .filter((field) => mappedIds.has(field._customfieldid))
    .map((field) => ({
      id: field._customfieldid,
      type: field.type ?? null,
      value: field.value ?? null,
      values: field.values ?? null,
    }));

  return {
    id: task.id,
    unique_id: task.unique_id ?? null,
    content: task.content ?? "",
    creator_id: task.creator_id ?? null,
    executor_id: task.executor_id ?? null,
    taskflow_status_id: task.taskflow_status_id ?? null,
    scenariofield_config_id: task.scenariofield_config_id ?? null,
    created: task.created ?? null,
    startdate: task.startdate ?? null,
    duedate: task.duedate ?? null,
    custom_fields: allowed,
  };
}

export function normalizeTeambitionTask(
  projectId: string,
  task: TeambitionTaskRecord,
  fieldMap: TeambitionFieldMap,
): NormalizedTeambitionRequirement {
  if (!task.id) throw new Error("Teambition task is missing its stable id");

  const customFields = parseCustomFields(task.custom_fields);
  const byId = new Map(customFields.map((field) => [field._customfieldid, field]));
  const mappedFields: Record<string, unknown> = {};

  for (const [domainField, teambitionFieldId] of Object.entries(fieldMap)) {
    const field = byId.get(teambitionFieldId);
    if (field) mappedFields[domainField] = field.value ?? field.values ?? null;
  }

  const mappedIds = new Set(Object.values(fieldMap));
  const sourcePayload = allowlistedSourcePayload(task, customFields, mappedIds);

  return {
    sourceProjectId: projectId,
    sourceRequirementId: task.id,
    title: task.content?.trim() ?? "",
    sourceUniqueId: typeof task.unique_id === "number" ? task.unique_id : null,
    sourceCreatedAt: task.created ?? null,
    sourceUpdatedAt: null,
    sourceCreatorId: task.creator_id ?? null,
    sourceExecutorId: task.executor_id ?? null,
    sourceStatusId: task.taskflow_status_id ?? null,
    sourceTypeId: task.scenariofield_config_id ?? null,
    mappedFields,
    sourcePayload,
  };
}

export function sourcePayloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}
