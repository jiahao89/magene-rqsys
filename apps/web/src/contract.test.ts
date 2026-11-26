import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const here = process.cwd();

describe("frontend workspace contract", () => {
  it("uses only existing business API routes and never hardcodes demo workflow records", () => {
    const app = readFileSync(resolve(here, "src/App.tsx"), "utf8");
    const api = readFileSync(resolve(here, "src/api.ts"), "utf8");
    const contract = readFileSync(resolve(here, "../../specs/rq-sys-mvp/openapi.yaml"), "utf8");
    const staticRoutes = [...api.matchAll(/(?:requestJson|postJson|putJson|deleteJson|patchJson)(?:<[^>]+>)?\("(\/api\/[^"?$]+)"/g)].map((match) => match[1]!);

    expect(staticRoutes.length).toBeGreaterThan(0);
    for (const route of staticRoutes) expect(contract).toContain(`  ${route}:`);
    expect(app).not.toMatch(/\bfetch\s*\(/);
    expect(app).not.toContain("DEMO_REQUIREMENTS");
    expect(app).not.toContain("mockData");
  });

  it("does not clip Arco dropdown popups mounted on body", () => {
    // Arco 的下拉浮层是挂到 body 的绝对定位节点；body 一旦 overflow-x: clip 会把靠右的下拉裁掉、点不开。
    // git 历史曾把 hidden 改成 clip 触发了这个回归，这里锁住：body 不能用 overflow-x: clip。
    const css = readFileSync(resolve(here, "src/styles.css"), "utf8");
    // 找到声明了 overflow-x 的规则块，确认 body 那一行用的是 hidden 而非 clip。
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*\boverflow-x:[^{}]*)\}/g)) {
      const selectors = rule[1]!;
      if (!/\bbody\b/.test(selectors)) continue;
      expect(rule[2]).not.toContain("overflow-x: clip");
    }
    expect(css).toMatch(/\bbody\b[^{]*\{[^}]*overflow-x:\s*hidden/);
  });
});
