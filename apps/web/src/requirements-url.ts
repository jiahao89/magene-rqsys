/**
 * 需求池的 URL 查询参数契约（design.md 第 8–10 章）。
 *
 * 列表筛选、详情深链都写在同一组查询参数里，刷新与分享 URL 不丢上下文：
 * - 列表筛选：title / owner / pull / analysis / ownerState / push / processingState / batchId / from / to
 * - 详情深链：requirement（复用 deep-link.ts 的语义）
 *
 * 这里只做「字符串 → 状态 → 字符串」的纯映射，不读写 location，
 * 方便测试以及 `history.pushState/replaceState` 的调用方决定历史行为。
 */

export interface RequirementListFilters {
  title: string;
  owner: string;
  pull: string;
  analysis: string;
  ownerState: string;
  push: string;
  /** 重复处理视图：all=全部，active=仅活跃（默认），suppressed=已压制（重复/忽略）。 */
  processingState: RequirementProcessingView;
  /** 优先级分诊视图（2026-11-06）：P0–P3 生效优先级筛选。 */
  priority: string;
  /** 排序：空=默认（仅活跃的注意力排序由前端完成），priority_asc=按生效优先级 P0→P3 分诊。 */
  sort: string;
  batchId: string;
  from: string;
  to: string;
}

/**
 * 重复处理视图的合法取值。
 * 注意 `all` 只存在于 URL/UI 层：请求服务端时省略 processingState 表示不过滤。
 */
export type RequirementProcessingView = "all" | "active" | "suppressed";

/** 默认工作视图：仅活跃（PRD 验收 #27：默认工作视图不包含已压制需求）。 */
export const DEFAULT_PROCESSING_VIEW: RequirementProcessingView = "active";

/** URL 参数 → 重复处理视图；未知值回落到默认视图，避免深链把非法枚举发给服务端。 */
export function parseRequirementProcessingView(value: string | null | undefined): RequirementProcessingView {
  return value === "all" || value === "suppressed" || value === "active" ? value : DEFAULT_PROCESSING_VIEW;
}

const REQUIREMENT_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

/** 非法/未知优先级回落到空（不过滤），避免深链把任意文本发给服务端。 */
export function parseRequirementPriority(value: string | null | undefined): string {
  return value && (REQUIREMENT_PRIORITIES as readonly string[]).includes(value) ? value : "";
}

export const emptyRequirementListFilters: RequirementListFilters = {
  title: "",
  owner: "",
  pull: "",
  analysis: "",
  ownerState: "",
  push: "",
  processingState: DEFAULT_PROCESSING_VIEW,
  priority: "",
  sort: "",
  batchId: "",
  from: "",
  to: "",
};

export const requirementFilterParams = [
  "title",
  "owner",
  "pull",
  "analysis",
  "ownerState",
  "push",
  "processingState",
  "priority",
  "sort",
  "batchId",
  "from",
  "to",
] as const;

export function readRequirementListFilters(search: string): RequirementListFilters {
  const params = new URLSearchParams(search);
  return {
    title: params.get("title")?.trim() ?? "",
    owner: params.get("owner")?.trim() ?? "",
    pull: params.get("pull")?.trim() ?? "",
    analysis: params.get("analysis")?.trim() ?? "",
    ownerState: params.get("ownerState")?.trim() ?? "",
    push: params.get("push")?.trim() ?? "",
    processingState: parseRequirementProcessingView(params.get("processingState")),
    priority: parseRequirementPriority(params.get("priority")),
    sort: params.get("sort") === "priority_asc" ? "priority_asc" : "",
    batchId: params.get("batchId")?.trim() ?? "",
    from: params.get("from")?.trim() ?? "",
    to: params.get("to")?.trim() ?? "",
  };
}

/** 默认视图不算筛选：避免「清除筛选」和筛选计数把默认的「仅活跃」当成用户条件。 */
export function isRequirementFilterApplied(key: typeof requirementFilterParams[number], value: string): boolean {
  if (value === "") return false;
  return !(key === "processingState" && value === DEFAULT_PROCESSING_VIEW);
}

export function hasRequirementListFilters(filters: RequirementListFilters): boolean {
  return requirementFilterParams.some((key) => isRequirementFilterApplied(key, filters[key]));
}

/** 已生效筛选数量，口径与 hasRequirementListFilters 一致。 */
export function requirementFilterCount(filters: RequirementListFilters): number {
  return requirementFilterParams.filter((key) => isRequirementFilterApplied(key, filters[key])).length;
}

/**
 * 生成 `?title=...&requirement=...`。空筛选与空详情都不写入，
 * 因此列表首页/总览不会留下无意义的查询串。
 */
export function buildRequirementPoolSearch(
  filters: RequirementListFilters,
  requirementId?: string | null,
): string {
  const params = new URLSearchParams();
  for (const key of requirementFilterParams) {
    const value = filters[key];
    // 默认视图不写入 URL：无参数即默认（仅活跃），URL 更短且语义稳定。
    if (isRequirementFilterApplied(key, value)) params.set(key, value);
  }
  const requirement = requirementId?.trim();
  if (requirement) params.set("requirement", requirement);
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function requirementPoolUrl(
  pathname: string,
  filters: RequirementListFilters,
  requirementId?: string | null,
  hash = "",
): string {
  const suffix = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${pathname || "/"}${buildRequirementPoolSearch(filters, requirementId)}${suffix}`;
}
