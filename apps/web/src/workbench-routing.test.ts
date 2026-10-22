import { describe, expect, it } from "vitest";
import { readRequirementDeepLink } from "./deep-link";
import { readWorkbenchPage, readWorkbenchRoute, workbenchUrl } from "./workbench-routing";

describe("workbench routes", () => {
  it("restores a selected workspace page from the URL fragment", () => {
    expect(readWorkbenchPage("#modules", "")).toBe("Modules");
    expect(readWorkbenchPage("#unknown", "")).toBe("Overview");
  });

  it("maps legacy menu fragments onto the merged pages and tabs", () => {
    // 旧菜单已合并：人员/负责人映射 → 团队管理；同步批次/审计日志 → 同步记录。
    expect(readWorkbenchRoute("#people", "")).toEqual({ page: "Team", tab: "people" });
    expect(readWorkbenchRoute("#mappings", "")).toEqual({ page: "Team", tab: "mappings" });
    expect(readWorkbenchRoute("#batches", "")).toEqual({ page: "SyncRecords", tab: "batches" });
    expect(readWorkbenchRoute("#audit", "")).toEqual({ page: "SyncRecords", tab: "audit" });
    expect(readWorkbenchRoute("#team", "")).toEqual({ page: "Team", tab: null });
    expect(readWorkbenchRoute("#sync-records", "")).toEqual({ page: "SyncRecords", tab: null });
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

  it("builds merged-page routes without the legacy fragments", () => {
    expect(workbenchUrl("/app/app-id", "", "Team")).toBe("/app/app-id#team");
    expect(workbenchUrl("/app/app-id", "", "SyncRecords")).toBe("/app/app-id#sync-records");
  });
});
