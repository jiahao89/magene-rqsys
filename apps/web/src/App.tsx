import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Activity, ArrowDownToLine, ArrowRight, Blocks, BookOpen, Building2, Check, CircleAlert, CircleHelp, Clock3, Database, FolderSync, Gauge, GitBranch, Layers3, ListChecks, LoaderCircle, Menu, Moon, PanelLeftClose, PanelLeftOpen, Play, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun, Trash2, UserRoundCheck, Users } from "lucide-react";
import { Alert as ArcoAlert, Badge as ArcoBadge, Breadcrumb as ArcoBreadcrumb, Button as ArcoButton, Card as ArcoCard, Collapse as ArcoCollapse, Divider as ArcoDivider, Drawer as ArcoDrawer, Dropdown as ArcoDropdown, Empty as ArcoEmpty, Form as ArcoForm, Grid as ArcoGrid, Input as ArcoInput, InputNumber as ArcoInputNumber, Layout as ArcoLayout, Menu as ArcoMenu, Progress as ArcoProgress, Result as ArcoResult, Space as ArcoSpace, Statistic as ArcoStatistic, Table as ArcoTable, Tag as ArcoTag, Tooltip as ArcoTooltip, Typography as ArcoTypography } from "@arco-design/web-react";
import { ApiError, createPriorityRuleDraft, getMyRequirementCounts, getRequirement, getOverviewMetrics, isAbortError, listBatches, listPriorityRules, listRequirements, listSources, onUnauthorized, publishPriorityRule, runSync, type BatchSummary, type MyRequirementCounts, type OverviewMetrics, type PriorityRuleVersion, type RequirementSummary, type SourceConfig, type SyncExecutionMode } from "./api";
import { CACHE_KEYS, invalidateQueryCache } from "./cache";
import { API_ERROR_TEXT, PanelErrorBoundary, PublishStatusChip, type LoadState } from "./panel-shared";
import { SkeletonBlock, SkeletonCards, SkeletonTableRows } from "./skeleton";
import { AiStatusCard } from "./overview-ai";
import { readRequirementDeepLink } from "./deep-link";
import { readWorkbenchPage, readWorkbenchRoute, workbenchUrl, type WorkbenchPage, type WorkbenchTab } from "./workbench-routing";
import type { RequirementListFilters } from "./requirements-url";
import { requirementDisplayId } from "./requirement-view";
import { stateLabel } from "./state-labels";
import { checkScheduleHealth, describeCountdown, formatInZone, nextRunAt, type WeeklySchedule } from "./schedule";

// 路由级代码分割：次级页面按需加载，缩小首屏总览 JS 包体积。
const RequirementsPanel = lazy(() => import("./pages/requirements-page").then((m) => ({ default: m.RequirementsPanel })));
const MyRequirementsPanel = lazy(() => import("./pages/requirements-page").then((m) => ({ default: m.MyRequirementsPanel })));
const RecycleBinPanel = lazy(() => import("./pages/requirements-page").then((m) => ({ default: m.RecycleBinPanel })));
const SourcesPanel = lazy(() => import("./pages/sources-page"));
const TeamPanel = lazy(() => import("./pages/team-page"));
const ModulesPanel = lazy(() => import("./pages/modules-page"));
const SyncRecordsPanel = lazy(() => import("./pages/sync-records-page"));
const OpsPanel = lazy(() => import("./pages/ops-page"));
const GuidePanel = lazy(() => import("./pages/guide-page"));
const SopPanel = lazy(() => import("./pages/sop-page"));

type Batch = BatchSummary;
// 与列表接口的 DTO 保持同一类型：此前这里复制了一份更窄的本地结构，字段一旦分叉就会在运行时才暴露。
type Requirement = RequirementSummary;
type Page = WorkbenchPage;
type Theme = "light" | "dark";

