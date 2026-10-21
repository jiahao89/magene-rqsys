import { readRequirementDeepLink } from "./deep-link";
import { buildRequirementPoolSearch, emptyRequirementListFilters, type RequirementListFilters } from "./requirements-url";

export type WorkbenchPage = "Overview" | "Requirements" | "Batches" | "Sources" | "Mappings" | "Modules" | "People" | "Rules" | "Audit" | "Guide";

const pageSegments: Record<WorkbenchPage, string> = {
  Overview: "overview",
  Requirements: "requirements",
  Batches: "batches",
  Sources: "sources",
  Mappings: "mappings",
  Modules: "modules",
  People: "people",
  Rules: "rules",
  Audit: "audit",
  Guide: "guide",
};

const pagesBySegment = Object.fromEntries(Object.entries(pageSegments).map(([page, segment]) => [segment, page])) as Record<string, WorkbenchPage>;

export function readWorkbenchPage(hash: string, search: string): WorkbenchPage {
  const segment = hash.replace(/^#/, "").toLowerCase();
  return pagesBySegment[segment] ?? (readRequirementDeepLink(search) ? "Requirements" : "Overview");
}

export function workbenchUrl(
  pathname: string,
  search: string,
  page: WorkbenchPage,
  requirementFilters?: Partial<RequirementListFilters>,
): string {
  const url = new URL(`${pathname || "/"}${search}`, "https://rqsys.local");
  url.hash = `#${pageSegments[page]}`;
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
