// 审计事件：捕获 actor/action/entity/result/timestamp，
// 通过 safe-details 白名单过滤禁止字段（密钥、个人联系方式、provider 原始载荷）。
// 不变量 5。事件模型与 audit_events DDL 行一一对应（domain/persistence.ts 的
// AuditEventRecord），本模块是审计事件的唯一构造入口，避免持久层词汇分叉。

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditEventRecord } from "../domain/persistence.js";

// 审计动作受控词汇：覆盖 MVP 流水线的全部关键动作。DDL event_type 为自由文本，
// 此枚举是写入白名单。
export const AuditActionSchema = z.enum([
  "run.claimed",
  "run.lease_reclaimed",
  "run.succeeded",
  "run.failed",
  "run.dead",
  "stage.succeeded",
  "stage.failed",
  "source.pushed_to_base",
  "source.push_skipped",
  "source.created",
  "source.config_updated",
  "owner.manually_mapped",
]);

// result 与 DDL CHECK (result IN ('succeeded', 'failed', 'denied')) 对齐；
// 跳过/拒绝语义由 action 名承载（如 source.push_skipped / denied）。
export const AuditResultSchema = z.enum(["succeeded", "failed", "denied"]);

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  eventType: AuditActionSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  result: AuditResultSchema,
  occurredAt: z.string(),
  safeDetails: z.record(z.string(), z.unknown()),
});

export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;

// 禁止进入审计 safeDetails 的字段名模式：密钥 / 凭据 / 个人联系方式 / provider 原始载荷。
const FORBIDDEN_KEY_PATTERNS: readonly RegExp[] = [
  /api[-_]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /authorization/i,
  /cookie/i,
  /phone/i,
  /mobile/i,
  /email/i,
  /weixin/i,
  /wechat/i,
  /open[-_]?id/i,
  /union[-_]?id/i,
  /payload/i, // provider 原始载荷禁止整体进入
  /request[-_]?body/i,
  /response[-_]?body/i,
];

// safeDetails 字段白名单：只有这些键可以保留。
const ALLOWED_DETAIL_KEYS: readonly string[] = [
  "sourceProjectId",
  "sourceRequirementId",
  "sourceVersion",
  "analysisVersion",
  "priorAnalysisVersion",
  "analysisStatus",
  "entryCount",
  "created",
  "replay",
  "push",
  "trigger",
  "runId",
  "stage",
  "attempt",
  "errorClass",
  "workerId",
  "scheduleWindow",
  "httpStatus",
  "durationMs",
  "reason",
  "confidence",
];

// 判断 safeDetails 键是否命中禁止模式。
function isKeyForbidden(key: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

// 脱敏 safeDetails：只保留白名单键，其余丢弃（不做值级改写，避免误留敏感数据）。
// 嵌套对象整体丢弃——safeDetails 保持扁平，避免敏感数据藏于嵌套结构。
export function redactSafeDetails(
  safeDetails: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (!safeDetails) return safe;

  for (const [key, value] of Object.entries(safeDetails)) {
    if (isKeyForbidden(key)) continue;
    if (!ALLOWED_DETAIL_KEYS.includes(key)) continue;
    // 只保留原始类型值，嵌套结构丢弃
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

// 创建审计事件：自动脱敏 safeDetails 并校验 schema。
// 返回与 DDL 行形状一致的 AuditEventRecord；禁止字段被静默移除。
export function createAuditEvent(params: {
  actor: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  result: AuditResult;
  occurredAt: string;
  safeDetails?: Record<string, unknown>;
}): AuditEventRecord {
  const event = {
    id: randomUUID(),
    actorId: params.actor,
    eventType: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    result: params.result,
    occurredAt: params.occurredAt,
    safeDetails: redactSafeDetails(params.safeDetails),
  };
  return AuditEventSchema.parse(event);
}

// 校验已有序列化的事件（如从存储读回时）。
export function parseAuditEvent(raw: unknown): AuditEventRecord {
  return AuditEventSchema.parse(raw);
}
