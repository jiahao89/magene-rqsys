import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowDownToLine, ArrowRight, Blocks, Check, CircleAlert, CircleHelp, Clock3, Database, FolderSync, Gauge, GitBranch, Layers3, ListChecks, LoaderCircle, Menu, Moon, Play, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun, Users, X } from "lucide-react";
import { ApiError, createPriorityRuleDraft, getHealth, getOverviewMetrics, listPriorityRules, listSources, publishPriorityRule, runSync, type OverviewMetrics, type PriorityRuleVersion, type RequirementSummary, type SourceConfig, type SyncExecutionMode } from "./api";
import { GuidePanel, ModulesPanel, PanelErrorBoundary, PublishStatusChip, RequirementsPanel, SourcesPanel, SyncRecordsPanel, TeamPanel } from "./panels";
import { SkeletonBlock, SkeletonCards, SkeletonTableRows } from "./skeleton";
import { readRequirementDeepLink } from "./deep-link";
import { readWorkbenchPage, readWorkbenchRoute, workbenchUrl, type WorkbenchPage, type WorkbenchTab } from "./workbench-routing";
import type { RequirementListFilters } from "./requirements-url";
import { requirementDisplayId } from "./requirement-view";
import { stateLabel } from "./state-labels";
import { checkScheduleHealth, describeCountdown, formatInZone, nextRunAt, type WeeklySchedule } from "./schedule";

type Batch = { id: string; status: string; totalCount: number; succeededCount: number; failedCount: number; startedAt?: string; completedAt?: string; errorSummary?: string };
// 与列表接口的 DTO 保持同一类型：此前这里复制了一份更窄的本地结构，字段一旦分叉就会在运行时才暴露。
type Requirement = RequirementSummary;
type Page = WorkbenchPage;
type LoadState = "loading" | "ready" | "error";
type Theme = "light" | "dark";

function readStoredTheme(): Theme {
  try { return window.localStorage?.getItem("rq-sys-theme") === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

// 菜单收敛：人员与负责人映射合并为团队管理，同步批次与审计日志合并为同步记录；
// 使用指南不在侧栏重复出现，只保留顶栏一个稳定入口。
const navigationGroups: { title: string; items: { label: Page; icon: typeof Gauge }[] }[] = [
  { title: "工作台", items: [
    { label: "Overview", icon: Gauge }, { label: "Requirements", icon: ListChecks }, { label: "SyncRecords", icon: FolderSync },
  ] },
  { title: "管理", items: [
    { label: "Team", icon: Users }, { label: "Modules", icon: Blocks },
  ] },
  { title: "设置", items: [
    { label: "Sources", icon: Database }, { label: "Rules", icon: Settings2 },
  ] },
];
const pageTitles: Record<Page, string> = { Overview: "总览", Requirements: "需求池", Team: "团队管理", Modules: "功能模块", SyncRecords: "同步记录", Sources: "数据源与计划", Rules: "优先级规则", Guide: "使用指南" };

const API_ERROR_TEXT: Record<string, string> = {
  INTERNAL: "服务暂时不可用，请稍后重试。",
  DEPENDENCY_UNAVAILABLE: "依赖服务暂不可用，请稍后重试。",
  VALIDATION_FAILED: "请求参数不合法，请检查输入。",
  NOT_FOUND: "请求的资源不存在或已被删除。",
  CONFLICT: "当前状态不允许此操作，请刷新后重试。",
  REQUEST_FAILED: "无法连接到 API 服务，请确认服务已启动后重试。",
  SOURCE_NOT_ENABLED: "请先配置并启用一个数据源。",
  UNAUTHORIZED: "登录已失效，请重新登录。",
  FORBIDDEN: "没有权限执行此操作。",
};

function formatApiError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (/[\u4e00-\u9fff]/.test(cause.message)) return cause.message;
    return API_ERROR_TEXT[cause.code] ?? `操作失败（${cause.code}）。`;
  }
  return "无法连接到本地 API。请启动 API 服务后重试。";
}

async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const detail = envelope && typeof envelope === "object" ? envelope as { code?: string; message?: string } : {};
    throw new ApiError(detail.message ?? `Request failed (${response.status})`, response.status, detail.code ?? "REQUEST_FAILED");
  }
  return body as T;
}

const stageLabels = { pull: "拉取", analysis: "AI 分析", owner: "负责人", push: "推送" } as const;

function StagePill({ stage, value }: { stage: keyof typeof stageLabels; value: string }) {
  const tone = value === "failed" || value === "failed_retryable" ? "failed" : value === "pending" || value === "pending_mapping" ? "pending" : value === "running" ? "running" : "done";
  return <span className={`stage-pill ${tone}`}><span className="stage-dot" />{stageLabels[stage]} · {stateLabel(value)}</span>;
}

/**
 * 调度状态卡片：展示计划配置是否可用与下次计划时刻。
 * 只描述「已配置的计划」，不代表目标环境已执行或能够执行——绝对时刻来自本地纯计算。
 */
