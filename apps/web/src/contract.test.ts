import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const here = process.cwd();

describe("frontend workspace contract", () => {
  it("uses only existing business API routes and never hardcodes demo workflow records", () => {
    const app = readFileSync(resolve(here, "src/App.tsx"), "utf8");
    const contract = readFileSync(resolve(here, "../../specs/rq-sys-mvp/openapi.yaml"), "utf8");
    const routes = [...app.matchAll(/apiJson<[^>]+>\("(\/api\/[^"]+)"/g)].map((match) => match[1]);

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(contract).toContain(`  ${route.split("?")[0]}:`);
    expect(app).not.toContain("DEMO_REQUIREMENTS");
    expect(app).not.toContain("mockData");
  });
});
