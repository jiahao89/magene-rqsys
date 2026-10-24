import { z } from "zod";

// 客户端仅维护项目名称与同步计划；内部项目/任务类型 ID、字段映射和负责人信息由服务端管理。
export const SourceConfigUpdateSchema = z.strictObject({
  projectName: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: z.object({
    enabled: z.boolean(),
    weekday: z.number().int().min(1).max(7).nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    // 时区必须是合法 IANA 名称：调度窗口换算依赖 Intl.DateTimeFormat，
    // 坏时区会让每次轮询都抛 RangeError（此前任意字符串都能存进来源配置）。
    timezone: z.string().trim().min(1).refine((zone) => {
      try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
    }).nullable(),
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
