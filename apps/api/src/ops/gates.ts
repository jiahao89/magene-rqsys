// PR-15：唯一上线 Gate 的当前状态。
//
// Gate 定义来自 docs/2026-11-06-rq-sys-production-readiness-prd.md §9（G1–G8）。
// 每一项由「自动检查」与「人工确认」组成：
//   - 自动：只读取应用内事实（正式 Base 配置、已推送数、已发布规则、未处理的待映射、告警通道）；
//   - 人工：通知实收/演练记录/SOP/试点等无法由代码证明的项，确认时写 system_flags 并留审计。
// 任何自动项未通过 → fail；自动通过但人工未确认 → pending；两者都通过 → pass。
// 全部 pass 才是上线判据；本模块只读状态，不执行发布或切换。

import { randomUUID } from "node:crypto";
import type {
  AuditEventRepository, PriorityRuleRepository, RequirementQueryRepository, SystemFlagRepository,
} from "../application/repositories.js";

export type GateId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8";
export type GateStatusValue = "pass" | "fail" | "pending";

export interface GateDefinition {
  id: GateId;
  title: string;
  requirement: string;
  /** 是否需要人工取证（通知实收、演练、SOP、试点等）。 */
  manual: boolean;
}

export const GATE_DEFINITIONS: readonly GateDefinition[] = [
  { id: "G1", title: "正式 Base 全链路", requirement: "正式 Base 配置与已推送；IM 通知实收 1 次；回退演练记录", manual: true },
  { id: "G2", title: "优先级可用", requirement: "v3 相对分位规则已发布；20–30 条 PM 基准校准（Top20 ≥70%）；分诊视图含下钻", manual: true },
  { id: "G3", title: "待匹配需求有确定去向", requirement: "不存在「待匹配且未推送」的活跃需求（Q1 空负责人推送口径）", manual: false },
  { id: "G4", title: "运营闭环", requirement: "告警通道已配置并实收 1 次；运营指标与导出可用；额度耗尽有暂停", manual: true },
  { id: "G5", title: "备份与恢复", requirement: "完成一次恢复演练并记录 RPO/RTO", manual: true },
  { id: "G6", title: "SOP 与培训", requirement: "每角色 1 页 SOP；30 分钟培训完成", manual: true },
  { id: "G7", title: "试点", requirement: "10–15 名 PM、1 个产品组、2–4 周；P0/严重缺陷清零", manual: true },
  { id: "G8", title: "上线公告与支持渠道", requirement: "公告发出；反馈入口与值班人明确", manual: true },
];

export const GATE_FLAG_PREFIX = "gate:";

export interface GateStatus {
  id: GateId;
  title: string;
  requirement: string;
  auto: { status: "pass" | "fail" | "na"; detail: string };
  manual: { required: boolean; confirmed: boolean; evidence?: string; by?: string; at?: string };
  status: GateStatusValue;
}

function findDefinition(id: string): GateDefinition | null {
  return GATE_DEFINITIONS.find((definition) => definition.id === id) ?? null;
}

export function isGateId(value: string): value is GateId {
  return findDefinition(value) !== null;
}

