# ADR-002：工作台与妙搭客户端采用 Arco Design（2026-11-26 升级至目标 B）

- **状态**：已批准并升级至 **目标 B（原生 Arco Design 视觉体系，2026-11-26）**；取代 2026-11-03 阶段性「目标 A（RQ 自定义视觉皮肤）」折中方案。
- **取代**：ADR-001 中关于 `apps/web` UI 组件库的决定（HeroUI v3）；ADR-001 中「禁止引入 HeroUI」的约束在两端继续有效。
- **配套规范**：[`design.md`](../../design.md)（Arco Design 目标 B 完整设计系统）；历史迁移记录见 `docs/2026-10-31-arco-design-migration-plan.md` 与 `docs/2026-11-03-arco-design-remaining-tasks.md`。

## 背景与演进

1. **阶段一（2026-10-31 ~ 2026-11-03，目标 A）**：`apps/web` 原使用 HeroUI v3、`rq-sys-miaoda/client` 原使用 Tailwind + Radix。首轮迁移将两端核心表单/表格/弹窗组件统一为 `@arco-design/web-react`，但为了控制首批改动面，保留了原有 `--rq-*` 自定义调色板、手写容器外壳与 `.arco-btn !important` 视觉桥接。
2. **审计暴露的问题（2026-11-26）**：目标 A 遗留了大量对抗 Arco 原生设计的样式与结构债务——两仓 `styles.css` 存在 5 个分散 `:root` 块、98 个自定义 `--rq-*` 变量（含 6 个未定义引用）、278 处硬编码 hex、130+ 条 `.arco-btn !important` 强行覆盖、196 条手工 `html[data-theme="dark"]` 暗色覆写、`body[arco-theme]` 将页面底色与卡片同设为 `#fff` 导致层级扁平、以及妙搭入口 CSS 导入顺序倒置（`styles.css` 先于 `arco-styles.ts` 加载）。同时外壳、卡片、提示条、徽标、页签、空态、骨架屏仍以手写 HTML/CSS 为主。
3. **阶段二决策（2026-11-26，目标 B）**：用户明确拍板升级至 **原生 Arco Design 视觉样式与组件体系（P0 → P1 → P2 全量切换）**，以彻底消除双套视觉体系与 `!important` 对抗，并实现 `apps/web` 与 `rq-sys-miaoda/client` 的真正统一。

## 决定

### 1. 原生 Arco Design Token 体系（单一真相源）

两端全面采用 `@arco-design/web-react/es/style/index.css` 提供的官方 Arco 变量，不再用自定义 `--rq-*` 调色板覆盖或复制 Arco 语义色：

| 视觉维度 | 目标 B 规范（Arco 原生 Token） | 替代的旧目标 A 做法 |
|---|---|---|
| 页面画布底色 | `var(--color-fill-2)`（亮色 `#F2F3F5`） | `--rq-background: var(--color-bg-1)`（与卡片同为 `#fff`） |
| 卡片 / 侧栏 / 顶栏表面 | `var(--color-bg-2)`（亮色 `#FFFFFF`） | 自定义 `--rq-surface` 与散落 hex |
| 次级填充 / 悬停表面 | `var(--color-fill-1)` / `var(--color-fill-2)` / `var(--color-fill-3)` | `--rq-surface-subtle` / `--rq-surface-muted-hover` 等 |
| 边框与分隔线 | `var(--color-border-2)` / `var(--color-border-1)` | `--rq-card-border` / `--rq-divider` 等多套灰线 |
| 文字层级 | `var(--color-text-1)`（主）/ `var(--color-text-2)`（次）/ `var(--color-text-3)`（辅助）/ `var(--color-text-4)`（禁用） | `--rq-text-*` 与硬编码灰字 |
| 品牌主色 | `rgb(var(--primary-6))`（Arco Blue `#165DFF`），浅底 `rgb(var(--primary-1))` | 6 种不一致的自定义蓝（`#2b61d8`/`#3971e8`/`#1f5fd6` 等） |
| 语义状态色 | `rgb(var(--success-6))` / `rgb(var(--warning-6))` / `rgb(var(--danger-6))` 及 `rgb(var(--*-1))` 浅底 | 散落绿/橙/红 hex |
| 圆角体系 | `var(--border-radius-small)`（2px）/ `var(--border-radius-medium)`（4px）/ `var(--border-radius-large)`（8px） | 14 种混杂圆角（4px–16px、999px） |
| 排版体系 | 字号 `12px`（辅助）/ `14px`（正文）/ `16px`（区块标题）/ `20px`（页标题）；字重仅用 `400` / `500` / `600`；数字 KPI 使用 `tabular-nums` | 19 种字号与非标小数权重（`560`/`620`/`760` 等） |
| 暗色模式 | 唯一由 `body[arco-theme="dark"]` 驱动，依赖 Arco 内置暗色语义 token 自动反转 | 196 条手工 `html[data-theme="dark"]` 硬编码覆写 |

- 业务专属颜色（如需求来源竖色条：多维表格 / 手工 / 聊天粘贴）仅允许保留极少量带语义命名的自定义变量，且必须同时提供亮/暗两套取值或直接基于 Arco 色阶（`--arcoblue-*` / `--orange-*` / `--purple-*`）派生。
- **禁止**在业务样式规则中硬编码 hex/rgb 颜色；**禁止**对 `.arco-*` 类使用 `!important` 覆盖 Arco 控件外观（包括全面清除原 ARCO-10 的 130+ 条 `.arco-btn !important` 规则）。

