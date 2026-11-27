// 需求池、我的需求、回收站与需求详情页模块（按路由懒加载）。
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { AudienceEditor, BetaPanel, IntakeForm, ManualEditSection } from "../intake-form";
import { Alert as ArcoAlert, Badge as ArcoBadge, Button as ArcoButton, Card as ArcoCard, Checkbox as ArcoCheckbox, Collapse, Descriptions as ArcoDescriptions, Divider as ArcoDivider, Empty as ArcoEmpty, Form as ArcoForm, Grid as ArcoGrid, Input as ArcoInput, InputNumber as ArcoInputNumber, Message as ArcoMessage, Popover as ArcoPopover, Radio as ArcoRadio, Result as ArcoResult, Select as ArcoSelect, Space as ArcoSpace, Statistic as ArcoStatistic, Table as ArcoTable, Tabs as ArcoTabs, Tag as ArcoTag, Tooltip as ArcoTooltip, Typography as ArcoTypography } from "@arco-design/web-react";
import { ConfirmModal } from "../confirm-modal";
import { ArrowLeft, CircleHelp, Download, RefreshCw } from "lucide-react";
import { stateLabel } from "../state-labels";
import { RequirementDetailSkeleton, SkeletonBlock, SkeletonTableRows } from "../skeleton";
import { readRequirementDeepLink } from "../deep-link";
import { emptyRequirementListFilters, myRequirementsUrl, readMyRequirementsPool, readRequirementListFilters, recycleBinUrl, requirementFilterCount, requirementPoolUrl, type RequirementListFilters, type RequirementProcessingView } from "../requirements-url";
import { formatDateTime, requirementDisplayId, requirementOwnerView, requirementSourceFacts, requirementSourceName, requirementTime, sortRequirementsForAttention } from "../requirement-view";
import { ApiError, applyRequirementAiScore, clearOwner, createRequirementAssessment, deleteRequirement, exportRequirementsCsv, getMyRequirementCounts, getRequirement, getRequirementSourceCounts, isAbortError, listMyRequirements, listRecycleBinRequirements, listRequirementAssessments, listRequirements, listTeamPeople, pushRequirement, restoreRequirement, retryAnalysis, revokeDuplicateDecision, saveAnalysisContext, saveRequirementScore, setDuplicateDecision, setOwner, setPriorityOverride, type AnalysisVersionSummary, type AssessmentConfidence, type AssessmentVerdict, type DuplicateDecision, type MyRequirementCounts, type RequirementAssessment, type RequirementDetail, type RequirementPool, type RequirementProcessingState, type RequirementResolution, type RequirementScoreVersion, type RequirementSourceCounts, type RequirementSummary, type ScoringInputs, type TeamPerson } from "../api";
import { CACHE_KEYS, invalidateQueryCache } from "../cache";
import { PrdPromptSection } from "../prd-prompt";
import { safeHttpUrl } from "../safe-url";
import { AccessibleTabs, API_ERROR_TEXT, errorText, FeishuUserPicker, poolChip, PRIORITY_TAG_COLORS, scrollToSection, StateBanner, timeLabel, type LoadState } from "../panel-shared";
import { useUnsavedGuard } from "../unsaved-guard";

// ---------- 工单 17 / design.md 第 8–10 章：需求池列表 + 独立详情页 ----------

const ownerStateOptions = [["", "全部负责人状态"], ["pending_mapping", "待匹配"], ["auto_mapped", "已匹配"], ["manually_mapped", "手动匹配"], ["not_required", "无需匹配"]] as const;
// 优先级分诊（2026-11-06）：默认不筛选；sort=priority_asc 由服务端按生效优先级排序（P0→P3，单页最多 100 条）。
const priorityFilterOptions = [["", "全部优先级"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["P3", "P3"]] as const;
const prioritySortOptions = [["", "默认排序"], ["priority_asc", "按优先级（P0 → P3）"]] as const;
const analysisStateOptions = [["", "全部分析状态"], ["analyzed", "已分析"], ["failed_retryable", "待重试"], ["pending", "等待中"], ["running", "进行中"]] as const;
const pullStateOptions = [["", "全部同步状态"], ["pending", "等待同步"], ["running", "同步中"], ["synced", "已同步"], ["failed", "同步失败"], ["collected", "已收录"]] as const;
// 5c-1 来源区分：来源是需求池的一等维度，用顶部 Tab 而不是下拉——筛选藏进下拉约等于没有。
// Teambition 是默认来源（332/333 都是它），所以默认来源不挂徽标、不加色条。
const SOURCE_TABS = [
  { value: "", label: "全部来源" },
  { value: "teambition", label: "Teambition" },
  { value: "base_form", label: "多维表格" },
  { value: "web_manual", label: "手工" },
  { value: "chat_paste", label: "聊天粘贴" },
] as const;

/** 来源筛选值 → source-counts 响应里的键；未知值不显示计数。 */
function sourceCountKey(value: string): keyof RequirementSourceCounts | null {
  return value === "" ? "all" : value === "teambition" || value === "web_manual" || value === "base_form" || value === "chat_paste" ? value : null;
}
const pushStateOptions = [["", "全部推送状态"], ["pending", "等待推送"], ["running", "推送中"], ["pushed", "已推送"], ["failed", "推送失败"]] as const;

// 详情/列表徽标按阶段取值：同一个原始枚举（pending/running/failed）在不同阶段含义不同，
// 因此不能用一张全局表；原始值保留在 title 上，便于排查。
type PipelineStage = "pull" | "analysis" | "owner" | "push";

const pipelineLabels: Record<PipelineStage, Record<string, string>> = {
  pull: { synced: "已同步", pending: "待同步", running: "同步中", failed: "同步失败" },
  analysis: { analyzed: "已分析", running: "分析中", failed_retryable: "可重试", failed: "分析失败", pending: "待分析" },
  owner: { manually_mapped: "已手动匹配", auto_mapped: "已自动匹配", pending_mapping: "待匹配负责人", not_required: "无需负责人" },
  push: { pushed: "已推送", pending: "待推送", running: "推送中", failed: "推送失败" },
};

const pipelineStageNames: Record<PipelineStage, string> = { pull: "同步", analysis: "AI 分析", owner: "负责人", push: "推送" };

interface AnalysisRecommendation {
  recommendation?: unknown;
  rationale?: unknown;
  evidence?: unknown;
  missing_evidence?: unknown;
}

interface AnalysisStructured {
  module?: unknown; priority?: unknown; confidence?: unknown; confidence_reason?: unknown;
  evidence?: unknown; facts?: unknown; inferences?: unknown; missing_inputs?: unknown; blind_spots?: unknown;
  recommendations?: Partial<Record<"user" | "market" | "business" | "technology", AnalysisRecommendation>>;
  // V02-T08：可选新字段，旧分析缺失时为 undefined（展示“未提供”）。
  typeSuggestion?: unknown;
  audience?: unknown;
}

function analysisText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function analysisStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function pipelineLabel(stage: PipelineStage, state: string): string {
  return pipelineLabels[stage][state] ?? stateLabel(state);
}

// ---------- P1 重复处理：处理闸口状态与判定展示 ----------

/** 旧响应没有 processingState 时按 active 处理，避免把普通需求误显示成压制态。 */
export function requirementProcessingState(requirement: Pick<RequirementSummary, "processingState">): RequirementProcessingState {
  return requirement.processingState ?? "active";
}

export const processingStateLabels: Record<RequirementProcessingState, string> = {
  active: "活跃",
  suppressed_duplicate: "已压制（重复）",
  suppressed_ignored: "已压制（忽略）",
};

/** 列表行角标：疑似重复提示 / 压制结果；普通活跃需求不加角标。 */
export function processingBadge(requirement: Pick<RequirementSummary, "processingState" | "resolution">): { label: string; className: string; title: string } | null {
  const state = requirementProcessingState(requirement);
  const resolution: RequirementResolution | null = requirement.resolution ?? null;
  const canonical = resolution?.canonicalPlatformRequirementId ?? resolution?.canonicalRequirementId ?? null;
  if (state === "suppressed_duplicate") {
    return { label: "已压制（重复）", className: "status-danger", title: `已压制：不再进入 AI 分析/Base 推送/通知${canonical ? `；主记录 ${canonical}` : ""}${resolution?.reason ? `；理由：${resolution.reason}` : ""}` };
  }
  if (state === "suppressed_ignored") {
    return { label: "已压制（忽略）", className: "status-muted", title: `已压制：不再进入 AI 分析/Base 推送/通知${resolution?.reason ? `；理由：${resolution.reason}` : ""}` };
  }
  if (resolution?.reviewState === "suspected") {
    return { label: "疑似重复", className: "status-warning", title: `系统提示标题相同，仅作疑似重复提示；${canonical ? `疑似主记录 ${canonical}；` : ""}尚未人工确认` };
  }
  if (resolution?.reviewState === "confirmed") {
    return { label: "已确认非重复", className: "status-muted", title: `已人工确认为非重复${resolution.reason ? `；理由：${resolution.reason}` : ""}` };
  }
  return null;
}

/** 需求池顶部视图切换值；`all` 只在 UI/URL 层使用，请求时省略参数。 */
const PROCESSING_VIEWS: Array<{ value: RequirementProcessingView; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "仅活跃" },
  { value: "suppressed", label: "已压制重复" },
];

function pipelineTagColor(state: string): string {
  if (state === "failed") return "red";
  if (state === "failed_retryable" || state === "pending_mapping") return "orange";
  if (state === "running") return "arcoblue";
  if (["synced", "analyzed", "pushed", "manually_mapped", "auto_mapped", "not_required"].includes(state)) return "green";
  return "gray";
}

// 中文文案 + 语义色；原始枚举留在 title / Tooltip 上，符合 design.md。
function StageBadge({ stage, state }: { stage: PipelineStage; state: string }) {
  const tip = `${pipelineStageNames[stage]}：${pipelineLabel(stage, state)}（${state}）`;
  return (
    <ArcoTooltip content={tip}>
      <ArcoTag className="req-badge" color={pipelineTagColor(state)} size="small" title={tip}>
        {pipelineLabel(stage, state)}
      </ArcoTag>
    </ArcoTooltip>
  );
}

type RequirementFieldSource = "teambition" | "web_manual" | "base_form" | "chat_paste";

/**
 * 字段来源标签：只有 Teambition 挂「TB」徽标。
 * 非 TB 来源不再挂来源徽标——区块右上角与底部「这条需求怎么来的」已经说明来源，
 * 再显示「多维表格 标题」既重复又占宽。
 */
function TbFieldLabel({ children, kind = "teambition" }: { children: ReactNode; kind?: RequirementFieldSource }) {
  return <span className="req-field-label">{kind === "teambition" ? <ArcoTag size="small" color="arcoblue" className="tb-badge" title="来自 Teambition 的原始字段">TB</ArcoTag> : null}{children}</span>;
}

function OwnerBadge({ owner }: { owner: ReturnType<typeof requirementOwnerView> }) {
  return <span className={`req-owner${owner.unassigned ? " is-unassigned" : ""}${owner.notRequired ? " is-not-required" : ""}`} title={owner.title}>
    <span className="req-avatar" aria-hidden="true">{owner.initial}</span>
    <span>{owner.label}</span>
  </span>;
}

function SourceValue({ value, href, emptyHint = "Teambition 未提供该字段" }: { value: string | null; href?: boolean; emptyHint?: string }) {
  if (!value) return <span className="req-empty-value" title={emptyHint}>—</span>;
  if (href) {
    const safeUrl = safeHttpUrl(value);
    if (safeUrl) return <a className="req-source-link" href={safeUrl} target="_blank" rel="noreferrer">{safeUrl}</a>;
  }
  return <span>{value}</span>;
}

function TextList({ items, prefix }: { items: string[]; prefix?: string }) {
  if (!items.length) return <span className="req-empty-value">—</span>;
  return <ul className="req-evidence-list">{items.map((item, index) => <li key={`${index}-${item}`}>{prefix ?? ""}{item}</li>)}</ul>;
}

function requirementListQuery(filter: RequirementListFilters, pool: RequirementPool = "product") {
  const toIso = (value: string): string | undefined => {
    if (!value) return undefined;
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
  };
  return {
    // 产品池是服务端默认：不序列化 pool，保持既有请求 URL 不变。
    pool: pool === "group" ? ("group" as const) : undefined,
    q: filter.title || undefined,
    executorName: filter.owner || undefined,
    pullState: filter.pull || undefined,
    analysisState: filter.analysis || undefined,
    ownerState: filter.ownerState || undefined,
    pushState: filter.push || undefined,
    processingState: filter.processingState === "all" ? undefined : filter.processingState,
    priority: (filter.priority || undefined) as "P0" | "P1" | "P2" | "P3" | undefined,
    // 集团池没有来源 Tab，也不接受来源筛选（数据只有 TB 一个来源）。
    source: pool === "group" ? undefined : (filter.source || undefined) as "teambition" | "web_manual" | "base_form" | "chat_paste" | undefined,
    sort: filter.sort === "priority_asc" ? ("priority_asc" as const) : undefined,
    batchId: filter.batchId || undefined,
    since: toIso(filter.from),
    until: toIso(filter.to),
  };
}

