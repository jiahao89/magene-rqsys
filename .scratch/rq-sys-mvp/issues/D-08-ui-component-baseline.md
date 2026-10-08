# [blocked] D-08 — 确定生产 UI 组件基线

## 问题
已删除的本地 UI 原型基于 shadcn/Base UI + Tailwind 4；技术设计和 `design.md` 指向 HeroUI v3。生产 UI 开发前需要基于实际仓库与妙搭运行约束确定一种基线。

## 实测记录（2026-10-08）
- GitHub 仓库 `jiahao89/magene-rqsys` 已于 2026-10-08 05:46 UTC 创建（公开仓库），但为**空仓库**：`size=0`，`git ls-remote` 无任何 refs，无分支、无提交。
- 因此“检视 GitHub 仓库当前组件库”暂无对象，建议决策项 A 无法评估；本工单由 `needs-decision` 转为 `blocked`。
- 解除条件：仓库推送基线代码后重新检视（分支、组件依赖、与妙搭导入约束），再产出 ADR。

## 建议决策项
- A. 延续 GitHub 仓库当前组件库（如果有成熟实现），统一设计 token。
- B. 若实际仓库没有稳定基线，按 `design.md` 采用 HeroUI v3。

## 验收标准
- ADR 记录选择、理由、影响范围和迁移/收敛方案。
- 后续新页面遵循 `design.md` 的产品视觉规范；交互状态来自 Spec，不依赖 mock-only 约定。

## 阻塞影响
阻塞生产 UI 页面开发，不阻塞服务端、API 合同或外部集成 POC。
