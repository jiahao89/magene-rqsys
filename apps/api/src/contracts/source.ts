import { z } from "zod";

// 配置请求体白名单：只接受 Spec 定义的来源字段；未知字段（含 apiKey/token 等凭据字段）直接拒绝。
// fieldMap 的 key 是进入规范化投影的领域字段名；个人/联系/凭据类字段禁止映射（Spec 02 数据最小化边界）。
export const ALLOWED_FIELD_MAP_KEYS = ["description", "acceptanceCriteria", "proposerName", "executorName"] as const;

export const SourceConfigUpdateSchema = z.strictObject({
  projectId: z.string().trim().min(1),
  projectName: z.string().trim().min(1),
  requirementTypeId: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: z.object({
    enabled: z.boolean(),
    weekday: z.number().int().min(1).max(7).nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    timezone: z.string().trim().min(1).nullable(),
  }),
  ownerNames: z.array(z.string().trim().min(1)).max(500),
  fieldMap: z.partialRecord(z.enum(ALLOWED_FIELD_MAP_KEYS), z.string().trim().min(1)),
});

export const IdempotencyKeySchema = z.string().trim().min(8).max(128);

export type SourceConfigUpdate = z.infer<typeof SourceConfigUpdateSchema>;
