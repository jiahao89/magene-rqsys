// 工作台跨页面共享基础件：错误边界（支持导航 resetKey 自动恢复）、统一错误文案（含 413 / 429 Retry-After / 401）、
// 可重试状态横幅、确认弹窗与受控无障碍 Tabs。
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert as ArcoAlert, Badge as ArcoBadge, Button as ArcoButton, Card as ArcoCard, Result as ArcoResult, Select as ArcoSelect, Space as ArcoSpace, Tabs as ArcoTabs, Tag as ArcoTag } from "@arco-design/web-react";
import { RefreshCw } from "lucide-react";
import { ApiError, isAbortError, listMappings, type FeishuUserSelection, type PublishStatus, type RequirementPool } from "./api";
import { ConfirmModal } from "./confirm-modal";
import { stateLabel } from "./state-labels";

export type LoadState = "loading" | "ready" | "error";

export const PRIORITY_TAG_COLORS: Record<string, string> = { P0: "red", P1: "orange", P2: "arcoblue", P3: "gray" };

export const API_ERROR_TEXT: Record<string, string> = {
  INTERNAL: "服务暂时不可用，请稍后重试。",
  DEPENDENCY_UNAVAILABLE: "依赖服务暂不可用，请稍后重试。",
  VALIDATION_FAILED: "请求参数不合法，请检查输入。",
  NOT_FOUND: "请求的资源不存在或已被删除。",
  CONFLICT: "当前状态不允许此操作，请刷新后重试。",
  REQUEST_FAILED: "无法连接到 API 服务，请确认服务已启动后重试。",
  REQUEST_TIMEOUT: "请求超时，请检查网络连接后重试。",
  PAYLOAD_TOO_LARGE: "请求内容过大，请精简后重试。",
  RATE_LIMITED: "请求过于频繁，请稍后再试。",
  SOURCE_NOT_ENABLED: "请先配置并启用一个数据源。",
  UNAUTHORIZED: "登录已失效，请重新登录。",
  FORBIDDEN: "没有权限执行此操作。",
  INVALID_METRICS_RESPONSE: "统计响应格式不正确，请稍后重试。",
};

function formatRetryWait(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

export function errorText(cause: unknown): string {
  if (isAbortError(cause)) return "";
  if (cause instanceof ApiError) {
    if (cause.status === 401) return API_ERROR_TEXT.UNAUTHORIZED!;
    if (cause.status === 403) return `服务端拒绝了此操作（${cause.code}）。MVP 要求飞书登录；拒绝原因以服务端为准，工作台不会绕过。`;
    if (cause.status === 413) return API_ERROR_TEXT.PAYLOAD_TOO_LARGE!;
    if (cause.status === 429) {
      const base = /[\u4e00-\u9fff]/.test(cause.message) ? cause.message : API_ERROR_TEXT.RATE_LIMITED!;
      return cause.retryAfterSeconds ? `${base}（请约 ${formatRetryWait(cause.retryAfterSeconds)} 后重试）` : base;
    }
    // 服务端已经给出中文可操作说明时直接使用；否则把稳定的错误码映射成中文，避免英文堆栈文案进入界面。
    if (/[\u4e00-\u9fff]/.test(cause.message)) return cause.message;
    return API_ERROR_TEXT[cause.code] ?? `操作失败（${cause.code}）。`;
  }
  return "操作失败：无法连接后端服务。";
}

/** 页内锚点跳转：直接滚动并聚焦目标标题，不修改 location.hash（避免触发 hash 路由 popstate 切页）。 */
export function scrollToSection(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus?.({ preventScroll: true });
}

export function StateBanner({ loadError, notice, onCloseNotice, onRetry }: { loadError: string | null; notice: string | null; onCloseNotice: () => void; onRetry?: () => void }) {
  return <>
    {loadError && (
      <ArcoAlert
        className="rq-inline-alert"
        type="error"
        showIcon
        role="alert"
        title="请求失败"
        content={loadError}
        action={onRetry ? <ArcoButton type="secondary" size="mini" htmlType="button" onClick={onRetry}><RefreshCw size={12} />重试</ArcoButton> : undefined}
      />
    )}
    {notice && <ArcoAlert className="rq-inline-alert" type="success" showIcon closable role="status" content={notice} onClose={onCloseNotice} />}
  </>;
}

export function DeleteConfirmation({ description, disabled, onConfirm, triggerLabel = "删除", heading = "确认删除", confirmLabel = "确认删除" }: { description: string; disabled: boolean; onConfirm: () => void; triggerLabel?: string; heading?: string; confirmLabel?: string }) {
  const [arcoOpen, setArcoOpen] = useState(false);
  // 弹窗关闭后把焦点还给触发按钮：Arco 的 focus-lock 只在弹窗内循环，关闭后默认回到 body。
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <ArcoButton type="outline" status="danger" htmlType="button" size="small" ref={triggerRef} disabled={disabled} onClick={() => { if (!disabled) setArcoOpen(true); }}>{triggerLabel}</ArcoButton>
    <ConfirmModal visible={arcoOpen} title={heading} description={description} okText={confirmLabel} onOk={() => { setArcoOpen(false); onConfirm(); }} onCancel={() => setArcoOpen(false)} afterClose={() => triggerRef.current?.focus()} />
  </>;
}

export function timeLabel(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

const publishStatusBadge: Record<PublishStatus, { label: string; status: "warning" | "success" | "default" }> = {
  draft: { label: "草稿", status: "warning" },
  published: { label: "已发布", status: "success" },
  retired: { label: "已退役", status: "default" },
};

export function PublishStatusChip({ status }: { status: PublishStatus }) {
  const badge = publishStatusBadge[status];
  return <ArcoBadge status={badge.status} text={badge.label} />;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 导航切页或切换 tab 时传入变化键，自动清除错误态，避免单页崩溃锁死整个侧栏导航。 */
  resetKey?: string;
}
interface ErrorBoundaryState { error: Error | null }

export class PanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <ArcoCard bordered={false} className="rq-card">
          <div role="alert">
            <ArcoResult
              status="error"
              title="页面渲染出错"
              subTitle={`${this.state.error.message}。请刷新页面重试；问题持续时检查服务端日志。`}
              extra={<ArcoButton type="primary" htmlType="button" size="small" onClick={() => this.setState({ error: null })}>重试渲染</ArcoButton>}
            />
          </div>
        </ArcoCard>
      );
    }
    return this.props.children;
  }
}

