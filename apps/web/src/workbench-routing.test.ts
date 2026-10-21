import { describe, expect, it } from "vitest";
import { readRequirementDeepLink } from "./deep-link";
import { readWorkbenchPage, workbenchUrl } from "./workbench-routing";

describe("workbench routes", () => {
  it("restores a selected workspace page from the URL fragment", () => {
    expect(readWorkbenchPage("#modules", "")).toBe("Modules");
    expect(readWorkbenchPage("#unknown", "")).toBe("Overview");
  });

  it("keeps notification deep links on the requirement page", () => {
    expect(readWorkbenchPage("", "?requirement=req-7")).toBe("Requirements");
  });

  it("drops an open detail id when the nav returns to the requirement list", () => {
    // 详情页点左侧「需求池」必须回到列表，而不是因为 requirement 还在而重开详情。
    expect(workbenchUrl("/app/app-id", "?requirement=req-7", "Requirements"))
      .toBe("/app/app-id#requirements");
    expect(readRequirementDeepLink("")).toBeNull();
  });

  it("builds a filtered requirement route without carrying a stale detail id", () => {
    expect(workbenchUrl("/app/app-id", "?requirement=old", "Requirements", { push: "failed" }))
      .toBe("/app/app-id?push=failed#requirements");
  });
});
