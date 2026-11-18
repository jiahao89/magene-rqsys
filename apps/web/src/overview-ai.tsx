// 总览「AI 状态」卡片：状态徽标、暂停原因/恢复时间、累计与今日调用次数、最近一次调用。
// 数据来自 GET /api/overview/metrics 的 ai 块。该块缺失或格式不完整时只降级本卡片，
// 不影响同一响应里的其他总览指标。
import { useEffect } from "react";
import type { OverviewAiStatus } from "./api";

type LoadState = "loading" | "ready" | "error";

const KIND_LABELS = { analysis: "分析", chat_intake: "聊天抽取" } as const;
const RESULT_LABELS = { succeeded: "成功", failed: "失败" } as const;

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/** 运行时校验：AI 块形状不对就当作不可用，不让整个总览指标失败。 */
export function normalizeAiStatus(ai: OverviewAiStatus | null | undefined): OverviewAiStatus | null {
  if (!ai || typeof ai !== "object") return null;
  const status = ai.status;
  if (status !== "ok" && status !== "paused" && status !== "unconfigured" && status !== "unavailable") return null;
  // 兼容旧后端：没有 statsAvailable 字段时按「统计可用」处理；给了就必须是布尔。
  if (ai.statsAvailable !== undefined && typeof ai.statsAvailable !== "boolean") return null;
  if (!ai.analysis || !ai.chatIntake || !ai.lastCall) return null;
  if (!isCount(ai.analysis.total) || !isCount(ai.analysis.today) || !isCount(ai.chatIntake.total) || !isCount(ai.chatIntake.today)) return null;
  const { kind, result, at } = ai.lastCall;
  if (kind !== null && kind !== "analysis" && kind !== "chat_intake") return null;
  if (result !== null && result !== "succeeded" && result !== "failed") return null;
  if (at !== null && !isIsoString(at)) return null;
  return ai;
}

function formatMoment(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("zh-CN", { hour12: false });
}

export function AiStatusCard({ ai, loadState, onExpire }: { ai?: OverviewAiStatus | null; loadState: LoadState; /** 暂停到期时触发一次刷新；由页面决定是否可用（总览传 loadData）。 */ onExpire?: () => void }) {
  const data = normalizeAiStatus(ai);
  const loading = !data && loadState === "loading";
  // 统计聚合失败：状态与计数一起降级，但不把 0 当成真实用量。
  const statsUnavailable = !!data && (data.status === "unavailable" || data.statsAvailable === false);
  const chip = loading
    ? { tone: "status-muted", label: "读取中" }
    : !data || statsUnavailable
      ? { tone: "status-muted", label: "状态不可用" }
      : data.status === "ok"
        ? { tone: "status-live", label: "正常" }
        : data.status === "paused"
          ? { tone: "status-danger", label: "暂停中" }
          : { tone: "status-muted", label: "未配置" };
  // 暂停到期后自动回正常：到点触发一次总览刷新，避免页面一直停在「暂停中」。
  // 已到期但服务端仍报暂停时不自动轮询，防止接口抖动时形成刷新循环。
  const pausedUntilMs = data?.status === "paused" && data.pausedUntil ? new Date(data.pausedUntil).getTime() : null;
  useEffect(() => {
    if (pausedUntilMs === null || !Number.isFinite(pausedUntilMs) || !onExpire) return;
    const delay = pausedUntilMs - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(onExpire, Math.min(delay + 2_000, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [pausedUntilMs, onExpire]);
  const lastCallAt = data ? formatMoment(data.lastCall.at) : null;
  const lastCallLabel = data?.lastCall.kind
    ? `${KIND_LABELS[data.lastCall.kind]}${data.lastCall.result ? ` · ${RESULT_LABELS[data.lastCall.result]}` : ""}`
    : "暂无记录";
  return <section className="panel ai-status-panel" aria-labelledby="ai-status-heading">
    <div className="panel-heading"><div><h2 id="ai-status-heading">AI 状态</h2><p>AI 分析与聊天抽取的调用状态；累计用量按调用次数统计，不含 token</p></div><span className={`status-chip ${chip.tone}`} role="status"><span />{chip.label}</span></div>
    {!data
      ? <div className="ai-status-unavailable">
          <strong>{loading ? "正在读取 AI 状态…" : "状态不可用"}</strong>
          <span>{loading ? "总览接口返回后显示状态与调用次数。" : "总览接口没有返回可用的 AI 状态；同一次响应里的其他指标照常展示。"}</span>
        </div>
      : statsUnavailable
        ? <div className="ai-status-unavailable">
            <strong>状态不可用（统计暂不可用）</strong>
            <span>AI 统计查询失败，累计与今日调用次数暂不可用，不展示为 0；同一次响应里的其他指标照常展示。</span>
          </div>
        : <>
          <div className="ai-status-grid">
            <div className="ai-status-stat"><span>分析调用</span><strong>{data.analysis.total}</strong><small>今日 {data.analysis.today} 次</small></div>
            <div className="ai-status-stat"><span>聊天抽取</span><strong>{data.chatIntake.total}</strong><small>今日 {data.chatIntake.today} 次</small></div>
            <div className="ai-status-stat"><span>今日合计</span><strong>{data.analysis.today + data.chatIntake.today}</strong><small>次调用</small></div>
            <div className="ai-status-stat"><span>最近一次调用</span><strong>{lastCallLabel}</strong><small>{lastCallAt ?? "还没有调用"}</small></div>
          </div>
          {data.status === "paused" && <p className="ai-status-note" role="status">已暂停 AI 调用{data.pauseReason ? `：${data.pauseReason}` : ""}；{data.pausedUntil ? `预计 ${formatMoment(data.pausedUntil)} 恢复` : "恢复时间未提供"}。</p>}
          {data.status === "unconfigured" && <p className="ai-status-note" role="status">未配置 AI 密钥：分析链路与聊天抽取暂时不可用，配置后自动恢复；已收录需求仍可手工处理。</p>}
        </>}
  </section>;
}
