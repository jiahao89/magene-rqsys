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
  // 0033：评估修复层触发（只记修复类型与版本，不含模型输出内容）
  "assessment.output_repaired",
  // 0034：我的需求/回收站的逻辑删除与还原
  "requirement.deleted",
  "requirement.restored",
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
  // 0031：Base 推送按池路由时的池标签（诊断用；不含任何企业/人员标识）。
  "pool",
  // 0034：逻辑删除/还原时的处理状态与是否已有 Base 行（只记状态与布尔，不含人员/内容）。
  "processingState",
  "hasBaseRecord",
  "sourceVersion",
  "analysisVersion",
  "priorAnalysisVersion",
  "analysisStatus",
  // 分析阶段自动恢复用：来源标记（scheduler）与状态回退的起止状态
  "source",
  "from",
  "to",
  "entryCount",
  "created",
  "replay",
  "push",
  "runId",
  "stage",
  "attempt",
  "errorClass",
  "trigger",
  "mode",
  // V02-T15-AC04：同步导入计数来源说明
  "fetched",
  "duplicateIds",
  "processed",
  // 0031：执行人名单外跳过的条数（集团池同步审计，只记计数）
  "filtered",
  "workerId",
  "scheduleWindow",
  "httpStatus",
  "durationMs",
  "reason",
  "confidence",
  // 评分/人群/重复判定审计：此前被白名单清空，变更无法追溯
  "fromVersion",
  "toVersion",
  "aiVersion",
  "version",
  "scoreVersion",
  "score",
  "priority",
  "decision",
  // 运维告警（ops/alerts.ts）：只记录计数，不含作业 payload
  "failed",
  "stuck",
  // 聊天抽取（PRD-26）：只记粘贴文本的字符数，不记内容
  "textLength",
  // PRD-26 兜底与 AI 填充统计：同样只记计数/布尔，不含聊天正文
  "fallback",
  "aiFilledCount",
  // 人工重试是否强制重跑（布尔）：会消耗一次模型调用，必须留在审计里
  "force",
  // PRD-26 审计串联与可追溯：一次抽取的请求号、提示词版本、供应商状态码（都不含正文）
  "requestId",
  "promptVersion",
  // 来源标记（5a/5b）：来源类型、业务渠道、聊天粘贴标记与外部行号——都是分类值，不含正文/PII
  "sourceType",
  "sourceChannel",
  "intakeOrigin",
  "sourceExternalId",
  "formRecordId",
  // Base 同步与诊断：阶段、失败类别、飞书状态码；不含请求/响应正文
  "phase",
  "kind",
  "apiCode",
  // 0033：评估修复层触发记录（修复类型与模型名，不含模型输出内容）
  "repairs",
  "model",
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
