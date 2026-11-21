import { createHash } from "node:crypto";
import type { NormalizedTeambitionRequirement } from "../../domain/workflow.js";
import type { SourcePool } from "../../domain/persistence.js";
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

function rtfHtml(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === "string") return candidate;
  if (!candidate || typeof candidate !== "object") return null;
  const meta = (candidate as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const html = (meta as { html?: unknown }).html;
  return typeof html === "string" ? html : null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|tr)\s*>/giu, "\n")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function lookupEntries(value: unknown): Record<string, unknown>[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
}

function lookupValues(value: unknown): { names: string[]; userIds: string[] } {
  const entries = lookupEntries(value);
  const names = entries.flatMap((entry) => typeof entry.title === "string" ? [entry.title.trim()] : []);
  const userIds = entries.flatMap((entry) => {
    const meta = entry.meta;
    if (meta && typeof meta === "object" && typeof (meta as { userid?: unknown }).userid === "string") return [(meta as { userid: string }).userid];
    return typeof entry.userid === "string" ? [entry.userid] : [];
  });
  return { names: names.filter(Boolean), userIds };
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
  const allowedById = new Map<string, TeambitionCustomField>();
  for (const field of fields) {
    if (mappedIds.has(field._customfieldid)) allowedById.set(field._customfieldid, field);
  }
  const allowed = Array.from(allowedById.values()).map((field) => ({
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

/**
 * 集团池默认字段映射（P0 已核对：需求收集与管理 项目内字段 ID）。
 * 需求类型/功能模块/约束没有 1:1 映射，保持 null，原文仍在 source_payload。
 */
export const GROUP_POOL_DEFAULT_FIELD_MAP: Readonly<TeambitionFieldMap> = Object.freeze({
  description: "674e7c2ceed2e651764a0d6f", // 需求描述
  proposerName: "68be4f5f4f5b7255e6fda8d6", // 需求提出人
  productModel: "6755a2581f580fe19bfaf70f", // 关联产品的具体信息
});

/**
 * 同步时使用的字段映射：集团池未在来源配置里写映射（{}）时回落到集团池默认值，
 * 这样已有记录下次同步会按新映射重算哈希并回填；产品池保持原样（空映射仍为空）。
 * 显式配置了任意映射时以配置为准，不混入默认值。
 */
export function resolveFieldMap(pool: SourcePool | undefined, fieldMap: TeambitionFieldMap): TeambitionFieldMap {
  if ((pool ?? "product") === "group" && Object.keys(fieldMap).length === 0) return { ...GROUP_POOL_DEFAULT_FIELD_MAP };
  return fieldMap;
}

export function normalizeTeambitionTask(
  projectId: string,
  task: TeambitionTaskRecord,
  fieldMap: TeambitionFieldMap,
): NormalizedTeambitionRequirement {
  if (!task.id) throw new Error("Teambition task is missing its stable id");

  const customFields = parseCustomFields(task.custom_fields);
  const byId = new Map<string, TeambitionCustomField>();
  for (const field of customFields) byId.set(field._customfieldid, field);
  const mappedFields: Record<string, unknown> = {};

  for (const [domainField, teambitionFieldId] of Object.entries(fieldMap)) {
    const field = byId.get(teambitionFieldId);
    if (!field) continue;
    const rawValue = field.value ?? field.values ?? null;
    if (field.type?.toLocaleLowerCase() === "rtf" && (domainField === "description" || domainField === "acceptanceCriteria")) {
      const html = rtfHtml(rawValue);
      mappedFields[domainField] = html === null ? null : htmlToText(html);
      continue;
    }
    if (domainField === "proposerName" || domainField === "executorName") {
      const lookup = lookupValues(rawValue);
      mappedFields[domainField] = lookup.names.length ? lookup.names.join("、") : (typeof rawValue === "string" ? rawValue : null);
      if (domainField === "proposerName") mappedFields.proposerUserId = lookup.userIds[0] ?? null;
      continue;
    }
    mappedFields[domainField] = rawValue;
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
