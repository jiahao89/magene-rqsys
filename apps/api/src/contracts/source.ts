import { z } from "zod";

// 客户端仅维护项目名称与同步计划；内部项目/任务类型 ID、字段映射和负责人信息由服务端管理。
export const SourceConfigUpdateSchema = z.strictObject({
  projectName: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: z.object({
    enabled: z.boolean(),
    weekday: z.number().int().min(1).max(7).nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    timezone: z.string().trim().min(1).nullable(),
  }),
});

export const IdempotencyKeySchema = z.string().trim().min(8).max(128);

export type SourceConfigUpdate = z.infer<typeof SourceConfigUpdateSchema>;
export type ResolvedSourceConfigUpdate = SourceConfigUpdate & {
  projectId: string;
  requirementTypeId: string;
  ownerNames: string[];
  fieldMap: Record<string, string>;
};
