// 流水线 API 契约 schemas：对齐 openapi.yaml 的请求体与查询参数定义。
// 验证在服务端进行；源契约是 openapi.yaml，本文件是其 TypeScript 执行形式。

import { z } from "zod";
import { IdempotencyKeySchema } from "./source.js";

// POST /api/sync/run 请求体
export const SyncRunRequestSchema = z.object({
  sourceId: z.uuid(),
});

// PUT /api/requirements/{id}/owner 请求体
export const OwnerMappingUpdateSchema = z.object({
  feishuUserId: z.string().trim().min(1),
  feishuIdType: z.enum(["open_id", "user_id", "union_id"]),
  tbUserId: z.string().trim().min(1).nullable().optional(),
  tbDisplayName: z.string().trim().min(1).nullable().optional(),
});

// 通用分页参数
const LimitSchema = z.number().int().min(1).max(100);
const CursorSchema = z.string().min(1);

// GET /api/batches 查询参数
export const BatchListQuerySchema = z.object({
  status: z.enum(["running", "succeeded", "partial_failure", "failed"]).optional(),
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
  limit: LimitSchema.default(25),
  cursor: CursorSchema.optional(),
});

// GET /api/audit 查询参数
export const AuditListQuerySchema = z.object({
  entityId: z.string().min(1).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  limit: LimitSchema.default(50),
});

// 同步运行请求的 Idempotency-Key header（openapi: minLength 8, maxLength 128）
export const SyncIdempotencyHeaderSchema = IdempotencyKeySchema;

export type SyncRunRequest = z.infer<typeof SyncRunRequestSchema>;
export type OwnerMappingUpdate = z.infer<typeof OwnerMappingUpdateSchema>;
export type BatchListQuery = z.infer<typeof BatchListQuerySchema>;
export type RequirementListQuery = z.infer<typeof RequirementListQuerySchema>;
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
