// Base 字段映射：产品池与集团池共用结构、独立配置。
// 0031：集团 PM 表由产品表复制而来，字段名与字段 ID 一致；唯一的已知差异是链接列叫「TB链接」
// （产品表为「TB地址」）。因此集团池必须显式映射到「TB链接」，且绝不能套用产品池那条
// 「TB链接 → TB地址」的历史兼容改写，否则会写入不存在的字段。
//
// 注意：`duplicate`（Q2 重复标记字段）与当前线上行为一致，不在此处解析——保持既有语义不变。

import type { SourcePool } from "../domain/persistence.js";
import type { BaseFieldMap } from "./client.js";

/** 通知字段默认值：四个「系统字段」+ 需求深链（精确形状，便于直接满足结构类型）。 */
export const DEFAULT_BASE_NOTIFICATION_FIELDS: NonNullable<BaseFieldMap["notification"]> = {
  eventId: "系统通知事件ID", eventType: "系统通知类型", recipient: "系统通知收件人",
  ownerMergeValue: "系统负责人通知归并值", requirementLink: "系统需求链接",
};

/** 产品池 Base 字段默认值（与线上 PM 表一致）。 */
export const DEFAULT_BASE_FIELDS: BaseFieldMap = {
  requirementId: "TB需求ID",
  platformRequirementId: "需求平台ID",
  owner: "执行人",
  // The selected TB project's custom-field type/binding is unverified. Only map
  // standard fields whose semantics and the Base column type are verified.
  source: { title: "标题", createdAt: "TB创建时间", sourceUrl: "TB地址" },
  ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" },
  pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"],
  metadata: { sourceVersion: "源版本", pushState: "推送状态", lastPushedAt: "最后推送时间" },
  // 通知由 Base 自动化规则发送；应用只写四个通知「系统字段」，外加一个给 PM 点击的需求深链字段。
  // requirementLink 每次推送都写，与通知事件无关（首推静默也写）。
  notification: DEFAULT_BASE_NOTIFICATION_FIELDS,
  selectOptions: {
    // Verified against the safe POC Base schema; override via BASE_FIELDS_JSON
    // together with Base options when the product module dictionary changes.
    module: ["需求澄清", "方案设计", "缺陷修复", "其他"],
    priority: ["P0", "P1", "P2", "P3"],
  },
};

/** 集团池 Base 字段默认值：结构同产品表，链接列是「TB链接」。 */
export const DEFAULT_GROUP_BASE_FIELDS: BaseFieldMap = {
  ...DEFAULT_BASE_FIELDS,
  source: { ...DEFAULT_BASE_FIELDS.source, sourceUrl: "TB链接" },
};

/**
 * 解析 BASE_FIELDS_JSON / GROUP_BASE_FIELDS_JSON。
 * - product（缺省）：保留历史兼容——配置写「TB链接」时改写为「TB地址」。
 * - group：不做该改写；未配置 source.sourceUrl 时默认「TB链接」。
 */
export function parseBaseFields(raw: string | undefined, options: { pool?: SourcePool } = {}): BaseFieldMap {
  const pool = options.pool ?? "product";
  const defaults = pool === "group" ? DEFAULT_GROUP_BASE_FIELDS : DEFAULT_BASE_FIELDS;
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<BaseFieldMap>;
    const source = { ...defaults.source, ...(parsed.source ?? {}) };
    // 历史兼容只保留在产品池：集团表列名就是「TB链接」，改写会写到不存在的字段。
    if (pool === "product" && source.sourceUrl === "TB链接") source.sourceUrl = "TB地址";
    return {
      requirementId: parsed.requirementId ?? defaults.requirementId,
      ...(parsed.platformRequirementId ?? defaults.platformRequirementId
        ? { platformRequirementId: (parsed.platformRequirementId ?? defaults.platformRequirementId)! }
        : {}),
      owner: parsed.owner ?? defaults.owner,
      source,
      ai: { ...defaults.ai, ...(parsed.ai ?? {}) },
      pm: Array.isArray(parsed.pm) ? parsed.pm : defaults.pm,
      metadata: { ...defaults.metadata, ...(parsed.metadata ?? {}) },
      // 缺省回落默认值：notification 整段缺失（或部分缺失）时仍指向 POC 验证过的四个通知字段与需求链接字段。
      notification: { ...DEFAULT_BASE_NOTIFICATION_FIELDS, ...(parsed.notification ?? {}) },
      selectOptions: { ...defaults.selectOptions, ...(parsed.selectOptions ?? {}), priority: ["P0", "P1", "P2", "P3"] },
      ...(typeof parsed.sourceMethod === "string" && parsed.sourceMethod.trim() ? { sourceMethod: parsed.sourceMethod.trim() } : {}),
    };
  } catch {
    return defaults;
  }
}