export function SchedulerHealthPanel({ schedule, now, loadState, onConfigure }: { schedule?: WeeklySchedule; now: Date; loadState: LoadState; onConfigure: () => void }) {
  const health = checkScheduleHealth(schedule);
  const next = health.active ? nextRunAt(schedule, now) : null;
  const tone = loadState === "loading" ? "status-muted" : health.active ? "status-live" : "status-muted";
  const toneLabel = loadState === "loading" ? "读取中" : health.active ? "计划已配置" : "未生效";
  return <section className="panel scheduler-panel">
    <div className="panel-heading"><div><h2>调度状态</h2><p>周计划配置与下次计划时刻 · 不代表目标环境已执行</p></div><span className={`status-chip ${tone}`}><span />{toneLabel}</span></div>
    <div className="scheduler-body">
      {loadState === "loading" && <p className="scheduler-note">正在读取来源配置与计划设置。</p>}
      {loadState !== "loading" && !health.active && <p className="scheduler-note">{health.reason}。<button className="link-button" onClick={onConfigure}>前往数据源与计划 <ArrowRight size={13} /></button></p>}
      {loadState !== "loading" && health.active && <>
        <div className="scheduler-next">
          <span className="micro-label">下次计划同步</span>
          <strong>{next ? formatInZone(next, schedule!.timezone!) : "无法计算"}</strong>
          {next && <span className="scheduler-countdown"><Clock3 size={13} />{describeCountdown(next, now)}</span>}
        </div>
        <p className="scheduler-note">计划由来源配置与服务端调度共同决定；本卡片只反映已保存的配置，执行结果以同步批次记录为准。</p>
      </>}
    </div>
  </section>;
}

