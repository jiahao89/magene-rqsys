import { readRequirementDeepLink } from "./deep-link";
import { buildRequirementPoolSearch, emptyRequirementListFilters, type RequirementListFilters } from "./requirements-url";

// 菜单收敛后的页面：人员与负责人映射合并为「团队管理」，同步批次与审计日志合并为「同步记录」。
export type WorkbenchPage = "Overview" | "MyRequirements" | "Requirements" | "GroupRequirements" | "RecycleBin" | "Team" | "Modules" | "SyncRecords" | "Sources" | "Rules" | "Ops" | "Guide" | "Sop";

// 合并页的页签。旧链接（#people/#mappings/#batches/#audit）继续解析到对应页签。
export type WorkbenchTab = "people" | "mappings" | "batches" | "audit";

const pageSegments: Record<WorkbenchPage, string> = {
  Overview: "overview",
  MyRequirements: "my-requirements",
  Requirements: "requirements",
  GroupRequirements: "group-requirements",
  RecycleBin: "recycle-bin",
  Team: "team",
  Modules: "modules",
  SyncRecords: "sync-records",
  Sources: "sources",
  Rules: "rules",
  Ops: "ops",
  Guide: "guide",
  Sop: "sop",
};

const legacySegments: Record<string, { page: WorkbenchPage; tab: WorkbenchTab }> = {
  people: { page: "Team", tab: "people" },
  mappings: { page: "Team", tab: "mappings" },
  batches: { page: "SyncRecords", tab: "batches" },
  audit: { page: "SyncRecords", tab: "audit" },
};

const pagesBySegment = Object.fromEntries(Object.entries(pageSegments).map(([page, segment]) => [segment, page])) as Record<string, WorkbenchPage>;

export interface WorkbenchRoute {
  page: WorkbenchPage;
  /** 合并页的初始页签；普通页面为 null。 */
  tab: WorkbenchTab | null;
}

export function readWorkbenchRoute(hash: string, search: string): WorkbenchRoute {
  const segment = hash.replace(/^#/, "").toLowerCase();
  const page = pagesBySegment[segment];
  if (page) return { page, tab: null };
  const legacy = legacySegments[segment];
  if (legacy) return { page: legacy.page, tab: legacy.tab };
  // 不带 hash 的深链：stage=mine/recycle 明确落到个人页面；否则沿用需求池。
  if (readRequirementDeepLink(search)) {
    const stage = new URLSearchParams(search).get("stage");
    if (stage === "mine") return { page: "MyRequirements", tab: null };
    if (stage === "recycle") return { page: "RecycleBin", tab: null };
    return { page: "Requirements", tab: null };
  }
  return { page: "Overview", tab: null };
}

export function readWorkbenchPage(hash: string, search: string): WorkbenchPage {
  return readWorkbenchRoute(hash, search).page;
}

export function workbenchUrl(
  pathname: string,
  search: string,
  page: WorkbenchPage,
  requirementFilters?: Partial<RequirementListFilters>,
): string {
  const url = new URL(`${pathname || "/"}${search}`, "https://rqsys.local");
  url.hash = `#${pageSegments[page]}`;
  url.searchParams.delete("stage");
  if (page === "MyRequirements" || page === "RecycleBin") url.searchParams.delete("pool");
  if (requirementFilters) {
    url.search = buildRequirementPoolSearch({ ...emptyRequirementListFilters, ...requirementFilters });
  } else if (page !== "Requirements") {
    url.searchParams.delete("requirement");
  } else {
    // 从详情页点左侧「需求池」应当回到列表：不清掉 requirement 参数，
    // readRequirementDeepLink 会再次把它当成深链并重新打开详情。
    url.searchParams.delete("requirement");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