export function RequirementsPanel({ onRefresh, initialRequirementId, scope = "product", onGroupCountChange, mine = false, onRequirementChanged }: { onRefresh: () => void; initialRequirementId?: string | null; scope?: RequirementPool; onGroupCountChange?: (count: number | null) => void; /** PRD §4.13：我的需求模式：服务端按当前身份过滤，隐藏来源 Tab/高级筛选/新建入口。 */ mine?: boolean; /** 删除/还原后通知外层刷新计数。 */ onRequirementChanged?: () => void }) {
  const isGroup = scope === "group";
  // 集团池没有来源维度：即使 URL 带了 source（从产品池复制/手改地址），也不把它带进请求。
  // 我的需求页按 PRD 省略 processingState（返回 active + suppressed），不沿用需求池默认的「仅活跃」。
  const [initialFilters] = useState(() => {
    const parsed = readRequirementListFilters(window.location.search);
    if (mine) return { ...emptyRequirementListFilters, processingState: "all" as RequirementProcessingView };
    return scope === "group" ? { ...parsed, source: "" } : parsed;
  });
  // 页头条数回填用 ref：父组件传内联回调时不应触发计数请求重跑。
  const onGroupCountChangeRef = useRef(onGroupCountChange);
  useEffect(() => { onGroupCountChangeRef.current = onGroupCountChange; }, [onGroupCountChange]);
  const [initialDetailId] = useState(() => readRequirementDeepLink(window.location.search) ?? initialRequirementId?.trim() ?? null);
  const [rows, setRows] = useState<RequirementSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState(initialFilters.title);
  const [executorName, setExecutorName] = useState(initialFilters.owner);
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [ownerState, setOwnerState] = useState(initialFilters.ownerState);
  const [analysisState, setAnalysisState] = useState(initialFilters.analysis);
  const [pullState, setPullState] = useState(initialFilters.pull);
  const [pushState, setPushState] = useState(initialFilters.push);
  // 重复处理视图：all=全部 / active=仅活跃（默认）/ suppressed=已压制（重复或忽略）。
  const [processingState, setProcessingState] = useState(initialFilters.processingState);
  const [priorityFilter, setPriorityFilter] = useState(initialFilters.priority);
  const [sourceFilter, setSourceFilter] = useState(initialFilters.source);
  // 5c-1：来源 Tab 计数。接口不可用时保持 null → 只显示 Tab 文字，不显示假数字。
  const [sourceCounts, setSourceCounts] = useState<RequirementSourceCounts | null>(null);
  const [prioritySort, setPrioritySort] = useState(initialFilters.sort);
  const [batchId, setBatchId] = useState(initialFilters.batchId);
  const [since, setSince] = useState(initialFilters.from);
  const [until, setUntil] = useState(initialFilters.to);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [selected, setSelected] = useState<RequirementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialDetailId));
  const detailRequestVersion = useRef(0);
  // 列表请求序号：筛选快速切换时丢弃过期响应，避免旧结果覆盖新筛选。
  const listRequestVersion = useRef(0);
  const listControllerRef = useRef<AbortController | null>(null);
  const sourceCountsControllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);
  // 列表滚动位置：进入详情时记下，返回列表后恢复（design.md 8.1）。
  const listScrollTop = useRef(0);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [autoOpenOwnerPicker, setAutoOpenOwnerPicker] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // PRD §4.13：单条删除的确认弹窗（回收站与列表共用同一实现）。
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  // ARCO-05：更多筛选的展开状态（交由 Arco Popover 管理，补充 document click / Escape 关闭以兼容键盘与单测）。
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  useEffect(() => {
    if (!moreFiltersOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMoreFiltersOpen(false);
    };
    const onClick = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#requirement-more-filters") || target.closest(".qmore-popover-trigger") || target.closest(".arco-select-popup")) return;
      setMoreFiltersOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, [moreFiltersOpen]);
  const filters: RequirementListFilters = { title: query.trim(), owner: executorName, pull: pullState, analysis: analysisState, ownerState, push: pushState, processingState, priority: priorityFilter, source: sourceFilter, sort: prioritySort, batchId: batchId.trim(), from: since, to: until };
  // 已生效筛选：列表行/详情 URL 与刷新必须以「点过筛选」的条件为准，
  // 不能把用户尚未应用的草稿输入写进 URL。
  const appliedFiltersRef = useRef(initialFilters);
  const activeFilterCount = requirementFilterCount(filters);
  // 已生效 = 上一次真正发给服务端的条件；草稿输入不算，否则还没点筛选就显示"已生效"。
  const [appliedFilterCount, setAppliedFilterCount] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const dateFilterCount = [since, until].filter(Boolean).length;
  // 「更多筛选」角标只统计浮层里的条件：来源已经移到顶部 Tab，不再计入。
  const moreFilterCount = [priorityFilter, prioritySort, ownerState, analysisState, pushState, batchId.trim(), since, until].filter(Boolean).length;

  const load = useCallback(async (filter: RequirementListFilters, nextCursor: string | null) => {
    appliedFiltersRef.current = filter;
    const version = ++listRequestVersion.current;
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    setLoadState("loading"); setLoadError(null);
    try {
      // 分诊视图（priority_asc）按优先级排序且不分页：单页最多 100 条，避免游标与排序不一致。
      const priorityMode = !mine && filter.sort === "priority_asc";
      const page = mine
        ? await listMyRequirements({ pool: scope, limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}), signal: controller.signal })
        : await listRequirements({ ...requirementListQuery(filter, scope), limit: priorityMode ? 100 : 25, ...(!priorityMode && nextCursor ? { cursor: nextCursor } : {}), signal: controller.signal });
      if (version !== listRequestVersion.current) return;
      setRows((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) {
      if (version !== listRequestVersion.current || isAbortError(cause)) return;
      // 首屏/筛选请求失败时不能继续展示上一批结果：否则用户会把旧行当成新筛选的结果。
      if (!nextCursor) { setRows([]); setCursor(null); }
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, [scope, mine]);

  // 来源计数只影响 Tab 上的数字：接口失败/未部署时静默降级，不打断列表。
  // 集团池只取 all 作为页头条数，不渲染五个来源 Tab。
  const loadSourceCounts = useCallback(() => {
    sourceCountsControllerRef.current?.abort();
    const controller = new AbortController();
    sourceCountsControllerRef.current = controller;
    void getRequirementSourceCounts({ pool: scope === "group" ? "group" : undefined, signal: controller.signal }).then((counts) => {
      if (controller.signal.aborted) return;
      setSourceCounts(counts);
      if (isGroup) onGroupCountChangeRef.current?.(counts?.all ?? null);
    });
  }, [scope, isGroup]);

  useEffect(() => {
    void load(initialFilters, null);
    let cancelled = false;
    if (!mine) {
      loadSourceCounts();
      void listTeamPeople()
        .then((list) => { if (!cancelled) setPeople(list); })
        .catch((cause: unknown) => { if (!cancelled && !isAbortError(cause)) setPeopleError(errorText(cause)); });
    }
    return () => {
      cancelled = true;
      listControllerRef.current?.abort();
      sourceCountsControllerRef.current?.abort();
      detailControllerRef.current?.abort();
    };
  }, [load, initialFilters, loadSourceCounts, mine]);

  const open = useCallback(async (id: string, options?: { push?: boolean; openOwnerPicker?: boolean; silent?: boolean }) => {
    if (options?.push) {
      listScrollTop.current = window.scrollY || document.documentElement.scrollTop || 0;
      window.history.pushState(null, "", mine ? myRequirementsUrl(window.location.pathname || "/", scope, id, "#my-requirements") : requirementPoolUrl(window.location.pathname || "/", appliedFiltersRef.current, id, window.location.hash));
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    // 静默刷新（操作成功后）：保留当前详情内容，避免整块详情闪成骨架屏；只有首次打开才展示骨架。
    const silent = Boolean(options?.silent);
    setDetailId(id); if (!silent) { setSelected(null); setDetailLoading(true); } setDetailError(null); setNotice(null);
    setAutoOpenOwnerPicker(Boolean(options?.openOwnerPicker));
    const version = ++detailRequestVersion.current;
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;
    try {
      const detail = await getRequirement(id, undefined, controller.signal);
      // 跨池守卫：详情接口按 UUID 返回所属池；与当前页面 scope 不符时按 404 展示，
      // 不渲染详情、不跳转、不探测其他池（服务端对显式带 pool 的跨池请求同样返回 404）。
      if (detail.pool && detail.pool !== scope) throw new ApiError(API_ERROR_TEXT.NOT_FOUND ?? "请求的资源不存在或已被删除。", 404, "NOT_FOUND");
      if (version === detailRequestVersion.current) {
        setSelected(detail);
        // 用最新详情同步当前列表行，操作后返回列表无需重新加载、也不会丢分页。
        setRows((prev) => prev.map((row) => row.id === detail.id ? {
          ...row,
          title: detail.title,
          pipeline: detail.pipeline,
          ...(detail.source === undefined ? {} : { source: detail.source }),
          ...(detail.ownerName === undefined ? {} : { ownerName: detail.ownerName }),
          ...(detail.updatedAt === undefined ? {} : { updatedAt: detail.updatedAt }),
          ...(detail.processingState === undefined ? {} : { processingState: detail.processingState }),
          ...(detail.resolution === undefined ? {} : { resolution: detail.resolution }),
        } : row));
        setDetailLoading(false);
      }
    } catch (cause) {
      if (version === detailRequestVersion.current && !isAbortError(cause)) { setDetailError(errorText(cause)); setDetailLoading(false); }
    }
  }, [scope, mine]);

  // 同一页面实例切池（产品池 ↔ 集团池）时 React 会复用本组件：作废在途请求与上一池的列表行，
  // 详情对象保留、由渲染层按 detail.pool 判池（不符只显示 404），切回原池即可恢复，无需重新请求。
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    detailRequestVersion.current += 1;
    setRows([]); setCursor(null); setLoadState("loading");
    setAutoOpenOwnerPicker(false);
    // 深链分享链接跨池时会复用同一个面板实例：按新池重新打开该需求，而不是停在 404。
    if (initialDetailId) {
      setDetailError(null);
      void open(initialDetailId);
    } else if (!selected && detailId) {
      // 详情还在加载、没有池信息可判：保守显示 404，避免把在途请求的结果渲染到错误的池。
      setDetailLoading(false);
      setDetailError(API_ERROR_TEXT.NOT_FOUND ?? "请求的资源不存在或已被删除。");
    }
    setSourceCounts(null);
  }, [scope, detailId, selected, initialDetailId, open]);

  // 通知深链/分享链接：URL 的 requirement 是唯一入口；只在首次挂载时自动打开。
  const deepLinkOpened = useRef(false);
  useEffect(() => {
    if (!initialDetailId || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    void open(initialDetailId);
  }, [initialDetailId, open]);

  // 返回列表时恢复进入详情前的滚动位置；详情页本身从顶部开始阅读。
  useEffect(() => {
    if (detailId !== null || listScrollTop.current === 0) return;
    const top = listScrollTop.current;
    listScrollTop.current = 0;
    document.documentElement.scrollTop = top;
    document.body.scrollTop = top;
  }, [detailId]);

  // 浏览器前进/后退：详情页跟着 URL 走，列表状态留在组件 state 里。
  useEffect(() => {
    const onPopState = () => {
      const next = readRequirementDeepLink(window.location.search);
      if (next) { void open(next); return; }
      detailRequestVersion.current += 1;
      setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false); setAutoOpenOwnerPicker(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open]);

  const runAction = async (action: () => Promise<string>, detailKey: string): Promise<boolean> => {
    setBusy(true); setNotice(null);
    try {
      const message = await action();
      // 先局部刷新详情（保留内容），再让总览数据在后台静默更新；不整页重载。
      await open(detailKey, { silent: true });
      onRefresh();
      setNotice(message);
      return true;
    } catch (cause) { setNotice(errorText(cause)); return false; }
    finally { setBusy(false); }
  };

  // PRD §4.13：删除/还原。删除成功后从当前列表移除并通知外层刷新计数；详情打开时回到列表。
  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    const targetId = deleteTargetId;
    setDeleteBusy(true); setActionError(null);
    try {
      await deleteRequirement(targetId);
      setRows((prev) => prev.filter((row) => row.id !== targetId));
      setDeleteTargetId(null);
      setNotice("已移入回收站");
      if (detailId === targetId) closeDetail();
      onRequirementChanged?.();
      onRefresh();
    } catch (cause) {
      setDeleteTargetId(null);
      setActionError(errorText(cause));
    } finally { setDeleteBusy(false); }
  };

  const restoreDeleted = async (id: string) => {
    setRestoreBusy(true); setActionError(null);
    try {
      await restoreRequirement(id);
      setNotice("已还原");
      onRequirementChanged?.();
      onRefresh();
      await open(id, { silent: true });
    } catch (cause) {
      // 并发：别人已先还原/需求已不在回收站。刷新到最新状态，而不是弹成失败。
      if (cause instanceof ApiError && cause.status === 409) {
        setNotice("这条需求已不在回收站，已刷新最新状态。");
        onRequirementChanged?.();
        onRefresh();
        await open(id, { silent: true }).catch(() => undefined);
      } else {
        setActionError(errorText(cause));
      }
    } finally { setRestoreBusy(false); }
  };

  // 返回列表：用 replaceState 立刻把 URL 恢复为「筛选 + 无 requirement」，
  // 刷新/分享列表地址都不会再落回详情；已加载的 rows/cursor 仍在 state 中。
  const closeDetail = () => {
    detailRequestVersion.current += 1;
    setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false); setAutoOpenOwnerPicker(false);
    window.history.replaceState(null, "", mine ? myRequirementsUrl(window.location.pathname || "/", scope, null, "#my-requirements") : requirementPoolUrl(window.location.pathname || "/", appliedFiltersRef.current, null, window.location.hash));
  };

  const applyFilters = () => {
    setAppliedFilterCount(activeFilterCount);
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", filters, null, window.location.hash));
    void load(filters, null);
  };

  // 重复处理视图切换：立即生效、重置游标并重新拉取，不要求用户再点「筛选」。
  const applyProcessingView = (view: RequirementProcessingView) => {
    setProcessingState(view);
    const next: RequirementListFilters = { ...filters, processingState: view };
    setAppliedFilterCount(requirementFilterCount(next));
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", next, null, window.location.hash));
    void load(next, null);
  };

  // 来源 Tab 切换：立即生效、重置游标；URL / 导出 / 分页继续共用同一个 source 参数。
  // 只改来源，不顺手把用户还没点「筛选」的草稿输入发出去。
  const applySourceFilter = (value: string) => {
    const next: RequirementListFilters = { ...appliedFiltersRef.current, source: value };
    setSourceFilter(value);
    setAppliedFilterCount(requirementFilterCount(next));
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", next, null, window.location.hash));
    void load(next, null);
  };

  // 清除筛选后立即回到无筛选的第一页，避免残留旧条件与旧游标。
  const clearFilters = () => {
    setAppliedFilterCount(0);
    const cleared = { ...emptyRequirementListFilters };
    setQuery(""); setExecutorName(""); setPullState(""); setOwnerState(""); setAnalysisState(""); setPushState(""); setProcessingState(cleared.processingState); setPriorityFilter(""); setSourceFilter(""); setPrioritySort(""); setBatchId(""); setSince(""); setUntil("");
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", cleared, null, window.location.hash));
    void load(cleared, null);
  };

  const refresh = () => {
    // 手动刷新：列表与详情各自静默更新（不整页重载）；总览数据由 onRefresh 在后台静默刷新。
    void load(appliedFiltersRef.current, null);
    if (!mine) loadSourceCounts();
    if (detailId) void open(detailId, { silent: true });
    onRefresh();
  };

  // I3-2：导出使用「已生效」筛选，而不是尚未点筛选的草稿输入。
  const exportCsv = async () => {
    setExportBusy(true); setExportNotice(null);
    try {
      const { csv, truncated } = await exportRequirementsCsv(requirementListQuery(appliedFiltersRef.current, scope));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rq-sys-requirements-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportNotice(truncated ? "导出已截断为前 5000 条，请缩小筛选范围。" : "已导出当前筛选结果。");
    } catch (cause) { setExportNotice(errorText(cause)); }
    finally { setExportBusy(false); }
  };

  // 服务端已按优先级排序时不重排；我的需求按服务端默认创建时间倒序，不做注意力重排。
  const sortedRows = useMemo(
    () => (mine || prioritySort === "priority_asc" ? rows : sortRequirementsForAttention(rows)),
    [mine, prioritySort, rows],
  );
  const handleOpenRow = useCallback((row: RequirementSummary) => { void open(row.id, { push: true }); }, [open]);
  const handleAssignRow = useCallback((row: RequirementSummary) => { void open(row.id, { push: true, openOwnerPicker: true }); }, [open]);
  const handleDeleteRow = useCallback((row: RequirementSummary) => { setDeleteTargetId(row.id); }, []);

  if (detailId) {
    // 跨池守卫的渲染层兜底：同一实例切池时 selected 仍指向上一个池的详情，但绝不渲染它。
    const detailPoolMismatch = Boolean(selected?.pool && selected.pool !== scope);
    return <section className="panel requirements-panel">
      <RequirementDetailPage
        detail={detailPoolMismatch ? null : selected}
        detailId={detailId}
        loading={detailPoolMismatch ? false : detailLoading}
        error={detailPoolMismatch ? (API_ERROR_TEXT.NOT_FOUND ?? "请求的资源不存在或已被删除。") : detailError}
        notice={notice}
        busy={busy}
        autoOpenOwnerPicker={autoOpenOwnerPicker}
        onCloseNotice={() => setNotice(null)}
        onBack={closeDetail}
        onRefresh={refresh}
        onAct={runAction}
        onSaved={(id) => void open(id, { silent: true })}
        onDelete={selected ? () => setDeleteTargetId(selected.id) : undefined}
        canDelete={Boolean(selected?.canDelete ?? (mine && selected?.lifecycleState !== "deleted"))}
        onRestore={restoreDeleted}
        canRestore={selected?.canRestore === true}
        restoreBusy={restoreBusy}
      />
      <ConfirmModal
        visible={deleteTargetId !== null}
        title="移入回收站？"
        description="这条需求会从需求池隐藏，但不会被物理删除；可在回收站还原。飞书 Base 中的历史行会保留，不会删除或改动。"
        okText="移入回收站"
        onOk={() => void confirmDelete()}
        onCancel={() => { if (!deleteBusy) setDeleteTargetId(null); }}
      />
    </section>;
  }

  return <ArcoCard bordered={false} className="rq-card requirements-panel">
    {/* 5c-1：来源是一等维度。采用 Arco Tabs 置于列表上方，带计数、可深链；计数拿不到时只显示文字。
        集团池只有一个 TB 来源，不渲染来源 Tab，也不请求五来源计数。 */}
    {!mine && !isGroup && (
      <div className="req-source-tabs">
        <AccessibleTabs
          label="需求来源"
          activeTab={sourceFilter || "__all__"}
          onChange={(key) => applySourceFilter(key === "__all__" ? "" : key)}
        >
          {SOURCE_TABS.map((tab) => {
            const countKey = sourceCountKey(tab.value);
            // 处理视图切到「全部/已压制重复」时隐藏计数：计数是活跃数，列表行数会更多，避免误读。
            const count = sourceCounts && processingState === "active" && countKey ? sourceCounts[countKey] : null;
            return (
              <ArcoTabs.TabPane
                key={tab.value || "__all__"}
                title={
                  <ArcoSpace size={4} align="center">
                    <span>{tab.label}</span>
                    {count !== null ? <ArcoTag size="small" className="source-tab-count">{count}</ArcoTag> : null}
                  </ArcoSpace>
                }
              />
            );
          })}
        </AccessibleTabs>
      </div>
    )}
    {!mine && (
      <>
        <div className="req-filter-bar">
          <div className="qtoolbar-main">
            <div className="qfield qfield-search">
              <ArcoInput aria-label="搜索需求标题" placeholder="搜索需求标题或批次 ID…" value={query} onChange={(value: string) => setQuery(value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyFilters(); } }} />
            </div>
            <div className="qfield">
              <ArcoSelect aria-label="TB负责人筛选" value={executorName} onChange={(value: string) => setExecutorName(value)} style={{ minWidth: 150 }} options={[{ label: "全部 TB 负责人", value: "" }, ...people.filter((person) => person.name).map((person) => ({ label: person.name!, value: person.name! }))]} />
            </div>
            <div className="qfield">
              <ArcoSelect aria-label="同步状态筛选" value={pullState} onChange={(value: string) => setPullState(value)} style={{ minWidth: 130 }} options={pullStateOptions.map(([value, label]) => ({ label, value }))} />
            </div>
            {/* ARCO-05：更多筛选改为 Arco Popover，交由组件统一处理外部点击与 Escape 关闭。 */}
            <ArcoPopover
              className="qmore-popover"
              style={{ maxWidth: 520 }}
              trigger="click"
              position="bl"
              unmountOnExit
              popupVisible={moreFiltersOpen}
              onVisibleChange={setMoreFiltersOpen}
              content={moreFiltersOpen ? (
                <div className="qmore-popover-body" id="requirement-more-filters">
                  <div className="qmore-field">
                    <span className="qmore-field-label">优先级</span>
                    <ArcoSelect aria-label="优先级筛选" value={priorityFilter} onChange={(value: string) => setPriorityFilter(value)} options={priorityFilterOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">排序方式</span>
                    <ArcoSelect aria-label="排序方式" value={prioritySort} onChange={(value: string) => setPrioritySort(value)} options={prioritySortOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">负责人状态</span>
                    <ArcoSelect aria-label="负责人筛选" value={ownerState} onChange={(value: string) => setOwnerState(value)} options={ownerStateOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">分析状态</span>
                    <ArcoSelect aria-label="分析状态筛选" value={analysisState} onChange={(value: string) => setAnalysisState(value)} options={analysisStateOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">推送状态</span>
                    <ArcoSelect aria-label="推送状态筛选" value={pushState} onChange={(value: string) => setPushState(value)} options={pushStateOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">批次 ID</span>
                    <ArcoInput aria-label="批次 ID 筛选" placeholder="输入批次 ID" value={batchId} onChange={(value: string) => setBatchId(value)} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">开始时间</span>
                    {/* ARCO-04 豁免：datetime-local 依赖浏览器本地时区语义，保留原生控件。 */}
                    <input className="rq-datetime-input" type="datetime-local" aria-label="最近同步开始时间" value={since} onChange={(e) => setSince(e.target.value)} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">结束时间</span>
                    <input className="rq-datetime-input" type="datetime-local" aria-label="最近同步结束时间" value={until} onChange={(e) => setUntil(e.target.value)} />
                  </div>
                </div>
              ) : null}
            >
              <ArcoButton type="secondary" htmlType="button" size="small" className="qmore-popover-trigger" aria-expanded={moreFiltersOpen} aria-controls="requirement-more-filters">更多筛选{moreFilterCount > 0 ? `（${moreFilterCount}）` : ""}</ArcoButton>
            </ArcoPopover>
          </div>
          <div className="req-filter-actions">
            {appliedFilterCount > 0 && <ArcoTag color="arcoblue" role="status">{appliedFilterCount} 个筛选已生效</ArcoTag>}
            <ArcoButton type="primary" htmlType="button" size="small" onClick={applyFilters}>筛选</ArcoButton>
            {activeFilterCount > 0 && <ArcoButton type="secondary" size="small" onClick={clearFilters} htmlType="button">清除筛选</ArcoButton>}
          </div>
        </div>
        <ArcoDivider className="req-search-divider" />
        <div className="req-action-row">
          <div className="req-action-row-left">
            {!isGroup && <IntakeForm onCreated={(id) => { refresh(); void open(id, { push: true }); }} />}
            {isGroup && (
              <div className="processing-view-switch">
                <span className="processing-view-switch-label">重复处理</span>
                <ArcoTooltip content="已压制需求保留记录，但不会进入 AI 分析、Base 推送与通知。">
                  <span className="inline-help-icon" role="img" aria-label="重复处理说明"><CircleHelp size={14} /></span>
                </ArcoTooltip>
                <ArcoRadio.Group
                  type="button"
                  size="small"
                  aria-label="重复处理视图"
                  value={processingState}
                  onChange={(value: RequirementProcessingView) => applyProcessingView(value)}
                  options={PROCESSING_VIEWS.map((view) => ({ label: view.label, value: view.value }))}
                />
              </div>
            )}
          </div>
          <div className="req-action-row-right">
            {!isGroup && (
              <div className="processing-view-switch">
                <span className="processing-view-switch-label">重复处理</span>
                <ArcoTooltip content="已压制需求保留记录，但不会进入 AI 分析、Base 推送与通知。">
                  <span className="inline-help-icon" role="img" aria-label="重复处理说明"><CircleHelp size={14} /></span>
                </ArcoTooltip>
                <ArcoRadio.Group
                  type="button"
                  size="small"
                  aria-label="重复处理视图"
                  value={processingState}
                  onChange={(value: RequirementProcessingView) => applyProcessingView(value)}
                  options={PROCESSING_VIEWS.map((view) => ({ label: view.label, value: view.value }))}
                />
              </div>
            )}
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void exportCsv()} disabled={exportBusy}><Download size={14} />{exportBusy ? "导出中…" : "导出 CSV"}</ArcoButton>
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={refresh}><RefreshCw size={14} />刷新</ArcoButton>
          </div>
        </div>
        <div className="list-summary" role="status" style={{ marginBottom: 12 }}>
          {exportNotice && <ArcoTypography.Text type="secondary" role="status">{exportNotice}</ArcoTypography.Text>}
          <span className="list-summary-count">已加载 {sortedRows.length} 条{cursor ? "，还有更多" : ""}{activeFilterCount > 0 ? `（已应用 ${activeFilterCount} 个筛选）` : ""}</span>
          <span className="list-summary-sort">{prioritySort === "priority_asc" ? "分诊视图：P0 → P3（最多 100 条）" : "待分配 → 推送失败 → 待推送 → 已推送"}</span>
          <ArcoTooltip content="三个状态互不影响：同步状态（是否已拉取最新原文）、AI 分析状态（是否已生成模块与优先级建议）、推送状态（是否已写入飞书多维表格）；分析失败不会阻止推送。">
            <span className="inline-help-icon" role="img" aria-label="处理状态说明"><CircleHelp size={14} /></span>
          </ArcoTooltip>
        </div>
      </>
    )}
    <StateBanner loadError={loadError ?? peopleError ?? actionError} notice={notice} onCloseNotice={() => setNotice(null)} onRetry={loadError ? () => void load(appliedFiltersRef.current, null) : undefined} />
    {mine && (
      <div className="list-summary" role="status" style={{ marginBottom: 12 }}>
        <span className="list-summary-count">已加载 {sortedRows.length} 条{cursor ? "，还有更多" : ""}</span>
        <ArcoButton type="secondary" htmlType="button" size="small" onClick={refresh}><RefreshCw size={14} />刷新</ArcoButton>
      </div>
    )}
    <div id="requirement-tab-panel" role="tabpanel" aria-label="需求列表">
      <RequirementsTable
        rows={sortedRows}
        loading={loadState === "loading"}
        showSource={!isGroup}
        showPool={mine}
        emptyState={mine ? { title: "暂无分配给你的需求", description: "负责人匹配或人工指派后会出现在这里。" } : undefined}
        onOpen={handleOpenRow}
        onAssign={handleAssignRow}
        onDelete={mine ? handleDeleteRow : undefined}
      />
      {cursor && (mine || prioritySort !== "priority_asc") && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={() => void load(appliedFiltersRef.current, cursor)} disabled={loadState === "loading"} type="secondary" size="small">加载更多</ArcoButton></div>}
    </div>
    <ConfirmModal
      visible={deleteTargetId !== null}
      title="移入回收站？"
      description="这条需求会从需求池隐藏，但不会被物理删除；可在回收站还原。飞书 Base 中的历史行会保留，不会删除或改动。"
      okText="移入回收站"
      onOk={() => void confirmDelete()}
      onCancel={() => { if (!deleteBusy) setDeleteTargetId(null); }}
    />
  </ArcoCard>;
}

/** PRD §4.13.4：「我的需求」页：产品池/集团池两个 Tab，Tab 切换写 ?pool= 并重置分页。 */
export function MyRequirementsPanel({ onRefresh }: { onRefresh: () => void }) {
  const [pool, setPool] = useState<RequirementPool>(() => readMyRequirementsPool(window.location.search));
  const [counts, setCounts] = useState<MyRequirementCounts | null>(null);
  const [countsState, setCountsState] = useState<LoadState>("loading");
  const countsControllerRef = useRef<AbortController | null>(null);

  const loadCounts = useCallback((force = false) => {
    if (force) invalidateQueryCache(CACHE_KEYS.myRequirementCounts);
    countsControllerRef.current?.abort();
    const controller = new AbortController();
    countsControllerRef.current = controller;
    setCountsState("loading");
    void getMyRequirementCounts(undefined, force ? controller.signal : undefined)
      .then((value) => { if (!controller.signal.aborted) { setCounts(value); setCountsState("ready"); } })
      .catch((cause) => { if (!controller.signal.aborted && !isAbortError(cause)) { setCounts(null); setCountsState("error"); } });
  }, []);
  useEffect(() => {
    loadCounts();
    return () => { countsControllerRef.current?.abort(); };
  }, [loadCounts]);
  // 浏览器前进/后退恢复同一 Tab；Tab 切换只 replaceState，避免历史里堆一屏池切换。
  useEffect(() => {
    const onPopState = () => setPool(readMyRequirementsPool(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const switchPool = (next: RequirementPool) => {
    if (next === pool) return;
    setPool(next);
    window.history.replaceState(null, "", myRequirementsUrl(window.location.pathname || "/", next, null, "#my-requirements"));
  };

  const tabs: Array<{ value: RequirementPool; label: string; count: number | null }> = [
    { value: "product", label: "产品需求池", count: countsState === "ready" && counts ? counts.product : null },
    { value: "group", label: "集团需求池", count: countsState === "ready" && counts ? counts.group : null },
  ];

  const tabExtra = countsState === "error"
    ? <span className="subtle-text">数量暂不可用</span>
    : countsState === "ready" && counts
      ? <span className="subtle-text">含已压制 · 共 {counts.total} 条</span>
      : undefined;

  return <div className="composite-page my-requirements-page">
    <AccessibleTabs label="我的需求池" activeTab={pool} onChange={(key) => switchPool(key as RequirementPool)} extra={tabExtra}>
      {tabs.map((tab) => (
        <ArcoTabs.TabPane
          key={tab.value}
          title={
            <ArcoSpace size={4} align="center">
              <span>{tab.label}</span>
              {tab.count !== null ? <ArcoTag size="small">{tab.count}</ArcoTag> : null}
            </ArcoSpace>
          }
        />
      ))}
    </AccessibleTabs>
    {countsState === "ready" && counts && !counts.identityResolved ? (
      <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="status" content="当前账号还没有可识别的飞书身份；请在团队管理中绑定飞书账号后再查看。" />
    ) : null}
    <RequirementsPanel key={pool} scope={pool} mine onRefresh={onRefresh} onRequirementChanged={() => loadCounts(true)} />
  </div>;
}

/** PRD §4.13.6：个人回收站；只显示本人删除项，还原不二次确认、不写 Base。 */
export function RecycleBinPanel({ onRefresh }: { onRefresh: () => void }) {
  const [initialDetailId] = useState<string | null>(() => readRequirementDeepLink(window.location.search));
  const [rows, setRows] = useState<RequirementSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [selected, setSelected] = useState<RequirementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialDetailId));
  const [detailError, setDetailError] = useState<string | null>(null);
  const listRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const listControllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (nextCursor: string | null) => {
    const version = ++listRequestVersion.current;
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    if (!nextCursor) setLoadState("loading");
    setLoadError(null);
    try {
      const page = await listRecycleBinRequirements({ limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}), signal: controller.signal });
      if (version !== listRequestVersion.current) return;
      setRows((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) {
      if (version !== listRequestVersion.current || isAbortError(cause)) return;
      if (!nextCursor) setRows([]);
      setLoadError(errorText(cause));
      setLoadState("error");
    }
  }, []);

  const openDetail = useCallback(async (id: string, options?: { push?: boolean }) => {
    const version = ++detailRequestVersion.current;
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;
    setDetailId(id); setSelected(null); setDetailLoading(true); setDetailError(null); setNotice(null);
    if (options?.push) window.history.pushState(null, "", recycleBinUrl(window.location.pathname || "/", id));
    try {
      const detail = await getRequirement(id, undefined, controller.signal);
      if (version !== detailRequestVersion.current) return;
      setSelected(detail);
    } catch (cause) {
      if (version !== detailRequestVersion.current || isAbortError(cause)) return;
      setDetailError(errorText(cause));
    } finally {
      if (version === detailRequestVersion.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
    return () => {
      listRequestVersion.current += 1;
      detailRequestVersion.current += 1;
      listControllerRef.current?.abort();
      detailControllerRef.current?.abort();
    };
  }, [load]);
  // 直接访问/刷新回收站深链（?stage=recycle&requirement=<id>）时在挂载期拉取详情，不重复 pushState。
  const deepLinkOpened = useRef(false);
  useEffect(() => {
    if (!initialDetailId || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    void openDetail(initialDetailId);
  }, [initialDetailId, openDetail]);
  useEffect(() => {
    const onPopState = () => {
      const next = readRequirementDeepLink(window.location.search);
      if (next) { void openDetail(next); return; }
      detailRequestVersion.current += 1;
      setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openDetail]);

  const closeDetail = () => {
    detailRequestVersion.current += 1;
    setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false);
    window.history.replaceState(null, "", recycleBinUrl(window.location.pathname || "/", null));
  };

  const restore = async (id: string) => {
    setRestoringId(id); setActionError(null);
    try {
      await restoreRequirement(id);
      setRows((prev) => prev.filter((row) => row.id !== id));
      setNotice("已还原");
      if (detailId === id) closeDetail();
      onRefresh();
    } catch (cause) {
      // 并发：这条需求已不在回收站（别人已还原）。刷新列表并提示，不弹成错误。
      if (cause instanceof ApiError && cause.status === 409) {
        setNotice("这条需求已不在回收站，已刷新列表。");
        if (detailId === id) closeDetail();
        void load(null);
        onRefresh();
      } else {
        setActionError(errorText(cause));
      }
    } finally { setRestoringId(null); }
  };

  const columns = useMemo(() => [
    {
      title: "需求",
      dataIndex: "title",
      render: (_value: unknown, row: RequirementSummary) => <div className="requirement-title">
        <span className="req-id">{requirementDisplayId(row)}</span>
        <strong>{row.title}</strong>
      </div>,
    },
    { title: "池", dataIndex: "pool", width: 90, render: (_value: unknown, row: RequirementSummary) => poolChip(row.pool) },
    {
      title: "来源",
      dataIndex: "sourceType",
      width: 130,
      render: (_value: unknown, row: RequirementSummary) => requirementSourceInfo(row)?.name ?? requirementSourceName(row),
    },
    {
      title: "删除时间",
      dataIndex: "deletedAt",
      width: 180,
      render: (_value: unknown, row: RequirementSummary) => formatDateTime(row.deletedAt ?? null) ?? <span className="req-empty-value">—</span>,
    },
    {
      title: "删除前处理状态",
      dataIndex: "processingState",
      width: 150,
      render: (_value: unknown, row: RequirementSummary) => processingStateLabels[requirementProcessingState(row)],
    },
    {
      title: "操作",
      dataIndex: "id",
      width: 110,
      render: (_value: unknown, row: RequirementSummary) => <ArcoButton type="text" size="small" className="link-button"
        onClick={(event) => { event.stopPropagation(); void restore(row.id); }} disabled={restoringId !== null} htmlType="button">{restoringId === row.id ? "还原中…" : "还原"}</ArcoButton>,
    },
  ], [restoringId]);

  if (detailId) {
    return <section className="panel requirements-panel">
      <RequirementDetailPage
        detail={selected}
        detailId={detailId}
        loading={detailLoading}
        error={detailError}
        notice={notice ?? actionError}
        busy={restoringId !== null}
        autoOpenOwnerPicker={false}
        onCloseNotice={() => { setNotice(null); setActionError(null); }}
        onBack={closeDetail}
        onRefresh={() => void openDetail(detailId)}
        onAct={async () => false}
        onSaved={() => undefined}
        canDelete={false}
        onRestore={restore}
        canRestore={selected?.canRestore === true}
        restoreBusy={restoringId !== null}
      />
    </section>;
  }

  return <ArcoCard bordered={false} className="rq-card requirements-panel recycle-bin-panel">
    <StateBanner loadError={loadError ?? actionError} notice={notice} onCloseNotice={() => setNotice(null)} onRetry={loadError ? () => void load(null) : undefined} />
    <div className="list-summary" role="status" style={{ marginBottom: 12 }}>
      <span className="list-summary-count">已加载 {rows.length} 条{cursor ? "，还有更多" : ""}</span>
      <span className="list-summary-sort">只显示你删除的需求；不做物理删除，可随时还原。</span>
    </div>
    {loadState === "loading" && !rows.length
      ? <SkeletonTableRows rows={4} columns={5} />
      : <div className="table-scroll req-list-scroll">
        <ArcoTable<RequirementSummary>
          className="req-list"
          rowKey="id"
          scroll={{ x: 900 }}
          columns={columns}
          data={rows}
          pagination={false}
          border={false}
          noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>回收站是空的</strong><span>你移入回收站的需求会出现在这里，可随时还原。</span></div>} />}
          onRow={(row) => ({
            style: { cursor: "pointer" },
            tabIndex: 0,
            "aria-label": `打开已删除需求：${row.title}`,
            onClick: () => void openDetail(row.id, { push: true }),
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(row.id, { push: true }); } },
          })}
        />
      </div>}
    {cursor && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={() => void load(cursor)} disabled={loadState === "loading"} type="secondary" size="small">加载更多</ArcoButton></div>}
  </ArcoCard>;
}

/**
 * Base 记录引用。工作台只拿得到 record ID，拿不到 Base app token（凭据不下发浏览器），
 * 因此提供可复制的引用，而不是伪造一个打不开的链接。
 */
function BaseRecordReference({ recordId, url }: { recordId: string | null; url?: string | null }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }, []);
  if (!recordId) return <span className="base-ref-empty">尚未写入飞书 Base</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recordId);
      setCopied(true);
      ArcoMessage.success("已复制记录 ID");
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };
  const safeUrl = safeHttpUrl(url);
  return <span className="base-ref">
    <code className="base-ref-id">{recordId}</code>
    {safeUrl ? <a className="link-button" href={safeUrl} target="_blank" rel="noreferrer">在飞书 Base 中打开</a> : null}
    <ArcoButton type="text" className="link-button" onClick={() => void copy()} htmlType="button">{copied ? "已复制" : "复制记录 ID"}</ArcoButton>
    <span className="base-ref-hint">PM 处理状态与通知送达请在飞书 Base 中查看；本工作台不读取这些字段。</span>
  </span>;
}

