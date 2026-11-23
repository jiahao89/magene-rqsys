// 两仓组件代码保持一致：评估 / 重试 / 规则草稿的调用不显式传全局 fetch。
// 根仓默认 fetcher 是 fetch、妙搭是 backendFetch（平台差异只在 api.ts），显式传 fetch
// 在妙搭会绕过 /app/app_17fqkjwyx1u 前缀落到站点根并 404（2026-11-23「生成评估」实测）。
// 这条用例守住根仓这份同源代码，避免镜像回妙搭时又带上 fetch。
import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import panelsSource from "./panels.tsx?raw";
import apiSource from "./api.ts?raw";

const CALLS = ["createRequirementAssessment", "retrySyncItem", "createPriorityRuleDraft"];

describe("API 调用不显式传全局 fetch", () => {
  for (const [name, source] of [["panels.tsx", panelsSource], ["App.tsx", appSource]] as const) {
    it(`${name} 使用默认 fetcher`, () => {
      expect(source).not.toMatch(/,\s*fetch\s*[,)]/);
      for (const fn of CALLS) {
        expect(source, `${name} 的 ${fn} 调用传了 fetch`).not.toMatch(new RegExp(`${fn}\\([^;]*\\bfetch\\b`));
      }
    });
  }

  it("根仓默认 fetcher 仍是 fetch（平台差异只保留在 api.ts）", () => {
    expect(apiSource).toMatch(/fetcher: typeof fetch = fetch/);
    expect(apiSource).toMatch(/export async function createRequirementAssessment\([\s\S]{0,160}?fetcher: typeof fetch = fetch,/);
    expect(apiSource).toMatch(/export function retrySyncItem\(id: string, fetcher: typeof fetch = fetch/);
  });
});