function readStoredTheme(): Theme {
  try { return window.localStorage?.getItem("rq-sys-theme") === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

// 菜单收敛：人员与负责人映射合并为团队管理，同步批次与审计日志合并为同步记录；
// 使用指南不在侧栏重复出现，只保留顶栏一个稳定入口。
const navigationGroups: { title: string; items: { label: Page; icon: typeof Gauge }[] }[] = [
  { title: "工作台", items: [
    { label: "Overview", icon: Gauge }, { label: "Requirements", icon: ListChecks }, { label: "MyRequirements", icon: UserRoundCheck }, { label: "GroupRequirements", icon: Building2 }, { label: "SyncRecords", icon: FolderSync },
  ] },
  { title: "管理", items: [
    { label: "Team", icon: Users }, { label: "Modules", icon: Blocks }, { label: "Sop", icon: BookOpen },
  ] },
  { title: "设置", items: [
    { label: "Sources", icon: Database }, { label: "Rules", icon: Settings2 }, { label: "Ops", icon: Activity },
  ] },
];
const pageTitles: Record<Page, string> = { Overview: "总览", MyRequirements: "我的需求", Requirements: "需求池", GroupRequirements: "集团需求池", RecycleBin: "回收站", Team: "团队管理", Modules: "功能模块", SyncRecords: "同步记录", Sources: "数据源与计划", Rules: "优先级规则", Ops: "作业运维", Guide: "使用指南", Sop: "SOP 与培训" };

function formatRetrySeconds(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

function formatApiError(cause: unknown): string {
  if (isAbortError(cause)) return "";
  if (cause instanceof ApiError) {
    if (cause.status === 401) return API_ERROR_TEXT.UNAUTHORIZED!;
    if (cause.status === 413) return API_ERROR_TEXT.PAYLOAD_TOO_LARGE!;
    if (cause.status === 429) {
      const base = /[\u4e00-\u9fff]/.test(cause.message) ? cause.message : API_ERROR_TEXT.RATE_LIMITED!;
      return cause.retryAfterSeconds ? `${base}（请约 ${formatRetrySeconds(cause.retryAfterSeconds)} 后重试）` : base;
    }
    if (/[\u4e00-\u9fff]/.test(cause.message)) return cause.message;
    return API_ERROR_TEXT[cause.code] ?? `操作失败（${cause.code}）。`;
  }
  return "服务暂不可用，请稍后重试。";
}

const stageLabels = { pull: "拉取", analysis: "AI 分析", owner: "负责人", push: "推送" } as const;

function StagePill({ stage, value }: { stage: keyof typeof stageLabels; value: string }) {
  const color = value === "failed" || value === "failed_retryable"
    ? "red"
    : value === "pending" || value === "pending_mapping"
      ? "orange"
      : value === "running"
        ? "arcoblue"
        : "green";
  return <ArcoTag size="small" color={color}>{stageLabels[stage]} · {stateLabel(value)}</ArcoTag>;
}

/**
 * 调度状态卡片：展示计划配置是否可用与下次计划时刻。
 * 只描述「已配置的计划」，不代表目标环境已执行或能够执行——绝对时刻来自本地纯计算。
 */
export function SchedulerHealthPanel({ schedule, now: externalNow, loadState, onConfigure }: { schedule?: WeeklySchedule; now?: Date; loadState: LoadState; onConfigure: () => void }) {
  // 30s 倒计时时钟收口在本卡片内，避免每 30 秒触发根 App 及其他页面整树重渲染。
  const [internalNow, setInternalNow] = useState(() => externalNow ?? new Date());
  useEffect(() => {
    if (externalNow) return;
    const timer = window.setInterval(() => setInternalNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [externalNow]);
  const now = externalNow ?? internalNow;
  const health = checkScheduleHealth(schedule);
  const next = health.active ? nextRunAt(schedule, now) : null;
  const badgeStatus = loadState === "loading" ? "processing" : health.active ? "success" : "default";
  const badgeLabel = loadState === "loading" ? "读取中" : health.active ? "计划已配置" : "未生效";
  return (
    <ArcoCard
      bordered={false}
      className="rq-card scheduler-panel"
      title={<h2>调度状态</h2>}
      extra={<ArcoBadge status={badgeStatus} text={badgeLabel} />}
    >
      <ArcoTypography.Text type="secondary" className="rail-card-subtitle">周计划配置与下次计划时刻 · 不代表目标环境已执行</ArcoTypography.Text>
      <div className="scheduler-body">
        {loadState === "loading" && <ArcoTypography.Text type="secondary">正在读取来源配置与计划设置。</ArcoTypography.Text>}
        {loadState !== "loading" && !health.active && (
          <ArcoSpace size={4} wrap>
            <ArcoTypography.Text type="secondary">{health.reason}。</ArcoTypography.Text>
            <ArcoButton type="text" size="small" onClick={onConfigure} htmlType="button">前往数据源与计划 <ArrowRight size={13} /></ArcoButton>
          </ArcoSpace>
        )}
        {loadState !== "loading" && health.active && (
          <>
            <div className="scheduler-next">
              <ArcoTypography.Text type="secondary" className="rq-caption">下次计划同步</ArcoTypography.Text>
              <strong className="rq-tabular">{next ? formatInZone(next, schedule!.timezone!) : "无法计算"}</strong>
              {next && <ArcoTag color="arcoblue" size="small"><Clock3 size={12} /> {describeCountdown(next, now)}</ArcoTag>}
            </div>
            <ArcoTypography.Paragraph type="secondary" className="detail-note">计划由来源配置与服务端调度共同决定；本卡片只反映已保存的配置，执行结果以同步批次记录为准。</ArcoTypography.Paragraph>
          </>
        )}
      </div>
    </ArcoCard>
  );
}

/**
 * 「高级操作」下拉：Arco Dropdown 自身不加 aria-haspopup/aria-expanded，也不把焦点移入弹出菜单、
 * 默认不响应 Esc（Trigger.escToClose=false）。这里做受控包装补齐无障碍行为。
 */
function AdvancedActions({ busy, health, onRunSourceOnly }: { busy: boolean; health: string; onRunSourceOnly: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // 打开后把焦点移入第一个可用菜单项；关闭后把焦点还给触发按钮。
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const timer = window.setTimeout(() => {
        document.querySelector<HTMLElement>(".arco-dropdown-menu-item:not(.arco-dropdown-menu-item-disabled)")?.focus();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);
  // Arco Trigger 的 escToClose 默认关闭；这里显式处理 Esc，同时阻止事件继续冒泡。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);
  return (
    <ArcoDropdown
      position="br"
      trigger="click"
      popupVisible={open}
      onVisibleChange={setOpen}
      triggerProps={{ escToClose: true }}
      droplist={
        <ArcoMenu onClickMenuItem={(key: string) => { setOpen(false); if (key === "source-only") onRunSourceOnly(); }}>
          <ArcoMenu.Item key="source-only" disabled={busy || health !== "ready"}>
            <span title="只导入 Teambition 源数据；不触发 AI、负责人匹配、Base 推送或通知">仅同步源数据</span>
          </ArcoMenu.Item>
        </ArcoMenu>
      }
    >
      <ArcoButton ref={triggerRef} type="secondary" htmlType="button" aria-haspopup="menu" aria-expanded={open}>高级操作</ArcoButton>
    </ArcoDropdown>
  );
}

const PRIORITY_TAG_COLORS: Record<string, string> = { p0: "red", p1: "orange", p2: "arcoblue", p3: "gray", unscored: "gray" };

function App() {
  // 通知按钮深链只在启动时读取一次：`?requirement=<requirements.id>`。
  // 缺失/无效时保持默认总览页；命中时直接进入需求池并打开该需求详情。
  const [deepLinkRequirementId, setDeepLinkRequirementId] = useState(() => readRequirementDeepLink(window.location.search));
  // 集团池页头条数：由列表面板拿到 source-counts 的 all 后回填，避免同一数字拉两次。
  const [groupRequirementCount, setGroupRequirementCount] = useState<number | null>(null);
  const [page, setPageState] = useState<Page>(() => readWorkbenchPage(window.location.hash, window.location.search));
  // 离开集团池时清掉条数，避免下次进入先闪一帧旧数字。
  useEffect(() => { if (page !== "GroupRequirements") setGroupRequirementCount(null); }, [page]);
  // 合并页签（团队管理：人员/负责人映射；同步记录：批次/审计）。旧链接解析出的页签也在这里落地。
  const [tab, setTabState] = useState<WorkbenchTab | null>(() => readWorkbenchRoute(window.location.hash, window.location.search).tab);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [health, setHealth] = useState<LoadState>("loading");
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sourcesLoadedRef = useRef(false);
  const overviewLoadedRef = useRef(false);

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

  // ?requirement=<UUID> 深链不带池信息：先按 UUID 反查所属池，再切到对应页，
  // 否则集团需求分享链接会落在产品池页被判 404（此前只能从集团列表点进去）。
  const resolvedDeepLinkPool = useRef<string | null>(null);
  useEffect(() => {
    const id = deepLinkRequirementId;
    if (!id) return;
    if (page !== "Requirements" && page !== "GroupRequirements") return;
    if (resolvedDeepLinkPool.current === id) return;
    let cancelled = false;
    void getRequirement(id).then((detail) => {
      if (cancelled) return;
      resolvedDeepLinkPool.current = id;
      if (!detail.pool) return;
      const target: Page = detail.pool === "group" ? "GroupRequirements" : "Requirements";
      if (target === page) return;
      setPageState(target);
      // 只换分页 hash，保留 ?requirement= 深链参数：刷新或复制链接仍直达详情。
      const next = new URL(workbenchUrl(window.location.pathname, window.location.search, target), window.location.origin);
      next.searchParams.set("requirement", id);
      window.history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
    }).catch(() => { resolvedDeepLinkPool.current = id; });
    return () => { cancelled = true; };
  }, [deepLinkRequirementId, page]);

  const pageHref = (target: Page) => workbenchUrl(window.location.pathname, window.location.search, target);
  const navigateLink = (event: ReactMouseEvent<HTMLAnchorElement>, target: Page) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setPage(target);
  };

  // 总览优先级卡片 → 需求池分诊视图。与侧栏链接一致：普通左键走应用内导航，修饰键/中键保留浏览器默认行为。
  const priorityLinkProps = (priority: string) => {
    const filters = { priority, sort: "priority_asc" };
    return {
      href: workbenchUrl(window.location.pathname, window.location.search, "Requirements", filters),
      onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        setPage("Requirements", filters);
      },
    };
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
      if (!event.matches) setMobileNavOpen(false);
    };
    media.addEventListener("change", onViewportChange);
    return () => media.removeEventListener("change", onViewportChange);
  }, []);

  const loadVersionRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const batchesVersionRef = useRef(0);

  // 订阅全局 401 会话失效事件：展示重新登录引导并暂停后台 5 秒轮询。
  useEffect(() => onUnauthorized(() => setSessionExpired(true)), []);

  // 总览数据单波并行拉取（消除 health → sources → 3x endpoints 串行瀑布），由实际结果推导连接状态。
  const loadData = useCallback(async (force = false) => {
    if (force) invalidateQueryCache(CACHE_KEYS.sources, CACHE_KEYS.myRequirementCounts);
    const version = ++loadVersionRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    // 轮询刷新时保留已加载状态：每 5 秒闪回“正在检查 API”只会让按钮禁用、数字抖动。
    setHealth((prev) => (prev === "ready" ? "ready" : "loading")); setError(null);
    const [sourcesResult, batchPage, requirementPage, metricsResult] = await Promise.allSettled([
      listSources(undefined, force ? controller.signal : undefined),
      listBatches({ limit: 10, signal: controller.signal }),
      listRequirements({ limit: 25, signal: controller.signal }),
      getOverviewMetrics(undefined, controller.signal),
    ]);
    if (version !== loadVersionRef.current || controller.signal.aborted) return;
    const anyFulfilled = [sourcesResult, batchPage, requirementPage, metricsResult].some((r) => r.status === "fulfilled");
    if (!anyFulfilled || (sourcesResult.status === "rejected" && batchPage.status === "rejected" && requirementPage.status === "rejected")) {
      const firstFailure = [sourcesResult, batchPage, requirementPage, metricsResult].find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (firstFailure && isAbortError(firstFailure.reason)) return;
      setHealth("error");
      setError(formatApiError(firstFailure?.reason));
      return;
    }
    if (sourcesResult.status === "fulfilled") {
      sourcesLoadedRef.current = true;
      setSources(sourcesResult.value);
    }
    setBatches(batchPage.status === "fulfilled" ? batchPage.value.items : []);
    setRequirements(requirementPage.status === "fulfilled" ? requirementPage.value.items : []);
    setMetrics(metricsResult.status === "fulfilled" ? metricsResult.value : null);
    overviewLoadedRef.current = true;
    setHealth("ready");
  }, []);

  // 仅在 Sources / SyncRecords 需要来源列表但未加载总览时按需拉取 sources，避免次级深链触发 5 个总览请求。
  const loadSourcesOnly = useCallback(async (force = false) => {
    if (force) invalidateQueryCache(CACHE_KEYS.sources);
    try {
      const rows = await listSources();
      sourcesLoadedRef.current = true;
      setSources(rows);
      setHealth("ready");
    } catch (cause) {
      if (!isAbortError(cause)) setHealth("error");
    }
  }, []);

  useEffect(() => {
    if (page === "Overview") {
      if (!overviewLoadedRef.current) void loadData();
    } else if (page === "Sources" || page === "SyncRecords") {
      if (!sourcesLoadedRef.current) void loadSourcesOnly();
    } else {
      setHealth((prev) => (prev === "loading" ? "ready" : prev));
    }
  }, [page, loadData, loadSourcesOnly]);

  useEffect(() => () => { loadControllerRef.current?.abort(); }, []);

  // 局部刷新：批次列表单独拉取。同步提交/运行中轮询只更新批次，需求与统计保持稳定，避免整页刷新。
  const refreshBatches = useCallback(async () => {
    const version = ++batchesVersionRef.current;
    try {
      const page = await listBatches({ limit: 10 });
      if (version !== batchesVersionRef.current) return;
      setBatches(page.items);
    } catch { /* 局部刷新失败保留旧数据，下一轮轮询或手动刷新恢复 */ }
  }, []);
  useEffect(() => {
    // Arco 暗色主题由 body[arco-theme="dark"] 统一驱动（同时保留 data-theme 供旧辅助检查兼容）。
    document.documentElement.dataset.theme = theme;
    document.body.setAttribute("arco-theme", theme === "dark" ? "dark" : "light");
    try { window.localStorage?.setItem("rq-sys-theme", theme); } catch { /* Storage can be disabled by the browser. */ }
  }, [theme]);

  const handleRunSync = async (mode: SyncExecutionMode = "full_pipeline") => {
    let currentSources = sources;
    if (!sourcesLoadedRef.current) {
      try {
        currentSources = await listSources();
        sourcesLoadedRef.current = true;
        setSources(currentSources);
      } catch (cause) {
        setActionError(formatApiError(cause));
        return;
      }
    }
    const source = currentSources.find((item) => item.enabled);
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

  const latestBatch = batches[0];
  // 运行中 → 终态时才补一次全量刷新；轮询期间只用 refreshBatches 更新进度，页面其余内容不重载。
  const previousBatchStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousBatchStatus.current;
    previousBatchStatus.current = latestBatch?.status;
    if (previous === "running" && latestBatch && latestBatch.status !== "running") void loadData(true);
  }, [latestBatch?.status, loadData]);
  // 运行中的批次需要可见进度：只在前端做有界轮询，终态/页面隐藏/401 会话失效时停止。
  useEffect(() => {
    if (latestBatch?.status !== "running" || sessionExpired) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshBatches();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [latestBatch?.status, sessionExpired, refreshBatches]);
  const counts = { pull: metrics?.pullSynced ?? 0, analysis: metrics?.analysisAnalyzed ?? 0, owner: metrics?.ownerResolved ?? 0, push: metrics?.pushPushed ?? 0, failed: metrics?.failed ?? 0, pushFailed: metrics?.pushFailed ?? 0, pushPending: metrics?.pushPending ?? 0, suppressed: metrics?.suppressed ?? 0 };
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
  // 服务端 ownerResolved 已包含 auto_mapped / manually_mapped / not_required，因此 total - counts.owner 精确对应 pending_mapping。
  const kpiItems = [
    { key: "total", label: "需求总数", value: metrics ? total : null, hint: metrics ? `已排除 ${counts.suppressed} 条，不参与分析与推送` : "全量统计暂不可用", tone: "neutral", icon: Layers3, filters: undefined },
    { key: "unassigned", label: "待分配负责人", value: metrics ? Math.max(0, total - counts.owner) : null, hint: "分配后自动推送并通知", tone: "warn", icon: UserRoundCheck, filters: { ownerState: "pending_mapping" } },
    { key: "failed", label: "推送失败", value: metrics ? counts.pushFailed : null, hint: "详情页查看原因并重试", tone: metrics && counts.pushFailed > 0 ? "danger" : "ok", icon: CircleAlert, filters: { push: "failed" } },
    { key: "pending", label: "待推送", value: metrics ? counts.pushPending : null, hint: "等待写入多维表格", tone: "info", icon: Clock3, filters: { push: "pending" } },
  ] as const;

  const renderBrand = () => (
    <a className="brand" href={pageHref("Overview")} onClick={(event) => navigateLink(event, "Overview")}>
      <span className="brand-mark"><Layers3 size={16} strokeWidth={2.2} /></span>
      <span className="brand-name">RQ-Sys</span>
    </a>
  );

  const renderSidebarNav = (collapsed = false) => (
    <nav className="main-nav" aria-label="主导航">
      <ArcoMenu
        className="rq-nav-menu"
        mode="vertical"
        collapse={collapsed}
        selectedKeys={[page]}
        onClickMenuItem={(key: string) => setPage(key as Page)}
      >
        {navigationGroups.map((group) => (
          <ArcoMenu.ItemGroup key={group.title} title={group.title}>
            {group.items.map(({ label, icon: Icon }) => (
              <ArcoMenu.Item key={label}>
                <a
                  className="nav-item-link"
                  href={pageHref(label)}
                  title={collapsed ? pageTitles[label] : undefined}
                  onClick={(event) => { event.stopPropagation(); navigateLink(event, label); }}
                  aria-current={page === label ? "page" : undefined}
                >
                  <span className="nav-item-icon"><Icon size={16} /></span>
                  <span className="nav-item-label">{pageTitles[label]}</span>
                </a>
              </ArcoMenu.Item>
            ))}
          </ArcoMenu.ItemGroup>
        ))}
      </ArcoMenu>
    </nav>
  );

  return (
    <ArcoLayout className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        // 避免改写 location.hash 触发 hash 路由 popstate 把当前页重置回总览。
        event.preventDefault();
        const main = document.getElementById("main-content");
        main?.focus();
        main?.scrollIntoView?.({ block: "start" });
      }}>
        跳到主要内容
      </a>

      <ArcoLayout.Header className="navbar">
        <div className="navbar-left">
          <ArcoButton
            type="text"
            shape="circle"
            ref={mobileMenuButtonRef}
            htmlType="button"
            className="navbar-icon-btn mobile-menu-button"
            aria-label="打开主导航"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={16} />
          </ArcoButton>
          {renderBrand()}
        </div>
        <ArcoSpace size={16} align="center" className="topbar-actions">
          <ArcoTag
            className={`connection-state ${health}`}
            color={health === "ready" ? "green" : health === "loading" ? "orange" : "red"}
          >
            <ArcoBadge status={health === "ready" ? "success" : health === "loading" ? "processing" : "error"} />
            <span>{health === "ready" ? "API 已连接" : health === "loading" ? "正在检查 API" : "API 未连接"}</span>
          </ArcoTag>
          <ArcoTooltip content={theme === "dark" ? "切换浅色主题" : "切换深色主题"}>
            <ArcoButton
              type="secondary"
              shape="circle"
              htmlType="button"
              className="navbar-icon-btn"
              aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </ArcoButton>
          </ArcoTooltip>
          <ArcoTooltip content="使用指南">
            <ArcoButton
              type="secondary"
              shape="circle"
              className="navbar-icon-btn"
              aria-label="帮助"
              title="使用指南"
              href={pageHref("Guide")}
              onClick={(event) => navigateLink(event as unknown as ReactMouseEvent<HTMLAnchorElement>, "Guide")}
            >
              <CircleHelp size={16} />
            </ArcoButton>
          </ArcoTooltip>
        </ArcoSpace>
      </ArcoLayout.Header>

      <ArcoDrawer
        className="mobile-nav-drawer"
        placement="left"
        width={240}
        visible={mobileNavOpen}
        footer={null}
        headerStyle={{ display: "none" }}
        unmountOnExit
        onCancel={() => {
          setMobileNavOpen(false);
          mobileMenuButtonRef.current?.focus();
        }}
      >
        {mobileNavOpen ? (
          <div role="dialog" aria-label="主导航" aria-modal="true" className="mobile-nav-drawer-body">
            {renderBrand()}
            {renderSidebarNav(false)}
          </div>
        ) : null}
      </ArcoDrawer>

      <ArcoLayout className="app-body-layout">
        <ArcoLayout.Sider
          className={`sidebar${siderCollapsed ? " is-collapsed" : ""}`}
          width={siderCollapsed ? 48 : 220}
          collapsible
          collapsed={siderCollapsed}
          trigger={null}
        >
          <div
            className="sidebar-inner"
            aria-hidden={mobileNavOpen || undefined}
            inert={mobileNavOpen || undefined}
          >
            {renderSidebarNav(siderCollapsed)}
            <ArcoTooltip content={siderCollapsed ? "展开侧栏" : "收起侧栏"} position="right">
              <ArcoButton
                type="text"
                size="mini"
                htmlType="button"
                className="sidebar-collapse-btn"
                aria-label={siderCollapsed ? "展开侧栏" : "收起侧栏"}
                onClick={() => setSiderCollapsed((prev) => !prev)}
              >
                {siderCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
              </ArcoButton>
            </ArcoTooltip>
          </div>
        </ArcoLayout.Sider>

        <ArcoLayout className={`main-area-layout${siderCollapsed ? " is-sider-collapsed" : ""}`}>
          <ArcoLayout.Content id="main-content" className="main-area" tabIndex={-1} inert={mobileNavOpen || undefined}>
            <div className="content-area">
              <div className="canvas-breadcrumb">
                <ArcoBreadcrumb className="rq-breadcrumb">
                  <ArcoBreadcrumb.Item key="root">RQ-Sys</ArcoBreadcrumb.Item>
                  <ArcoBreadcrumb.Item key={page}>{pageTitles[page]}</ArcoBreadcrumb.Item>
                </ArcoBreadcrumb>
              </div>
              <PanelErrorBoundary resetKey={`${page}:${tab ?? ""}:${deepLinkRequirementId ?? ""}`}>
                {sessionExpired && (
                  <ArcoAlert
                    className="rq-page-alert"
                    type="warning"
                    showIcon
                    role="alert"
                    title="登录已失效"
                    content="当前飞书登录会话已过期，后台轮询已暂停；请重新登录后继续操作。"
                    action={<ArcoButton type="primary" size="small" htmlType="button" onClick={() => window.location.reload()}>重新登录</ArcoButton>}
                  />
                )}
                {error && page === "Overview" && (
                  <ArcoAlert
                    className="rq-page-alert"
                    type="error"
                    showIcon
                    role="alert"
                    title="服务暂不可用"
                    content={error}
                    action={<ArcoButton type="secondary" size="small" htmlType="button" onClick={() => void loadData(true)}><RefreshCw size={14} />重试连接</ArcoButton>}
                  />
                )}
                {actionError && (
                  <ArcoAlert
                    className="rq-page-alert"
                    type="error"
                    showIcon
                    closable
                    role="alert"
                    title="操作未完成"
                    content={actionError}
                    onClose={() => setActionError(null)}
                  />
                )}
                {notice && (
                  <ArcoAlert
                    className="rq-page-alert"
                    type="success"
                    showIcon
                    closable
                    role="status"
                    content={notice}
                    onClose={() => setNotice(null)}
                  />
                )}

                {page === "Overview" && (
                  <div className="overview-stack">
                    <div className="workplace-layout">
                      <div className="workplace-main">
                        <ArcoCard bordered={false} className="rq-card workplace-banner">
                          <div className="workplace-banner-head">
                            <div className="page-heading-copy">
                              <h1>工作流总览</h1>
                              <ArcoTypography.Text type="secondary" className="page-heading-subtitle">查看需求同步进度、分析状态与推送健康度；四个处理阶段独立统计、互不阻塞。</ArcoTypography.Text>
                            </div>
                            <ArcoSpace size={8} wrap className="heading-actions">
                              <ArcoButton type="secondary" htmlType="button" onClick={() => void loadData(true)} disabled={health === "loading"}>
                                <RefreshCw size={14} className={health === "loading" ? "spin" : ""} />刷新
                              </ArcoButton>
                              <AdvancedActions busy={busy} health={health} onRunSourceOnly={() => void handleRunSync("source_only")} />
                              <ArcoButton type="primary" htmlType="button" onClick={() => void handleRunSync()} disabled={busy || health !== "ready"}>
                                <Play size={14} fill="currentColor" />{busy ? "提交中…" : "立即同步"}
                              </ArcoButton>
                            </ArcoSpace>
                          </div>
                          <ArcoDivider className="rq-compact-divider" />
                          <div className="workplace-kpi-grid">
                            {kpiItems.map((item) => {
                              const Icon = item.icon;
                              const disabled = item.value === null;
                              return (
                                <div className="workplace-kpi-item" key={item.key}>
                                  <button
                                    type="button"
                                    className={`workplace-kpi-btn is-${item.tone}`}
                                    disabled={disabled}
                                    onClick={() => { if (!disabled) setPage("Requirements", item.filters); }}
                                  >
                                    <span className="workplace-kpi-icon"><Icon size={22} /></span>
                                    <span className="workplace-kpi-body">
                                      <span className="todo-value">
                                        {item.value === null ? (
                                          health === "loading" ? <SkeletonBlock className="skeleton-num" /> : <ArcoStatistic title={item.label} value="—" />
                                        ) : (
                                          <ArcoStatistic title={item.label} value={item.value} />
                                        )}
                                      </span>
                                      <span className="todo-hint">{item.hint}</span>
                                    </span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </ArcoCard>

                        <ArcoCard
                          bordered={false}
                          className="rq-card priority-grade-panel"
                            aria-labelledby="priority-grade-heading"
                            title={
                              <div className="rq-card-title">
                                <h2 id="priority-grade-heading">优先级分级</h2>
                                <ArcoTypography.Text type="secondary" className="rq-card-subtitle">按当前综合评分统计需求数量；点击下钻对应分诊视图</ArcoTypography.Text>
                              </div>
                            }
                            extra={<ArcoTypography.Text type="secondary">{priority ? `${priorityGraded} / ${total} 已分级` : "统计暂不可用"}</ArcoTypography.Text>}
                          >
                            <div className="priority-grade-grid" role="group" aria-label="优先级分级统计">
                              {priorityCards.map((card) => {
                                const body = (
                                  <ArcoCard size="small" hoverable={Boolean(priority)} className={`priority-grade-card is-${card.tone}`}>
                                    <div className="priority-grade-head">
                                      <ArcoTag size="small" color={PRIORITY_TAG_COLORS[card.tone]}>{card.key}</ArcoTag>
                                      <ArcoTypography.Text type="secondary" className="rq-caption">{card.range}</ArcoTypography.Text>
                                    </div>
                                    <div className="priority-grade-num">
                                      {priority ? <ArcoStatistic value={card.value} suffix="条需求" /> : health === "loading" ? <SkeletonBlock className="skeleton-num" /> : <ArcoStatistic value="—" suffix="条需求" />}
                                    </div>
                                  </ArcoCard>
                                );
                                // 统计可用时下钻到需求池的分诊视图（priority 筛选 + P0→P3 排序）；统计缺失时只展示，不给假链接。
                                return priority
                                  ? <a key={card.key} className="priority-grade-link" aria-label={`查看 ${card.key} 需求，共 ${card.value} 条`} {...priorityLinkProps(card.key)}>{body}</a>
                                  : <div key={card.key}>{body}</div>;
                              })}
                              <ArcoCard size="small" className="priority-grade-card is-unscored">
                                <div className="priority-grade-head">
                                  <ArcoTag size="small" color="gray">待评分</ArcoTag>
                                  <ArcoTypography.Text type="secondary" className="rq-caption">无评分记录</ArcoTypography.Text>
                                </div>
                                <div className="priority-grade-num">
                                  {priority ? <ArcoStatistic value={priority.unscored} suffix="条需求" /> : health === "loading" ? <SkeletonBlock className="skeleton-num" /> : <ArcoStatistic value="—" suffix="条需求" />}
                                </div>
                              </ArcoCard>
                            </div>

                            <div className="priority-rule-box">
                              <div className="priority-rule-heading">
                                <strong>分级规则</strong>
                                <ArcoTypography.Text type="secondary">{priorityRule ? `评分规则 v${priorityRule.version} · 固定公式` : "暂未发布有效评分规则"}</ArcoTypography.Text>
                              </div>
                              {priorityRule?.thresholds ? (
                                <ArcoSpace size={[16, 8]} wrap className="priority-rule-ranges" aria-label="评分范围与对应分级">
                                  <span><ArcoTag size="small" color="red">P0</ArcoTag> 综合分 ≥ {priorityRule.thresholds.p0}</span>
                                  <span><ArcoTag size="small" color="orange">P1</ArcoTag> {priorityRule.thresholds.p1}–{(priorityRule.thresholds.p0 - 0.01).toFixed(2)}</span>
                                  <span><ArcoTag size="small" color="arcoblue">P2</ArcoTag> {priorityRule.thresholds.p2}–{(priorityRule.thresholds.p1 - 0.01).toFixed(2)}</span>
                                  <span><ArcoTag size="small" color="gray">P3</ArcoTag> 综合分 &lt; {priorityRule.thresholds.p2}</span>
                                </ArcoSpace>
                              ) : (
                                <ArcoTypography.Paragraph type="secondary" className="priority-rule-empty">规则未发布时优先级保持为空，不使用模型自报 P 填充。</ArcoTypography.Paragraph>
                              )}
                              <code className="priority-rule-formula">{priorityRule?.formulaText ?? "U/M/S/C 固定公式"}</code>
                              <ArcoTypography.Paragraph type="secondary" className="priority-rule-note">
                                {priority ? (
                                  <>已分级 {priorityGraded} 条，其中 <strong>{priority.legacy}</strong> 条来自历史分析优先级（v1，不套用上方 v2 分数范围）；<strong>{priority.unscored}</strong> 条待评分。人工优先级优先于评分；当前评分版本优先于历史分析优先级。</>
                                ) : "评分统计随总览指标加载；合成验收数据不计入。"}
                              </ArcoTypography.Paragraph>
                            </div>
                          </ArcoCard>

                          <ArcoCard
                            bordered={false}
                            className="rq-card pipeline-panel"
                            title={
                              <div className="rq-card-title">
                                <h2>处理阶段</h2>
                                <ArcoTypography.Text type="secondary" className="rq-card-subtitle">需求处理状态一览</ArcoTypography.Text>
                              </div>
                            }
                            extra={
                              <ArcoTooltip content="拉取、AI 分析、负责人匹配和 Base 推送分别记录状态；AI 分析失败不会阻止推送。">
                                <span className="pipeline-help" role="img" aria-label="阶段说明"><CircleHelp size={16} /></span>
                              </ArcoTooltip>
                            }
                          >
                            <div className="pipeline-overview">
                              {[
                                { name: "拉取", detail: "从 Teambition 获取需求", value: counts.pull, icon: ArrowDownToLine },
                                { name: "AI 分析", detail: "生成模块与维度建议", value: counts.analysis, icon: Sparkles },
                                { name: "负责人匹配", detail: "关联 Feishu 用户", value: counts.owner, icon: Users },
                                { name: "推送 Base", detail: "创建或更新多维表格记录", value: counts.push, icon: Check },
                              ].map(({ name, detail, value, icon: Icon }) => {
                                const percent = metrics && total ? Math.round((value / total) * 100) : 0;
                                return (
                                  <div className="pipeline-row" key={name}>
                                    <div className="pipeline-icon"><Icon size={16} /></div>
                                    <div className="pipeline-copy">
                                      <strong>{name}</strong>
                                      <ArcoTypography.Text type="secondary" className="rq-caption">{detail}</ArcoTypography.Text>
                                    </div>
                                    <div className="pipeline-progress">
                                      <ArcoProgress percent={percent} size="small" showText={false} />
                                      <ArcoTypography.Text type="secondary" className="rq-caption rq-tabular">
                                        {metrics ? `${value} / ${total}` : "全量统计暂不可用"}
                                      </ArcoTypography.Text>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <ArcoDivider className="rq-compact-divider" />
                            <div className="pipeline-foot">
                              <ArcoBadge status={metrics ? "success" : "default"} text={metrics ? "状态来自全量需求聚合 API" : "等待全量统计 API"} />
                              <ArcoTypography.Text type="secondary" className="rq-caption">AI 失败不会阻止推送</ArcoTypography.Text>
                            </div>
                          </ArcoCard>

                          <RecentRequirementsCard
                            requirements={requirements}
                            loading={health === "loading"}
                            onViewAll={() => setPage("Requirements")}
                          />
                      </div>

                      <div className="workplace-rail">
                        <MyRequirementsCard onOpen={() => setPage("MyRequirements")} />

                          <ArcoCard
                            bordered={false}
                            className="rq-card source-banner"
                            title={<h2>当前同步来源</h2>}
                            extra={<ArcoButton type="text" size="small" onClick={() => setPage("Sources")} htmlType="button">管理来源 <ArrowRight size={14} /></ArcoButton>}
                          >
                            <div className="source-rail-body">
                              <div className="source-rail-top">
                                <span className="source-icon"><GitBranch size={16} /></span>
                                <div>
                                  <div className="source-banner-title">
                                    {sources[0]?.projectName ?? (health === "loading" ? "正在加载配置…" : health === "error" ? "无法读取来源配置" : "尚未配置数据源")}
                                  </div>
                                  <ArcoTypography.Text type="secondary" className="rq-caption">Teambition 项目</ArcoTypography.Text>
                                </div>
                              </div>
                              <ArcoBadge status={sources[0]?.enabled ? "success" : "default"} text={sources[0]?.enabled ? "同步已启用" : "未启用"} />
                            </div>
                          </ArcoCard>

                          <AiStatusCard ai={metrics?.ai} loadState={health} onExpire={loadData} />

                          <ArcoCard
                            bordered={false}
                            className="rq-card latest-panel"
                            title={<h2>最近同步</h2>}
                            extra={<ArcoButton type="text" size="small" onClick={() => setPage("SyncRecords")} htmlType="button">全部批次 <ArrowRight size={14} /></ArcoButton>}
                          >
                            <ArcoTypography.Text type="secondary" className="rail-card-subtitle">最新批次执行情况</ArcoTypography.Text>
                            {latestBatch ? (
                              <div className="latest-content">
                                <div className="batch-status-line">
                                  <span className={`batch-status-icon ${latestBatch.status === "failed" ? "danger" : latestBatch.status === "running" ? "live" : "success"}`}>
                                    {latestBatch.status === "running" ? <LoaderCircle size={16} className="spin" /> : latestBatch.status === "failed" ? <CircleAlert size={16} /> : <Check size={16} />}
                                  </span>
                                  <div className="batch-status-copy">
                                    <strong>{latestBatch.status === "running" ? "同步进行中" : latestBatch.status === "partial_failure" ? "部分完成" : latestBatch.status === "failed" ? "同步失败" : "同步完成"}</strong>
                                    <ArcoTypography.Text type="secondary" className="rq-caption mono-cell">批次 {latestBatch.id}</ArcoTypography.Text>
                                  </div>
                                  <ArcoTag size="small" color={latestBatch.status === "failed" ? "red" : latestBatch.status === "running" ? "arcoblue" : "green"}>{stateLabel(latestBatch.status)}</ArcoTag>
                                </div>
                                <ArcoGrid.Row gutter={12} className="latest-counts">
                                  <ArcoGrid.Col span={8}><ArcoStatistic title="总需求" value={latestBatch.totalCount} /></ArcoGrid.Col>
                                  <ArcoGrid.Col span={8}><ArcoStatistic title="已完成" value={latestBatch.succeededCount} /></ArcoGrid.Col>
                                  <ArcoGrid.Col span={8}><ArcoStatistic title="失败" value={latestBatch.failedCount} styleValue={latestBatch.failedCount ? { color: "rgb(var(--danger-6))" } : undefined} /></ArcoGrid.Col>
                                </ArcoGrid.Row>
                                <div className="latest-timestamp">
                                  <ArcoSpace size={6} align="center">
                                    <Clock3 size={14} />
                                    <ArcoTypography.Text type="secondary" className="rq-caption">
                                      {latestBatch.startedAt ? new Date(latestBatch.startedAt).toLocaleString("zh-CN") : "等待批次时间"}
                                    </ArcoTypography.Text>
                                  </ArcoSpace>
                                  <ArcoButton type="text" size="small" onClick={() => setPage("SyncRecords")} htmlType="button">查看详情</ArcoButton>
                                </div>
                              </div>
                            ) : health === "loading" ? (
                              <SkeletonCards count={1} />
                            ) : (
                              <ArcoEmpty
                                className="rq-empty"
                                description={
                                  <div className="rq-empty-copy">
                                    <strong>还没有同步批次</strong>
                                    <span>{health === "ready" ? "手动启动同步后，批次进度会显示在这里。" : "连接 API 后可查看实际批次记录。"}</span>
                                  </div>
                                }
                              />
                            )}
                          </ArcoCard>

                          <SchedulerHealthPanel schedule={sources[0]?.schedule} loadState={health} onConfigure={() => setPage("Sources")} />
                      </div>
                    </div>

                    <footer className="page-footer">
                      <span>RQ-Sys MVP</span>
                      <ArcoSpace size={6} align="center"><ShieldCheck size={14} /><span>状态由 API 返回；不展示飞书 PM 处理状态</span></ArcoSpace>
                    </footer>
                  </div>
                )}

                {page !== "Overview" && (
                  <section className="secondary-page">
                    <div className="page-heading">
                      <div className="page-heading-copy">
                        <ArcoSpace size={8} align="center">
                          <h1>{pageTitles[page]}</h1>
                          {page === "GroupRequirements" && groupRequirementCount !== null ? <ArcoTag color="arcoblue">共 {groupRequirementCount} 条</ArcoTag> : null}
                        </ArcoSpace>
                        <ArcoTypography.Text type="secondary" className="page-heading-subtitle">{pageDescription(page)}</ArcoTypography.Text>
                      </div>
                      {page === "MyRequirements" && (
                        <div className="heading-actions">
                          <ArcoButton type="secondary" onClick={() => setPage("RecycleBin")} htmlType="button"><Trash2 size={14} />回收站</ArcoButton>
                        </div>
                      )}
                      {page === "SyncRecords" && (
                        <ArcoSpace size={8} className="heading-actions">
                          <AdvancedActions busy={busy} health={health} onRunSourceOnly={() => void handleRunSync("source_only")} />
                          <ArcoButton type="primary" htmlType="button" onClick={() => void handleRunSync()} disabled={busy || health !== "ready"}>
                            <Play size={14} fill="currentColor" />{busy ? "提交中…" : "立即同步"}
                          </ArcoButton>
                        </ArcoSpace>
                      )}
                    </div>
                    <Suspense fallback={<SkeletonCards count={2} />}>
                      <SecondaryContent page={page} tab={tab} sources={sources} loadState={health} deepLinkRequirementId={deepLinkRequirementId} onNavigate={setPage} onRefresh={() => { if (page === "Sources") void loadSourcesOnly(true); else void loadData(true); }} onGroupCountChange={setGroupRequirementCount} />
                    </Suspense>
                  </section>
                )}
              </PanelErrorBoundary>
            </div>
          </ArcoLayout.Content>
        </ArcoLayout>
      </ArcoLayout>
    </ArcoLayout>
  );
}

/** PRD §4.13.4：首页「我的需求」卡，与左侧菜单同一路由；数量来自 /mine/counts。 */
function MyRequirementsCard({ onOpen }: { onOpen: () => void }) {
  const [counts, setCounts] = useState<MyRequirementCounts | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  useEffect(() => {
    let cancelled = false;
    void getMyRequirementCounts()
      .then((value) => { if (!cancelled) { setCounts(value); setLoadState("ready"); } })
      .catch(() => { if (!cancelled) { setCounts(null); setLoadState("error"); } });
    return () => { cancelled = true; };
  }, []);
  const href = workbenchUrl(window.location.pathname, window.location.search, "MyRequirements");
  const total = loadState === "error" ? "—" : loadState === "loading" ? null : counts?.identityResolved === false ? "—" : String(counts?.total ?? 0);
  const detail = loadState === "error"
    ? "数量暂不可用"
    : loadState === "loading"
      ? "正在读取分配给你的需求…"
      : counts && !counts.identityResolved
        ? "未绑定飞书身份"
        : counts && counts.total === 0
          ? "暂无分配给你的需求"
          : counts ? `产品池 ${counts.product} · 集团池 ${counts.group}（含已排除）` : "";
  return (
    <ArcoCard
      bordered={false}
      className="rq-card my-requirements-card"
      title={<h2>我的需求</h2>}
      extra={<ArcoButton type="text" size="small" onClick={onOpen} htmlType="button">查看全部 <ArrowRight size={14} /></ArcoButton>}
    >
      <a
        className="my-requirements-card-link"
        href={href}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen();
        }}
      >
        <span className="my-requirements-card-left">
          <span className="my-requirements-card-icon"><UserRoundCheck size={20} /></span>
          <span className="my-requirements-card-copy">
            <strong className="my-requirements-card-title">{detail}</strong>
            <ArcoTypography.Text type="secondary" className="rq-caption">分配给你的需求；不含已删除</ArcoTypography.Text>
          </span>
        </span>
        <span className="my-requirements-card-count">
          <strong className="rq-tabular">{loadState === "loading" ? <SkeletonBlock className="skeleton-num" /> : total}</strong>
        </span>
      </a>
    </ArcoCard>
  );
}

const OVERVIEW_REQUIREMENTS_COLUMNS = [
  { title: "需求", dataIndex: "title", render: (_value: unknown, row: Requirement) => <div className="requirement-title"><span className="req-id">{requirementDisplayId(row)}</span><strong>{row.title}</strong></div> },
  { title: "版本", dataIndex: "sourceVersion", width: 64, render: (_value: unknown, row: Requirement) => <span className="version-label">v{row.sourceVersion}</span> },
  { title: "拉取", key: "pipeline-pull", dataIndex: "pipeline", width: 112, render: (_value: unknown, row: Requirement) => <StagePill stage="pull" value={row.pipeline.pull} /> },
  { title: "AI 分析", key: "pipeline-analysis", dataIndex: "pipeline", width: 120, render: (_value: unknown, row: Requirement) => <StagePill stage="analysis" value={row.pipeline.analysis} /> },
  { title: "负责人", key: "pipeline-owner", dataIndex: "pipeline", width: 116, render: (_value: unknown, row: Requirement) => <StagePill stage="owner" value={row.pipeline.owner} /> },
  { title: "Base 推送", key: "pipeline-push", dataIndex: "pipeline", width: 116, render: (_value: unknown, row: Requirement) => <StagePill stage="push" value={row.pipeline.push} /> },
];

const RecentRequirementsCard = memo(function RecentRequirementsCard({
  requirements,
  loading,
  onViewAll,
}: {
  requirements: Requirement[];
  loading: boolean;
  onViewAll: () => void;
}) {
  // 本地筛选状态收口在本卡片内，输入关键词不会触发根 App 或其他总览卡片重渲染。
  const [query, setQuery] = useState("");
  const shownRequirements = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requirements.slice(0, 5);
    return requirements.filter((item) => item.title.toLowerCase().includes(q) || (item.sourceRequirementId ?? "").toLowerCase().includes(q)).slice(0, 5);
  }, [requirements, query]);

  return (
    <ArcoCard
      bordered={false}
      className="rq-card requirements-panel"
      title={
        <div className="rq-card-title">
          <h2>最近处理的需求</h2>
          <ArcoTypography.Text type="secondary" className="rq-card-subtitle">每个阶段状态分别展示，分析失败不会隐藏已推送结果</ArcoTypography.Text>
        </div>
      }
      extra={
        <ArcoSpace size={8} wrap align="center">
          <ArcoInput
            className="rq-search-input"
            prefix={<Search size={14} />}
            aria-label="搜索需求"
            placeholder="在当前已加载需求内搜索…"
            value={query}
            onChange={(value: string) => setQuery(value)}
          />
          <ArcoButton type="text" htmlType="button" size="small" onClick={onViewAll}>查看全部 <ArrowRight size={14} /></ArcoButton>
        </ArcoSpace>
      }
    >
      <RequirementsTable rows={shownRequirements} loading={loading} />
    </ArcoCard>
  );
});

const RequirementsTable = memo(function RequirementsTable({ rows, loading }: { rows: Requirement[]; loading: boolean }) {
  // 首屏加载显示骨架屏；空态保留表头（Arco Pro 2.0 Search Table 规范）。
  if (loading && !rows.length) {
    return <SkeletonTableRows rows={5} columns={6} />;
  }
  return (
    <ArcoTable<Requirement>
      rowKey="id"
      data={rows}
      pagination={false}
      border={false}
      scroll={{ x: 760 }}
      noDataElement={
        <ArcoEmpty
          className="rq-empty"
          description={
            <div className="rq-empty-copy">
              <strong>没有匹配的需求</strong>
              <span>数据仅在 API 返回后显示，不使用演示数据。</span>
            </div>
          }
        />
      }
      columns={OVERVIEW_REQUIREMENTS_COLUMNS}
    />
  );
});

function SecondaryContent({ page, tab, sources, loadState, deepLinkRequirementId, onNavigate, onRefresh, onGroupCountChange }: { page: Page; tab: WorkbenchTab | null; sources: SourceConfig[]; loadState: LoadState; deepLinkRequirementId: string | null; onNavigate: (page: Page) => void; onRefresh: () => void; onGroupCountChange: (count: number | null) => void }) {
  if (page === "MyRequirements") return <MyRequirementsPanel onRefresh={onRefresh} />;
  if (page === "RecycleBin") return <RecycleBinPanel onRefresh={onRefresh} />;
  if (page === "Requirements") return <RequirementsPanel onRefresh={onRefresh} initialRequirementId={deepLinkRequirementId} />;
  if (page === "GroupRequirements") return <RequirementsPanel scope="group" onRefresh={onRefresh} initialRequirementId={deepLinkRequirementId} onGroupCountChange={onGroupCountChange} />;
  if (page === "Team") return <TeamPanel initialTab={tab} onRefresh={onRefresh} />;
  if (page === "SyncRecords") return <SyncRecordsPanel initialTab={tab} onRefresh={onRefresh} />;
  if (page === "Sources") return <SourcesPanel sources={sources} loadState={loadState} onRefresh={onRefresh} />;
  if (page === "Modules") return <ModulesPanel />;
  if (page === "Rules") return <RulesPanel />;
  if (page === "Ops") return <OpsPanel />;
  if (page === "Guide") return <GuidePanel />;
  if (page === "Sop") return <SopPanel />;
  return (
    <ArcoCard className="rq-card">
      <ArcoResult
        status="404"
        title="页面未实现"
        subTitle="该页面尚未提供 API 契约。"
        extra={<ArcoButton type="primary" htmlType="button" onClick={() => onNavigate("Overview" as Page)}>返回总览 <ArrowRight size={14} /></ArcoButton>}
      />
    </ArcoCard>
  );
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
  const [thresholds, setThresholds] = useState<{ p0: number | undefined; p1: number | undefined; p2: number | undefined }>({ p0: 4, p1: 3, p2: 2 });
  const [scoringInput, setScoringInput] = useState("user:强=3\nuser:中=2\nuser:弱=1\nmarket:强=3\nmarket:中=2\nmarket:弱=1\nbusiness:强=3\nbusiness:中=2\nbusiness:弱=1\ntechnology:强=3\ntechnology:中=2\ntechnology:弱=1");
  const [evidenceInput, setEvidenceInput] = useState("");
  // v2 是已确认的固定公式：生效期间 API 拒绝发布任何 v1 草稿，界面必须提前说明而不是让人点了才收到 409。
  const activeV2 = rules.some((rule) => rule.status === "published" && (rule.rules.formulaType === "umsc_weighted_v2" || rule.rules.formulaType === "umsc_weighted_v3"));

  const loadControllerRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoadError(null);
    try {
      const list = await listPriorityRules(undefined, controller.signal);
      if (!controller.signal.aborted) setRules(list);
    } catch (cause) {
      if (!controller.signal.aborted && !isAbortError(cause)) setLoadError(formatApiError(cause));
    }
  }, []);
  useEffect(() => {
    void load();
    return () => { loadControllerRef.current?.abort(); };
  }, [load]);

  const withFeedback = useCallback(async (action: () => Promise<string>) => {
    setBusy(true); setNotice(null); setActionError(null);
    try { setNotice(await action()); await load(); }
    catch (cause) { setActionError(formatApiError(cause)); }
    finally { setBusy(false); }
  }, [load]);

  const ruleColumns = useMemo(() => [
    { title: "版本", dataIndex: "version", width: 90, render: (_value: unknown, rule: PriorityRuleVersion) => <span className="mono-cell">v{rule.version}</span> },
    { title: "状态", dataIndex: "status", width: 110, render: (_value: unknown, rule: PriorityRuleVersion) => <PublishStatusChip status={rule.status} /> },
    { title: "阈值 (P0/P1/P2)", dataIndex: "rules", width: 170, render: (_value: unknown, rule: PriorityRuleVersion) => <span className="mono-cell">{[rule.rules.thresholds?.p0, rule.rules.thresholds?.p1, rule.rules.thresholds?.p2].map((value) => value ?? "—").join(" / ")}</span> },
    { title: "创建时间", dataIndex: "createdAt", width: 180, render: (_value: unknown, rule: PriorityRuleVersion) => new Date(rule.createdAt).toLocaleString("zh-CN") },
    { title: "发布时间", dataIndex: "publishedAt", width: 180, render: (_value: unknown, rule: PriorityRuleVersion) => rule.publishedAt ? new Date(rule.publishedAt).toLocaleString("zh-CN") : "—" },
    {
      title: "操作",
      dataIndex: "id",
      width: 110,
      render: (_value: unknown, rule: PriorityRuleVersion) => {
        const blocked = activeV2 && rule.rules.formulaType !== "umsc_weighted_v2" && rule.rules.formulaType !== "umsc_weighted_v3";
        return rule.status === "draft" && (
          <ArcoTooltip content={blocked ? "v2/v3 公式生效期间不能发布 v1 规则" : ""} disabled={!blocked}>
            <ArcoButton
              type="primary"
              htmlType="button"
              size="small"
              onClick={() => void withFeedback(async () => { await publishPriorityRule(rule.id); return `规则 v${rule.version} 已发布`; })}
              disabled={busy || blocked}
            >
              发布
            </ArcoButton>
          </ArcoTooltip>
        );
      },
    },
  ], [activeV2, busy, withFeedback]);
  const handleCreateRule = () => withFeedback(async () => {
    if (thresholds.p0 === undefined || thresholds.p1 === undefined || thresholds.p2 === undefined) {
      throw new ApiError("请填写完整的 P0 / P1 / P2 阈值。", 400, "INVALID_THRESHOLDS");
    }
    if (!(thresholds.p0 >= thresholds.p1 && thresholds.p1 >= thresholds.p2)) throw new ApiError("阈值需满足 P0 ≥ P1 ≥ P2。", 400, "INVALID_THRESHOLDS");
    const scoring = parseScoringInput(scoringInput);
    if (Object.values(scoring).some((map) => Object.keys(map).length === 0)) throw new ApiError("每个维度至少需要一条「取值=分数」的已批准评分。", 400, "INVALID_SCORING");
    let validationEvidence: unknown[] = [];
    try { validationEvidence = evidenceInput.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown); }
    catch { throw new ApiError("校准证据每行必须是一个合法 JSON 对象。", 400, "INVALID_EVIDENCE"); }
    const created = await createPriorityRuleDraft({ scoring, thresholds: { p0: thresholds.p0, p1: thresholds.p1, p2: thresholds.p2 } }, undefined, validationEvidence);
    return `规则 v${created.version} 草稿已创建`;
  });

  return (
    <ArcoCard bordered={false} className="rq-card requirements-panel">
      <div className="req-action-row">
        <ArcoTypography.Text type="secondary">规则版本经历史案例校准；发布前需求优先级保持为空。</ArcoTypography.Text>
        <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void load()} disabled={busy}><RefreshCw size={14} />刷新</ArcoButton>
      </div>
      {activeV2 && <ArcoAlert className="rq-inline-alert" type="info" showIcon role="status" content="当前生效的是已确认的 v2/v3 评分公式。v1 四维求和规则不能再发布覆盖它，下方「创建草稿」已暂停。" />}
      {loadError && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="配置加载失败" content={loadError} action={<ArcoButton type="secondary" size="mini" htmlType="button" onClick={() => void load()}>重试</ArcoButton>} />}
      {actionError && <ArcoAlert className="rq-inline-alert" type="error" showIcon closable role="alert" title="操作未完成" content={actionError} onClose={() => setActionError(null)} />}
      {notice && <ArcoAlert className="rq-inline-alert" type="success" showIcon closable role="status" content={notice} onClose={() => setNotice(null)} />}

      <ArcoCollapse className="advanced-settings" defaultActiveKey={[]}>
        <ArcoCollapse.Item name="rule-advanced-settings" header="高级设置：创建规则草稿（U/M/S/C 评分映射与校准证据）">
          <ArcoTypography.Paragraph type="secondary" className="detail-note">这些输入直接决定规则 JSON；未校准证据的规则发布后不会用于优先级计算。</ArcoTypography.Paragraph>
          <ArcoForm layout="vertical" className="rq-compact-form">
            <ArcoGrid.Row gutter={[12, 0]}>
              {(["p0", "p1", "p2"] as const).map((key) => (
                <ArcoGrid.Col key={key} xs={8} sm={6} md={4}>
                  <ArcoForm.Item label={`${key.toUpperCase()} 阈值`}>
                    <ArcoInputNumber
                      min={0}
                      max={4}
                      step={1}
                      precision={0}
                      value={thresholds[key]}
                      aria-label={`${key.toUpperCase()} 阈值`}
                      onChange={(value: number | undefined) => setThresholds((prev) => ({ ...prev, [key]: typeof value === "number" && Number.isFinite(value) ? value : undefined }))}
                    />
                  </ArcoForm.Item>
                </ArcoGrid.Col>
              ))}
            </ArcoGrid.Row>
            <ArcoForm.Item label="U/M/S/C 已批准评分映射（每行「维度:取值=分数」；未校准证据的规则不会用于计算）">
              <ArcoInput.TextArea aria-label="评分映射" rows={3} value={scoringInput} onChange={(value: string) => setScoringInput(value)} />
            </ArcoForm.Item>
            <ArcoForm.Item label="校准证据（每行一个 JSON 对象；为空的规则发布后不会用于优先级计算）">
              <ArcoInput.TextArea aria-label="校准证据" rows={2} placeholder='例如：{"cohort":"2026-Q3","cases":12}' value={evidenceInput} onChange={(value: string) => setEvidenceInput(value)} />
            </ArcoForm.Item>
            <div className="rq-action-bar">
              <ArcoTooltip content={activeV2 ? "v2/v3 公式生效期间不能发布 v1 规则" : ""} disabled={!activeV2}>
                <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void handleCreateRule()} disabled={busy || activeV2}>创建草稿</ArcoButton>
              </ArcoTooltip>
            </div>
          </ArcoForm>
        </ArcoCollapse.Item>
      </ArcoCollapse>

      <ArcoTable<PriorityRuleVersion>
        rowKey="id"
        data={rules}
        pagination={false}
        border={false}
        noDataElement={
          <ArcoEmpty
            className="rq-empty"
            description={
              <div className="rq-empty-copy">
                <strong>{loadError ? "配置不可用" : "还没有规则版本"}</strong>
                <span>{loadError ? "请检查 API 连接后重试。" : "在高级设置中创建阈值规则草稿并发布后，AI 建议才会生成 P0–P3 优先级。"}</span>
              </div>
            }
          />
        }
        columns={ruleColumns}
      />
    </ArcoCard>
  );
}

function pageDescription(page: Page): string {
  const descriptions: Record<Page, string> = { Overview: "同步流程的当前健康状态与执行概况。", Requirements: "按需求标题、TB负责人和处理状态检索需求；负责人分配在需求详情页完成。", GroupRequirements: "集团需求池：仅同步执行人名单内的集团需求，数据与产品池完全隔离。", Team: "维护组内人员、飞书账号绑定和 Teambition 负责人映射。", Modules: "维护 AI 分类使用的功能模块、责任人员及词典版本历史。", SyncRecords: "检查同步批次、失败项与可追踪的审计操作。", Sources: "两个需求池的数据源、周计划、收集表与飞书 Base 地址。", MyRequirements: "分配给你的需求；删除后进入回收站，可随时还原；含已排除。", RecycleBin: "你删除的需求保留在这里，可一键还原；不做物理删除。", Rules: "管理已校准的优先级规则；评分映射与校准证据在高级设置中维护。", Ops: "只读查看失败与卡住的作业，辅助定位同步、分析和推送中断。", Guide: "系统工作流、状态含义与日常操作说明。", Sop: "按角色整理的试点标准作业流程（SOP）与 30 分钟培训议程。" };
  return descriptions[page];
}

export default App;