### 2. 原生 Arco 组件基线与历史封装退役

两仓统一采用原生 `@arco-design/web-react` 组件替代手写 HTML/CSS 外壳与控件：

- **布局与导航外壳**：`Layout`（`Layout.Sider` / `Layout.Header` / `Layout.Content`）、`Menu`（含 `Menu.ItemGroup` / `Menu.Item`）、`Breadcrumb`、`Drawer`（移动端抽屉导航，替代手写 `.sidebar-backdrop` 按钮与焦点陷阱）、`Divider`。
- **容器与信息展示**：`Card`（`title` / `extra`，替代手写 `.panel` / `.req-section`）、`Descriptions`（替代手写 `<dl>` 网格）、`Table`（含 `ScoringPanel` 九项评分表）、`Collapse`（替代手写 `<details class="fold">`）、`Statistic`、`Progress`、`Empty`、`Skeleton`、`Result`、`Tooltip`。
- **反馈与标签**：`Alert`（替代手写 `.alert-banner` / `.notice-banner`）、`Message`（短时操作反馈）、`Tag`（含 `checkable` / `closable`，替代 `.status-chip` / `.stage-pill` / `.priority-pill` / `.audience-tag` / `.executor-tag`）、`Badge`（状态圆点与计数）。
- **表单与交互**：`Form` / `Form.Item`、`Input` / `Input.TextArea`、`InputNumber`、`Select`、`Checkbox`、`Switch`、`Radio.Group type="button"`、`Tabs`、`Popover`、`Modal`、`Dropdown`、`Space`、`Grid`（`Row` / `Col`）、`Typography`、`Button`（严格区分 `primary` / `secondary` / `outline` / `text` / `status="danger"`）。
- **退役历史垫片**：移除 `apps/web/src/arco.tsx` 兼容层，业务代码直接从 `@arco-design/web-react` 导入原生组件；删除残留的 `Hero*` 别名。
- **保留专用安全/无障碍封装**：
  - `ConfirmModal`（`confirm-modal.tsx`）：封装 Arco `Modal`，在 `afterOpen` 中将角色设为 `alertdialog` 并绑定 `aria-describedby`，作为所有破坏性操作确认的唯一入口。
  - `AdvancedActions`：封装受控 `Dropdown` + `Menu`，保证 `aria-haspopup="menu"`、`aria-expanded`、焦点管理与 `Esc` 归还焦点。
- **React 19 适配器**：两端应用入口必须保持引入 `import "@arco-design/web-react/es/_util/react-19-adapter";`，确保 `Message` / `Modal.confirm` 等命令式 API 在 React 19 下正常运行。

### 3. 样式导入顺序、按需加载与双仓一致

1. **严格的 CSS 导入顺序**：两端必须保证 **Arco 按需样式（`arco-styles.ts`）先于应用布局样式（`styles.css`）导入**，避免两仓级联优先级倒置（修复妙搭 `client/src/index.tsx` 中 `RoutesComponent` 先导入 `rqsys/styles.css`、后导入 `arco-styles.ts` 的缺陷）。
2. **按需样式注册（ARCO-12）**：继续通过两端 `arco-styles.ts` 按组件引入 `@arco-design/web-react/es/style/index.css` 与各组件 `style/css.js`（不退回整份 `arco.css`），由 `npm run check:arco-styles` 自动防回归。
3. **Tailwind 定位（ARCO-14）**：保留依赖仅用于最小 preflight/reset（`apps/web` 与妙搭 TSX 中保持 0 工具类）；若 Tailwind preflight 与 Arco 图标行内布局冲突，仅保留最小无 `!important` 的行内对齐修复。妙搭侧逐步清理未使用的模板样式（`typography.css`、`tw-animate-css` 与废弃 shadcn 变量）以消除约 200 KB CSS 冗余。
4. **双仓样式与组件对齐**：`apps/web` 与 `rq-sys-miaoda/client` 的页面结构、Arco 组件选型、视觉样式与 `arco-styles.ts` 保持同步，并纳入 `npm run check:alignment` 守卫。

### 4. 明确保留的豁免清单

以下两类仍允许使用原生 HTML 元素，但外观须遵循 Arco 视觉 token：

1. **ARCO-04 日期时间筛选**：6 处 `datetime-local` 筛选输入保留原生 `<input type="datetime-local">`（置于 Arco `Form.Item` 内），避免引入 `dayjs` 时区解析回归；样式直接使用 Arco `--color-bg-2` / `--color-border-2` / `--border-radius-medium` 并跟随 `color-scheme`。
2. **语义导航链接**：需要标准浏览器链接语义（右键新开、深链分享）的场景可使用原生 `<a>` 或 Arco `Link`。

## 已知限制与注意事项

- **React 19 控制台提示**：Arco 内部克隆弹层可能输出 `Accessing element.ref was removed in React 19` 警告，来自组件库实现，不影响功能。
- **表格同列多字段**：Arco `Table` 中多列读取同一 `dataIndex` 时必须显式指定唯一 `key`。
- **目标环境验证边界**：根仓本地构建与单元测试通过仅代表本地完成；妙搭线上视觉与功能验收仍须在 `rq-sys-miaoda/` 发布后的目标环境中实测确认。
