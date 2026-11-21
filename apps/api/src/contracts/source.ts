import { z } from "zod";
import type { SourceExecutorBinding, SourcePool } from "../domain/persistence.js";

/** 来源池：product 为现有产品池（缺省），group 为集团需求池。 */
export const SourcePoolSchema = z.enum(["product", "group"]);

/** 执行人名单：自由文本姓名，服务端 trim/去重后再解析为 TB user_id（1–20 个）。 */
export const ExecutorAllowlistNameSchema = z.string().trim().min(1).max(100);
export const ExecutorAllowlistSchema = z.array(ExecutorAllowlistNameSchema).max(100);

/**
 * 名单规范化：trim → 去空 → 按首次出现顺序去重。
 * 上限 20 在去重之后再判定（前端标签输入可能带重复项或空白项）。
 */
export function normalizeExecutorAllowlistNames(names: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.normalize("NFC");
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(name);
  }
  return normalized;
}
export const MAX_EXECUTOR_ALLOWLIST_SIZE = 20;

// 客户端仅维护项目名称与同步计划；内部项目/任务类型 ID、字段映射和负责人信息由服务端管理。
export const SourceConfigUpdateSchema = z.strictObject({
  projectName: z.string().trim().min(1),
  enabled: z.boolean(),
  // 创建时缺省 product（现有页面零改动）；更新时不可改池，传不同值返回 400。
  pool: SourcePoolSchema.optional(),
  // 仅集团池有意义；产品池传非空名单返回 400（避免"看起来过滤了其实没有"）。
  executorAllowlist: ExecutorAllowlistSchema.optional(),
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
  /** 归一化后的池：创建缺省 product；更新取当前来源的池（不可改）。旧调用方缺省按 product。 */
  pool?: SourcePool;
  /** 已解析的集团池执行人名单；产品池恒为空数组。旧调用方缺省按空名单。 */
  executorAllowlist?: SourceExecutorBinding[];
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
