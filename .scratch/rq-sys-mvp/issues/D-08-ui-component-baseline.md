# [resolved: 2026-10-08] D-08 — 确定生产 UI 组件基线

## 问题
已删除的本地 UI 原型基于 shadcn/Base UI + Tailwind 4；技术设计和 `design.md` 指向 HeroUI v3。生产 UI 开发前需要基于实际仓库与妙搭运行约束确定一种基线。

## 实测记录（2026-10-08）
- GitHub 仓库 `jiahao89/magene-rqsys` 已于 2026-10-08 05:46 UTC 创建（公开仓库），但为**空仓库**：`size=0`，`git ls-remote` 无任何 refs，无分支、无提交。
- **基线已推送（2026-10-08）**：`main` 分支 commit `03aef74`（服务端骨架、migrations、specs、POC 证据与工单，91 文件）。推送前完成脱敏：源码中的真实网关 API key 改为空占位（保留 env 覆盖结构，见 `apps/api/src/adapters/teambition/client.ts` 与 `skills/teambition/scripts/teambition_api.py`），内网网关 URL 与企业邮箱脱敏，`plugins/` 与 `rq-sys-tech-design/` 排除在仓库外。
- **基线检视结果**：`apps/api` 为纯服务端骨架（TypeScript ESM，package.json 无任何 UI 依赖）——决策项 A（延续仓库当前组件库）无对象可评估。
- **决策已产出：[ADR-001](../../../specs/rq-sys-mvp/ADR-001-ui-component-library.md)——按 `design.md` 采用 HeroUI v3 + Tailwind 作为生产 UI 基线**（决策项 B）。UI 构建产物在妙搭运行时的托管方式仍属工单 00 未验证范围。

## 建议决策项
- A. 延续 GitHub 仓库当前组件库（如果有成熟实现），统一设计 token。
- B. 若实际仓库没有稳定基线，按 `design.md` 采用 HeroUI v3。

## 验收标准
- ADR 记录选择、理由、影响范围和迁移/收敛方案。
- 后续新页面遵循 `design.md` 的产品视觉规范；交互状态来自 Spec，不依赖 mock-only 约定。

## 阻塞影响
阻塞生产 UI 页面开发，不阻塞服务端、API 合同或外部集成 POC。
