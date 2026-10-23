/**
 * 需求池纯展示逻辑：把 API 已有的数据映射为列表/详情需要的事实与排序。
 *
 * 关键约束：/api/requirements 的契约不改。列表/详情 DTO 只提供
 * `pipeline`、`source`（Teambition allowlist 快照）与 `analysis`，没有
 * 负责人姓名、更新时间等字段。这里优先读取将来可能下发的展示字段，
 * 读不到时退回 Teambition 快照中可验证的信息，仍读不到就返回 null，
 * 由 UI 显示「—」并说明原因，不编造姓名或时间。
 */
import type { RequirementDetail, RequirementSummary } from "./api";

export type RequirementLike = Pick<RequirementSummary, "id" | "title" | "pipeline"> & {
  source?: Record<string, unknown>;
  ownerName?: string | null;
  updatedAt?: string | null;
};

type SourceRecord = Record<string, unknown>;

function asRecord(value: unknown): SourceRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SourceRecord)
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asText(value);
    if (text !== null) return text;
  }
  return null;
}

function parseJsonRecord(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * `source` 正常是 allowlisted Teambition payload；部分历史/未来响应会把
 * 快照包在 `sourcePayload` 里。两种形态都接受，避免列表空白。
 */
function rawSource(source: Record<string, unknown> | undefined): SourceRecord {
  const base = asRecord(source) ?? {};
  const nested = asRecord(base.sourcePayload);
  return nested ?? base;
}

function mappedFields(source: Record<string, unknown> | undefined): SourceRecord {
  const base = asRecord(source) ?? {};
  return asRecord(base.mappedFields) ?? asRecord(rawSource(source).mappedFields) ?? {};
}

function findPersonName(customFields: unknown, userId: string | null, depth = 0): string | null {
  if (!userId || depth > 8) return null;
  const value = parseJsonRecord(customFields);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = findPersonName(entry, userId, depth + 1);
      if (name) return name;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const meta = asRecord(record.meta);
  const ids = [record.userid, record.userId, meta?.userid, meta?.userId]
    .map((item) => asText(item))
    .filter((item): item is string => item !== null);
  if (ids.includes(userId)) {
    const name = firstText(record.title, record.name);
    if (name) return name;
  }
  for (const key of ["value", "values", "meta", "entries"]) {
    const name = findPersonName(record[key], userId, depth + 1);
    if (name) return name;
  }
  return null;
}

function personName(
  source: Record<string, unknown> | undefined,
  raw: SourceRecord,
  directName: unknown,
  userId: unknown,
  mappedKey: "executorName" | "proposerName",
): string | null {
  const mapped = mappedFields(source);
  return firstText(directName, mapped[mappedKey], raw[mappedKey])
    ?? findPersonName(raw.custom_fields, asText(userId));
}

export interface RequirementOwnerView {
  /** 列表/详情显示的中文名；未分配时为「待分配」。 */
  label: string;
  name: string | null;
  initial: string;
  unassigned: boolean;
  notRequired: boolean;
  title: string;
}

export function requirementExecutorName(requirement: RequirementLike): string | null {
  const raw = rawSource(requirement.source);
  return personName(
    requirement.source,
    raw,
    requirement.source?.executorName,
    raw.executor_id ?? requirement.source?.sourceExecutorId,
    "executorName",
  );
}

export function requirementProposerName(requirement: Pick<RequirementDetail, "source">): string | null {
  const raw = rawSource(requirement.source);
  return personName(
    requirement.source,
    raw,
    requirement.source?.proposerName,
    raw.creator_id ?? requirement.source?.sourceCreatorId,
    "proposerName",
  );
}

/**
 * 负责人展示。只有在 `auto_mapped` 时才把 TB 执行人姓名当作负责人姓名：
 * 自动匹配要求身份一致；`manually_mapped` 可能是另一个人，姓名又未下发，
 * 因此显示「已手动指定」而不是张冠李戴。
 */
export function requirementOwnerView(requirement: RequirementLike): RequirementOwnerView {
  const ownerState = requirement.pipeline.owner;
  if (ownerState === "pending_mapping") {
    return {
      label: "待分配",
      name: null,
      initial: "待",
      unassigned: true,
      notRequired: false,
      title: "尚未分配负责人，点击「分配」进入详情页选择飞书用户。",
    };
  }
  if (ownerState === "not_required") {
    return {
      label: "无需负责人",
      name: null,
      initial: "—",
      unassigned: false,
      notRequired: true,
      title: "Teambition 未提供执行人，该需求无需匹配负责人。",
    };
  }
  const explicit = asText(requirement.ownerName);
  const derived = ownerState === "auto_mapped" ? requirementExecutorName(requirement) : null;
  const name = explicit ?? derived;
  if (name) {
    return {
      label: name,
      name,
      initial: name.slice(0, 1).toLocaleUpperCase(),
      unassigned: false,
      notRequired: false,
      title: explicit ? "负责人姓名由 API 下发。" : "负责人由 TB 执行人自动匹配；姓名为 Teambition 执行人姓名。",
    };
  }
  return {
    label: ownerState === "manually_mapped" ? "已手动指定" : "已匹配负责人",
    name: null,
    initial: "负",
    unassigned: false,
    notRequired: false,
    title: "负责人已匹配，但接口未返回负责人姓名；请在负责人映射中查看飞书用户。",
  };
}

export interface RequirementTimeView {
  /** 可用的 ISO/本地时间字符串；null 表示源端未提供。 */
  value: string | null;
  /** true 表示没有更新时间，只能退回创建时间展示。 */
  fallbackToCreated: boolean;
}

export function requirementTime(requirement: RequirementLike): RequirementTimeView {
  const raw = rawSource(requirement.source);
  const updated = firstText(
    requirement.updatedAt,
    requirement.source?.updatedAt,
    requirement.source?.sourceUpdatedAt,
    raw.updated,
    raw.updatedAt,
  );
  if (updated) return { value: updated, fallbackToCreated: false };
  const created = firstText(
    requirement.source?.createdAt,
    requirement.source?.sourceCreatedAt,
    raw.created,
    raw.createdAt,
  );
  return { value: created, fallbackToCreated: created !== null };
}

export function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return null;
  return time.toLocaleString("zh-CN");
}