const SCORE_ROWS: Array<{ path: [keyof ScoringInputs, string]; label: string; max: number; group: string }> = [
  { path: ["user", "pain"], label: "U 痛点强度", max: 5, group: "U 用户价值" },
  { path: ["user", "frequency"], label: "U 发生频次", max: 5, group: "U 用户价值" },
  { path: ["market", "sellingPoint"], label: "M 卖点强度", max: 3, group: "M 市场价值" },
  { path: ["market", "competitor"], label: "M 竞品差异", max: 3, group: "M 市场价值" },
  { path: ["strategy", "roadmap"], label: "S Roadmap 匹配", max: 3, group: "S 战略价值" },
  { path: ["strategy", "dependency"], label: "S 战略依赖/杠杆", max: 3, group: "S 战略价值" },
  { path: ["cost", "workload"], label: "C 工作量", max: 5, group: "C 成本" },
  { path: ["cost", "technicalRisk"], label: "C 技术风险", max: 5, group: "C 成本" },
  { path: ["cost", "resource"], label: "C 资源占用", max: 5, group: "C 成本" },
];

export interface DimensionInsight {
  key: "U" | "M" | "S" | "C";
  recommendation?: string | null;
  rationale?: string | null;
  evidence?: string[];
  missing?: boolean;
}

type EditableScoringInputs = {
  user: { pain: number | undefined; frequency: number | undefined };
  market: { sellingPoint: number | undefined; competitor: number | undefined };
  strategy: { roadmap: number | undefined; dependency: number | undefined };
  cost: { workload: number | undefined; technicalRisk: number | undefined; resource: number | undefined };
};

function scoringValue(inputs: ScoringInputs, path: [keyof ScoringInputs, string]): number {
  return Number((inputs[path[0]] as Record<string, number>)[path[1]] ?? 0);
}

function editableScoringValue(inputs: EditableScoringInputs, path: [keyof ScoringInputs, string]): number | undefined {
  return (inputs[path[0]] as Record<string, number | undefined>)[path[1]];
}

function withScoringValue(inputs: EditableScoringInputs, path: [keyof ScoringInputs, string], value: number | undefined): EditableScoringInputs {
  return { ...inputs, [path[0]]: { ...(inputs[path[0]] as Record<string, number | undefined>), [path[1]]: value } } as EditableScoringInputs;
}

function toValidScoringInputs(inputs: EditableScoringInputs): ScoringInputs | null {
  for (const { path, max } of SCORE_ROWS) {
    const val = editableScoringValue(inputs, path);
    if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > max) return null;
  }
  return inputs as ScoringInputs;
}

function scoreDimensions(inputs: ScoringInputs) {
  return {
    U: inputs.user.pain * inputs.user.frequency,
    M: inputs.market.sellingPoint * inputs.market.competitor,
    S: inputs.strategy.roadmap * inputs.strategy.dependency,
    C: Math.max(inputs.cost.workload, inputs.cost.technicalRisk, inputs.cost.resource),
  };
}

function scoreOriginLabel(origin: RequirementScoreVersion["origin"]): string {
  return origin === "ai" ? "AI 建议" : origin === "manual" ? "PM 人工" : "已采用 AI";
}

/** V02-S06 / 2026-10-28：AI 评分与 AI 建议整合为同一区域。
 *  评分决定优先级；U/M/S/C 维度卡、九项输入和 AI 定性建议放在一起，
 *  避免原来的“评分与优先级 + AI分析与建议”两个重复区块。 */
