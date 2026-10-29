import { describe, expect, it } from "vitest";
import { buildRequirementPoolSearch, emptyRequirementListFilters, parseRequirementProcessingView, readRequirementListFilters } from "./requirements-url.js";

describe("requirement processing-state URL contract", () => {
  it("parses only known views and falls back to 全部 for unknown values", () => {
    expect(parseRequirementProcessingView("active")).toBe("active");
    expect(parseRequirementProcessingView("suppressed")).toBe("suppressed");
    expect(parseRequirementProcessingView("")).toBe("");
    expect(parseRequirementProcessingView(null)).toBe("");
    expect(parseRequirementProcessingView("bogus")).toBe("");
  });

  it("round-trips the processing view through the pool URL", () => {
    const filters = { ...emptyRequirementListFilters, processingState: "suppressed" as const };
    const search = buildRequirementPoolSearch(filters, "req-1");
    expect(search).toContain("processingState=suppressed");
    expect(search).toContain("requirement=req-1");
    expect(readRequirementListFilters(search).processingState).toBe("suppressed");
  });

  it("does not emit an empty processing filter", () => {
    expect(buildRequirementPoolSearch(emptyRequirementListFilters)).toBe("");
  });
});
