# ADR-002：工作台与妙搭客户端采用 Arco Design

- **状态**：已接受（2026-10-31）
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

## 后果

- 迁移期允许 HeroUI 与 Arco 并存，但每个面板完成迁移后必须移除对应 HeroUI 用法；
- 需要更新 Web 组件测试（当前 95 个）中依赖 HeroUI 语义的断言；
- bundle 体积纳入阶段验收（P0 基线：宽组件面 JS gzip ≈248 KB、CSS gzip ≈64 KB）；
- 妙搭云端构建已验证可安装并构建 Arco（临时验证应用 `app_17h45brz8hb`，2026-10-31）。