export function ScoringPanel({ requirementId, scoring, dimensionInsights = [], children, onSaved }: {
  requirementId: string;
  scoring: import("../api").ScoringData | null | undefined;
  dimensionInsights?: DimensionInsight[];
  children?: ReactNode;
  onSaved: () => void;
}) {
  const current = scoring?.current ?? null;
  const ai = scoring?.aiSuggestion ?? null;
  const baseInputs: ScoringInputs = current?.inputs ?? ai?.inputs ?? {
    user: { pain: 3, frequency: 3 }, market: { sellingPoint: 1, competitor: 1 },
    strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 3, technicalRisk: 3, resource: 3 },
  };
  const [editing, setEditing] = useState(false);
  const [inputs, setInputs] = useState<EditableScoringInputs>(baseInputs);
  const [alpha, setAlpha] = useState<number | undefined>(current?.alpha ?? ai?.alpha ?? 0.8);
  const [safetyFlag, setSafetyFlag] = useState(current?.safetyFlag ?? ai?.safetyFlag ?? false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    const source = current ?? ai;
    if (source) { setInputs(source.inputs); setAlpha(source.alpha); setSafetyFlag(source.safetyFlag); }
    setEditing(false); setError(null);
  }, [current?.id, ai?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const display = current ?? ai;
  const dimensions = display ? scoreDimensions(display.inputs) : null;
  const insightByKey = new Map(dimensionInsights.map((insight) => [insight.key, insight]));
  const dimensionCards = display && dimensions ? ([
    { key: "U" as const, label: "U · 用户价值", value: dimensions.U, formula: `痛点 ${display.inputs.user.pain} × 频次 ${display.inputs.user.frequency}` },
    { key: "M" as const, label: "M · 市场价值", value: dimensions.M, formula: `卖点 ${display.inputs.market.sellingPoint} × 竞品 ${display.inputs.market.competitor}` },
    { key: "S" as const, label: "S · 战略价值", value: dimensions.S, formula: `Roadmap ${display.inputs.strategy.roadmap} × 依赖 ${display.inputs.strategy.dependency}` },
    { key: "C" as const, label: "C · 成本", value: dimensions.C, formula: `max(工作量 ${display.inputs.cost.workload}，风险 ${display.inputs.cost.technicalRisk}，资源 ${display.inputs.cost.resource})` },
  ]) : [];
  const aiAlreadyApplied = Boolean(current && ai && current.origin === "ai_applied" && current.analysisVersion === ai.analysisVersion);
  const validInputs = toValidScoringInputs(inputs);
  const validAlpha = typeof alpha === "number" && Number.isFinite(alpha) && alpha >= 0.5 && alpha <= 2 ? alpha : null;
  const save = async () => {
    if (!validInputs || validAlpha === null) { setError("请填写合法的评分项（1 至对应上限）与 α 系数（0.5–2.0）。"); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await saveRequirementScore(requirementId, { expectedVersion: current?.version ?? 0, inputs: validInputs, alpha: validAlpha, safetyFlag, reason });
      setNotice("评分已保存并重算。");
      setEditing(false); setReason(""); onSaved();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const applyAi = async () => {
    if (!ai) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await applyRequirementAiScore(requirementId, { expectedVersion: current?.version ?? 0, aiVersion: ai.version, reason: "采用AI建议" });
      setNotice("已采用 AI 建议。"); onSaved();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const rowLabel = (path: [keyof ScoringInputs, string]) => {
    const key = `${path[0]}.${path[1]}`;
    const basis = (display?.basis ?? {})[key];
    if (!basis) return "—";
    return `${basis.reason}${basis.assumption ? "（假设）" : ""}`;
  };
  const scoreTableRows: Array<{
    key: string;
    group: string;
    label: string;
    aiValue: string | number;
    currentValue: ReactNode;
    basis: string;
  }> = [
    ...SCORE_ROWS.map(({ path, label, max, group }) => ({
      key: label,
      group,
      label,
      aiValue: ai ? scoringValue(ai.inputs, path) : "—",
      currentValue: editing
        ? <ArcoInputNumber aria-label={`评分 ${label}`} min={1} max={max} step={1} precision={0} value={editableScoringValue(inputs, path)} onChange={(value: number | undefined) => setInputs(withScoringValue(inputs, path, typeof value === "number" && Number.isFinite(value) ? value : undefined))} style={{ width: 72 }} />
        : (display ? scoringValue(display.inputs, path) : "—"),
      basis: rowLabel(path),
    })),
    {
      key: "alpha",
      group: "修正系数",
      label: "α 修正系数",
      aiValue: ai?.alpha ?? "—",
      currentValue: editing
        ? <ArcoInputNumber aria-label="评分 alpha" min={0.5} max={2} step={0.1} precision={1} value={alpha} onChange={(value: number | undefined) => setAlpha(typeof value === "number" && Number.isFinite(value) ? value : undefined)} style={{ width: 72 }} />
        : (display?.alpha ?? "—"),
      basis: display?.rationale ?? "—",
    },
  ];
  return <ArcoCard
    className="rq-card req-section req-score-section"
    aria-labelledby="req-scoring-heading"
    title={
      <div className="rq-card-title">
        <h3 id="req-scoring-heading" className="rq-section-heading">AI 评分与优先级</h3>
        <ArcoTypography.Text type="secondary" className="rq-card-subtitle">U/M/S/C 四维评分决定 P0–P3；AI 给出依据，PM 可修订单项与 α。</ArcoTypography.Text>
      </div>
    }
    extra={<ArcoTag>AI 评分 · 服务端算 P</ArcoTag>}
  >
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    {!display && !editing ? (
      <ArcoEmpty
        className="rq-empty"
        description={
          <div className="rq-empty-copy">
            <strong>暂无评分</strong>
            <span>AI 分析完成后会生成九项评分；旧分析没有合法评分时也可以手动填写。</span>
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setEditing(true)} disabled={busy}>手动填写评分</ArcoButton>
          </div>
        }
      />
    ) : <>
      {display && (
        <div className="score-overview">
          <div className="score-overview-main">
            <ArcoTypography.Text type="secondary" className="rq-caption">{current ? "当前综合评分" : "AI 建议综合评分"}</ArcoTypography.Text>
            <div className="score-number-line">
              <ArcoStatistic value={display.score} renderFormat={() => display.score.toFixed(2)} />
              <ArcoTag color={PRIORITY_TAG_COLORS[display.priority] ?? "gray"}>{display.priority}</ArcoTag>
            </div>
            <ArcoTypography.Text type="secondary" className="rq-caption">v{display.version} · {scoreOriginLabel(display.origin)} · {display.scoreConfidence ? `${display.scoreConfidence}置信度` : "置信度 —"}</ArcoTypography.Text>
            {!current && ai && <ArcoTag size="small" color="orange">尚未成为当前评分，请查看后采用</ArcoTag>}
          </div>
          <div className="score-overview-formula">
            <ArcoTypography.Text type="secondary" className="rq-caption">计算依据（只读）</ArcoTypography.Text>
            <code>{scoring?.formula?.text ?? "U/M/S/C 固定公式"}</code>
            <ArcoTypography.Text type="secondary" className="rq-caption">综合分由服务端按此公式计算，P 按 45 / 25 / 10 阈值判定。</ArcoTypography.Text>
          </div>
          <ArcoSpace size={8} wrap>
            {ai && ai.id !== current?.id && !aiAlreadyApplied && <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void applyAi()} disabled={busy}>采用 AI 建议 v{ai.version}</ArcoButton>}
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setEditing((value) => !value)} disabled={busy}>{editing ? "取消编辑" : "编辑评分"}</ArcoButton>
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setHistoryOpen((value) => !value)}>{historyOpen ? "收起历史" : `历史（${scoring?.history.length ?? 0}）`}</ArcoButton>
          </ArcoSpace>
        </div>
      )}
      {display?.scoreConfidenceReason && <ArcoTypography.Paragraph type="secondary" className="detail-note">评分置信度理由：{display.scoreConfidenceReason}</ArcoTypography.Paragraph>}
      {display?.safetyFlag && <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="status" content="涉及安全：需人工复核；安全标记不自动改变 P。" />}
      {display && (
        <ArcoGrid.Row gutter={[12, 12]} aria-label="U/M/S/C 维度评分">
          {dimensionCards.map((card) => {
            const insight = insightByKey.get(card.key);
            return (
              <ArcoGrid.Col key={card.key} xs={24} sm={12}>
                <ArcoCard size="small" className={`rq-subcard dimension-score-card dimension-${card.key.toLowerCase()}`}>
                  <div className="dimension-card-head"><span>{card.label}</span><strong>{card.value}</strong></div>
                  <ArcoTypography.Text type="secondary" className="rq-caption">{card.formula}</ArcoTypography.Text>
                  {insight?.recommendation ? <p className="dimension-insight">AI：{insight.recommendation}</p> : <p className="dimension-insight subtle-text">AI 维度解读未提供</p>}
                  {insight?.rationale && <p className="dimension-rationale">理由：{insight.rationale}</p>}
                  {insight?.evidence && insight.evidence.length > 0 && <p className="dimension-evidence">证据：{insight.evidence.join("；")}</p>}
                  {insight?.missing && <ArcoTag size="small" color="orange">需要补充信息</ArcoTag>}
                </ArcoCard>
              </ArcoGrid.Col>
            );
          })}
        </ArcoGrid.Row>
      )}
      <div className="score-input-head"><h4>九项评分输入</h4><ArcoTypography.Text type="secondary" className="rq-caption">AI 建议值 vs 当前值；依据/假设可逐项核对</ArcoTypography.Text></div>
      <ArcoTable<(typeof scoreTableRows)[number]>
        className="score-input-table"
        rowKey="key"
        data={scoreTableRows}
        pagination={false}
        border={false}
        scroll={{ x: 640 }}
        columns={[
          { title: "维度", dataIndex: "group", width: 120, render: (_value, row) => <ArcoTag size="small">{row.group}</ArcoTag> },
          { title: "评分项", dataIndex: "label", width: 150, render: (_value, row) => <strong>{row.label}</strong> },
          { title: "AI建议", dataIndex: "aiValue", width: 80 },
          { title: "当前值", dataIndex: "currentValue", width: 100 },
          { title: "依据/假设", dataIndex: "basis" },
        ]}
      />
      {editing && (
        <ArcoForm layout="inline" className="rq-compact-form rq-action-bar">
          <ArcoForm.Item>
            <ArcoCheckbox checked={safetyFlag} onChange={(checked: boolean) => setSafetyFlag(checked)}>涉及安全</ArcoCheckbox>
          </ArcoForm.Item>
          <ArcoForm.Item label="修改理由（必填）">
            <ArcoInput aria-label="评分修改理由" value={reason} onChange={(value: string) => setReason(value)} />
          </ArcoForm.Item>
          <ArcoForm.Item>
            <ArcoSpace size={8}>
              <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void save()} disabled={busy || reason.trim().length === 0 || !validInputs || validAlpha === null}>{busy ? "保存中…" : "保存评分"}</ArcoButton>
              {!display && <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setEditing(false)} disabled={busy}>取消</ArcoButton>}
            </ArcoSpace>
          </ArcoForm.Item>
        </ArcoForm>
      )}
      {historyOpen && <ArcoTable<RequirementScoreVersion>
        rowKey="id"
        data={scoring?.history ?? []}
        pagination={false}
        border={false}
        columns={[
          { title: "版本", dataIndex: "version", width: 130, render: (_value, version) => <>v{version.version} · {version.status}</> },
          { title: "来源", dataIndex: "origin", width: 120, render: (_value, version) => scoreOriginLabel(version.origin) },
          { title: "分数/P", dataIndex: "score", width: 130, render: (_value, version) => <>{version.score.toFixed(2)} / {version.priority}</> },
          { title: "时间", dataIndex: "createdAt", width: 180, render: (_value, version) => formatDateTime(version.createdAt) },
          { title: "理由", dataIndex: "changeReason", render: (_value, version) => version.changeReason ?? "—" },
        ]}
      />}
      {children && <div className="score-analysis-detail">
        <div className="score-analysis-head"><h4>AI 分析建议</h4><ArcoTypography.Text type="secondary" className="rq-caption">模块、类型、人群与整体置信度；详细证据在下方历史/依据中可查。</ArcoTypography.Text></div>
        {children}
      </div>}
    </>}
    {!display && !editing && children && <div className="score-analysis-detail">
      <div className="score-analysis-head"><h4>AI 分析建议</h4><ArcoTypography.Text type="secondary" className="rq-caption">评分未生成时仍可查看现有 AI 分析。</ArcoTypography.Text></div>
      {children}
    </div>}
  </ArcoCard>;
}

// ---------- P1 重复处理：详情页人工判定区块 ----------
type DuplicateDecisionMode = "duplicate" | "confirmed_unique" | "ignored" | "revoke";

/**
 * 重复判定区块：确认重复（选择主记录）/ 确认非重复 / 忽略，已压制时提供撤销。
 * 撤销与确认走不同端点：撤销用 DELETE 清除判定（审计 duplicate.revoked），
 * 不能复用 confirmed_unique，否则会留下一条"已确认非重复"记录。
 */
function DuplicateDecisionSection({ detail, onSaved }: { detail: RequirementDetail; onSaved: () => void }) {
  const state = requirementProcessingState(detail);
  const resolution = detail.resolution ?? null;
  const suppressed = state !== "active";
  const version = resolution?.version ?? 0;
  const [mode, setMode] = useState<DuplicateDecisionMode | null>(null);
  const [canonicalId, setCanonicalId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 候选优先取后端 duplicateCandidates（同标题的其他 active 需求），旧响应回退 duplicates。
  type DuplicateCandidateLike = { id: string; title: string; platformRequirementId?: string | null; teambitionRequirementId?: string | null };
  const candidateSource: DuplicateCandidateLike[] = detail.duplicateCandidates ?? detail.duplicates ?? [];
  const candidates = candidateSource.map((item) => ({
    id: item.id,
    title: item.title,
    // 手工需求没有 TB 任务号：优先显示 RQ 编号，避免候选行出现 "null"。
    hint: item.platformRequirementId ?? item.teambitionRequirementId ?? "手工需求",
  }));
  const currentCanonicalId = resolution?.canonicalRequirementId ?? detail.duplicateOf ?? null;
  const canonicalOptions = currentCanonicalId && !candidates.some((candidate) => candidate.id === currentCanonicalId)
    ? [{ id: currentCanonicalId, title: "当前疑似主记录", hint: resolution?.canonicalPlatformRequirementId ?? currentCanonicalId }, ...candidates]
    : candidates;

  // 用户口径（2026-11-23）：没有同标题候选时进入精简态——只保留「忽略」这个独立动作，
  // 主记录与「确认非重复」都没有可判断的对象；已有判定时只保留撤销。
  const reviewState = resolution?.reviewState ?? null;
  const undecided = reviewState !== "suspected" && reviewState !== "confirmed";
  const noCandidates = canonicalOptions.length === 0;
  const compact = !suppressed && undecided && noCandidates;

  const openMode = (next: DuplicateDecisionMode) => {
    setMode(next); setError(null); setConflict(false); setNotice(null);
    setReason(next === "revoke" ? "撤销判定，恢复为活跃需求" : "");
    setCanonicalId((previous) => previous || currentCanonicalId || candidates[0]?.id || "");
  };

  const submit = async () => {
    if (!mode) return;
    // null 表示撤销：走 DELETE 清除判定，而不是用 confirmed_unique 落一条新判定。
    const decision: DuplicateDecision | null = mode === "revoke" ? null : mode === "duplicate" ? "duplicate" : mode === "ignored" ? "ignored" : "confirmed_unique";
    const trimmed = reason.trim();
    if (!trimmed) { setError("请填写判定理由。"); return; }
    if (decision === "duplicate" && !canonicalId) { setError("请选择主记录后再确认重复。"); return; }
    setBusy(true); setError(null); setConflict(false); setNotice(null);
    try {
      const result = decision === null
        ? await revokeDuplicateDecision(detail.id, version)
        : await setDuplicateDecision(detail.id, {
            decision,
            ...(decision === "duplicate" ? { canonicalRequirementId: canonicalId } : {}),
            reason: trimmed,
            expectedVersion: version,
          });
      setMode(null);
      setNotice(`${decision === null ? "已撤销判定，需求恢复为活跃" : `重复判定已保存（${processingStateLabels[result.processingState]}）`}，正在刷新详情。`);
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict(true);
        setError("判定版本冲突：该需求已被其他操作更新。请刷新详情后重试。");
      } else {
        setError(cause instanceof ApiError ? errorText(cause) : "判定提交失败，请重试。");
      }
    } finally { setBusy(false); }
  };

  const heading = mode === "duplicate" ? "确认重复：选择主记录" : mode === "ignored" ? "忽略该需求" : mode === "revoke" ? "撤销判定" : "确认非重复";
  const submitLabel = mode === "duplicate" ? "确认重复" : mode === "ignored" ? "确认忽略" : mode === "revoke" ? "撤销判定" : "确认非重复";
  const stateBadgeStatus = state === "suppressed_duplicate" ? "error" : state === "suppressed_ignored" ? "default" : resolution?.reviewState === "suspected" ? "warning" : "success";
  const stateChipLabel = state !== "active"
    ? processingStateLabels[state]
    : resolution?.reviewState === "suspected" ? "疑似重复（待确认）" : resolution?.reviewState === "confirmed" ? "已确认非重复" : compact ? "未作判定 · 暂无重复候选" : "未作判定";

  return <ArcoCard
    className="rq-card req-section req-duplicate-section"
    aria-labelledby="req-duplicate-heading"
    title={<h3 id="req-duplicate-heading" className="rq-section-heading">重复处理</h3>}
    extra={<ArcoTag>人工判定 · 影响处理链路</ArcoTag>}
  >
    <div className="duplicate-current-state">
      <ArcoBadge status={stateBadgeStatus} text={stateChipLabel} />
      {resolution?.reason && <span className="subtle-text">理由：{resolution.reason}</span>}
      {(resolution?.canonicalPlatformRequirementId ?? resolution?.canonicalRequirementId) && <span className="subtle-text">主记录：<code>{resolution.canonicalPlatformRequirementId ?? resolution.canonicalRequirementId}</code></span>}
      {typeof resolution?.version === "number" && <span className="subtle-text">判定版本 v{resolution.version}</span>}
    </div>
    <p className="detail-note">{compact ? "暂未发现同标题的重复候选，主记录与「确认非重复」暂不可用；如需压制这条需求，可直接忽略：不再进入 AI 分析、Base 推送与通知，记录保留、可随时撤销。" : "确认重复或忽略后该需求会被压制：不再进入 AI 分析、Base 推送与通知，记录保留、可随时撤销；撤销判定会把处理状态恢复为活跃。"}</p>
    {error && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title={conflict ? "判定未保存" : "操作未完成"} content={error} action={conflict ? <ArcoButton type="secondary" htmlType="button" size="small" onClick={onSaved}>刷新详情</ArcoButton> : undefined} />}
    {notice && <ArcoAlert className="rq-inline-alert" type="success" showIcon role="status" content={notice} />}
    {mode === null ? <ArcoSpace size={8} wrap className="duplicate-actions">
      {!suppressed && !noCandidates && <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => openMode("duplicate")} disabled={busy} title="从同标题候选中选择主记录">确认重复（选择主记录）</ArcoButton>}
      {!suppressed && !noCandidates && <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => openMode("confirmed_unique")} disabled={busy}>确认非重复</ArcoButton>}
      {!suppressed && <ArcoButton type="outline" status="danger" htmlType="button" size="small" onClick={() => openMode("ignored")} disabled={busy}>忽略</ArcoButton>}
      {suppressed && <ArcoButton type="primary" htmlType="button" size="small" onClick={() => openMode("revoke")} disabled={busy}>撤销判定（恢复活跃）</ArcoButton>}
    </ArcoSpace> : <div className="duplicate-form">
      <ArcoTypography.Title heading={6}>{heading}</ArcoTypography.Title>
      <ArcoForm layout="vertical" className="rq-compact-form">
        {mode === "duplicate" && <ArcoForm.Item label="主记录（同标题候选）"><ArcoSelect aria-label="主记录候选" value={canonicalId} onChange={(value: string) => setCanonicalId(value)} disabled={busy} style={{ minWidth: 260 }} placeholder="选择主记录" options={canonicalOptions.map((candidate) => ({ label: `${candidate.title}（${candidate.hint}）`, value: candidate.id }))} /></ArcoForm.Item>}
        <ArcoForm.Item label="判定理由 *"><ArcoInput aria-label="判定理由" value={reason} onChange={(value: string) => setReason(value)} disabled={busy} placeholder={mode === "ignored" ? "例如：已知重复诉求，无需再处理" : "例如：与主记录描述同一诉求"} /></ArcoForm.Item>
        <ArcoSpace size={8}>
          <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : submitLabel}</ArcoButton>
          <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => { setMode(null); setError(null); setConflict(false); }} disabled={busy}>取消</ArcoButton>
        </ArcoSpace>
      </ArcoForm>
    </div>}
  </ArcoCard>;
}

