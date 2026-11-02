# ADR-002：工作台与妙搭客户端采用 Arco Design

- **状态**：已实施完成（2026-10-31）
- **取代**：ADR-001 中关于 `apps/web` UI 组件库的决定（HeroUI v3）；ADR-001 的其余结论（Tailwind 作为布局/工具类、妙搭 client 禁止引入 HeroUI）继续有效
- **相关计划**：`docs/2026-10-31-arco-design-migration-plan.md`

## 背景

`apps/web` 当前以 HeroUI 3.2.6 + Tailwind 4 构建 canonical 工作台，妙搭运行时 client 以 Tailwind + Radix 原语实现。两套 UI 体系导致组件行为与视觉需要双份维护；团队决定统一迁移到 Arco Design（`@arco-design/web-react`）。

## 决定

1. `apps/web` 与 `rq-sys-miaoda/client` 的 UI 组件库统一为 **Arco Design**，逐步移除 HeroUI（根仓）与被替换的 Radix 原语（妙搭 client）。
2. 视觉采用 **Arco 默认设计语言**；品牌信息通过 Arco token（`ConfigProvider`）与少量 CSS 变量承载，不再保留 HeroUI 主题层。
3. Tailwind 保留用于布局与工具类，不作为组件库。
4. React 19 下必须在应用入口引入 Arco 官方适配器：
   `import "@arco-design/web-react/es/_util/react-19-adapter";`
   否则 `Message/Notification/Modal.confirm` 等命令式 API 会因 React 19 移除 `ReactDOM.render` 而抛错。
5. Arco 依赖按需引入并做路由级拆分；全量样式只在必要处引入，逐步替换为组件级样式。
6. 妙搭 client 继续禁止引入 HeroUI；迁移完成后两侧均只依赖 Arco + Tailwind。

## 实施结果（2026-10-31，2026-11-01 校正）

- `apps/web`：HeroUI 已移除；Button/Card/Chip/Input/Modal/Collapse/Table/Select 全部由 Arco 渲染，布局类通过 Arco token 桥接。
- `rq-sys-miaoda/client`：Arco 依赖、React 19 适配器、主题同步与 token 桥接已上线；列表、下拉、按钮、帮助页表格、总览表与规则表均由 Arco 渲染；删除确认由 Radix `AlertDialog` 改为 Arco `Modal`，`rqsys` 目录下不再引用 Radix/shadcn 组件。
- 仍保留的原生 `<table>`：两端的"九项评分输入网格"（分组、可编辑，需要保留 input 语义）。
- 妙搭生产发布：release `7702750651457850659`（commit `a23c673`）完成，目标环境多页验证通过。本次校正涉及的总览表、规则表、删除确认改动**尚未发布到目标环境**，只有本地验证。
- 后续新增页面必须直接使用 Arco 组件，不再引入 HeroUI/Radix 组件。

## 已知限制

- **样式产物**：两端都引入完整的 `arco.css`，与上文"按需引入"的决定不一致。根仓 CSS 约 665 KB（gzip 82 KB），妙搭约 874 KB（gzip 110 KB）。按组件引入 `es/<Component>/style/css` 是后续优化项，尚未实施。
- **无障碍**：Arco `Modal` 固定 `role="dialog"`，不是 `alertdialog`；删除确认的屏幕阅读器播报语义比迁移前弱。
- **React 19**：Arco 内部克隆弹层时会触发 `Accessing element.ref was removed in React 19` 控制台警告，来自库本身，不影响功能。
- **同列多字段**：`Table` 里多列读同一个 `dataIndex` 时必须显式写 `key`，否则 React 报重复 key（总览表的四个阶段列就是这种情况）。

## 后果

- 迁移期允许 HeroUI 与 Arco 并存，但每个面板完成迁移后必须移除对应 HeroUI 用法；
- 需要更新 Web 组件测试（当前 95 个）中依赖 HeroUI 语义的断言；
- bundle 体积纳入阶段验收（P0 基线：宽组件面 JS gzip ≈248 KB、CSS gzip ≈64 KB）；
- 妙搭云端构建已验证可安装并构建 Arco（临时验证应用 `app_17h45brz8hb`，2026-10-31）。
