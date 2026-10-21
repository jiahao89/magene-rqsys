import { describe, expect, it } from "vitest";
import { readWorkbenchPage, workbenchUrl } from "./workbench-routing";

describe("workbench routes", () => {
  it("restores a selected workspace page from the URL fragment", () => {
    expect(readWorkbenchPage("#modules", "")).toBe("Modules");
    expect(readWorkbenchPage("#unknown", "")).toBe("Overview");
  });

  it("keeps notification deep links on the requirement page", () => {
    expect(readWorkbenchPage("", "?requirement=req-7")).toBe("Requirements");
  });

  it("builds a filtered requirement route without carrying a stale detail id", () => {
    expect(workbenchUrl("/app/app-id", "?requirement=old", "Requirements", { push: "failed" }))
      .toBe("/app/app-id?push=failed#requirements");
  });
});