export async function evaluateGates(params: {
  flags: SystemFlagRepository | undefined;
  requirements: Pick<RequirementQueryRepository, "search" | "getPipelineCounts"> | undefined;
  priorityRules: Pick<PriorityRuleRepository, "getPublished"> | undefined;
  env: Record<string, string | undefined>;
  now: Date;
}): Promise<{ ready: boolean; gates: GateStatus[] }> {
  const { flags, requirements, priorityRules, env } = params;

  const baseConfigured = Boolean(env.BASE_APP_TOKEN && env.BASE_TABLE_ID);
  const counts = requirements ? await requirements.getPipelineCounts().catch(() => null) : null;
  const pushed = counts?.pushPushed ?? 0;
  const unpublishedMapping = requirements
    ? await requirements.search({ ownerState: "pending_mapping", pushState: "pending", limit: 1 }).then((page) => page.items.length > 0).catch(() => true)
    : true;
  const rule = priorityRules ? await priorityRules.getPublished().catch(() => null) : null;
  const formulaType = rule ? (rule.rules as { formulaType?: unknown }).formulaType : null;
  const webhookConfigured = typeof env.RQSYS_ALERT_WEBHOOK_URL === "string" && env.RQSYS_ALERT_WEBHOOK_URL.startsWith("https://");

  const automatic: Record<string, { status: "pass" | "fail" | "na"; detail: string }> = {
    G1: {
      status: baseConfigured && pushed > 0 ? "pass" : "fail",
      detail: `正式 Base ${baseConfigured ? "已配置" : "未配置"}；已推送 ${pushed} 条`,
    },
    G2: {
      status: formulaType === "umsc_weighted_v3" ? "pass" : "fail",
      detail: rule ? `当前发布规则 v${rule.version}（${String(formulaType ?? "未标注公式")}）` : "尚未发布规则",
    },
    G3: {
      status: unpublishedMapping ? "fail" : "pass",
      detail: unpublishedMapping ? "仍有「待匹配且未推送」的活跃需求" : "没有待匹配且未推送的活跃需求",
    },
    G4: {
      status: webhookConfigured ? "pass" : "fail",
      detail: webhookConfigured ? "告警 webhook 已配置" : "未配置 RQSYS_ALERT_WEBHOOK_URL",
    },
    G5: { status: "na", detail: "需人工记录恢复演练" },
    G6: { status: "na", detail: "需人工确认 SOP 与培训" },
    G7: { status: "na", detail: "需人工确认试点结果" },
    G8: { status: "na", detail: "需人工确认公告与支持渠道" },
  };

  const gates: GateStatus[] = [];
  for (const definition of GATE_DEFINITIONS) {
    let confirmation: { confirmed: boolean; evidence?: string; by?: string; at?: string } = { confirmed: false };
    if (definition.manual && flags) {
      const row = await flags.get(`${GATE_FLAG_PREFIX}${definition.id}`).catch(() => null);
      if (row && row.value.confirmed === true) {
        confirmation = {
          confirmed: true,
          ...(typeof row.value.evidence === "string" ? { evidence: row.value.evidence } : {}),
          ...(typeof row.value.by === "string" ? { by: row.value.by } : {}),
          ...(typeof row.value.at === "string" ? { at: row.value.at } : {}),
        };
      }
    }
    const auto = automatic[definition.id]!;
    const status: GateStatusValue = auto.status === "fail"
      ? "fail"
      : definition.manual && !confirmation.confirmed
        ? "pending"
        : "pass";
    gates.push({
      id: definition.id, title: definition.title, requirement: definition.requirement,
      auto, manual: { required: definition.manual, ...confirmation }, status,
    });
  }
  return { ready: gates.every((gate) => gate.status === "pass"), gates };
}

export async function confirmGate(params: {
  flags: SystemFlagRepository | undefined;
  audit: AuditEventRepository;
  id: string;
  confirmed: boolean;
  evidence?: string;
  actorId: string;
  now: Date;
}): Promise<{ outcome: "saved" } | { outcome: "invalid" } | { outcome: "unavailable" }> {
  const definition = findDefinition(params.id);
  if (!definition) return { outcome: "invalid" };
  if (!definition.manual) return { outcome: "invalid" };
  if (!params.flags) return { outcome: "unavailable" };
  const at = params.now.toISOString();
  const value: Record<string, unknown> = params.confirmed
    ? { confirmed: true, by: params.actorId, at, ...(params.evidence ? { evidence: params.evidence } : {}) }
    : { confirmed: false, by: params.actorId, at };
  await params.flags.set(`${GATE_FLAG_PREFIX}${definition.id}`, value, at);
  await params.audit.append({
    id: randomUUID(), actorId: params.actorId,
    eventType: params.confirmed ? "ops.gate_confirmed" : "ops.gate_unconfirmed",
    entityType: "gate", entityId: definition.id, result: "succeeded",
    safeDetails: { reason: `gate_${definition.id}` }, occurredAt: at,
  });
  return { outcome: "saved" };
}