// ---------- V02-T26：人工优先级覆盖（只影响应用内列表/详情/总览，不回写 Base） ----------
export function PriorityOverrideSection({ detail, onSaved }: { detail: RequirementDetail; onSaved: () => void }) {
  const override = detail.priorityOverride ?? null;
  const effective = detail.effectivePriority ?? null;
  const suppressed = requirementProcessingState(detail) !== "active";
  const [mode, setMode] = useState<"edit" | "clear" | null>(null);
  const [priority, setPriority] = useState<"P0" | "P1" | "P2" | "P3">(override?.priority ?? "P1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setMode(null); setReason(""); setError(null); setNotice(null); setPriority(override?.priority ?? "P1"); }, [detail.id, override?.priority]);
  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) { setError("请填写覆盖原因（或清除原因）。"); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await setPriorityOverride(detail.id, { priority: mode === "clear" ? null : priority, reason: trimmed });
      setMode(null); setReason("");
      setNotice(mode === "clear" ? "已清除人工优先级，恢复使用当前评分版本优先级。" : `人工优先级已保存为 ${result.effectivePriority ?? priority}。`);
      onSaved();
    } catch (cause) { setError(cause instanceof ApiError ? errorText(cause) : "人工优先级保存失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <ArcoCard
    className="rq-card req-section req-priority-override-section"
    aria-labelledby="req-priority-override-heading"
    title={<h3 id="req-priority-override-heading" className="rq-section-heading">人工优先级</h3>}
    extra={<ArcoTag>人工覆盖 · 仅应用内，不回写 Base</ArcoTag>}
  >
    <ArcoSpace size={8} wrap className="priority-override-current">
      <ArcoTypography.Text type="secondary">当前生效</ArcoTypography.Text>
      {effective ? <ArcoTag color={PRIORITY_TAG_COLORS[effective] ?? "gray"}>{effective}</ArcoTag> : <span className="req-empty-value">暂无优先级</span>}
      {override ? <ArcoBadge status="warning" text="已人工覆盖" /> : <span className="subtle-text">取自当前评分版本{detail.scoring?.current ? `（v${detail.scoring.current.version}）` : ""}</span>}
    </ArcoSpace>
    {override && (
      <ArcoDescriptions
        className="priority-override-meta"
        style={{ marginTop: 12 }}
        size="small"
        column={{ xs: 1, sm: 2 }}
        data={[
          { label: "覆盖为", value: override.priority },
          { label: "原因", value: override.reason },
          { label: "操作人", value: override.actorId },
          { label: "时间", value: timeLabel(override.at) },
        ]}
      />
    )}
    <p className="detail-note">人工优先级只影响应用内列表/详情/总览统计，不回写 Base；清除后恢复当前评分版本优先级。</p>
    {override && detail.scoring?.current && detail.scoring.current.priority !== override.priority && <ArcoAlert className="rq-inline-alert" type="info" showIcon role="note" content={`Base 的「AI优先级建议」仍是评分结果 ${detail.scoring.current.priority}，不会随人工覆盖（${override.priority}）变化；PM 终审优先级请在 Base 中维护。`} />}
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    {mode === null ? <ArcoSpace size={8} wrap className="rq-action-bar">
      <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => { setMode("edit"); setReason(""); setError(null); setNotice(null); }} disabled={busy || suppressed} title={suppressed ? "已压制需求不能设置人工优先级；请先撤销判定" : "设置人工优先级覆盖"}>{override ? "修改人工优先级" : "设置人工优先级"}</ArcoButton>
      {override && <ArcoButton type="outline" status="danger" htmlType="button" size="small" onClick={() => { setMode("clear"); setReason(""); setError(null); setNotice(null); }} disabled={busy || suppressed} title={suppressed ? "已压制需求不能清除人工优先级" : "清除人工优先级，恢复评分结果"}>清除人工优先级</ArcoButton>}
    </ArcoSpace> : <ArcoForm layout="inline" className="rq-compact-form rq-action-bar">
      {mode === "edit" && <ArcoForm.Item label="覆盖为 *"><ArcoSelect aria-label="人工优先级" value={priority} onChange={(value: "P0" | "P1" | "P2" | "P3") => setPriority(value)} style={{ minWidth: 120 }} options={["P0", "P1", "P2", "P3"].map((level) => ({ label: level, value: level }))} /></ArcoForm.Item>}
      <ArcoForm.Item label={mode === "clear" ? "清除原因 *" : "覆盖原因 *"}><ArcoInput aria-label="人工优先级原因" value={reason} onChange={(value: string) => setReason(value)} disabled={busy} placeholder="例如：产品会议决定提前处理（1–500 字）" /></ArcoForm.Item>
      <ArcoForm.Item>
        <ArcoSpace size={8}>
          <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void submit()} disabled={busy || reason.trim().length === 0}>{busy ? "保存中…" : mode === "clear" ? "确认清除" : "保存"}</ArcoButton>
          <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => { setMode(null); setError(null); }} disabled={busy}>取消</ArcoButton>
        </ArcoSpace>
      </ArcoForm.Item>
    </ArcoForm>}
  </ArcoCard>;
}

// ---------- V02-T26：分析补充上下文（进入下一次分析请求，不写 Base） ----------
export function AnalysisContextSection({ detail, onSaved }: { detail: RequirementDetail; onSaved: () => void }) {
  const suppressed = requirementProcessingState(detail) !== "active";
  const saved = detail.analysisContext ?? null;
  const [context, setContext] = useState(saved?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setContext(saved?.note ?? ""); setError(null); setNotice(null); }, [detail.id, saved?.note]);
  const save = async (rerun: boolean) => {
    setBusy(true); setError(null); setNotice(null);
    const trimmed = context.trim();
    try {
      await saveAnalysisContext(detail.id, trimmed.length > 0 ? trimmed : null);
      if (rerun) {
        try { await retryAnalysis(detail.id, { force: true }); }
        catch (cause) {
          if (cause instanceof ApiError && cause.status === 409) {
            setError("补充上下文已保存，但重新分析未开始：当前状态不允许重试（可能有分析排队/运行中），请刷新后重试。");
            onSaved();
            return;
          }
          throw cause;
        }
      }
      setNotice(rerun ? "补充上下文已保存，已提交重新分析。" : trimmed.length > 0 ? "补充上下文已保存。" : "补充上下文已清除。");
      onSaved();
    } catch (cause) { setError(cause instanceof ApiError ? errorText(cause) : "补充上下文保存失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <ArcoCard
    className="rq-card req-section req-analysis-context-section"
    role="region"
    aria-labelledby="req-analysis-context-heading"
    title={<h3 id="req-analysis-context-heading" className="rq-section-heading">补充上下文</h3>}
    extra={<ArcoTag>仅进入 AI 分析 · 不写 Base</ArcoTag>}
  >
    <p className="detail-note">补充 PM 已知但来源未记录的事实（场景、约束、历史决策等）；下一次分析会以“补充上下文：”独立段提供给模型。不写入 Base，也不改变 PM 已确认字段。</p>
    {saved && <ArcoTypography.Paragraph type="secondary" className="rq-caption" style={{ marginTop: 6 }}>上次更新：{timeLabel(saved.updatedAt)} · {saved.updatedBy}</ArcoTypography.Paragraph>}
    <ArcoForm layout="vertical" className="rq-compact-form">
      <ArcoForm.Item label="补充上下文（不超过 4000 字）">
        <ArcoInput.TextArea aria-label="补充上下文" rows={4} value={context} onChange={(value: string) => setContext(value)} disabled={busy || suppressed} placeholder="例如：该能力需在 Q4 前上线；硬件仅支持 C706；与 GEOID 项目存在复用关系。" />
      </ArcoForm.Item>
    </ArcoForm>
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    <ArcoSpace size={8} wrap align="center">
      <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void save(false)} disabled={busy || suppressed} title={suppressed ? "已压制需求不能保存补充上下文；请先撤销判定" : "仅保存补充上下文"}>{busy ? "保存中…" : "保存"}</ArcoButton>
      <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void save(true)} disabled={busy || suppressed} title={suppressed ? "已压制需求不能重新分析" : "保存补充上下文后强制重跑一次 AI 分析（会消耗一次模型调用）"}>{busy ? "提交中…" : "保存并重新分析"}</ArcoButton>
      <span className="subtle-text">会消耗一次模型调用</span>
    </ArcoSpace>
  </ArcoCard>;
}

// ---------- PRD-28：需求评估（按需生成 · 落 requirement_assessments · 不写需求本体/Base） ----------

const ASSESSMENT_VERDICTS: Record<AssessmentVerdict, { label: string; className: string; hint: string }> = {
  advance: { label: "建议推进", className: "is-advance", hint: "信息足够，可以进入 PRD 编写" },
  hold: { label: "建议暂缓", className: "is-hold", hint: "当前价值或时机不足" },
  investigate: { label: "需要调查", className: "is-investigate", hint: "关键信息不足，先做调查" },
};
const ASSESSMENT_CONFIDENCES: Record<AssessmentConfidence, string> = { high: "高", medium: "中", low: "低" };

function assessmentWaitLabel(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

/** 评估失败提示：沿用 intake 口径；429 读 Retry-After 说明还要等多久。 */
function assessmentErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return "评估生成失败，请重试。";
  if (cause.status === 429) {
    if (!cause.retryAfterSeconds) return cause.message;
    return `${cause.message}（还需等待约 ${assessmentWaitLabel(cause.retryAfterSeconds)}）`;
  }
  if (cause.status === 500) return "服务端暂时无法完成这次评估，请稍后重试。";
  if (cause.status === 503) return "服务暂时不可用，请稍后重试；已保存的评估不受影响。";
  return cause.message;
}

