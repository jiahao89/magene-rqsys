// 回归锁：Arco 的 Select 不能包在 <label> 里。
// label 会把点击转发给内部第一个可标记控件（Arco Select 的隐藏 input），
// 导致真实浏览器里点下拉框没有任何反应；可访问名由 Select 自己的 aria-label 提供。
// 2026-11-19 卡点：需求池工具栏 8 个筛选、模块责任人、重复判定/优先级覆盖、
// 新建需求表单与手工编辑表单里的 5 个 Select 都是这个结构。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SELECT_INSIDE_LABEL = /<label\b[^>]*>(?:(?!<\/label>)[\s\S])*<ArcoSelect\b/;

describe("Arco Select label wrapping", () => {
  it("detects both the broken and the fixed wrapper shape", () => {
    expect(SELECT_INSIDE_LABEL.test('<label className="qfield"><ArcoSelect aria-label="x" /></label>')).toBe(true);
    expect(SELECT_INSIDE_LABEL.test('<div className="qfield"><ArcoSelect aria-label="x" /></div>')).toBe(false);
    expect(SELECT_INSIDE_LABEL.test('<label className="field"><span>标题</span><input /></label><div><ArcoSelect /></div>')).toBe(false);
  });

  it("never nests an Arco Select inside a <label> in workbench sources", () => {
    const dir = join(process.cwd(), "src");
    const files = readdirSync(dir).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => SELECT_INSIDE_LABEL.test(readFileSync(join(dir, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