function App() {
  // 通知按钮深链只在启动时读取一次：`?requirement=<requirements.id>`。
  // 缺失/无效时保持默认总览页；命中时直接进入需求池并打开该需求详情。
  const [deepLinkRequirementId, setDeepLinkRequirementId] = useState(() => readRequirementDeepLink(window.location.search));
  const [page, setPageState] = useState<Page>(() => readWorkbenchPage(window.location.hash, window.location.search));
  // 合并页签（团队管理：人员/负责人映射；同步记录：批次/审计）。旧链接解析出的页签也在这里落地。
  const [tab, setTabState] = useState<WorkbenchTab | null>(() => readWorkbenchRoute(window.location.hash, window.location.search).tab);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 860px)").matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [health, setHealth] = useState<LoadState>("loading");
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  // 计划预测基于「本次数据读取完成的时刻」，避免渲染期间读取挂钟导致结果不稳定。
  const [loadedAt, setLoadedAt] = useState(() => new Date());

  const setPage = useCallback((nextPage: Page, requirementFilters?: Partial<RequirementListFilters>) => {
    setPageState(nextPage);
    setTabState(null);
    setMobileNavOpen(false);
    const nextUrl = workbenchUrl(window.location.pathname, window.location.search, nextPage, requirementFilters);
    setDeepLinkRequirementId(readRequirementDeepLink(new URL(nextUrl, window.location.origin).search));
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(null, "", nextUrl);
    // 已在需求池时点侧栏「需求池」：URL 已无 requirement，但面板内部还停在详情，
    // 广播一次 popstate 让面板按 URL 收起详情回到列表。
    if (nextPage === "Requirements" && !requirementFilters) window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const pageHref = (target: Page) => workbenchUrl(window.location.pathname, window.location.search, target);
  const navigateLink = (event: ReactMouseEvent<HTMLAnchorElement>, target: Page) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setPage(target);
  };

  useEffect(() => {
    const onPopState = () => {
      const route = readWorkbenchRoute(window.location.hash, window.location.search);
      setPageState(route.page);
      setTabState(route.tab);
      setDeepLinkRequirementId(readRequirementDeepLink(window.location.search));
      setMobileNavOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 860px)");
    const onViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
      if (!event.matches) setMobileNavOpen(false);
    };
    media.addEventListener("change", onViewportChange);
    return () => media.removeEventListener("change", onViewportChange);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstItem = sidebarRef.current?.querySelector<HTMLElement>(".nav-item");
    firstItem?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavOpen(false); };
    const closeOnResize = () => { if (window.innerWidth > 860) setMobileNavOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
      if (window.innerWidth <= 860) mobileMenuButtonRef.current?.focus();
    };
  }, [mobileNavOpen]);

  const handleSidebarKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!mobileNavOpen || event.key !== "Tab") return;
    const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const loadData = useCallback(async () => {
    // 轮询刷新时保留已加载状态：每 5 秒闪回“正在检查 API”只会让按钮禁用、数字抖动。
    setHealth((prev) => (prev === "ready" ? "ready" : "loading")); setError(null);
    try {
      await getHealth();
      setHealth("ready");
      setLoadedAt(new Date());
      const sourceRows = await listSources();
      // 各端点独立容错：个别端点未实现（501）时不拖垮整页
      const [batchPage, requirementPage, metricsResult] = await Promise.allSettled([
        apiJson<{ items: Batch[] }>("/api/batches?limit=10"),
        apiJson<{ items: Requirement[] }>("/api/requirements?limit=25"),
        getOverviewMetrics(),
      ]);
      setSources(sourceRows);
      setBatches(batchPage.status === "fulfilled" ? batchPage.value.items : []);
      setRequirements(requirementPage.status === "fulfilled" ? requirementPage.value.items : []);
      setMetrics(metricsResult.status === "fulfilled" ? metricsResult.value : null);
      if (batchPage.status === "rejected" && requirementPage.status === "rejected") {
        throw batchPage.reason instanceof ApiError ? batchPage.reason : new Error("API request failed");
      }
    } catch (cause) {
      setHealth("error");
      setError(formatApiError(cause));
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  // 局部刷新：批次列表单独拉取。同步提交/运行中轮询只更新批次，需求与统计保持稳定，避免整页刷新。
  const refreshBatches = useCallback(async () => {
    try {
      const page = await apiJson<{ items: Batch[] }>("/api/batches?limit=10");
      setBatches(page.items);
    } catch { /* 局部刷新失败保留旧数据，下一轮轮询或手动刷新恢复 */ }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage?.setItem("rq-sys-theme", theme); } catch { /* Storage can be disabled by the browser. */ }
  }, [theme]);

  const handleRunSync = async (mode: SyncExecutionMode = "full_pipeline") => {
    const source = sources.find((item) => item.enabled);
    if (!source) { setNotice("请先配置并启用一个数据源。"); return; }
    setBusy(true); setNotice(null); setActionError(null);
    try {
      const result = await runSync(source, mode);
      setNotice(mode === "source_only" ? `仅同步源数据批次 ${result.batchId} 已提交；不会触发 AI、负责人匹配、Base 推送或通知` : `批次 ${result.batchId} 已提交`);
      await refreshBatches();
    } catch (cause) {
      setActionError(formatApiError(cause));
    } finally { setBusy(false); }
  };

  const shownRequirements = requirements.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()) || (item.sourceRequirementId ?? "").toLowerCase().includes(query.toLowerCase()));
  const latestBatch = batches[0];
  // 运行中 → 终态时才补一次全量刷新；轮询期间只用 refreshBatches 更新进度，页面其余内容不重载。
  const previousBatchStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousBatchStatus.current;
    previousBatchStatus.current = latestBatch?.status;
    if (previous === "running" && latestBatch && latestBatch.status !== "running") void loadData();
  }, [latestBatch?.status, loadData]);
  // 运行中的批次需要可见进度：只在前端做有界轮询，终态/页面隐藏时停止。
  useEffect(() => {
    if (latestBatch?.status !== "running") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshBatches();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [latestBatch?.status, refreshBatches]);
  const counts = { pull: metrics?.pullSynced ?? 0, analysis: metrics?.analysisAnalyzed ?? 0, owner: metrics?.ownerResolved ?? 0, push: metrics?.pushPushed ?? 0, failed: metrics?.failed ?? 0, pushFailed: metrics?.pushFailed ?? 0, pushPending: metrics?.pushPending ?? 0 };
  const total = metrics?.total ?? 0;
  const priority = metrics?.priority ?? null;
  const priorityRule = metrics?.priorityRule ?? null;
  const priorityCards = [
    { key: "P0", tone: "p0", value: priority?.P0 ?? 0, range: priorityRule?.thresholds ? `≥ ${priorityRule.thresholds.p0}` : "规则未发布" },
    { key: "P1", tone: "p1", value: priority?.P1 ?? 0, range: priorityRule?.thresholds ? `${priorityRule.thresholds.p1}–${(priorityRule.thresholds.p0 - 0.01).toFixed(2)}` : "规则未发布" },
    { key: "P2", tone: "p2", value: priority?.P2 ?? 0, range: priorityRule?.thresholds ? `${priorityRule.thresholds.p2}–${(priorityRule.thresholds.p1 - 0.01).toFixed(2)}` : "规则未发布" },
    { key: "P3", tone: "p3", value: priority?.P3 ?? 0, range: priorityRule?.thresholds ? `< ${priorityRule.thresholds.p2}` : "规则未发布" },
  ] as const;
  const priorityGraded = priority ? priority.P0 + priority.P1 + priority.P2 + priority.P3 : null;
  const todoItems = [
    { key: "unassigned", label: "待分配负责人", value: metrics ? Math.max(0, total - counts.owner) : null, hint: "没有对应飞书账号，分配后会自动推送并通知", tone: "warn", filters: { ownerState: "pending_mapping" } },
    { key: "failed", label: "推送失败", value: metrics ? counts.pushFailed : null, hint: "可在需求详情页查看原因并重试", tone: metrics && counts.failed > 0 ? "danger" : "ok", filters: { push: "failed" } },
    { key: "pending", label: "待推送", value: metrics ? counts.pushPending : null, hint: "等待推送到多维表格", tone: "info", filters: { push: "pending" } },
  ] as const;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {mobileNavOpen && <button className="sidebar-backdrop" aria-label="关闭主导航" onClick={() => setMobileNavOpen(false)} />}
      <aside ref={sidebarRef} id="main-navigation" className={`sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`} aria-label="主导航" aria-hidden={isMobileViewport && !mobileNavOpen || undefined} aria-modal={mobileNavOpen || undefined} inert={isMobileViewport && !mobileNavOpen || undefined} role={mobileNavOpen ? "dialog" : undefined} onKeyDown={handleSidebarKeyDown}>
        <a className="brand" href={pageHref("Overview")} onClick={(event) => navigateLink(event, "Overview")}><span className="brand-mark"><Layers3 size={19} strokeWidth={2.2} /></span><span className="brand-name">rq<span>·</span>sys</span><span className="brand-edition">WORKSPACE</span></a>
        <div className="nav-label">菜单</div>
        <nav className="main-nav" aria-label="主导航">{navigationGroups.map((group) => <div className="nav-group" key={group.title}>
          <div className="nav-group-label">{group.title}</div>
          {group.items.map(({ label, icon: Icon }) => <a key={label} href={pageHref(label)} className={`nav-item ${page === label ? "is-active" : ""}`} onClick={(event) => navigateLink(event, label)} aria-current={page === label ? "page" : undefined}>
            <Icon size={16} /><span className="nav-item-label">{pageTitles[label]}</span>
          </a>)}
        </div>)}</nav>
        <div className="sidebar-spacer" />
      </aside>

      <main id="main-content" className="main-area" tabIndex={-1} inert={mobileNavOpen || undefined}>
        <header className="topbar"><div className="breadcrumbs"><button ref={mobileMenuButtonRef} className="icon-button mobile-menu-button" aria-label="打开主导航" aria-expanded={mobileNavOpen} aria-controls="main-navigation" onClick={() => setMobileNavOpen(true)}><Menu size={18} /></button><span>RQ-Sys</span><span className="crumb-sep">/</span><strong>{pageTitles[page]}</strong></div><div className="topbar-actions"><span className={`connection-state ${health}`}><span className="connection-dot" />{health === "ready" ? "API 已连接" : health === "loading" ? "正在检查 API" : "API 未连接"}</span><span className="topbar-divider" /><button className="icon-button" aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"} aria-pressed={theme === "dark"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}><>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</></button><a className="icon-button" aria-label="帮助" title="使用指南" href={pageHref("Guide")} onClick={(event) => navigateLink(event, "Guide")}><CircleHelp size={17} /></a></div></header>

        <div className="content-area">
          <PanelErrorBoundary>
          {error && page === "Overview" && <div className="alert-banner" role="alert"><CircleAlert size={18} /><div><strong>服务暂不可用</strong><span>{error}</span></div><button className="button button-secondary button-small" onClick={() => void loadData()}><RefreshCw size={14} />重试连接</button></div>}
          {actionError && <div className="alert-banner" role="alert"><CircleAlert size={18} /><div><strong>操作未完成</strong><span>{actionError}</span></div><button className="icon-button" aria-label="关闭提示" onClick={() => setActionError(null)}><X size={15} /></button></div>}
          {notice && <div className="notice-banner" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
          {page === "Overview" && <>
            <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />SYNC WORKBENCH</div><h1>工作流总览</h1><p>查看需求同步进度、分析状态与推送健康度。</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => void loadData()} disabled={health === "loading"}><RefreshCw size={15} className={health === "loading" ? "spin" : ""} />刷新</button><details className="advanced-actions"><summary className="button button-secondary">高级操作</summary><div className="advanced-actions-menu"><button className="button button-secondary button-small" title="只导入 Teambition 源数据；不触发 AI、负责人匹配、Base 推送或通知" onClick={() => void handleRunSync("source_only")} disabled={busy || health !== "ready"}>仅同步源数据</button></div></details><button className="button button-primary" onClick={() => void handleRunSync()} disabled={busy || health !== "ready"}><Play size={15} fill="currentColor" />{busy ? "提交中…" : "立即同步"}</button></div></section>
            <section className="source-banner"><div className="source-leading"><span className="source-icon"><GitBranch size={17} /></span><div><span className="micro-label">当前同步来源</span><strong>{sources[0]?.projectName ?? (health === "loading" ? "正在加载配置…" : health === "error" ? "无法读取来源配置" : "尚未配置数据源")}</strong></div></div><div className="source-meta"><span className={`status-chip ${sources[0]?.enabled ? "status-live" : "status-muted"}`}><span />{sources[0]?.enabled ? "同步已启用" : "未启用"}</span><span className="source-meta-divider" /><span className="subtle-text">Teambition 项目</span></div><button className="text-link" onClick={() => setPage("Sources")}>管理来源 <ArrowRight size={14} /></button></section>

            <section className="section-block"><div className="section-heading"><div><h2>同步健康度</h2><p>四个处理阶段独立统计 · 不互相阻塞</p></div><button className="link-button" onClick={() => setPage("Requirements")}>查看需求池 <ArrowRight size={14} /></button></div>
              {/* 今日待办：把统计数字翻译成"该做什么"，并直接跳到对应筛选 */}
            <section className="panel todo-panel">
              <div className="panel-heading"><div><h2>今天要处理什么</h2><p>按优先级排列，点击直接跳到对应需求。</p></div></div>
              <div className="todo-grid">
                {todoItems.map((item) => (
                  <button key={item.key} className={`todo-card is-${item.tone}`} disabled={item.value === null} onClick={() => setPage("Requirements", item.filters)}>
                    <span className="todo-value">{item.value === null ? (health === "loading" ? <SkeletonBlock className="skeleton-num" /> : "—") : item.value}</span>
                    <span className="todo-label">{item.label}</span>
                    <span className="todo-hint">{item.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            </section>

            <section className="panel priority-grade-panel" aria-labelledby="priority-grade-heading">
              <div className="panel-heading"><div><h2 id="priority-grade-heading">优先级分级</h2><p>按当前综合评分统计需求数量；未评分需求单列</p></div><span className="priority-grade-total">{priority ? `${priorityGraded} / ${total} 已分级` : "统计暂不可用"}</span></div>
              <div className="priority-grade-grid" role="group" aria-label="优先级分级统计">
                {priorityCards.map((card) => <div className={`priority-grade-card is-${card.tone}`} key={card.key}>
                  <div className="priority-grade-head"><span className={`priority-pill priority-${card.tone}`}>{card.key}</span><small>{card.range}</small></div>
                  <strong>{priority ? card.value : health === "loading" ? <SkeletonBlock className="skeleton-num" /> : "—"}</strong>
                  <span>条需求</span>
                </div>)}
                <div className="priority-grade-card is-unscored">
                  <div className="priority-grade-head"><span className="priority-pill priority-unscored">待评分</span><small>无评分/无历史优先级</small></div>
                  <strong>{priority ? priority.unscored : health === "loading" ? <SkeletonBlock className="skeleton-num" /> : "—"}</strong>
                  <span>条需求</span>
                </div>
              </div>
              <div className="priority-rule-box">
                <div className="priority-rule-heading"><strong>分级规则</strong>{priorityRule ? <span>评分规则 v{priorityRule.version} · 固定公式</span> : <span>暂未发布有效评分规则</span>}</div>
                {priorityRule?.thresholds ? <div className="priority-rule-ranges" aria-label="评分范围与对应分级">
                  <span><b>P0</b> 综合分 ≥ {priorityRule.thresholds.p0}</span>
                  <span><b>P1</b> {priorityRule.thresholds.p1}–{(priorityRule.thresholds.p0 - 0.01).toFixed(2)}</span>
                  <span><b>P2</b> {priorityRule.thresholds.p2}–{(priorityRule.thresholds.p1 - 0.01).toFixed(2)}</span>
                  <span><b>P3</b> 综合分 &lt; {priorityRule.thresholds.p2}</span>
                </div> : <p className="priority-rule-empty">规则未发布时优先级保持为空，不使用模型自报 P 填充。</p>}
                <code className="priority-rule-formula">{priorityRule?.formulaText ?? "U/M/S/C 固定公式"}</code>
                <p className="priority-rule-note">{priority ? <>已分级 {priorityGraded} 条，其中 <strong>{priority.legacy}</strong> 条来自历史分析优先级（v1，不套用上方 v2 分数范围）；<strong>{priority.unscored}</strong> 条待评分。当前评分版本优先于历史分析优先级。</> : "评分统计随总览指标加载；合成验收数据不计入。"}</p>
              </div>
            </section>

            <div className="overview-grid"><section className="panel pipeline-panel"><div className="panel-heading"><div><h2>处理阶段</h2><p>需求处理状态一览</p></div><span className="pipeline-help" role="img" aria-label="阶段说明" title="拉取、AI 分析、负责人匹配和 Base 推送分别记录状态；AI 分析失败不会阻止推送。"><CircleHelp size={16} /></span></div><div className="pipeline-overview">{[
              { name: "拉取", detail: "从 Teambition 获取需求", value: counts.pull, color: "blue", icon: ArrowDownToLine },
              { name: "AI 分析", detail: "生成模块与维度建议", value: counts.analysis, color: "violet", icon: Sparkles },
              { name: "负责人匹配", detail: "关联 Feishu 用户", value: counts.owner, color: "amber", icon: Users },
              { name: "推送 Base", detail: "创建或更新多维表格记录", value: counts.push, color: "green", icon: Check },
            ].map(({ name, detail, value, color, icon: Icon }, index) => <div className="pipeline-row" key={name}><div className={`pipeline-icon ${color}`}><Icon size={16} /></div><div className="pipeline-copy"><strong>{name}</strong><span>{detail}</span></div><div className="pipeline-progress"><div className="progress-track"><span style={{ width: `${metrics && total ? Math.round(value / total * 100) : 0}%` }} /></div><small>{metrics ? `${value} / ${total}` : "全量统计暂不可用"}</small></div>{index < 3 && <span className="pipeline-connector" />}</div>)}</div><div className="pipeline-foot"><span className="pipeline-health"><span />{metrics ? "状态来自全量需求聚合 API" : "等待全量统计 API"}</span><span className="pipeline-note">AI 失败不会阻止推送</span></div></section>

              <section className="panel latest-panel"><div className="panel-heading"><div><h2>最近同步</h2><p>最新批次执行情况</p></div><button className="link-button" onClick={() => setPage("SyncRecords")}>全部批次 <ArrowRight size={14} /></button></div>{latestBatch ? <div className="latest-content"><div className="batch-status-line"><span className={`batch-status-icon ${latestBatch.status === "failed" ? "danger" : latestBatch.status === "running" ? "live" : "success"}`}>{latestBatch.status === "running" ? <LoaderCircle size={16} className="spin" /> : latestBatch.status === "failed" ? <CircleAlert size={16} /> : <Check size={16} />}</span><div><strong>{latestBatch.status === "running" ? "同步进行中" : latestBatch.status === "partial_failure" ? "部分完成" : latestBatch.status === "failed" ? "同步失败" : "同步完成"}</strong><span>批次 {latestBatch.id}</span></div><span className="batch-status-tag">{stateLabel(latestBatch.status)}</span></div><div className="latest-counts"><div><strong>{latestBatch.totalCount}</strong><span>总需求</span></div><div><strong>{latestBatch.succeededCount}</strong><span>已完成</span></div><div><strong className={latestBatch.failedCount ? "text-danger" : ""}>{latestBatch.failedCount}</strong><span>失败</span></div></div><div className="latest-timestamp"><Clock3 size={14} />{latestBatch.startedAt ? new Date(latestBatch.startedAt).toLocaleString("zh-CN") : "等待批次时间"}<button className="link-button" onClick={() => setPage("SyncRecords")}>查看详情</button></div></div> : health === "loading" ? <div role="status" aria-busy="true" aria-label="正在加载批次"><SkeletonCards count={1} /></div> : <div className="empty-state compact"><span className="empty-icon"><Clock3 size={20} /></span><strong>还没有同步批次</strong><span>{health === "ready" ? "手动启动同步后，批次进度会显示在这里。" : "连接 API 后可查看实际批次记录。"}</span></div>}</section></div>

            <SchedulerHealthPanel schedule={sources[0]?.schedule} now={loadedAt} loadState={health} onConfigure={() => setPage("Sources")} />

            <section className="panel requirements-panel"><div className="panel-heading requirements-heading"><div><h2>最近处理的需求</h2><p>每个阶段状态分别展示，分析失败不会隐藏已推送结果</p></div><div className="table-actions"><label className="search-box"><Search size={15} /><input aria-label="搜索需求" placeholder="在当前已加载需求内搜索…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="button button-secondary button-small" onClick={() => setPage("Requirements")}>查看全部</button></div></div><RequirementsTable rows={shownRequirements.slice(0, 5)} loading={health === "loading"} /></section>
            <footer className="page-footer"><span>RQ-Sys MVP</span><span><ShieldCheck size={14} />状态由 API 返回；不展示飞书 PM 处理状态</span></footer>
          </>}

          {page !== "Overview" && <section className="secondary-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />WORKSPACE</div><h1>{pageTitles[page]}</h1><p>{pageDescription(page)}</p></div>{page === "SyncRecords" && <div className="heading-actions"><details className="advanced-actions"><summary className="button button-secondary">高级操作</summary><div className="advanced-actions-menu"><button className="button button-secondary button-small" title="只导入 Teambition 源数据；不触发 AI、负责人匹配、Base 推送或通知" onClick={() => void handleRunSync("source_only")} disabled={busy || health !== "ready"}>仅同步源数据</button></div></details><button className="button button-primary" onClick={() => void handleRunSync()} disabled={busy || health !== "ready"}><Play size={15} fill="currentColor" />{busy ? "提交中…" : "立即同步"}</button></div>}</div><SecondaryContent page={page} tab={tab} sources={sources} loadState={health} deepLinkRequirementId={deepLinkRequirementId} onNavigate={setPage} onRefresh={() => void loadData()} /></section>}
          </PanelErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function RequirementsTable({ rows, loading }: { rows: Requirement[]; loading: boolean }) {
  // 首屏加载显示骨架屏；已有数据时的静默刷新保留旧行，避免整块表格闪烁。
  if (!rows.length) return loading
    ? <SkeletonTableRows rows={5} columns={6} />
    : <div className="table-empty"><span className="empty-icon"><ListChecks size={19} /></span><strong>没有匹配的需求</strong><span>数据仅在 API 返回后显示，不使用演示数据。</span></div>;
  return <div className="table-scroll"><table><thead><tr><th>需求</th><th>版本</th><th>拉取</th><th>AI 分析</th><th>负责人</th><th>Base 推送</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><div className="requirement-title"><span className="req-id">{requirementDisplayId(row)}</span><strong>{row.title}</strong></div></td><td><span className="version-label">v{row.sourceVersion}</span></td><td><StagePill stage="pull" value={row.pipeline.pull} /></td><td><StagePill stage="analysis" value={row.pipeline.analysis} /></td><td><StagePill stage="owner" value={row.pipeline.owner} /></td><td><StagePill stage="push" value={row.pipeline.push} /></td></tr>)}</tbody></table></div>;
}

function SecondaryContent({ page, tab, sources, loadState, deepLinkRequirementId, onNavigate, onRefresh }: { page: Page; tab: WorkbenchTab | null; sources: SourceConfig[]; loadState: LoadState; deepLinkRequirementId: string | null; onNavigate: (page: Page) => void; onRefresh: () => void }) {
  if (page === "Requirements") return <RequirementsPanel onRefresh={onRefresh} initialRequirementId={deepLinkRequirementId} />;
  if (page === "Team") return <TeamPanel initialTab={tab} onRefresh={onRefresh} />;
  if (page === "SyncRecords") return <SyncRecordsPanel initialTab={tab} onRefresh={onRefresh} />;
  if (page === "Sources") return <SourcesPanel sources={sources} loadState={loadState} onRefresh={onRefresh} />;
  if (page === "Modules") return <ModulesPanel />;
  if (page === "Rules") return <RulesPanel />;
  if (page === "Guide") return <GuidePanel />;
  return <section className="panel placeholder-panel"><div className="placeholder-illustration"><span><Users size={23} /></span><i /><i /><i /></div><div className="eyebrow"><span className="eyebrow-line" />API 契约待实现</div><h2>页面未实现</h2><p>该页面尚未提供 API 契约。</p><button className="button button-secondary" onClick={() => onNavigate("Overview" as Page)}>返回总览<ArrowRight size={15} /></button></section>;
}

// 评分映射输入：每行「维度:取值=分数」；分数来自规则数据本身，UI 不代填公式
function parseScoringInput(text: string): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = { user: {}, market: {}, business: {}, technology: {} };
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^(user|market|business|technology)[:：]\s*(.+?)\s*=\s*(-?\d+(?:\.\d+)?)$/);
    if (match) map[match[1]!]![match[2]!.trim()] = Number(match[3]);
  }
  return map;
}

function RulesPanel() {
  const [rules, setRules] = useState<PriorityRuleVersion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thresholds, setThresholds] = useState({ p0: 4, p1: 3, p2: 2 });
  const [scoringInput, setScoringInput] = useState("user:强=3\nuser:中=2\nuser:弱=1\nmarket:强=3\nmarket:中=2\nmarket:弱=1\nbusiness:强=3\nbusiness:中=2\nbusiness:弱=1\ntechnology:强=3\ntechnology:中=2\ntechnology:弱=1");
  const [evidenceInput, setEvidenceInput] = useState("");
  // v2 是已确认的固定公式：生效期间 API 拒绝发布任何 v1 草稿，界面必须提前说明而不是让人点了才收到 409。
  const activeV2 = rules.some((rule) => rule.status === "published" && rule.rules.formulaType === "umsc_weighted_v2");

  const load = useCallback(async () => {
    setLoadError(null);
    try { setRules(await listPriorityRules()); }
    catch (cause) { setLoadError(formatApiError(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const withFeedback = async (action: () => Promise<string>) => {
    setBusy(true); setNotice(null); setActionError(null);
    try { setNotice(await action()); await load(); }
    catch (cause) { setActionError(formatApiError(cause)); }
    finally { setBusy(false); }
  };
  const handleCreateRule = () => withFeedback(async () => {
    if (!(thresholds.p0 >= thresholds.p1 && thresholds.p1 >= thresholds.p2)) throw new ApiError("阈值需满足 P0 ≥ P1 ≥ P2。", 400, "INVALID_THRESHOLDS");
    const scoring = parseScoringInput(scoringInput);
    if (Object.values(scoring).some((map) => Object.keys(map).length === 0)) throw new ApiError("每个维度至少需要一条「取值=分数」的已批准评分。", 400, "INVALID_SCORING");
    let validationEvidence: unknown[] = [];
    try { validationEvidence = evidenceInput.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown); }
    catch { throw new ApiError("校准证据每行必须是一个合法 JSON 对象。", 400, "INVALID_EVIDENCE"); }
    const created = await createPriorityRuleDraft({ scoring, thresholds }, fetch, validationEvidence);
    return `规则 v${created.version} 草稿已创建`;
  });

  return <section className="panel requirements-panel">
      <div className="panel-heading"><div><h2>优先级规则</h2><p>规则版本经历史案例校准；发布前需求优先级保持为空。</p></div><button className="button button-secondary button-small" onClick={() => void load()} disabled={busy}><RefreshCw size={14} />刷新</button></div>
      {activeV2 && <div className="notice-banner" role="status"><ShieldCheck size={16} /><span>当前生效的是已确认的 v2 评分公式（umsc_weighted_v2）。v1 四维求和规则不能再发布覆盖它，下方「创建草稿」已暂停。</span></div>}
      {loadError && <div className="alert-banner" role="alert"><CircleAlert size={18} /><div><strong>配置加载失败</strong><span>{loadError}</span></div></div>}
      {actionError && <div className="alert-banner" role="alert"><CircleAlert size={18} /><div><strong>操作未完成</strong><span>{actionError}</span></div><button className="button button-secondary button-small" onClick={() => setActionError(null)}>关闭</button></div>}
      {notice && <div className="notice-banner" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
      <details className="advanced-settings">
        <summary>高级设置：创建规则草稿（U/M/S/C 评分映射与校准证据）</summary>
        <p className="advanced-settings-hint">这些输入直接决定规则 JSON；未校准证据的规则发布后不会用于优先级计算。</p>
        <div className="rules-form">
          <div className="rules-thresholds">
            {(["p0", "p1", "p2"] as const).map((key) => <label key={key} className="rules-threshold"><span>{key.toUpperCase()} 阈值</span><input type="number" min={0} max={4} step={1} value={thresholds[key]} aria-label={`${key.toUpperCase()} 阈值`} onChange={(event) => setThresholds((prev) => ({ ...prev, [key]: Number(event.target.value) }))} /></label>)}
          </div>
          <button className="button button-primary button-small" onClick={() => void handleCreateRule()} disabled={busy || activeV2} title={activeV2 ? "v2 公式生效期间不能发布 v1 规则" : undefined}>创建草稿</button>
        </div>
        <div className="rules-form">
          <label className="field"><span>U/M/S/C 已批准评分映射（每行「维度:取值=分数」；未校准证据的规则不会用于计算）</span><textarea aria-label="评分映射" className="rules-textarea" rows={3} value={scoringInput} onChange={(event) => setScoringInput(event.target.value)} /></label>
        </div>
        <div className="rules-form">
          <label className="rules-threshold" style={{ flex: 1 }}><span>校准证据（每行一个 JSON 对象；为空的规则发布后不会用于优先级计算）</span><textarea aria-label="校准证据" className="rules-textarea" rows={2} placeholder='例如：{"cohort":"2026-Q3","cases":12}' value={evidenceInput} onChange={(event) => setEvidenceInput(event.target.value)} /></label>
        </div>
      </details>
      {rules.length ? <div className="table-scroll"><table><thead><tr><th>版本</th><th>状态</th><th>阈值 (P0/P1/P2)</th><th>创建时间</th><th>发布时间</th><th>操作</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.id}><td className="mono-cell">v{rule.version}</td><td><PublishStatusChip status={rule.status} /></td><td className="mono-cell">{[rule.rules.thresholds?.p0, rule.rules.thresholds?.p1, rule.rules.thresholds?.p2].map((value) => value ?? "—").join(" / ")}</td><td>{new Date(rule.createdAt).toLocaleString("zh-CN")}</td><td>{rule.publishedAt ? new Date(rule.publishedAt).toLocaleString("zh-CN") : "—"}</td><td>{rule.status === "draft" && <button className="button button-secondary button-small" onClick={() => void withFeedback(async () => { await publishPriorityRule(rule.id); return `规则 v${rule.version} 已发布`; })} disabled={busy || (activeV2 && rule.rules.formulaType !== "umsc_weighted_v2")} title={activeV2 && rule.rules.formulaType !== "umsc_weighted_v2" ? "v2 公式生效期间不能发布 v1 规则" : undefined}>发布</button>}</td></tr>)}</tbody></table></div> : <div className="table-empty"><strong>{loadError ? "配置不可用" : "还没有规则版本"}</strong><span>{loadError ? "请检查 API 连接后重试。" : "在高级设置中创建阈值规则草稿并发布后，AI 建议才会生成 P0–P3 优先级。"}</span></div>}
  </section>;
}

function EmptyPanel({ loading, title, description }: { loading: boolean; title: string; description: string }) {
  return <div className="empty-state"><span className="empty-icon">{loading ? <LoaderCircle size={21} className="spin" /> : <Database size={20} />}</span><strong>{loading ? "正在载入…" : title}</strong><span>{description}</span></div>;
}

function pageDescription(page: Page): string {
  const descriptions: Record<Page, string> = { Overview: "同步流程的当前健康状态与执行概况。", Requirements: "按需求标题、TB负责人和处理状态检索需求；负责人分配在需求详情页完成。", Team: "维护组内人员、飞书账号绑定和 Teambition 负责人映射。", Modules: "维护 AI 分类使用的功能模块、责任人员及词典版本历史。", SyncRecords: "检查同步批次、失败项与可追踪的审计操作。", Sources: "单项目的数据源与周计划设置。", Rules: "管理已校准的优先级规则；评分映射与校准证据在高级设置中维护。", Guide: "系统工作流、状态含义与日常操作说明。" };
  return descriptions[page];
}

export default App;