/** 单条评估结论：按契约 v0 渲染，未知/缺失字段显示「未提供」，不补造内容。 */
function AssessmentResult({ assessment }: { assessment: RequirementAssessment }) {
  const promptBodyId = useId();
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => { setPromptOpen(false); setCopied(false); setCopyError(null); }, [assessment.id]);
  useEffect(() => () => { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }, []);

  const output = assessment.output;
  if (assessment.status === "running") {
    return <ArcoAlert className="rq-inline-alert" type="info" showIcon role="status" title="这一版正在生成" content="生成完成后会自动刷新；期间请勿重复生成。" />;
  }
  if (assessment.status !== "succeeded" || !output) {
    return <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="本次评估没有生成可用结论" content={`${assessment.errorCode ? `错误码：${assessment.errorCode}。` : "服务端未返回评估内容。"}调整补充内容后可重新生成。`} />;
  }

  const prompt = analysisText(output.investigationPrompt) ?? "";
  const verdict = output.verdict && ASSESSMENT_VERDICTS[output.verdict] ? output.verdict : null;
  const verdictColor = verdict === "advance" ? "green" : verdict === "hold" ? "orange" : verdict === "investigate" ? "arcoblue" : "gray";
  const confidence = typeof output.confidence === "string" ? (ASSESSMENT_CONFIDENCES as Record<string, string>)[output.confidence] ?? null : null;
  const scopeIn = analysisStrings(output.scope?.in);
  const scopeOut = analysisStrings(output.scope?.out);
  const assumptions = analysisStrings(output.assumptions);
  const openQuestions = analysisStrings(output.openQuestions);
  const feasibility = output.feasibility ?? { technical: "", cost: "", dependency: "", risk: "" };
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true); setCopyError(null);
      ArcoMessage.success("已复制提示词");
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch { setCopyError("复制失败，请展开后手动选中复制。"); }
  };

  return <div className="assessment-result">
    <div className="assessment-verdict-row">
      {verdict ? <ArcoTag color={verdictColor} title={ASSESSMENT_VERDICTS[verdict].hint}>{ASSESSMENT_VERDICTS[verdict].label}</ArcoTag> : <ArcoTag>未给出结论</ArcoTag>}
      {confidence ? <ArcoTag>置信度：{confidence}</ArcoTag> : null}
      <span className="subtle-text">v{assessment.version} · {timeLabel(assessment.createdAt)}{assessment.promptVersion ? ` · ${assessment.promptVersion}` : ""}{assessment.model ? ` · ${assessment.model}` : ""}</span>
    </div>
    <p className="subtle-text" style={{ margin: 0 }}>AI 建议，非结论；请结合下方依据与待确认问题人工判断。</p>
    <ArcoGrid.Row gutter={[12, 12]}>
      <ArcoGrid.Col xs={24} md={8}><ArcoCard size="small" className="rq-subcard" title="背景"><p style={{ margin: 0 }}>{analysisText(output.background) ?? "未提供"}</p></ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={8}><ArcoCard size="small" className="rq-subcard" title="目标"><p style={{ margin: 0 }}>{analysisText(output.goal) ?? "未提供"}</p></ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={8}><ArcoCard size="small" className="rq-subcard" title="业务价值"><p style={{ margin: 0 }}>{analysisText(output.value) ?? "未提供"}</p></ArcoCard></ArcoGrid.Col>
    </ArcoGrid.Row>
    <ArcoGrid.Row gutter={[12, 12]}>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="范围：要做">{scopeIn.length ? <ul className="rq-compact-list">{scopeIn.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="subtle-text">未提供</p>}</ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="范围：不做">{scopeOut.length ? <ul className="rq-compact-list">{scopeOut.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="subtle-text">未提供</p>}</ArcoCard></ArcoGrid.Col>
    </ArcoGrid.Row>
    <ArcoCard size="small" className="rq-subcard" title="可行性">
      <ArcoDescriptions
        size="small"
        column={{ xs: 1, sm: 2 }}
        data={[
          { label: "技术", value: analysisText(feasibility.technical) ?? "未提供" },
          { label: "成本", value: analysisText(feasibility.cost) ?? "未提供" },
          { label: "依赖", value: analysisText(feasibility.dependency) ?? "未提供" },
          { label: "风险", value: analysisText(feasibility.risk) ?? "未提供" },
        ]}
      />
    </ArcoCard>
    {verdict ? <ArcoCard size="small" className="rq-subcard" title="结论依据"><p style={{ margin: 0 }}>{analysisText(output.verdictReason) ?? "未提供"}</p></ArcoCard> : null}
    <ArcoGrid.Row gutter={[12, 12]}>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="假设（AI 推断）">{assumptions.length ? <ul className="rq-compact-list">{assumptions.map((item, index) => <li key={index}><ArcoTag size="small" color="orange" style={{ marginRight: 6 }}>假设</ArcoTag>{item.replace(/^(假设|推断)[：:]\s*/, "")}</li>)}</ul> : <p className="subtle-text">未列出假设</p>}</ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="待确认问题">{openQuestions.length ? <ol className="rq-compact-list">{openQuestions.map((item, index) => <li key={index}>{item}</li>)}</ol> : <p className="subtle-text">暂无待确认问题</p>}</ArcoCard></ArcoGrid.Col>
    </ArcoGrid.Row>
    {prompt ? <ArcoCard
      size="small"
      className="rq-subcard"
      title={<strong>Investigation 提示词</strong>}
      extra={
        <ArcoSpace size={8}>
          <ArcoButton type="secondary" size="small" htmlType="button" aria-expanded={promptOpen} aria-controls={promptBodyId} onClick={() => setPromptOpen((open) => !open)}>{promptOpen ? "收起提示词" : "展开提示词"}</ArcoButton>
          <ArcoButton size="small" type="primary" htmlType="button" onClick={() => void copyPrompt()}>{copied ? "已复制" : "复制提示词"}</ArcoButton>
        </ArcoSpace>
      }
    >
      <ArcoTypography.Text type="secondary" className="rq-caption">复制后带到你的 Agent 继续调查、写 PRD</ArcoTypography.Text>
      {promptOpen && <pre className="prd-prompt-text is-expanded" id={promptBodyId}>{prompt}</pre>}
      {copyError ? <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" content={copyError} /> : null}
    </ArcoCard> : null}
  </div>;
}

/**
 * 需求评估区：补充背景/目标/场景后按需生成；
 * 历史版本来自独立表，不修改需求本体，也不回写 Base。
 */
/**
 * 评估是同步模型调用，服务端单次上限取 AI_TIMEOUT_MS（线上 120s）；客户端留 5s 余量。
 * 即便超时也不直接判失败：服务端可能仍在重试并最终落库成功，超时后按版本号核对。
 */
const ASSESSMENT_CLIENT_TIMEOUT_MS = 125_000;
/** 超时后核对最新评估版本的窗口：覆盖服务端失败重试的剩余时间。 */
const ASSESSMENT_RECONCILE_WINDOW_MS = 90_000;

function RequirementAssessmentSection({
  requirementId,
  onSaved,
  onAssessmentsChange,
}: {
  requirementId: string;
  onSaved?: () => void;
  /** 将评估历史实时同步给同页的 PRD 提示词块，避免重复请求 GET /assessments。 */
  onAssessmentsChange?: (state: { items: RequirementAssessment[]; loaded: boolean; error: string | null }) => void;
}) {
  const [history, setHistory] = useState<RequirementAssessment[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [background, setBackground] = useState("");
  const [goal, setGoal] = useState("");
  const [scenario, setScenario] = useState("");
  const [inputsDirty, setInputsDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 切版本后回填的版本号：提示「已载入 vN 的输入，可改后重新生成」。
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  // 首次打开详情时默认载入最新版本的输入；静默轮询/用户已开始输入时不覆盖。
  const pendingInitialInputs = useRef(true);
  const inputsEdited = useRef(false);
  // 超时后待核对的一轮生成：记录发起前的最大版本号，只有更新的成功版本才算本轮成功。
  const pendingRecovery = useRef<{ baselineVersion: number } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const loadRequestVersion = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const generateControllerRef = useRef<AbortController | null>(null);
  // 父组件每次渲染都会传新的内联回调，用 ref 保存以免重建 load 触发挂载 effect 循环。
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  const onAssessmentsChangeRef = useRef(onAssessmentsChange);
  useEffect(() => { onAssessmentsChangeRef.current = onAssessmentsChange; }, [onAssessmentsChange]);

  useUnsavedGuard(inputsDirty);

  useEffect(() => {
    onAssessmentsChangeRef.current?.({
      items: history,
      loaded: loadState !== "loading",
      error: loadState === "error" ? loadError : null,
    });
  }, [history, loadState, loadError]);

  const applyInputs = useCallback((assessment: RequirementAssessment) => {
    const inputs = assessment.inputs ?? { background: "", goal: "", scenario: "" };
    setBackground(inputs.background ?? "");
    setGoal(inputs.goal ?? "");
    setScenario(inputs.scenario ?? "");
    setInputsDirty(false);
  }, []);

  // preferLatest：生成失败后刷新时直接选中最新（失败）版本，避免结论区还停在旧版本。
  const load = useCallback(async (silent = false, preferLatest = false) => {
    const version = ++loadRequestVersion.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    if (!silent) { setLoadState("loading"); setLoadError(null); }
    try {
      // 防御：历史接口若返回错形状（如被通用列表路由兜底），不把无 version 的条目当成评估版本。
      const items = (await listRequirementAssessments(requirementId, undefined, controller.signal)).filter((item) => item && typeof item.version === "number");
      if (version !== loadRequestVersion.current) return;
      const latest = items.reduce((max, item) => Math.max(max, item.version), 0) || null;
      // 超时核对：只有比发起时更新的成功版本才算本轮成功，避免把旧版本误当成新结果。
      const pending = pendingRecovery.current;
      if (pending) {
        const newer = items.filter((item) => item.version > pending.baselineVersion);
        const succeeded = newer.filter((item) => item.status === "succeeded").sort((left, right) => right.version - left.version)[0];
        if (succeeded) {
          pendingRecovery.current = null;
          setReconciling(false);
          setError(null);
          setNotice(`评估 v${succeeded.version} 已生成。`);
          onSavedRef.current?.();
        } else if (newer.length > 0 && !newer.some((item) => item.status === "running")) {
          // 本轮已结束但没有成功版本：按失败展示最新版，错误码来自历史记录。
          const newest = newer.reduce((left, right) => (right.version > left.version ? right : left));
          pendingRecovery.current = null;
          setReconciling(false);
          setNotice(null);
          setError(`评估 v${newest.version} 生成失败（${newest.errorCode ?? "未知原因"}）。`);
        }
      }
      setHistory(items);
      setSelectedVersion((current) => preferLatest || current === null || !items.some((item) => item.version === current)
        ? latest
        : current);
      // PRD 4.10.7：打开详情时默认带上最新版本的补充输入；只在首次成功载入时做，静默刷新不覆盖草稿。
      if (pendingInitialInputs.current && items.length > 0) {
        pendingInitialInputs.current = false;
        if (!inputsEdited.current) applyInputs(items.reduce((left, right) => (right.version > left.version ? right : left)));
      }
      setLoadState("ready");
    } catch (cause) {
      if (version !== loadRequestVersion.current || isAbortError(cause)) return;
      if (!silent) { setLoadError(errorText(cause)); setLoadState("error"); }
    }
  }, [applyInputs, requirementId]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestVersion.current += 1;
      loadControllerRef.current?.abort();
    };
  }, [load]);

  // 有 running 版本或超时核对中时每 5 秒静默刷新一次：生成完成后自动换成结论，期间保持按钮禁用。
  const hasRunning = history.some((item) => item.status === "running");
  useEffect(() => {
    if (!hasRunning && !reconciling) return;
    const timer = window.setInterval(() => { void load(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [hasRunning, reconciling, load]);

  // 超时核对的兜底窗口：过了这段时间仍没有更新的版本，也不判失败（平台最坏 3×120s），
  // 只提示服务端仍在生成；保留待核对标记，已有 running 行时后续轮询仍能补解锁。
  useEffect(() => {
    if (!reconciling) return;
    const timer = window.setTimeout(() => {
      if (!pendingRecovery.current) return;
      setReconciling(false);
      setError(null);
      setNotice("服务端仍在生成，请稍后刷新查看。");
    }, ASSESSMENT_RECONCILE_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [reconciling]);

  // 409 单飞提示保留一小段时间：避免服务端 running 行还没被历史接口返回时按钮立刻可点。
  useEffect(() => {
    if (!conflict) return;
    const timer = window.setTimeout(() => setConflict(false), 15000);
    return () => window.clearTimeout(timer);
  }, [conflict]);

  // 后台轮询看到 running 结束（成功或失败）后，解除 409 的等待提示，避免残留「正在生成」。
  const sawRunning = useRef(false);
  useEffect(() => {
    if (hasRunning) { sawRunning.current = true; return; }
    if (!sawRunning.current) return;
    sawRunning.current = false;
    setConflict(false);
    setNotice((current) => current === "正在生成，请稍候。" ? null : current);
  }, [hasRunning]);

  // 切换需求时清空草稿输入与待核对状态，避免把上一条需求的背景或恢复状态带过去；下一条继续默认载入自己的最新输入。
  useEffect(() => {
    generateControllerRef.current?.abort();
    generateControllerRef.current = null;
    pendingRecovery.current = null;
    setReconciling(false);
    setConflict(false);
    setBusy(false);
    setBackground(""); setGoal(""); setScenario(""); setInputsDirty(false); setError(null); setNotice(null); setLoadedVersion(null);
    pendingInitialInputs.current = true;
    inputsEdited.current = false;
    return () => {
      generateControllerRef.current?.abort();
      generateControllerRef.current = null;
    };
  }, [requirementId]);

  const versions = [...history].sort((left, right) => right.version - left.version);
  const selected = versions.find((item) => item.version === selectedVersion) ?? versions[0] ?? null;

  // 切版本：把该版本的 inputs 载入输入框（可改后重新生成），不做只读锁。
  const switchVersion = (version: number) => {
    setSelectedVersion(version);
    const target = history.find((item) => item.version === version);
    if (!target) return;
    applyInputs(target);
    setLoadedVersion(version);
  };

  const generate = async () => {
    // 三项补充都可为空（PRD 4.10.3：全空也允许生成，结果更多落到 investigate）。
    const inputs = { background: background.trim(), goal: goal.trim(), scenario: scenario.trim() };
    setBusy(true); setError(null); setNotice(null); setLoadedVersion(null);
    // 用户已经主动填写/生成，之后不再用历史版本覆盖输入框。
    pendingInitialInputs.current = false;
    // 记录发起前的最大版本号：超时后只有更新的成功版本才算本轮结果。
    const baselineVersion = versions.reduce((max, item) => Math.max(max, item.version), 0);
    pendingRecovery.current = { baselineVersion };
    setReconciling(false);
    const controller = new AbortController();
    generateControllerRef.current = controller;
    let timedOut = false;
    // 服务端模型超时取 AI_TIMEOUT_MS（线上 120s），客户端留 5s 余量；超时后仍会核对落库结果。
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, ASSESSMENT_CLIENT_TIMEOUT_MS);
    try {
      const created = await createRequirementAssessment(requirementId, inputs, undefined, controller.signal);
      if (generateControllerRef.current !== controller) return;
      // 请求正常返回：本轮已有明确结果，不再走超时核对。
      pendingRecovery.current = null;
      setReconciling(false);
      setHistory((previous) => [created, ...previous.filter((item) => item.version !== created.version)]);
      setSelectedVersion(created.version);
      setInputsDirty(false);
      setNotice(created.status === "succeeded"
        ? `评估 v${created.version} 已生成。`
        : `评估 v${created.version} 生成失败（${created.errorCode ?? "未知原因"}）。`);
      // 同页的 PRD 提示词块按「是否有成功评估」解锁；生成完立刻通知它重新拉取，不必刷新页面。
      onSavedRef.current?.();
    } catch (cause) {
      if (generateControllerRef.current !== controller) return;
      // 同一需求已有未超时的 running 版本（409 单飞）：提示等待并禁用按钮，不重复烧 token。
      if (cause instanceof ApiError && cause.status === 409) {
        pendingRecovery.current = null;
        setReconciling(false);
        setConflict(true);
        setNotice("正在生成，请稍候。");
        setError(null);
        void load(true);
      } else if (timedOut) {
        // 客户端先超时不等于服务端失败：服务端可能仍在重试并已落库成功。
        // 先不报失败，按版本号核对；确认成功就补 onSaved 解锁提示词块，窗口内没有结果才提示超时。
        setError(null);
        setNotice("评估生成较慢，正在核对最新结果…");
        setReconciling(true);
        void load(true, true);
      } else {
        // 429/503/500 由服务端保留 failed 版本：静默刷新历史并选中最新版本，
        // 避免用户只看到报错、却在版本列表里找不到这次失败记录。
        pendingRecovery.current = null;
        setReconciling(false);
        setError(assessmentErrorMessage(cause));
        void load(true, true);
      }
    } finally {
      window.clearTimeout(timer);
      if (generateControllerRef.current === controller) {
        generateControllerRef.current = null;
        setBusy(false);
      }
    }
  };

  return <ArcoCard
    className="rq-card req-section req-assessment-section"
    aria-labelledby="req-assessment-heading"
    title={<h3 id="req-assessment-heading" className="rq-section-heading">需求评估</h3>}
    extra={<ArcoTag>AI 建议 · 非结论 · 按需生成</ArcoTag>}
  >
    <p className="detail-note">补充背景、目标、使用场景后生成评估；补充内容只保存在评估记录里，不修改需求本体，也不写 Base。评估按需生成，不会自动消耗模型调用。</p>
    <ArcoForm layout="vertical" className="rq-compact-form">
      <ArcoGrid.Row gutter={[12, 0]}>
        <ArcoGrid.Col xs={24} md={8}><ArcoForm.Item label="需求背景（不超过 2000 字）"><ArcoInput.TextArea aria-label="需求背景" rows={3} maxLength={2000} showWordLimit value={background} onChange={(value: string) => { inputsEdited.current = true; setInputsDirty(true); setBackground(value); }} disabled={busy} placeholder="为什么要做：用户场景、当前问题、触发来源。" /></ArcoForm.Item></ArcoGrid.Col>
        <ArcoGrid.Col xs={24} md={8}><ArcoForm.Item label="目标（不超过 1000 字）"><ArcoInput.TextArea aria-label="需求目标" rows={3} maxLength={1000} showWordLimit value={goal} onChange={(value: string) => { inputsEdited.current = true; setInputsDirty(true); setGoal(value); }} disabled={busy} placeholder="希望达成什么结果；尽量可度量。" /></ArcoForm.Item></ArcoGrid.Col>
        <ArcoGrid.Col xs={24} md={8}><ArcoForm.Item label="使用场景（不超过 2000 字）"><ArcoInput.TextArea aria-label="使用场景" rows={3} maxLength={2000} showWordLimit value={scenario} onChange={(value: string) => { inputsEdited.current = true; setInputsDirty(true); setScenario(value); }} disabled={busy} placeholder="谁在什么情况下使用；包含环境、硬件型号、频率等约束。" /></ArcoForm.Item></ArcoGrid.Col>
      </ArcoGrid.Row>
    </ArcoForm>
    {loadedVersion !== null ? <ArcoAlert className="rq-inline-alert" type="info" showIcon role="status" content={`已载入 v${loadedVersion} 的输入，可改后重新生成。`} /> : null}
    <ArcoSpace size={10} wrap align="center" className="rq-action-bar">
      <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void generate()} disabled={busy || conflict || hasRunning}>{busy ? "生成中…（约 30 秒）" : conflict || hasRunning ? "正在生成，请稍候" : "生成评估"}</ArcoButton>
      {loadState === "loading" ? <span className="subtle-text">正在读取评估历史…</span> : null}
      {loadState === "error" ? <div role="alert" style={{ display: "inline-flex" }}><ArcoSpace size={6}><ArcoTypography.Text type="error">评估历史读取失败：{loadError}</ArcoTypography.Text><ArcoButton type="text" size="small" htmlType="button" onClick={() => void load()}>重试</ArcoButton></ArcoSpace></div> : null}
      {versions.length > 0 ? (
        <ArcoRadio.Group
          type="button"
          size="small"
          aria-label="评估版本"
          value={selected?.version}
          onChange={(val: number) => switchVersion(val)}
          options={versions.map((item) => ({
            label: `v${item.version}${item.status === "running" ? " 生成中" : item.status !== "succeeded" ? "（失败）" : ""}`,
            value: item.version,
          }))}
        />
      ) : null}
    </ArcoSpace>
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    {selected ? <AssessmentResult assessment={selected} /> : loadState === "ready" ? <ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>还没有评估结果</strong><span>补充背景、目标或使用场景后生成第一版。</span></div>} /> : null}
  </ArcoCard>;
}

/**
 * PRD-31：多维表格来源的详情只读展示相似需求。
 * R8 两段查询：先用整条标题；0 条且标题超过 8 字时，去掉【…】前缀取前 8 字再查一次。
 * 每次渲染最多 2 次请求，2s 超时或失败静默隐藏，不写 duplicate_of、不自动压制。
 */
function SimilarRequirementSection({ requirementId, title }: { requirementId: string; title: string }) {
  const [items, setItems] = useState<RequirementSummary[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let cancelled = false;
    setItems([]);

    // 单次查询：2s 超时中断；异常交给 run() 统一静默隐藏。
    const search = async (query: string) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      const timer = window.setTimeout(() => controller.abort(), 2000);
      try {
        const result = await listRequirements({ q: query, limit: 5, processingState: "active", signal: controller.signal });
        return result.items;
      } finally {
        window.clearTimeout(timer);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    };

    const run = async () => {
      const fullTitle = title.trim();
      if (!fullTitle) return;
      const matches = (await search(fullTitle)).filter((item) => item.id !== requirementId);
      if (cancelled) return;
      if (matches.length > 0) { setItems(matches.slice(0, 5)); return; }
      // 第二段只对长标题生效；避免与第一段完全相同的查询。
      if (Array.from(fullTitle).length <= 8) return;
      const fallbackQuery = Array.from(fullTitle.replace(/^【[^】]*】\s*/, "")).slice(0, 8).join("").trim();
      if (!fallbackQuery || fallbackQuery === fullTitle) return;
      const fallbackMatches = (await search(fallbackQuery)).filter((item) => item.id !== requirementId);
      if (!cancelled) setItems(fallbackMatches.slice(0, 5));
    };

    void run().catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; controllerRef.current?.abort(); };
  }, [requirementId, title]);

  // 0 条、查询中、超时或失败都整块不渲染（PRD-31 C）。
  if (items.length === 0) return null;
  return <ArcoCard
    className="rq-card req-section req-similar-section"
    aria-labelledby="req-similar-heading"
    title={<h3 id="req-similar-heading" className="rq-section-heading">相似需求（只读，仅供参考）</h3>}
    extra={<ArcoTag>按标题关键字匹配</ArcoTag>}
  >
    <p className="detail-note">相似需求只作参考：不会写回重复判定、不自动压制，也不影响本条需求的编辑与推送。</p>
    <ul className="rq-compact-list">
      {items.map((item) => <li key={item.id}>
        <a href={`?requirement=${item.id}`} target="_blank" rel="noreferrer">{item.platformRequirementId ? `${item.platformRequirementId} · ` : ""}{item.title}</a>
        <span className="subtle-text"> · {requirementSourceName(item)}</span>
      </li>)}
    </ul>
  </ArcoCard>;
}

function RequirementDetailPage({ detail, detailId, loading, error, notice, busy, autoOpenOwnerPicker, onCloseNotice, onBack, onRefresh, onAct, onSaved, onDelete, canDelete = false, onRestore, canRestore = false, restoreBusy = false }: {
  detail: RequirementDetail | null;
  detailId: string;
  loading: boolean;
  error: string | null;
  notice: string | null;
  busy: boolean;
  autoOpenOwnerPicker: boolean;
  onCloseNotice: () => void;
  onBack: () => void;
  onRefresh: () => void;
  onAct: (action: () => Promise<string>, detailId: string) => Promise<boolean>;
  onSaved: (id: string) => void;
  /** PRD §4.13：只有当前有效负责人可见「移入回收站」。 */
  onDelete?: () => void;
  canDelete?: boolean;
  onRestore?: (id: string) => Promise<void>;
  canRestore?: boolean;
  restoreBusy?: boolean;
}) {
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(autoOpenOwnerPicker);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  // 由 RequirementAssessmentSection 统一拉取评估历史并共享给 PrdPromptSection，消除详情页打开时的重复 GET /assessments 请求。
  const [sharedAssessments, setSharedAssessments] = useState<{ items: RequirementAssessment[]; loaded: boolean; error: string | null }>({ items: [], loaded: false, error: null });
  const ownerEditorId = useId();
  useEffect(() => { setOwnerPickerOpen(autoOpenOwnerPicker); }, [detail?.id, autoOpenOwnerPicker]);
  useEffect(() => {
    setDescriptionExpanded(false);
    setSharedAssessments({ items: [], loaded: false, error: null });
  }, [detail?.id]);

  if (!detail) {
    return <div className="req-detail-page">
      <ArcoCard className="rq-card req-detail-summary">
        <div style={{ marginBottom: 12 }}><ArcoButton htmlType="button" onClick={onBack} type="secondary" size="small"><ArrowLeft size={14} />返回需求池</ArcoButton></div>
        <h2 className="req-summary-title">{loading ? <SkeletonBlock className="skeleton-title" /> : "无法载入需求详情"}</h2>
        <span className="mono-cell">REQ {detailId.slice(0, 8)}</span>
      </ArcoCard>
      {loading && <RequirementDetailSkeleton />}
      <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />
      {!loading && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={onRefresh} type="secondary" size="small"><RefreshCw size={14} />重试载入</ArcoButton></div>}
    </div>;
  }

  const structured: AnalysisStructured = (detail.analysis ?? {}) as AnalysisStructured;
  const facts = requirementSourceFacts(detail);
  // 5c-1：详情来源说明与列表徽标一致；TB 是默认来源，没有徽标但有同样的来源行。
  const sourceInfo = requirementSourceInfo({ sourceType: detail.sourceType, sourceChannel: detail.sourceChannel, source: detail.source });
  const sourceLabel = sourceInfo?.name ?? "Teambition";
  // 非 Teambition 来源没有 TB 执行人/状态/链接/更新时间：详情只保留有值的提出人，避免一整排「—」。
  const sourceKind = sourceInfo?.kind ?? "teambition";
  const isTbSource = sourceKind === "teambition";
  const owner = requirementOwnerView(detail);
  // P1 重复处理：压制态需求不进入 AI 分析 / Base 推送 / 通知，相关操作入口必须一并收敛。
  const processingState = requirementProcessingState(detail);
  const suppressed = processingState !== "active";
  const suppressedLabel = processingStateLabels[processingState];
  // PRD §4.13.7：已删除详情只读；只有删除人能看到还原入口，其余动作一律不渲染。
  const deleted = Boolean(detail.deletedAt) || detail.lifecycleState === "deleted";
  if (deleted) {
    return <div className="req-detail-page req-deleted-detail">
      <ArcoCard className="rq-card req-detail-summary">
        <div className="req-summary-backbar" style={{ marginBottom: 12 }}><ArcoButton htmlType="button" onClick={onBack} type="secondary" size="small"><ArrowLeft size={14} />返回</ArcoButton></div>
        <h2 className="req-summary-title" style={{ marginBottom: 0 }}>
          <span>{detail.title}</span>
          {" "}
          <ArcoTag size="small">已删除</ArcoTag>
          {detail.pool === "group" ? <>{" "}{poolChip("group")}</> : null}
        </h2>
        <div className="mono-cell" style={{ marginTop: 4 }}>{detail.platformRequirementId ?? (detail.sourceRequirementId ? `REQ-${detail.sourceRequirementId.slice(0, 8)}` : "WEB")} · v{detail.sourceVersion}</div>
        <div className="req-summary-meta">
          <ArcoSpace size={16} wrap>
            <span className="subtle-text">删除时间：{detail.deletedAt ? timeLabel(detail.deletedAt) : "—"}</span>
            <span className="subtle-text">删除前处理状态：{suppressedLabel}</span>
          </ArcoSpace>
          <div role="group" aria-label="已删除需求操作">
            <ArcoSpace size={8}>
              {canRestore ? <ArcoButton type="primary" size="small" htmlType="button" loading={restoreBusy} onClick={() => void onRestore?.(detail.id)}>还原需求</ArcoButton> : null}
              <ArcoButton htmlType="button" onClick={onRefresh} disabled={busy || restoreBusy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
            </ArcoSpace>
          </div>
        </div>
        <p className="detail-note">已删除需求只读：编辑、负责人、重复判定、AI 分析、评估、提示词、评分与 Base 推送均已停止；飞书 Base 中的历史行保留原样。</p>
      </ArcoCard>
      <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />
      <ArcoCard
        className="rq-card req-section"
        aria-labelledby="req-l1-heading"
        title={<h3 id="req-l1-heading" className="rq-section-heading">需求信息</h3>}
        extra={<ArcoTag>{sourceLabel}</ArcoTag>}
      >
        <div className="req-field">
          <ArcoTypography.Text type="secondary" className="rq-caption">标题</ArcoTypography.Text>
          <p className="req-l1-title">{detail.title}</p>
        </div>
        <div className="req-field req-description-field">
          <ArcoTypography.Text type="secondary" className="rq-caption">描述</ArcoTypography.Text>
          {facts.description ? <p className="req-description is-expanded">{facts.description}</p> : <span className="req-empty-value">—</span>}
        </div>
        <ArcoDescriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          data={[
            { label: "池", value: poolChip(detail.pool) },
            { label: "来源", value: sourceLabel },
            { label: "删除时间", value: detail.deletedAt ? timeLabel(detail.deletedAt) : "—" },
            { label: "删除前处理状态", value: suppressedLabel },
          ]}
        />
      </ArcoCard>
    </div>;
  }
  const evidence = analysisStrings(structured.evidence);
  const factItems = Array.isArray(structured.facts)
    ? (structured.facts as { text?: unknown }[]).map((fact) => analysisText(fact.text)).filter((text): text is string => text !== null)
    : [];
  const inferenceItems = Array.isArray(structured.inferences)
    ? (structured.inferences as { text?: unknown }[]).map((inference) => analysisText(inference.text)).filter((text): text is string => text !== null)
    : [];
  const missingInputs = analysisStrings(structured.missing_inputs);
  const blindSpots = analysisStrings(structured.blind_spots);
  interface AdviceCard { label: string; conclusion: string; rationale?: string | null; evidence?: string[]; missing?: boolean }
  // V02-T08：六层人群与类型建议；旧分析缺字段 → 未提供/待判断，不推断“不适用”。
  const AUDIENCE_NAMES: Record<string, string> = { L1: "L1 职业级 Pro", L2: "L2 竞技级 Racing", L3: "L3 爱好者/专业入门", L4: "L4 健身锻炼", L5: "L5 休闲娱乐", L6: "L6 通勤代步" };
  const audienceItems = Array.isArray(structured.audience)
    ? (structured.audience as { level?: unknown; reason?: unknown }[]).filter((item) => typeof item.level === "string")
    : null;
  const typeSuggestion = analysisText(structured.typeSuggestion);
  const adviceCards: AdviceCard[] = [
    { label: "模块建议", conclusion: analysisText(structured.module) ?? "—" },
    { label: "类型建议", conclusion: typeSuggestion ?? (structured.typeSuggestion === undefined ? "未提供（旧版本分析）" : "待判断") },
    {
      label: "适用人群建议",
      conclusion: audienceItems === null ? "未提供（旧版本分析）" : audienceItems.length ? audienceItems.map((item) => AUDIENCE_NAMES[String(item.level)] ?? String(item.level)).join("、") : "待判断",
      rationale: audienceItems === null ? null : audienceItems.map((item) => `${AUDIENCE_NAMES[String(item.level)] ?? item.level}：${typeof item.reason === "string" ? item.reason : ""}`).join("；") || null,
    },
    { label: "整体置信度", conclusion: analysisText(structured.confidence) ?? "—", rationale: analysisText(structured.confidence_reason) },
  ];

  // 操作可用性只取决于流水线状态；不可用时保留按钮并说明原因，避免「入口消失 = 不知道能做什么」。
  // 压制态（重复/忽略）不进入 AI 分析、Base 推送与通知：所有会入队的入口保持禁用，撤销判定后恢复。
  const analysisRetryable = !suppressed && ["failed_retryable", "pending", "analyzed"].includes(detail.pipeline.analysis);
  const analysisActionLabel = detail.pipeline.analysis === "analyzed" ? "重新分析" : "重试 AI 分析";
  const pushRetryable = !suppressed && detail.pipeline.push === "failed";
  const ownerMapped = ["auto_mapped", "manually_mapped"].includes(detail.pipeline.owner);
  const ownerSaveLabel = detail.pipeline.owner === "pending_mapping" ? "保存负责人并入队推送" : ownerMapped ? "变更负责人并入队推送" : "分配负责人并入队推送";
  const analysisDisabledReason = suppressed
    ? "该需求已被压制，不会进入 AI 分析；如需分析请先在「重复处理」撤销判定。"
    : detail.pipeline.analysis === "running"
      ? "AI 分析正在进行中，完成后可查看结果。"
      : detail.pipeline.analysis === "analyzed"
        ? "重新分析会基于当前已发布的词典/规则创建新版本。"
        : detail.pipeline.analysis === "failed"
          ? "该需求的分析失败不可自动重试，请检查源数据或联系管理员。"
          : "当前状态不可重试 AI 分析。";
  const pushDisabledReason = suppressed
    ? "该需求已被压制，不会进入 Base 推送；如需推送请先在「重复处理」撤销判定。"
    : detail.pipeline.push === "pushed"
      ? "Base 推送已完成，无需重试；PM 在飞书多维表格继续处理。"
      : detail.pipeline.push === "running"
        ? "Base 推送进行中，完成后刷新详情可看到最新状态。"
        : detail.pipeline.push === "pending"
          ? "Base 推送排队中，完成后刷新详情可看到最新状态。"
          : "当前状态不可重试 Base 推送。";
  // 没有可重试项时也要给出一句明确的下一步说明，而不是留白。
  // 「可重跑」包含 already analyzed；指引不能把已完成的分析说成未完成。
  const analysisIncomplete = ["pending", "failed_retryable", "running"].includes(detail.pipeline.analysis);
  const guidance = (suppressed
    ? [`该需求已被压制（${suppressedLabel}）：不会进入 AI 分析、Base 推送与通知；如需恢复请在下方「重复处理」撤销判定。`]
    : [
      detail.pipeline.push === "pushed" ? "该需求已推送完成，PM 在飞书多维表格继续处理；如需换人可在此变更负责人。" : "",
      pushRetryable ? (ownerMapped ? "Base 推送失败：可重试推送，也可变更负责人后重新排队。" : "Base 推送失败：请先分配负责人，再重试推送。") : "",
      analysisIncomplete ? (detail.pipeline.analysis === "running" ? "AI 分析正在进行中；完成后刷新查看结果。" : "AI 分析未完成，可在此重试分析。") : "",
      detail.pipeline.analysis === "failed" ? "AI 分析失败且不可自动重试；失败摘要见「查看依据与历史」中的分析版本记录。" : "",
    ]).filter(Boolean).join(" ") || "当前没有待重试的失败项；如需换人可在此变更负责人。";

  // TB「创建时间」仍取源快照；底部「这条需求怎么来的」取服务端创建时间（平台收录时间，四种来源一致，F1）。
  const sourceCreatedAt = formatDateTime(facts.createdAt);
  const platformCreatedAt = formatDateTime(detail.createdAt ?? null) ?? sourceCreatedAt;
  const updatedAt = formatDateTime(facts.updatedAt);
  const analysisVersions = [...detail.analyses].reverse();
  const failedAnalysis = analysisVersions.find((version) => version.safeErrorSummary !== null);
  const failureText = detail.pipeline.push === "failed"
    ? "Base 推送失败。可在详情页点「重试 Base 推送」；AI 分析失败是另一条独立链路，不影响推送。"
    : detail.pipeline.analysis === "failed" || detail.pipeline.analysis === "failed_retryable"
      ? failedAnalysis?.safeErrorSummary ?? "AI 分析失败（接口未返回失败摘要）。"
      : null;
  const pushTime = formatDateTime(detail.lastPushedAt ?? null);
  const stages: Array<[PipelineStage, string]> = [["pull", detail.pipeline.pull], ["analysis", detail.pipeline.analysis], ["owner", detail.pipeline.owner], ["push", detail.pipeline.push]];
  const summaryCurrent = detail.scoring?.current ?? null;
  const summaryAi = detail.scoring?.aiSuggestion ?? null;
  const summaryScore = summaryCurrent ?? summaryAi;
  const dimensionInsights: DimensionInsight[] = [
    { key: "U", recommendation: analysisText(structured.recommendations?.user?.recommendation), rationale: analysisText(structured.recommendations?.user?.rationale), evidence: analysisStrings(structured.recommendations?.user?.evidence), missing: structured.recommendations?.user?.missing_evidence === true },
    { key: "M", recommendation: analysisText(structured.recommendations?.market?.recommendation), rationale: analysisText(structured.recommendations?.market?.rationale), evidence: analysisStrings(structured.recommendations?.market?.evidence), missing: structured.recommendations?.market?.missing_evidence === true },
    { key: "S", recommendation: analysisText(structured.recommendations?.business?.recommendation), rationale: analysisText(structured.recommendations?.business?.rationale), evidence: analysisStrings(structured.recommendations?.business?.evidence), missing: structured.recommendations?.business?.missing_evidence === true },
    { key: "C", recommendation: analysisText(structured.recommendations?.technology?.recommendation), rationale: analysisText(structured.recommendations?.technology?.rationale), evidence: analysisStrings(structured.recommendations?.technology?.evidence), missing: structured.recommendations?.technology?.missing_evidence === true },
  ];
  const audienceSuggestedTags = audienceItems?.map((item) => String(item.level)).filter((level) => Boolean(AUDIENCE_NAMES[level])) ?? [];
  const audienceEditor = <div className="score-analysis-subsection audience-analysis-block">
    <div className="score-analysis-subhead"><h5>适用人群</h5><span>AI 建议仅供参考；PM 确认值单独保存</span></div>
    <AudienceEditor requirementId={detail.id} audience={detail.audience ?? { tags: [], confirmed: false, version: 0 }} suggestedTags={audienceSuggestedTags} onSaved={() => onSaved(detail.id)} />
  </div>;
  const aiAnalysisBody = detail.analysis
    ? <>
      <div className="score-analysis-subsection">
        <div className="score-input-head"><h5>模块、类型与整体判断</h5><ArcoTypography.Text type="secondary" className="rq-caption">AI 生成 · 可被推翻</ArcoTypography.Text></div>
        <ArcoGrid.Row gutter={[12, 12]} className="advice-grid">
          {adviceCards.map((card) => (
            <ArcoGrid.Col key={card.label} xs={24} sm={12}>
              <ArcoCard size="small" className="rq-subcard advice-card">
                <ArcoTypography.Text type="secondary" className="rq-caption">{card.label}</ArcoTypography.Text>
                <div style={{ marginTop: 4 }}><strong>{card.conclusion}</strong></div>
                {card.rationale && <p className="detail-note">理由：{card.rationale}</p>}
                {card.evidence && card.evidence.length > 0 && <p className="detail-note">证据：{card.evidence.join("；")}</p>}
                {card.missing && <ArcoTag size="small" color="orange" style={{ marginTop: 6 }}>需要补充信息</ArcoTag>}
              </ArcoCard>
            </ArcoGrid.Col>
          ))}
        </ArcoGrid.Row>
      </div>
    </>
    : <ArcoEmpty
        className="rq-empty"
        description={
          <div className="rq-empty-copy">
            <strong>尚未分析</strong>
            <span>{detail.pipeline.analysis === "running" ? "AI 分析正在进行中；完成后刷新查看结果。" : "该需求还没有可用的 AI 分析结果。"}</span>
            <ArcoSpace size={8}>
              <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void onAct(async () => { await retryAnalysis(detail.id); return "AI 分析重试已入队"; }, detail.id)} disabled={busy || !analysisRetryable} title={analysisRetryable ? "提交 AI 分析（会消耗一次模型调用）" : analysisDisabledReason}>{analysisActionLabel}</ArcoButton>
              <span className="subtle-text">会消耗一次模型调用</span>
            </ArcoSpace>
          </div>
        }
      />;
  const aiAnalysisContent = <>{audienceEditor}{aiAnalysisBody}<div className="rq-action-bar"><BetaPanel requirementId={detail.id} /></div></>;

  return <div className="req-detail-page">
    <ArcoCard className="rq-card req-detail-summary">
      <div className="req-summary-backbar" style={{ marginBottom: 12 }}><ArcoButton htmlType="button" onClick={onBack} type="secondary" size="small"><ArrowLeft size={14} />返回需求池</ArcoButton></div>
      <div className="req-summary-top">
        <div className="req-summary-heading">
          <h2 className="req-summary-title" style={{ marginBottom: 0 }}>
            <span>{detail.title}</span>
            {detail.pool === "group" ? <>{" "}{poolChip("group")}</> : null}
          </h2>
          <div className="mono-cell" style={{ marginTop: 4 }}>{detail.platformRequirementId ?? (detail.sourceRequirementId ? `REQ-${detail.sourceRequirementId.slice(0, 8)}` : "WEB")} · v{detail.sourceVersion}</div>
          {detail.duplicateOf && <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="note" content={<>该需求与另一条需求标题相同，仅作疑似重复提示；两条记录仍按各自的来源 ID 独立保留，是否压制由人工判定决定。<a href={`?requirement=${detail.duplicateOf}`}>查看另一条</a></>} />}
          {detail.duplicates && detail.duplicates.length > 0 && <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="note" content={<>发现 {detail.duplicates.length} 条同标题疑似重复需求：{detail.duplicates.map((duplicate, index) => <span key={duplicate.id}>{index > 0 ? "、" : ""}<a href={`?requirement=${duplicate.id}`}>{duplicate.title}</a></span>)}。这些记录均独立保留；可在下方「重复处理」确认重复或忽略，被压制记录不再进入 AI 分析、Base 推送与通知。</>} />}
        </div>
        <div className="req-summary-score" aria-label="评分与优先级摘要">
          <ArcoTypography.Text type="secondary" className="rq-caption">{summaryCurrent ? "当前综合评分" : summaryAi ? "AI 建议" : "综合评分"}</ArcoTypography.Text>
          {summaryScore ? <>
            <div className="summary-score-line">
              <strong>{summaryScore.score.toFixed(2)}</strong>
              <ArcoTag color={PRIORITY_TAG_COLORS[summaryScore.priority] ?? "gray"}>{summaryScore.priority}</ArcoTag>
            </div>
            <ArcoTypography.Text type="secondary" className="rq-caption">v{summaryScore.version} · {scoreOriginLabel(summaryScore.origin)}{summaryScore.scoreConfidence ? ` · ${summaryScore.scoreConfidence}置信度` : ""}</ArcoTypography.Text>
            <ArcoButton type="text" size="small" htmlType="button" onClick={() => scrollToSection("req-scoring-heading")}>查看评分与依据</ArcoButton>
          </> : <div><strong>暂无评分</strong><div className="subtle-text">AI 分析后生成，或手动填写</div></div>}
        </div>
      </div>
      <div className="req-summary-meta">
        <ArcoSpace size={8} align="center" wrap>
          <ArcoTypography.Text type="secondary">负责人</ArcoTypography.Text>
          <OwnerBadge owner={owner} />
          {detail.manualOwner && <ArcoTag size="small" color="arcoblue" title="只影响这一条需求，不会改动同 TB 执行人的其他需求">手动指定</ArcoTag>}
          {detail.manualOwner && <ArcoButton type="text" size="small" disabled={busy || suppressed} title={suppressed ? "已压制需求不会推送；请先撤销判定" : undefined} onClick={() => void onAct(async () => {
            const result = await clearOwner(detail.id);
            return `已恢复默认负责人（${pipelineLabel("owner", result.ownerState)}）${result.status === "queued" ? "，Base 推送已排队" : "；等待默认负责人映射"}`;
          }, detail.id)} htmlType="button">恢复默认负责人</ArcoButton>}
        </ArcoSpace>
        <div className="req-stage-row" role="group" aria-label="处理状态">{stages.map(([stage, state]) => <StageBadge key={stage} stage={stage} state={state} />)}</div>
        <div role="group" aria-label="需求操作">
          <ArcoSpace size={8} wrap>
            <ArcoButton htmlType="button" aria-expanded={ownerPickerOpen} aria-controls={ownerEditorId} onClick={() => setOwnerPickerOpen((open) => !open)} disabled={busy || suppressed} type="primary" size="small">{suppressed ? "分配 / 变更负责人（已压制）" : "分配 / 变更负责人"}</ArcoButton>
            <ArcoTooltip content={analysisRetryable ? "重新提交 AI 分析（会消耗一次模型调用）" : analysisDisabledReason}>
              <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void onAct(async () => { await retryAnalysis(detail.id); return "AI 分析重试已入队"; }, detail.id)} disabled={busy || !analysisRetryable} title={analysisRetryable ? "重新提交 AI 分析（会消耗一次模型调用）" : analysisDisabledReason}>{analysisActionLabel}</ArcoButton>
            </ArcoTooltip>
            <span className="subtle-text">会消耗一次模型调用</span>
            <ArcoTooltip content={pushRetryable ? "重新提交 Base 推送" : pushDisabledReason}>
              <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void onAct(async () => { const result = await pushRequirement(detail.id); return result.status === "queued" ? "Base 推送重试已入队" : `推送状态：${result.status}`; }, detail.id)} disabled={busy || !pushRetryable} title={pushRetryable ? "重新提交 Base 推送" : pushDisabledReason}>重试 Base 推送</ArcoButton>
            </ArcoTooltip>
            {canDelete && onDelete ? <ArcoButton type="outline" htmlType="button" size="small" status="danger" onClick={onDelete}>移入回收站</ArcoButton> : null}
            <ArcoButton htmlType="button" onClick={onRefresh} disabled={busy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
          </ArcoSpace>
        </div>
      </div>
      <p className="detail-note">{guidance}</p>
      {ownerPickerOpen && !suppressed && <div className="detail-owner-editor" id={ownerEditorId}>
        <p className="detail-note" style={{ marginTop: 0, marginBottom: 8 }}>只修改当前这一条需求的负责人，不会改动同 TB 执行人名下的其他需求或全局映射；保存后重新排队 Base 推送。{detail.manualOwner ? "点击「恢复默认负责人」可回到 TB 执行人映射。" : ""}</p>
        <FeishuUserPicker key={detail.id} disabled={busy} saveLabel={ownerSaveLabel} onMap={async (user) => {
          const ok = await onAct(async () => {
            const result = await setOwner(detail.id, { feishuUserId: user.feishuUserId, feishuIdType: user.feishuIdType, tbDisplayName: user.name });
            return `${user.name} 负责人已${ownerMapped ? "变更" : "分配"}（${pipelineLabel("owner", result.ownerState)}），推送已排队`;
          }, detail.id);
          if (ok) setOwnerPickerOpen(false);
        }} />
      </div>}
    </ArcoCard>

    <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />

    {detail.sourceMissingSince && <ArcoAlert type="warning" showIcon role="status" content={`该需求的 Teambition 来源记录已不在最近一次全量同步中（${timeLabel(detail.sourceMissingSince)} 起未出现）。记录与处理状态保留；如来源恢复出现，标记会自动清除。`} />}
    {suppressed && <ArcoAlert
      className="suppressed-detail-banner"
      type="error"
      showIcon
      role="alert"
      title={`该需求已被压制（${suppressedLabel}）`}
      content="被压制的需求不会进入 AI 分析、Base 推送与通知；记录仍保留。请在下方「重复处理」撤销判定后恢复为活跃。"
      action={<ArcoButton type="secondary" htmlType="button" size="small" onClick={() => scrollToSection("req-duplicate-heading")}>前往撤销判定</ArcoButton>}
    />}

    <ArcoCard
      className="rq-card req-section"
      aria-labelledby="req-l1-heading"
      title={<h3 id="req-l1-heading" className="rq-section-heading">需求信息</h3>}
      extra={<ArcoTag>{sourceInfo?.note ?? "来自 Teambition"}</ArcoTag>}
    >
      <div className="req-field">
        <TbFieldLabel kind={sourceKind}>标题</TbFieldLabel>
        <p className="req-l1-title">{detail.title}</p>
      </div>
      <div className="req-field req-description-field">
        <TbFieldLabel kind={sourceKind}>描述</TbFieldLabel>
        {facts.description ? <>
          <p className={`req-description${descriptionExpanded ? " is-expanded" : ""}`}>{facts.description}</p>
          {facts.description.length > 140 && <ArcoButton type="text" size="small" htmlType="button" onClick={() => setDescriptionExpanded((expanded) => !expanded)}>{descriptionExpanded ? "收起描述" : "展开全部"}</ArcoButton>}
        </> : <span className="req-empty-value" title="Teambition 未提供该字段">—</span>}
      </div>
      {(isTbSource || facts.proposerName) ? (
        <ArcoDescriptions
          size="small"
          column={{ xs: 1, sm: 2, md: 3 }}
          style={{ marginTop: 12 }}
          data={[
            { label: <TbFieldLabel kind={sourceKind}>提出人</TbFieldLabel>, value: <SourceValue value={facts.proposerName} /> },
            ...(isTbSource ? [
              { label: <TbFieldLabel kind={sourceKind}>执行人</TbFieldLabel>, value: <SourceValue value={facts.executorName} /> },
              { label: <TbFieldLabel kind={sourceKind}>状态</TbFieldLabel>, value: <SourceValue value={facts.tbStatus} emptyHint="Teambition 未提供该字段；工作台不推断状态名称" /> },
              { label: <TbFieldLabel kind={sourceKind}>链接</TbFieldLabel>, value: <SourceValue value={facts.tbUrl} href emptyHint="Teambition 未提供该字段" /> },
              { label: <TbFieldLabel kind={sourceKind}>创建时间</TbFieldLabel>, value: <SourceValue value={sourceCreatedAt} emptyHint="Teambition 未提供该字段" /> },
              { label: <TbFieldLabel kind={sourceKind}>更新时间</TbFieldLabel>, value: <SourceValue value={updatedAt ?? facts.updatedAt} emptyHint="Teambition 未提供该字段" /> },
            ] : []),
          ]}
        />
      ) : null}
      {(detail.intakeModule || detail.productModel || detail.requirementType || detail.constraintNotes || detail.supplementUrl) ? (
        <ArcoDescriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          style={{ marginTop: 12 }}
          title="录入上下文"
          data={[
            ...(detail.intakeModule ? [{ label: "模块（录入）", value: detail.intakeModule }] : []),
            ...(detail.productModel ? [{ label: "产品/型号", value: detail.productModel }] : []),
            ...(detail.requirementType ? [{ label: "需求类型（录入）", value: detail.requirementType }] : []),
            ...(detail.constraintNotes ? [{ label: "边界/限制", value: detail.constraintNotes }] : []),
            ...(detail.supplementUrl ? [{ label: "来源链接", value: safeHttpUrl(detail.supplementUrl) ? <a href={safeHttpUrl(detail.supplementUrl)!} target="_blank" rel="noreferrer">{detail.supplementUrl}</a> : detail.supplementUrl }] : []),
          ]}
        />
      ) : null}
      <ManualEditSection detail={detail} onSaved={() => onSaved(detail.id)} />
    </ArcoCard>

    {/* 决策按 (来源配置, TB 需求ID) 保存，非 Teambition 来源没有这个身份、后端会 404：仅 TB 显示。
        PRD-31：base_form 详情改为只读展示相似需求；手工/聊天粘贴不展示重复处理。 */}
    {isTbSource
      ? <DuplicateDecisionSection detail={detail} onSaved={() => onSaved(detail.id)} />
      : sourceKind === "base_form"
        ? <SimilarRequirementSection requirementId={detail.id} title={detail.title} />
        : null}

    <ScoringPanel requirementId={detail.id} scoring={detail.scoring} dimensionInsights={dimensionInsights} onSaved={() => onSaved(detail.id)}>
      {aiAnalysisContent}
    </ScoringPanel>

    <PriorityOverrideSection detail={detail} onSaved={() => onSaved(detail.id)} />

    <AnalysisContextSection detail={detail} onSaved={() => onSaved(detail.id)} />

    <RequirementAssessmentSection requirementId={detail.id} onAssessmentsChange={setSharedAssessments} />
    <PrdPromptSection
      key={detail.id}
      requirementId={detail.id}
      sharedAssessments={sharedAssessments.items}
      sharedAssessmentsLoaded={sharedAssessments.loaded}
      sharedAssessmentsError={sharedAssessments.error}
    />

    <ArcoCard
      className="rq-card req-section"
      aria-labelledby="req-status-heading"
      title={<h3 id="req-status-heading" className="rq-section-heading">处理与推送</h3>}
      extra={<ArcoTag>系统状态</ArcoTag>}
    >
      <ArcoDescriptions
        size="small"
        column={{ xs: 1, sm: 2 }}
        data={[
          { label: "四阶段状态", value: <div className="req-stage-row">{stages.map(([stage, state]) => <StageBadge key={stage} stage={stage} state={state} />)}</div> },
          { label: "负责人映射方式", value: pipelineLabel("owner", detail.pipeline.owner) },
          { label: "Base 记录", value: <BaseRecordReference recordId={detail.baseRecordId} url={detail.baseRecordUrl ?? null} /> },
          { label: "推送时间", value: pushTime ?? <span className="req-empty-value" title="接口未返回推送时间">—</span> },
          { label: "最近一次失败", value: failureText ?? <span className="req-empty-value" title="没有最近失败记录">—</span> },
        ]}
      />
      <p className="detail-note">推送成功不代表飞书 PM 通知已送达；PM 处理状态与通知送达以飞书多维表格为准。</p>
    </ArcoCard>

    <ArcoCard className="rq-card req-section req-audit-section">
      <Collapse className="req-audit" defaultActiveKey={[]}>
        <Collapse.Item name="requirement-audit" header="查看依据与历史">
          <ArcoDescriptions
            size="small"
            layout="vertical"
            column={{ xs: 1, sm: 2 }}
            data={[
              { label: "原文证据", value: <TextList items={evidence} /> },
              { label: "事实（来自源文本）", value: <TextList items={factItems} /> },
              { label: "AI 推断（非事实）", value: <TextList items={inferenceItems} prefix="【AI 推断】" /> },
              { label: "缺失信息", value: <TextList items={missingInputs} /> },
              { label: "分析盲点", value: <TextList items={blindSpots} /> },
              { label: "Base 记录号", value: detail.baseRecordId ? <code className="base-ref-id">{detail.baseRecordId}</code> : <span className="req-empty-value">尚未写入飞书 Base</span> },
            ]}
          />
          <ArcoDivider className="rq-compact-divider" />
          <div className="req-source-snapshot">
            <ArcoTypography.Text type="secondary" className="rq-caption">源快照（只读 JSON）</ArcoTypography.Text>
            <pre className="source-snapshot-pre">{JSON.stringify(detail.source ?? {}, null, 2)}</pre>
          </div>
          <ArcoDivider className="rq-compact-divider" />
          <h4 className="req-audit-title" style={{ marginBottom: 8 }}>分析版本历史</h4>
          {analysisVersions.length
            ? <ArcoTable<AnalysisVersionSummary>
              rowKey="analysisVersion"
              data={analysisVersions}
              pagination={false}
              border={false}
              columns={[
                { title: "分析版本", dataIndex: "analysisVersion", width: 100, render: (_value, version) => <span className="mono-cell">v{version.analysisVersion}</span> },
                { title: "状态", dataIndex: "status", width: 120, render: (_value, version) => <StageBadge stage="analysis" state={version.status} /> },
                { title: "模块", dataIndex: "moduleSuggestion", render: (_value, version) => version.moduleSuggestion ?? "—" },
                { title: "优先级", dataIndex: "priority", width: 100, render: (_value, version) => version.priority ?? "空" },
                { title: "开始时间", dataIndex: "startedAt", width: 180, render: (_value, version) => timeLabel(version.startedAt) },
                { title: "失败摘要", dataIndex: "safeErrorSummary", render: (_value, version) => version.safeErrorSummary ?? "—" },
              ]}
            />
            : <p className="req-empty-value">尚无分析版本历史</p>}
        </Collapse.Item>
      </Collapse>
    </ArcoCard>
    {/* 5c-1：详情底部只读区块，回答「这条需求怎么来的」。不展示 Base 表 ID / record URL / 原始 payload。 */}
    <div className="req-origin-line" aria-label="这条需求怎么来的">
      <strong>这条需求怎么来的</strong>
      <span><em>来源</em>{sourceLabel}</span>
      <span><em>来源渠道</em>{detail.sourceChannel || "未填写"}</span>
      <span><em>提出人</em>{facts.proposerName || "未填写"}</span>
      <span><em>创建时间</em>{platformCreatedAt ?? "未填写"}</span>
    </div>
  </div>;
}

type RequirementSourceKind = "base_form" | "web_manual" | "chat_paste";

/** 5c-1：来源判定。Teambition 是默认来源（返回 null）；聊天粘贴按 source_payload.intakeOrigin 区分。 */
function requirementSourceKind(row: { sourceType?: string | null; source?: Record<string, unknown> | null }): RequirementSourceKind | null {
  // 兼容旧响应：没有 sourceType 的记录按 Teambition 处理（历史行默认来源）。
  const sourceType = row.sourceType ? String(row.sourceType) : "teambition";
  if (sourceType === "base_form") return "base_form";
  if (sourceType === "web_manual") {
    const origin = row.source && typeof row.source === "object" ? row.source.intakeOrigin : undefined;
    return origin === "chat_paste" ? "chat_paste" : "web_manual";
  }
  return null;
}

/**
 * 5c-1：来源徽标/说明。Teambition 不挂徽标（默认来源，332/333 都是它）；
 * 其余来源的文案带渠道细分（如「多维表格·销售」），扫视时能直接看出从哪来。
 */
function requirementSourceInfo(row: { sourceType?: string | null; sourceChannel?: string | null; source?: Record<string, unknown> | null }): { kind: RequirementSourceKind; name: string; channel: string | null; note: string } | null {
  const kind = requirementSourceKind(row);
  if (!kind) return null;
  const name = kind === "chat_paste" ? "聊天粘贴" : kind === "web_manual" ? "手工" : "多维表格";
  // 渠道为空时只显示来源名：不出现「·null」「·undefined」或空括号。
  const channel = typeof row.sourceChannel === "string" && row.sourceChannel.trim() !== "" ? row.sourceChannel.trim() : null;
  const noteName = kind === "web_manual" ? "手工录入" : name;
  return { kind, name, channel, note: `来自${noteName}${channel ? ` · ${channel}` : ""}` };
}

function isRowActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea"));
}

const SOURCE_TAG_COLORS: Record<RequirementSourceKind, string> = { base_form: "arcoblue", chat_paste: "purple", web_manual: "orange" };
const BADGE_TAG_COLOR = (className: string) => className === "status-danger" ? "red" : className === "status-warning" ? "orange" : "gray";

const RequirementsTable = memo(function RequirementsTable({ rows, loading, showSource = true, showPool = false, emptyState, onOpen, onAssign, onDelete }: { rows: RequirementSummary[]; loading: boolean; showSource?: boolean; showPool?: boolean; emptyState?: { title: string; description: string }; onOpen: (row: RequirementSummary) => void; onAssign: (row: RequirementSummary) => void; onDelete?: (row: RequirementSummary) => void }) {
  const columns = useMemo(() => [
    {
      title: "需求标题",
      dataIndex: "title",
      render: (_value: unknown, row: RequirementSummary) => {
        const badge = processingBadge(row);
        const suppressed = requirementProcessingState(row) !== "active";
        const sourceInfo = showSource ? requirementSourceInfo(row) : null;
        return <ArcoSpace size={6} wrap align="center" className="req-row-title-cell">
          <span className="req-row-title" title={row.title}>{row.title}</span>
          {sourceInfo ? <ArcoTag size="small" color={SOURCE_TAG_COLORS[sourceInfo.kind]} className="source-badge" title={sourceInfo.note}>{sourceInfo.name}{sourceInfo.channel ? `·${sourceInfo.channel}` : ""}</ArcoTag> : null}
          {showPool ? poolChip(row.pool) : null}
          {badge ? <ArcoTag size="small" color={BADGE_TAG_COLOR(badge.className)} className="processing-badge" title={badge.title}>{badge.label}</ArcoTag> : null}
          {row.sourceMissingSince ? <ArcoTag size="small" className="processing-badge" title={`上次全量同步（${timeLabel(row.sourceMissingSince)}）未再出现该 TB 需求；记录保留，处理与推送状态不变`}>来源已移除</ArcoTag> : null}
          {suppressed ? <span className="sr-only">（已压制：不进入 AI 分析/Base 推送/通知）</span> : null}
        </ArcoSpace>;
      },
    },
    {
      title: "优先级",
      dataIndex: "effectivePriority",
      width: 96,
      render: (_value: unknown, row: RequirementSummary) => row.effectivePriority
        ? <ArcoTag size="small" color={PRIORITY_TAG_COLORS[row.effectivePriority] ?? "gray"} title={row.priorityOverride ? `人工覆盖：${row.priorityOverride.priority}（${row.priorityOverride.reason}）` : "当前评分建议"}>{row.effectivePriority}{row.priorityOverride ? " *" : ""}</ArcoTag>
        : <span className="req-empty-value">—</span>,
    },
    {
      title: "负责人",
      dataIndex: "executorName",
      width: 170,
      render: (_value: unknown, row: RequirementSummary) => {
        const owner = requirementOwnerView(row);
        return <ArcoButton type="text" size="small" className="owner-cell-button" title={owner.unassigned ? "分配负责人" : "变更负责人"}
          onClick={(event) => { event.stopPropagation(); onAssign(row); }} htmlType="button">
          <OwnerBadge owner={owner} />
          <span className="owner-cell-edit">{owner.unassigned ? "分配" : "变更"}</span>
        </ArcoButton>;
      },
    },
    {
      title: "处理状态",
      dataIndex: "pipeline",
      width: 300,
      render: (_value: unknown, row: RequirementSummary) => <ArcoSpace size={[4, 4]} wrap className="req-row-stages">
        {([["pull", row.pipeline.pull], ["analysis", row.pipeline.analysis], ["owner", row.pipeline.owner], ["push", row.pipeline.push]] as const).map(([stage, state]) => <StageBadge key={stage} stage={stage as PipelineStage} state={state} />)}
      </ArcoSpace>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (_value: unknown, row: RequirementSummary) => {
        const time = requirementTime(row);
        const timeText = formatDateTime(time.value);
        return <span className="req-row-time" title={timeText ? (time.fallbackToCreated ? "接口未返回更新时间，显示 Teambition 创建时间" : time.value ?? undefined) : "接口未返回更新时间"}>{timeText ?? <span className="req-empty-value">—</span>}</span>;
      },
    },
    {
      title: "操作",
      dataIndex: "id",
      width: 120,
      render: (_value: unknown, row: RequirementSummary) => {
        const owner = requirementOwnerView(row);
        return <ArcoSpace size={4} className="req-row-action">
          {owner.unassigned ? <ArcoButton htmlType="button" onClick={() => onAssign(row)} type="text" size="small">分配</ArcoButton> : null}
          {onDelete ? <ArcoButton type="text" status="danger" size="small" onClick={(event) => { event.stopPropagation(); onDelete(row); }} htmlType="button">删除</ArcoButton> : null}
        </ArcoSpace>;
      },
    },
  ], [showSource, showPool, onAssign, onDelete]);

  const handleRow = useCallback((row: RequirementSummary) => ({
    style: { cursor: "pointer" },
    tabIndex: 0,
    "aria-label": `${requirementProcessingState(row) !== "active" ? "打开已压制需求" : "打开需求"}：${row.title}`,
    onClick: (event: MouseEvent<HTMLElement>) => { if (!isRowActionTarget(event.target)) onOpen(row); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if ((event.key === "Enter" || event.key === " ") && !isRowActionTarget(event.target)) { event.preventDefault(); onOpen(row); } },
  }), [onOpen]);

  const rowClassName = useCallback((row: RequirementSummary) => {
    const owner = requirementOwnerView(row);
    const suppressed = requirementProcessingState(row) !== "active";
    const sourceKind = showSource ? requirementSourceKind(row) : null;
    // 非默认来源在行首加 3px 竖色条，扫视时比 chip 更快；TB 行不加，避免整屏噪音。
    return `req-row${owner.unassigned ? " is-pending-owner" : ""}${sourceKind ? ` is-source-${sourceKind}` : ""}${suppressed ? " is-suppressed" : ""}`;
  }, [showSource]);

  // 首屏加载骨架屏；空态保留表头（Arco Pro 2.0 Search Table 规范）。
  if (loading && !rows.length) return <SkeletonTableRows rows={6} columns={6} />;
  return <div className="table-scroll req-list-scroll">
    <ArcoTable<RequirementSummary>
      className="req-list"
      rowKey="id"
      scroll={{ x: 1100 }}
      columns={columns}
      data={rows}
      pagination={false}
      border={false}
      noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{emptyState?.title ?? "没有匹配的需求"}</strong><span>{emptyState?.description ?? "数据仅在 API 返回后显示，不使用演示数据。"}</span></div>} />}
      onRow={handleRow}
      rowClassName={rowClassName}
    />
  </div>;
});

// 审计结果列独立渲染（result 枚举 succeeded/failed/denied），不复用流水线阶段标签

export default RequirementsPanel;
