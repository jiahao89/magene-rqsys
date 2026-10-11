# [implemented-not-target-verified] 16 — Web 数据源配置与同步批次工作台

## 目标

让管理员/操作员能在 Web 查看并维护唯一产品组来源，发起手动同步，查看真实批次状态和失败明细。

## 依据

- `specs/rq-sys-mvp/04-workbench.md`
- `specs/rq-sys-mvp/01-teambition-sync.md`
- `specs/rq-sys-mvp/05-platform-reliability-security.md`
- `design.md`（HeroUI v3 + Tailwind 基线；新增页面遵循现有项目样式）

## 范围

- 在现有 Overview、Sources、Batches 页面基础上补齐缺失交互，不重做已有 API-backed 页面。
- Source 页面支持读取/创建/更新一个专用 Teambition 项目：客户端仅维护项目名称（默认 `室外产品-码表软固件需求池`）和周计划/启用状态；服务端解析项目 ID、需求类型 ID并保留内部 mapping。客户端不编辑负责人名单、字段映射或凭据。
- 支持手动全量同步，显示返回的 batch ID，并从服务端刷新真实进度。
- 批次列表/详情显示触发者、触发方式、时间、总数、成功/失败数、逐条错误与允许的重试动作；数据不得来自 mock counter。
- 显示 loading、empty、partial failure、permission denied、API error 等可恢复状态。

## 验收标准

- Source 创建/更新保存后重新读取仍一致；字段超出 allowlist 时服务端拒绝。
- 手动同步使用幂等键，重复点击/请求不制造重复批次；UI 只在 API 接受后显示已提交。
- 批次数据与服务端持久化状态一致；单条失败时成功项可见且不被隐藏。
- 无身份/无角色时，页面显示可理解的权限状态，不假报操作成功。
- 对当前页面行为及新增流程有组件/API mock contract tests；运行页面连接本地 API 可手动核验。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

## Target verification remains

Miaoda真实身份、调度和目标应用发布由 Tickets 00/09 验收。

## Latest local implementation evidence (2026-10-11)

- 来源表单默认项目名为 `室外产品-码表软固件需求池`；客户端只提交项目名称、启用状态和周计划，不要求录入内部 ID，也不暴露 owner/field map。默认周计划为周一 09:00 `Asia/Shanghai`，保持未启用，等待目标调度验收。
- 新建来源会持久化已解析配置、周计划、负责人名单、字段映射与审计事件；妙搭 app 的来源创建也已修正为写入完整配置，不再丢弃这些设置。
- root Web 创建/更新表单有 API mock contract 覆盖；主仓 Web 21 项测试通过。妙搭 app 路由测试覆盖来源创建请求和 Postgres 参数持久化；`test:rqsys-route` 24/24 通过。
- 妙搭 app `type:check`、`lint`、`build:prod` 通过；目标身份、线上来源写入、手动同步与周调度仍未验收。
