import { normalizeOwnerName } from "../owner/mapping.js";
import type { FeishuIdType, FunctionModuleEntry } from "./persistence.js";

// 人员页的飞书账号绑定：来源是 person_mappings 中按规范化姓名匹配的活跃行，
// 不新增表、不改 TB 回写。人员名单（source_configs.owner_names）负责“有哪些人”，
// 绑定负责“每个人对应哪个飞书账号”，需求分配下拉直接读这份映射。
export interface TeamPersonBinding {
  feishuUserId: string;
  feishuIdType: FeishuIdType;
  /** 绑定映射最近一次更新时间（ISO 8601）。 */
  boundAt: string;
}

/** 写入绑定时的参数：boundAt 由服务端时间决定，不由调用方提供。 */
export type TeamPersonBindingInput = Pick<TeamPersonBinding, "feishuUserId" | "feishuIdType">;

export interface TeamPersonRecord {
  name: string;
  binding: TeamPersonBinding | null;
  /**
   * 同一姓名存在多条指向不同飞书账号的活跃映射。此时既不显示为“已绑定”，
   * 也不让自动匹配替人猜账号；人员页只提示冲突，写操作返回 409 要求先人工核对。
   */
  bindingConflict: boolean;
}

/** person_mappings 中用于人员绑定展示的最小列（只取关系，不取任何联系方式）。 */
export interface TeamMappingRow {
  normalized_name: string | null;
  feishu_user_id: string;
  feishu_id_type: string;
  updated_at: Date | string;
}

/**
 * 把活跃映射归并到人员名单：同一姓名指向同一飞书身份才算“已绑定”；
 * 指向多个不同身份时标记冲突，不猜其中任何一个（与自动匹配的歧义规则一致）。
 */
export function mergeTeamBindings(people: string[], mappings: readonly TeamMappingRow[]): TeamPersonRecord[] {
  const byName = new Map<string, TeamMappingRow[]>();
  for (const row of mappings) {
    if (!row.normalized_name) continue;
    const rows = byName.get(row.normalized_name) ?? [];
    rows.push(row);
    byName.set(row.normalized_name, rows);
  }
  return people.map((name) => {
    const rows = byName.get(normalizeOwnerName(name)) ?? [];
    const identities = new Set(rows.map((row) => `${row.feishu_user_id}|${row.feishu_id_type}`));
    if (identities.size === 0) return { name, binding: null, bindingConflict: false };
    if (identities.size > 1) return { name, binding: null, bindingConflict: true };
    const latest = rows.reduce((best, row) => new Date(row.updated_at).getTime() > new Date(best.updated_at).getTime() ? row : best);
    return {
      name,
      binding: { feishuUserId: latest.feishu_user_id, feishuIdType: latest.feishu_id_type as FeishuIdType, boundAt: new Date(latest.updated_at).toISOString() },
      bindingConflict: false,
    };
  });
}

export const DEFAULT_TEAM_MEMBERS = [
  "毕梓浩", "盛永帮", "刘媛媛", "李晨璐", "史东升", "贾浩", "兰诣伟",
] as const;

// 初始模块只使用截图“功能模块”行里的内容；“其他”行的职责描述不作为模块。
export const DEFAULT_FUNCTION_MODULES: FunctionModuleEntry[] = [
  { name: "爬坡", personName: "毕梓浩" },
  { name: "赛段", personName: "毕梓浩" },
  { name: "训练-骑行台训练", personName: "毕梓浩" },
  { name: "训练-模拟路线", personName: "毕梓浩" },
  { name: "训练-课程训练", personName: "毕梓浩" },
  { name: "训练-训练计划", personName: "毕梓浩" },
  { name: "天气风向收益", personName: "毕梓浩" },
  { name: "地图", personName: "盛永帮" },
  { name: "导航（路线/离线/位置点）", personName: "盛永帮" },
  { name: "AI意图导航", personName: "盛永帮" },
  { name: "自行车防盗", personName: "盛永帮" },
  { name: "急弯陡坡", personName: "盛永帮" },
  { name: "声音提示", personName: "刘媛媛" },
  { name: "语音播报", personName: "刘媛媛" },
  { name: "星环", personName: "刘媛媛" },
  { name: "AI码表设置", personName: "刘媛媛" },
  { name: "码表桌面伴侣（结合充电底座）", personName: "刘媛媛" },
  { name: "语音控制", personName: "刘媛媛" },
  { name: "初次使用（海思新平台）", personName: "刘媛媛" },
  { name: "团队骑行", personName: "刘媛媛" },
  { name: "实时对讲", personName: "刘媛媛" },
  { name: "摔倒检测", personName: "刘媛媛" },
  { name: "电源管理（海思新平台）", personName: "李晨璐" },
  { name: "消息通知（海思新平台）", personName: "李晨璐" },
  { name: "骑行记录", personName: "李晨璐" },
  { name: "历史记录", personName: "李晨璐" },
  { name: "个人资料", personName: "李晨璐" },
  { name: "数据计算", personName: "李晨璐" },
  { name: "数据展示", personName: "李晨璐" },
  { name: "迈金系多语言", personName: "李晨璐" },
  { name: "场景+表盘+场景设置（海思新平台）", personName: "史东升" },
  { name: "车辆+传感器（海思新平台）", personName: "史东升" },
  { name: "数据传输", personName: "史东升" },
  { name: "数据埋点", personName: "史东升" },
  { name: "智联助手以及三者", personName: "史东升" },
  { name: "码表设置-App端", personName: "贾浩" },
  { name: "固件升级", personName: "贾浩" },
  { name: "车辆传感器（后续转交）", personName: "贾浩" },
  { name: "消息通知（后续转交）", personName: "贾浩" },
  { name: "音乐控制", personName: "贾浩" },
  { name: "自定义按键", personName: "贾浩" },
  { name: "新手引导", personName: "贾浩" },
  { name: "帮助中心", personName: "贾浩" },
  { name: "极游系多语言", personName: "贾浩" },
  { name: "码表设置-码表端", personName: "兰诣伟" },
  { name: "App端通用设置", personName: "兰诣伟" },
  { name: "日志/异常文件管理", personName: "兰诣伟" },
  { name: "电源管理（后续转交）", personName: "兰诣伟" },
  { name: "GNSS管理", personName: "兰诣伟" },
  { name: "显示设置", personName: "兰诣伟" },
  { name: "系统管理", personName: "兰诣伟" },
  { name: "偏好设置", personName: "兰诣伟" },
  { name: "锁屏/解锁", personName: "兰诣伟" },
  { name: "场景+表盘+场景设置（后续转交）", personName: "兰诣伟" },
];