/** ARCO-06 收尾：Arco Tabs 自身不渲染 role=tablist；挂载后在头部补 role/aria-label，保留 tab/tabpanel 关联。 */
export function AccessibleTabs({ label, activeTab, onChange, extra, destroyOnHide, lazyload, children }: { label: string; activeTab: string; onChange: (key: string) => void; extra?: ReactNode; destroyOnHide?: boolean; lazyload?: boolean; children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = hostRef.current?.querySelector<HTMLElement>(".arco-tabs-header");
    if (!header) return;
    header.setAttribute("role", "tablist");
    header.setAttribute("aria-label", label);
  }, [label]);
  return <div ref={hostRef}><ArcoTabs activeTab={activeTab} onChange={onChange} extra={extra} {...(destroyOnHide === undefined ? {} : { destroyOnHide })} {...(lazyload === undefined ? {} : { lazyload })}>{children}</ArcoTabs></div>;
}

export function stateChip(status: string) {
  const color = status === "failed" ? "red" : status === "running" ? "arcoblue" : status === "partial_failure" ? "orange" : status === "succeeded" ? "green" : "gray";
  return <ArcoTag size="small" color={color}>{stateLabel(status)}</ArcoTag>;
}

/** 池标识：产品池/集团池共用同一视觉，只在需要区分池的地方出现。 */
export function poolChip(pool?: RequirementPool) {
  const value = pool ?? "product";
  return <ArcoTag size="small" color={value === "group" ? "purple" : "arcoblue"}><span className="pool-chip">{value === "group" ? "集团池" : "产品池"}</span></ArcoTag>;
}

export function FeishuUserPicker({ disabled, onMap, saveLabel = "保存负责人并入队推送" }: {
  disabled: boolean;
  onMap: (user: FeishuUserSelection) => Promise<void>;
  saveLabel?: string;
}) {
  // 名单来自 person_mappings（组内人员绑定的飞书账号 + 需求详情里建立的人工映射），
  // 不再每次输入姓名搜索飞书通讯录：分配负责人是高频动作，从固定名单里选比等搜索结果快。
  const [people, setPeople] = useState<FeishuUserSelection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void listMappings(undefined, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        const seen = new Map<string, FeishuUserSelection>();
        for (const row of rows) {
          // 只有带姓名的映射才能在下拉里显示；否则会变成一串飞书 ID，无法辨认。
          if (!row.feishuUserId || !row.teambitionDisplayName || seen.has(row.feishuUserId)) continue;
          seen.set(row.feishuUserId, {
            feishuUserId: row.feishuUserId,
            feishuIdType: row.feishuIdType,
            name: row.teambitionDisplayName,
          });
        }
        setPeople([...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")));
      })
      .catch((cause) => {
        if (controller.signal.aborted || isAbortError(cause)) return;
        setLoadError(cause instanceof ApiError ? errorText(cause) : "无法读取人员名单，请刷新后重试。");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, []);

  const selected = people.find((person) => person.feishuUserId === selectedId) ?? null;
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try { await onMap(selected); } finally { setSaving(false); }
  };

  return <div className="feishu-user-picker">
    {loadError
      ? <ArcoAlert type="error" showIcon role="alert" content={loadError} />
      : <ArcoSpace size={8} wrap className="feishu-user-search">
          <ArcoSelect aria-label="选择负责人" value={selectedId} disabled={disabled || loading || saving}
            onChange={(value: string) => setSelectedId(value)} style={{ minWidth: 200 }}
            placeholder={loading ? "正在读取人员…" : people.length ? "请选择负责人" : "名单为空，请先在「组内人员」绑定飞书账号"}
            options={people.map((person) => ({ label: person.name, value: person.feishuUserId }))}
          />
          <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void save()} disabled={disabled || !selected || saving}>
            {saving ? "保存中…" : saveLabel}
          </ArcoButton>
        </ArcoSpace>}
  </div>;
}
