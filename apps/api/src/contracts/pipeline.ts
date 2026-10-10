// 流水线 API 契约 schemas：对齐 openapi.yaml 的请求体与查询参数定义。
// 验证在服务端进行；源契约是 openapi.yaml，本文件是其 TypeScript 执行形式。
// 严格度与契约一致：不在 zod 中添加契约没有的约束，避免契约合法请求被拒。

import { z } from "zod";
import { IdempotencyKeySchema } from "./source.js";

// POST /api/sync/run 请求体
export const SyncRunRequestSchema = z.object({
  sourceId: z.uuid(),
});

// PUT /api/requirements/{id}/owner 请求体
export const OwnerMappingUpdateSchema = z.object({
  feishuUserId: z.string().min(1),
  feishuIdType: z.enum(["open_id", "user_id", "union_id"]),
  tbUserId: z.string().nullable().optional(),
  tbDisplayName: z.string().nullable().optional(),
});

// 通用分页参数（openapi: integer 1-100, default 25/50）
const LimitSchema = z.coerce.number().int().min(1).max(100);
const CursorSchema = z.string();

// GET /api/batches 查询参数
export const BatchListQuerySchema = z.object({
  status: z.enum(["running", "succeeded", "partial_failure", "failed"]).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  limit: LimitSchema.default(25),
  cursor: CursorSchema.optional(),
});

// GET /api/requirements 查询参数
export const RequirementListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  pullState: z.enum(["pending", "running", "synced", "failed"]).optional(),
  analysisState: z.enum(["pending", "running", "analyzed", "failed_retryable"]).optional(),
  ownerState: z.enum(["pending_mapping", "auto_mapped", "manually_mapped", "not_required"]).optional(),
  pushState: z.enum(["pending", "running", "pushed", "failed"]).optional(),
  batchId: z.uuid().optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  limit: LimitSchema.default(25),
  cursor: CursorSchema.optional(),
});

// GET /api/audit 查询参数（date-time 允许 "+08:00" 等偏移，offset: true 对齐 RFC 3339）
export const AuditListQuerySchema = z.object({
  entityId: z.string().optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  limit: LimitSchema.default(50),
});

// GET /api/feishu/users — keep directory search bounded and avoid logging user data.
export const FeishuUserSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

// 同步运行请求的 Idempotency-Key header（openapi: minLength 8, maxLength 128）
export const SyncIdempotencyHeaderSchema = IdempotencyKeySchema;

export type SyncRunRequest = z.infer<typeof SyncRunRequestSchema>;
export type OwnerMappingUpdate = z.infer<typeof OwnerMappingUpdateSchema>;
export type BatchListQuery = z.infer<typeof BatchListQuerySchema>;
export type RequirementListQuery = z.infer<typeof RequirementListQuerySchema>;
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
