// 左侧菜单与 Arco Design (Target B) 样式回归：
// 1. 左侧菜单使用原生 Arco Menu（.rq-nav-menu），图标+文字同行、标签单行省略、窄侧栏 215px 不折行；
// 2. 样式完全由 Arco token 驱动：禁止硬编码 hex、禁止手写 html[data-theme="dark"]、禁止 !important 覆盖 .arco-*。
import { describe, expect, it } from "vitest";
import styles from "./styles.css?raw";

function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

function px(css: string, property: string): number {
  const match = css.match(new RegExp(`${property}:\\s*(-?[\\d.]+)px`));
  return match ? Number(match[1]) : Number.NaN;
}

describe("左侧菜单与 Arco Target B 样式", () => {
  it("菜单项度量与 Arco Design Pro 2.0 规范一致（40px 行高、8px 间距、4px 圆角 token）", () => {
    const item = ruleBlock(styles, ".rq-nav-menu .arco-menu-item");
    expect(item).toContain("height: 40px");
    expect(item).toContain("border-radius: var(--rq-radius-sm)");
    expect(styles).toMatch(/--rq-radius-sm:\s*var\(--border-radius-medium\)/);

    const link = ruleBlock(styles, ".nav-item-link");
    expect(link).toContain("display: flex");
    expect(link).toContain("align-items: center");
    expect(link).toContain("gap: 8px");
  });

  it("图标 16px、默认 text-3 语义色、悬停与激活用主色", () => {
    const icon = ruleBlock(styles, ".nav-item-icon");
    expect(icon).toContain("width: 16px");
    expect(icon).toContain("height: 16px");
    expect(icon).toContain("flex: none");
    expect(icon).toContain("color: var(--color-text-3)");

    expect(styles).toMatch(/\.rq-nav-menu \.arco-menu-selected \.nav-item-icon\s*\{[^}]*color:\s*rgb\(var\(--primary-6\)\)/);

    const hover = ruleBlock(styles, ".rq-nav-menu .arco-menu-item:hover");
    expect(hover).toContain("background: var(--color-fill-2)");
  });

  it("标签单行省略：nowrap + ellipsis + 可收缩，不允许折行", () => {
    const label = ruleBlock(styles, ".nav-item-label");
    expect(label).toContain("min-width: 0");
    expect(label).toContain("overflow: hidden");
    expect(label).toContain("white-space: nowrap");
    expect(label).toContain("text-overflow: ellipsis");
    expect(label).toMatch(/flex:\s*1 1 (auto|0)/);
  });

  it("侧栏 220px 下标签仍有 120px 以上单行空间（长标题靠省略号截断）", () => {
    const sidebar = ruleBlock(styles, ".sidebar");
    const item = ruleBlock(styles, ".rq-nav-menu .arco-menu-item");
    const link = ruleBlock(styles, ".nav-item-link");
    const icon = ruleBlock(styles, ".nav-item-icon");

    const horizontalPadding = (block: string) => {
      const shorthand = /padding:\s*([^;]+);/.exec(block);
      if (!shorthand) return Number.NaN;
      const tokens = shorthand[1].trim().replace(/calc\([^)]+\)/g, "0").split(/\s+/);
      const parts = tokens.map((value) => (value === "0" ? 0 : Number.parseFloat(value)));
      if (parts.some((value) => !Number.isFinite(value))) return Number.NaN;
      if (parts.length === 1) return parts[0] * 2;
      if (parts.length <= 3) return parts[1] * 2;
      return parts[1] + parts[3];
    };

    const sidebarPadding = horizontalPadding(sidebar);
    const itemPadding = horizontalPadding(item);
    const gap = px(link, "gap");
    const iconWidth = px(icon, "width");

    expect([sidebarPadding, itemPadding, gap, iconWidth].every(Number.isFinite)).toBe(true);
    const labelBox = 220 - sidebarPadding - itemPadding - gap - iconWidth;
    expect(labelBox).toBeGreaterThanOrEqual(120);
    expect(labelBox / 14).toBeGreaterThanOrEqual(6);
  });

  it("遵循 Arco Design Target B 样式约束（无硬编码 hex、无 html[data-theme] 覆盖、无 !important、--rq-* 声明在 body 而非 :root）", () => {
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(styles).not.toMatch(/html\[data-theme=/);
    expect(styles).not.toMatch(/!important/);
    // Arco Design 将 --color-* / --primary-* / --border-radius-* 声明在 body 上，不能在 :root 中引用。
    expect(styles).not.toMatch(/:root\s*\{[^}]*var\(--(?:color-|primary-|border-radius-)/);
    const body = ruleBlock(styles, "body");
    expect(body).toContain("--rq-surface: var(--color-bg-2)");
    expect(body).toContain("--rq-border: var(--color-border-2)");
    expect(body).toContain("--rq-primary: rgb(var(--primary-6))");
    expect(body).toContain("--rq-radius-sm: var(--border-radius-medium)");
    expect(body).toContain("background: var(--color-fill-2)");
    expect(styles).toMatch(/body\[arco-theme="dark"\]\s*\{\s*background:\s*var\(--color-bg-1\);\s*\}/);
    expect(ruleBlock(styles, ".arco-btn")).toContain("display: inline-flex");
    // 窄屏（1000px）表格不撑破内容区：外层只做宽度约束，横向滚动交给表格自身的滚动容器。
    expect(styles).toMatch(/\.table-scroll\s*\{[^}]*max-width:\s*100%/);
    expect(styles).toMatch(/\.table-scroll\s*\{[^}]*min-width:\s*0/);
  });
});
