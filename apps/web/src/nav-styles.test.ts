// 左侧菜单样式回归：图标+文字必须同行、标签单行省略、度量对齐 Arco。
// 布局换行只有真实浏览器能测，所以这里断言「构造上不可能换行」的 CSS 不变量 +
// 窄侧栏（215px）下的可用宽度，防止后续改样式时把 nowrap / flex-shrink 删掉。
import { describe, expect, it } from "vitest";
import styles from "./styles.css?raw";

/** 取出以 selector 开头的第一条规则块（选择器整段匹配，避免 .nav-item 误命中 .nav-item-label）。 */
function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

function px(css: string, property: string): number {
  const match = css.match(new RegExp(`${property}:\\s*(-?[\\d.]+)px`));
  return match ? Number(match[1]) : Number.NaN;
}

describe("左侧菜单样式", () => {
  it("菜单项度量与 Arco 规范一致（36px 行高、8px 间距、4px 圆角）", () => {
    const item = ruleBlock(styles, ".nav-item");
    expect(item).toContain("gap: 8px");
    expect(item).toContain("min-height: 36px");
    expect(item).toContain("border-radius: var(--rq-radius-sm)");
    // 圆角走 Arco token，--border-radius-medium = 4px。
    expect(styles).toMatch(/--rq-radius-sm:\s*var\(--border-radius-medium\)/);
  });

  it("图标 16px、默认 text-3 语义色、悬停与激活用主色", () => {
    const icon = ruleBlock(styles, ".nav-item > svg");
    expect(icon).toContain("width: 16px");
    expect(icon).toContain("height: 16px");
    expect(icon).toContain("flex: none");
    expect(icon).toContain("color: var(--color-text-3)");

    const activeIcon = ruleBlock(styles, ".nav-item:hover > svg, .nav-item.is-active > svg");
    expect(activeIcon).toContain("color: rgb(var(--primary-6))");

    const hover = ruleBlock(styles, ".nav-item:hover");
    expect(hover).toContain("background: var(--color-fill-2)");
  });

  it("标签单行省略：nowrap + ellipsis + 可收缩，不允许折行", () => {
    const label = ruleBlock(styles, ".nav-item-label");
    expect(label).toContain("min-width: 0");
    expect(label).toContain("overflow: hidden");
    expect(label).toContain("white-space: nowrap");
    expect(label).toContain("text-overflow: ellipsis");
    // flex-basis 0 + min-width 0：文字区域由容器决定，不再按内容最小宽度撑开。
    expect(label).toMatch(/flex:\s*1 1 (auto|0)/);
  });

  it("窄侧栏 215px 下标签仍有 120px 以上单行空间（长标题靠省略号截断）", () => {
    const sidebar = ruleBlock(styles, ".sidebar");
    const item = ruleBlock(styles, ".nav-item");
    const icon = ruleBlock(styles, ".nav-item > svg");

    const horizontalPadding = (block: string) => {
      // 按 CSS padding 简写规则取水平值：1 值 [上下左右]、2 值 [上下 左右]、
      // 3 值 [上 左右 下]、4 值 [上 右 下 左]；0 可以不带单位。
      const shorthand = /padding:\s*([^;]+);/.exec(block);
      if (!shorthand) return Number.NaN;
      const parts = shorthand[1].trim().split(/\s+/).map((value) => (value === "0" ? 0 : Number.parseFloat(value)));
      if (parts.some((value) => !Number.isFinite(value))) return Number.NaN;
      if (parts.length === 1) return parts[0] * 2;
      if (parts.length <= 3) return parts[1] * 2;
      return parts[1] + parts[3];
    };

    const sidebarPadding = horizontalPadding(sidebar); // .sidebar padding: 19px 14px 12px -> 14*2
    const itemPadding = horizontalPadding(item); // .nav-item padding: 0 10px -> 10*2
    const gap = px(item, "gap");
    const iconWidth = px(icon, "width");

    expect([sidebarPadding, itemPadding, gap, iconWidth].every(Number.isFinite)).toBe(true);
    const labelBox = 215 - sidebarPadding - itemPadding - gap - iconWidth;
    // 143px @ 12px 字号 ≈ 11 个全角字；侧栏最长标题「数据源与计划」6 字只需 72px。
    expect(labelBox).toBeGreaterThanOrEqual(120);
    expect(labelBox / 12).toBeGreaterThanOrEqual(6);
  });

  it("重复处理视图与等效组件样式存在（防止整份覆盖 styles.css 时再次丢失）", () => {
    for (const selector of [".badge", ".advice-card", ".processing-view-switch", ".processing-badge", ".suppressed-detail-banner", ".duplicate-current-state", ".duplicate-actions", ".duplicate-form"]) {
      expect(ruleBlock(styles, selector), `缺少规则：${selector}`).not.toBe("");
    }
  });
});
