# [implemented-not-target-verified] 17 — Web 需求详情、负责人映射与审计工作台

## 目标

让操作员能在需求池中定位单条需求，理解其拉取/分析/负责人/推送独立状态，并完成负责人映射、阶段重试和审计追踪。

## 依据

- `specs/rq-sys-mvp/04-workbench.md`
- `specs/rq-sys-mvp/02-ai-analysis.md`
- `specs/rq-sys-mvp/03-owner-and-base-push.md`
- `specs/rq-sys-mvp/00-foundation-and-data-contract.md`
- `design.md`

## 范围

- 完成 Requirements 池的服务端筛选、分页、四阶段状态、错误提示和需求详情。
- 详情展示只读源快照及版本、最新 AI 分析与证据、负责人匹配、Base 推送状态/记录链接和历史；不显示 Web 没有读回的 PM 处理状态或通知送达状态。
- Mappings 页面调用真实 API 读取待映射需求/现有映射；操作员选择飞书用户后提交映射，并显示持久化/推送结果。
- 飞书用户通过服务端通讯录搜索接口选择；浏览器不直连飞书，搜索结果仅返回 Open ID、姓名和英文名，不包含联系方式。
- 提供同步项、AI 分析和 Base 推送各自的安全重试入口；重试只针对可重试阶段并刷新持久状态。
- Audit 页面读取真实审计日志，支持按对象/时间筛选并显示 actor、动作、结果和安全摘要。
- 对权限拒绝、空数据、加载中、局部失败和 API 不可用提供可恢复状态。

## 验收标准

- 需求池筛选/分页与 API 返回一致；详情能区分已同步、AI 失败但已推送等独立状态组合。
- 无负责人需求可显示“无需匹配”；有 TB 负责人但未匹配时可人工映射；UI 不允许把“通知已送达”作为推送成功的推断。
- 映射/重试调用成功后从 API 刷新状态，不用本地乐观值伪造持久化完成。
- AI 建议与 PM 确认字段分开显示；推送和 AI 重跑不会让 Web 声称 Base PM 状态已同步。
- 审计筛选结果来自服务端，不显示虚构 actor 或时间。
- 组件/API contract tests 覆盖正向、拒绝、错误与空状态；`npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

## Target verification remains

目标 Feishu 通讯录搜索权限、身份和映射链路需在 Ticket 09 的真实环境验收。