function attentionRank(requirement: RequirementLike): number {
  if (requirement.pipeline.owner === "pending_mapping") return 0;
  if (requirement.pipeline.push === "failed") return 1;
  if (requirement.pipeline.push === "pending" || requirement.pipeline.push === "running") return 2;
  if (requirement.pipeline.push === "pushed") return 3;
  return 4;
}

/**
 * 默认排序：待分配负责人 > 推送失败 > 待推送 > 已推送；同组按更新时间倒序
 * （接口未下发更新时间时退回 Teambition 创建时间）。
 * 服务端按创建时间返回，不能改接口，因此在客户端对已加载行排序。
 */
export function sortRequirementsForAttention<T extends RequirementLike>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const rank = attentionRank(left) - attentionRank(right);
    if (rank !== 0) return rank;
    const leftTime = requirementTime(left).value;
    const rightTime = requirementTime(right).value;
    const leftStamp = leftTime ? new Date(leftTime).getTime() : Number.NEGATIVE_INFINITY;
    const rightStamp = rightTime ? new Date(rightTime).getTime() : Number.NEGATIVE_INFINITY;
    if (leftStamp !== rightStamp) return rightStamp - leftStamp;
    return left.title.localeCompare(right.title, "zh-CN") || left.id.localeCompare(right.id);
  });
}

export interface RequirementSourceFacts {
  description: string | null;
  proposerName: string | null;
  executorName: string | null;
  tbStatus: string | null;
  tbUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** L1「需求信息」的 Teambition 原始字段。缺失值保持 null，由 UI 显示「—」。 */
export function requirementSourceFacts(requirement: Pick<RequirementDetail, "source" | "sourceUrl">): RequirementSourceFacts {
  const source = asRecord(requirement.source) ?? {};
  const raw = rawSource(requirement.source);
  const mapped = mappedFields(requirement.source);
  return {
    description: firstText(source.description, mapped.description),
    proposerName: requirementProposerName(requirement),
    executorName: personName(source, raw, source.executorName, raw.executor_id ?? source.sourceExecutorId, "executorName"),
    // 只展示状态名称；仅有 taskflow_status_id 时不把内部 ID 当成业务状态展示。
    tbStatus: firstText(
      source.tbStatusName,
      source.statusName,
      raw.taskflow_status_name,
    ),
    // 接口在顶层给出由任务 ID 推导的 TB 地址；原始 payload 里通常没有该字段。
    tbUrl: firstText(requirement.sourceUrl, source.sourceUrl, source.source_url, source.url),
    createdAt: firstText(source.createdAt, source.sourceCreatedAt, raw.created),
    updatedAt: firstText(source.updatedAt, source.sourceUpdatedAt, raw.updated),
  };
}

