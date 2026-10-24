// 流水线 API 契约 schemas：对齐 openapi.yaml 的请求体与查询参数定义。
// 验证在服务端进行；源契约是 openapi.yaml，本文件是其 TypeScript 执行形式。
// 严格度与契约一致：不在 zod 中添加契约没有的约束，避免契约合法请求被拒。

import { z } from "zod";
import { IdempotencyKeySchema } from "./source.js";

// POST /api/sync/run 请求体
export const SyncRunRequestSchema = z.object({
  sourceId: z.uuid(),
  mode: z.enum(["full_pipeline", "source_only"]).default("full_pipeline"),
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
  executorName: z.string().trim().min(1).max(100).optional(),
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

// V02-T04：Web 手工收录（web_manual）的固定渠道与创建请求校验。
// 必填仅标题/描述/渠道（PRD 3.2）；描述是单字段，四段提示是 UI 引导不是四个必填项。
export const REQUIREMENT_INTAKE_CHANNELS = ["销售", "售后", "电商", "运营/用研", "终端用户", "产品/研发/测试"] as const;
export const REQUIREMENT_INTAKE_TYPES = ["新增功能", "功能扩展", "体验优化", "性能优化", "质量修复", "安全合规", "成本效率", "技术治理"] as const;
export const RequirementIntakeSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000),
  sourceChannel: z.enum(REQUIREMENT_INTAKE_CHANNELS),
  // V02-T05 可选精简上下文：未知留空，不自动补造；链接需 http(s) 且不带凭据形态。
  productModel: z.string().trim().max(100).nullish(),
  requirementType: z.enum(REQUIREMENT_INTAKE_TYPES).nullish(),
  constraintNotes: z.string().trim().max(2_000).nullish(),
  supplementUrl: z.string().trim().url().max(500).nullish(),
  // V02-T06：受控词典模块（服务端对照已发布词典校验）与可选需求级负责人（D-12：人工分配首推通知被分配人）。
  intakeModule: z.string().trim().min(1).max(100).nullish(),
  owner: z.strictObject({
    feishuUserId: z.string().trim().min(1).max(64),
    feishuIdType: z.enum(["open_id", "user_id", "union_id"]),
    tbDisplayName: z.string().trim().max(100).nullish(),
  }).nullish(),
});
// V02-T07：手工编辑（仅 web_manual）。全部字段可选（未传=保持不变，null=清空可选值）；
// 期望源版本做乐观并发；渠道/类型仍受固定枚举约束。
export const RequirementIntakeEditSchema = z.strictObject({
  expectedSourceVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(20_000).nullish(),
  sourceChannel: z.enum(REQUIREMENT_INTAKE_CHANNELS).optional(),
  productModel: z.string().trim().max(100).nullish(),
  requirementType: z.enum(REQUIREMENT_INTAKE_TYPES).nullish(),
  constraintNotes: z.string().trim().max(2_000).nullish(),
  supplementUrl: z.string().trim().url().max(500).nullish(),
});
// V02-T09：人工人群标签保存。多选（含明确空集=已确认空）；期望版本乐观并发。
export const AUDIENCE_LEVELS = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
export const AudienceUpdateSchema = z.strictObject({
  tags: z.array(z.enum(AUDIENCE_LEVELS)).max(6),
  expectedVersion: z.number().int().min(0),
});
// V02-T11：RICE Beta 草稿保存。未传字段=保持不变；null=清空；全部允许缺项（草稿）。
export const RiceDraftUpdateSchema = z.strictObject({
  reach: z.string().trim().max(500).nullish(),
  impact: z.string().trim().max(500).nullish(),
  confidence: z.string().trim().max(500).nullish(),
  effort: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(4_000).nullish(),
  expectedEditVersion: z.number().int().min(0),
});
// V02-T13：Kano 访谈资料导入（维护者受控入口）。未知字段显式 null/缺省，不补造。
export const KanoEvidenceImportSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.string().trim().url().max(500).nullish(),
  sourceSection: z.string().trim().max(200).nullish(),
  summary: z.string().trim().min(1).max(20_000),
  evidenceFragments: z.array(z.strictObject({ ref: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(2_000) })).max(200),
  coverageNotes: z.string().trim().max(4_000).nullish(),
  knownAudiences: z.array(z.enum(AUDIENCE_LEVELS)).max(6).default([]),
  knownScenes: z.string().trim().max(500).nullish(),
  interviewDate: z.string().trim().max(40).nullish(),
});
