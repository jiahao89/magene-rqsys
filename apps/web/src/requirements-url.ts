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
  /** 重复处理视图：""=全部，active=仅活跃，suppressed=已压制（重复/忽略）。 */
  processingState: RequirementProcessingView;
  batchId: string;
  from: string;
  to: string;
}

/** 重复处理视图的合法取值；与服务端 processingState 查询参数取值一致。 */
export type RequirementProcessingView = "" | "active" | "suppressed";

/** URL 参数 → 重复处理视图；未知值回落到「全部」，避免深链把非法枚举发给服务端。 */
export function parseRequirementProcessingView(value: string | null | undefined): RequirementProcessingView {
  return value === "active" || value === "suppressed" ? value : "";
}

export const emptyRequirementListFilters: RequirementListFilters = {
  title: "",
  owner: "",
  pull: "",
  analysis: "",
  ownerState: "",
  push: "",
  processingState: "",
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
    batchId: params.get("batchId")?.trim() ?? "",
    from: params.get("from")?.trim() ?? "",
    to: params.get("to")?.trim() ?? "",
  };
}

export function hasRequirementListFilters(filters: RequirementListFilters): boolean {
  return requirementFilterParams.some((key) => filters[key] !== "");
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
    if (value !== "") params.set(key, value);
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
