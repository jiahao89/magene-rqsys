// 审计事件 schema 与脱敏：捕获 actor/action/object/outcome/timestamp，
// 通过 safe-detail 白名单过滤禁止字段（密钥、个人联系方式、provider 原始载荷）。
// 不变量 5。

import { z } from "zod";

// 审计动作枚举：覆盖 MVP 流水线的全部关键动作。
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
  "source.config_updated",
  "owner.manually_mapped",
]);

// 审计结果枚举。
export const AuditOutcomeSchema = z.enum([
  "success",
  "failure",
  "skipped",
  "rejected",
]);

// 审计事件 schema：actor/action/object/outcome/timestamp 必填，detail 可选。
export const AuditEventSchema = z.object({
  id: z.string().min(1),
  actor: z.string().min(1), // actor 标识（如 "worker:abc" / "pm:张三" / "system"）
  action: AuditActionSchema,
  object: z.string().min(1), // 对象标识（如 "run:<uuid>" / "source:<projectId>:<reqId>"）
  outcome: AuditOutcomeSchema,
  timestamp: z.string(), // ISO 8601
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

// 禁止进入审计 detail 的字段名模式：密钥 / 凭据 / 个人联系方式 / provider 原始载荷。
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

// detail 字段白名单：只有这些键（或匹配这些模式）可以保留。
const ALLOWED_DETAIL_KEYS: readonly string[] = [
  "sourceProjectId",
  "sourceRequirementId",
  "runId",
  "stage",
  "attempt",
  "errorClass",
  "trigger",
  "workerId",
  "scheduleWindow",
  "httpStatus",
  "durationMs",
  "reason",
  "confidence",
];

// 判断 detail 键是否允许保留。
function isKeyAllowed(key: string): boolean {
  if (ALLOWED_DETAIL_KEYS.includes(key)) return true;
  return false;
}

// 判断 detail 键是否命中禁止模式。
function isKeyForbidden(key: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

// 脱敏 detail：只保留白名单键，其余丢弃（不做值级改写，避免误留敏感数据）。
// 嵌套对象整体丢弃——审计 detail 保持扁平，避免敏感数据藏于嵌套结构。
export function redactDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!detail) return undefined;

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (isKeyForbidden(key)) continue;
    if (!isKeyAllowed(key)) continue;
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
  return Object.keys(safe).length > 0 ? safe : undefined;
}

// 创建审计事件：自动脱敏 detail 并校验 schema。
// 返回校验通过的完整事件；detail 中禁止字段被静默移除。
export function createAuditEvent(params: {
  actor: string;
  action: AuditAction;
  object: string;
  outcome: AuditOutcome;
  timestamp: string;
  detail?: Record<string, unknown>;
}): AuditEvent {
  const event = {
    id: crypto.randomUUID(),
    actor: params.actor,
    action: params.action,
    object: params.object,
    outcome: params.outcome,
    timestamp: params.timestamp,
    detail: redactDetail(params.detail),
  };
  return AuditEventSchema.parse(event);
}

// 校验已有序列化的事件（如从存储读回时）。
export function parseAuditEvent(raw: unknown): AuditEvent {
  return AuditEventSchema.parse(raw);
}
