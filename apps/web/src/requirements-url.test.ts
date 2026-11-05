import { describe, expect, it } from "vitest";
import { buildRequirementPoolSearch, emptyRequirementListFilters, hasRequirementListFilters, parseRequirementProcessingView, readRequirementListFilters, requirementFilterCount } from "./requirements-url.js";

describe("requirement processing-state URL contract", () => {
  it("parses known views and defaults to 仅活跃 for missing/unknown values", () => {
    expect(parseRequirementProcessingView("active")).toBe("active");
    expect(parseRequirementProcessingView("suppressed")).toBe("suppressed");
    expect(parseRequirementProcessingView("all")).toBe("all");
    expect(parseRequirementProcessingView("")).toBe("active");
    expect(parseRequirementProcessingView(null)).toBe("active");
    expect(parseRequirementProcessingView("bogus")).toBe("active");
  });

  it("defaults the pool to the active-only work view", () => {
    expect(emptyRequirementListFilters.processingState).toBe("active");
    expect(readRequirementListFilters("").processingState).toBe("active");
    // 默认视图不是“用户筛选”：不显示清除按钮，也不计入已生效数量。
    expect(hasRequirementListFilters(emptyRequirementListFilters)).toBe(false);
    expect(requirementFilterCount(emptyRequirementListFilters)).toBe(0);
    expect(requirementFilterCount({ ...emptyRequirementListFilters, processingState: "all" })).toBe(1);
    expect(requirementFilterCount({ ...emptyRequirementListFilters, processingState: "suppressed" })).toBe(1);
  });

  it("round-trips the processing view through the pool URL", () => {
    const filters = { ...emptyRequirementListFilters, processingState: "suppressed" as const };
    const search = buildRequirementPoolSearch(filters, "req-1");
    expect(search).toContain("processingState=suppressed");
    expect(search).toContain("requirement=req-1");
    expect(readRequirementListFilters(search).processingState).toBe("suppressed");
    const all = buildRequirementPoolSearch({ ...emptyRequirementListFilters, processingState: "all" });
    expect(all).toContain("processingState=all");
    expect(readRequirementListFilters(all).processingState).toBe("all");
  });

  it("does not emit the default processing filter", () => {
    expect(buildRequirementPoolSearch(emptyRequirementListFilters)).toBe("");
    expect(buildRequirementPoolSearch({ ...emptyRequirementListFilters, processingState: "active" })).toBe("");
  });
});
