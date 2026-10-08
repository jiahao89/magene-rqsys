# ADR-001 — 生产 UI 组件基线选 HeroUI v3

> 状态：Decided 2026-10-08。决策登记：`OPEN-DECISIONS.md` D-08。对应工单：`.scratch/rq-sys-mvp/issues/D-08-ui-component-baseline.md`。

## 背景

已删除的本地 UI 原型基于 shadcn/Base UI + Tailwind 4；技术设计和 `design.md` 指向 HeroUI v3。生产 UI 开发前需要基于实际仓库与运行约束确定一种基线（D-08）。

## 检视证据（2026-10-08，基线 commit `03aef74`）

- 仓库 `jiahao89/magene-rqsys` 已推送基线：`main` 分支，单 commit（服务端骨架、migrations、specs、POC 证据与工单）。
- 组件依赖检视：`apps/api` 为纯服务端骨架（TypeScript ESM monorepo，Node 22）；根 `package.json` 的 workspaces 仅含 `apps/api`，**无任何 UI 组件库依赖**（React/shadcn/HeroUI 均未引入）。
- 结论：决策项 A（延续仓库当前组件库）**无对象可评估**——仓库没有成熟 UI 实现可延续。

## 决策

采用决策项 B：**按 `design.md` 采用 HeroUI v3 + Tailwind 作为生产 UI 组件基线**。

理由：

1. 仓库无既有 UI 基线，无迁移负担；已删除的 shadcn 原型不复用。
2. `design.md` 的产品视觉规范（token、排版、组件形态）以 HeroUI v3 为前提编写，沿用可保持设计与实现一致。
3. Tailwind 4 与 HeroUI v3 组合与 `design.md` 描述一致。

## 影响范围

- 后续 Web UI 页面（Ticket 05 的批次列表/详情最小界面等）统一按 `design.md` + HeroUI v3 开发。
- 新增页面遵循 `design.md` 的产品视觉规范；交互状态来自 Spec，不依赖 mock-only 约定。

## 迁移/收敛方案

无需迁移：shadcn 原型已删除，无存量页面。收敛规则：所有新 UI 组件以 HeroUI v3 为唯一基线，不混用其他组件库。

## 约束与待验证项

- 本 ADR 解除 D-08 对生产 UI 开发的阻塞；UI 构建产物在妙搭运行时的托管方式仍属工单 00（妙搭运行时 POC）未验证范围，部署方式以 00 的实测结论为准。
- HeroUI v3 版本在引入依赖时锁定到当前稳定版，版本变更需更新本 ADR。
