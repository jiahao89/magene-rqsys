# [blocked] 00 — 验证妙搭运行时能力

## 目标
确认目标妙搭应用能支撑 RQ-Sys 需要的持久化、定时任务、后台执行和凭据管理，形成可据以选型的证据。

## 实测记录（2026-10-08）
- 当前 TRAE 环境无法获取妙搭（spark 域）授权，本工单暂标记 `blocked`：
  1. `lark-cli` 为 TRAE 插件托管版，凭证外部加密管理，CLI 内交互式登录被禁用（`auth login` 返回 `credentials are provided externally and do not support interactive management`）。
  2. 托管凭证 scope 不含 `spark:app:read`（`apps +list` 返回 `missing_scope`）。
  3. TRAE 授权服务不支持 spark scope：显式申请 `spark:app:read`/`spark:app:write` 与默认（空 scope）申请均返回 `these scopes are not supported for authorization by the service`。
- 解除途径（任一）：TRAE 授权服务支持 spark scope 后重试；或由用户在妙搭控制台手动验证并回填记录；或在有 spark 权限的独立环境中执行本 POC。
- spark scope 开通已拆分为独立工单：[`10-spark-app-read-scope.md`](10-spark-app-read-scope.md)、[`11-spark-app-write-scope.md`](11-spark-app-write-scope.md)；两单完成（agent 验收通过）后本工单 spark 侧 blocker 解除。
- 本工单不阻塞 Ticket 02（飞书 Base POC），Base 域凭证已验证可用（2026-10-08）。

## 范围
- 验证可用数据库、持久化边界、数据/存储限制。
- 验证每周定时触发、后台任务执行、失败重试及应用重启后的任务状态恢复。
- 验证服务端密钥注入与读取方式；Teambition 默认 API key fallback 仅保留在服务端，配置 API 不回显，日志脱敏。
- 验证 GitHub 仓库如何导入/关联到妙搭、部署对应的分支或 commit、以及修改能否回同步；分别记录官方支持与本租户实测。
- 验证妙搭服务端运行时是否能访问 Teambition、飞书 OpenAPI 和获批模型服务。
- 记录已验证能力、限制、部署方式和推荐实现方案。

## 验收标准
- 有目标妙搭环境中的实际验证记录，区分文档说明与实测结果。
- 明确数据库、scheduler/background task、secret storage 各自的可用方案和限制。
- 明确 GitHub 与妙搭之间唯一代码事实来源和可重复发布流程；若不能直接双向同步，记录基于导入包的发布步骤。
- 若任一能力不满足，给出兼容方案和影响，不以本地 SQLite/本地进程推断生产可用。
- 更新技术决策记录，供 Ticket 04/08 使用。

## 不在范围
实现完整同步业务或假定特定数据库。
