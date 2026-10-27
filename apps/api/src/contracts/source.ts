import { z } from "zod";

// 客户端仅维护项目名称与同步计划；内部项目/任务类型 ID、字段映射和负责人信息由服务端管理。
export const SourceConfigUpdateSchema = z.strictObject({
  projectName: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: z.object({
    enabled: z.boolean(),
    // weekday 保留为旧客户端兼容字段；新客户端发送 weekdays 数组。
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable().optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    // 时区必须是合法 IANA 名称：调度窗口换算依赖 Intl.DateTimeFormat，
    // 坏时区会让每次轮询都抛 RangeError（此前任意字符串都能存进来源配置）。
    timezone: z.string().trim().min(1).refine((zone) => {
      try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
    }).nullable(),
  }).superRefine((schedule, context) => {
    if (!schedule.enabled) return;
    const days = schedule.weekdays ?? (schedule.weekday === null || schedule.weekday === undefined ? null : [schedule.weekday]);
    if (!days || days.length === 0) context.addIssue({ code: "custom", message: "启用周计划时必须至少选择一个星期" });
    if (!schedule.time) context.addIssue({ code: "custom", message: "启用周计划时必须填写执行时间" });
    if (!schedule.timezone) context.addIssue({ code: "custom", message: "启用周计划时必须填写时区" });
  }),
});

export const IdempotencyKeySchema = z.string().trim().min(8).max(128);

export type SourceConfigUpdate = z.infer<typeof SourceConfigUpdateSchema>;

/** 规范化后的来源配置：weekday 为第一天的旧字段，weekdays 为权威多选列表。 */
export interface ResolvedSourceConfigUpdate {
  projectName: string;
  enabled: boolean;
  schedule: {
    enabled: boolean;
    weekday: number | null;
    weekdays?: number[] | null;
    time: string | null;
    timezone: string | null;
  };
  projectId: string;
  requirementTypeId: string;
  ownerNames: string[];
  fieldMap: Record<string, string>;
}

export function normalizeSourceSchedule(schedule: SourceConfigUpdate["schedule"]): ResolvedSourceConfigUpdate["schedule"] {
  const raw = schedule.weekdays ?? (schedule.weekday === null || schedule.weekday === undefined ? null : [schedule.weekday]);
  const weekdays = raw ? [...new Set(raw)].sort((left, right) => left - right) : null;
  return { enabled: schedule.enabled, weekday: weekdays?.[0] ?? null, weekdays, time: schedule.time, timezone: schedule.timezone };
}
