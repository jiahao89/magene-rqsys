# [partially-available] 00 — 验证妙搭运行时能力

## 目标
确认目标妙搭应用能支撑 RQ-Sys 需要的持久化、定时任务、后台执行和凭据管理，形成可据以选型的证据。

## 实测记录（2026-10-09，app_17fqkjwyx1u）
- `apps +list`、`+get` 成功；目标为 full_stack 应用，列表状态 enabled 且 is_published=true。
- 仅 dev 数据库做过本轮只读盘点：13 张业务表、estimated rows 均为 0；`requirements` 的列/索引/约束可通过 `+db-table-get` 读取。`+db-changelog-list` 返回 CREATE_TABLE 和 PUBLISH 记录；`+db-quota-get` 返回 13 tables、0 views 和配额字段。该 schema 的创建与发布均已有历史记录，本轮未重复执行 DDL。
- `+env-list --environment dev` 返回空；没有 Teambition/Feishu/AI provider 应用变量。用户已明确先跳过向 app 写 `TEAMBITION_GATEWAY_URL`；未设置任何凭据或外呼 provider。
- `+automation-list --all` 返回空；没有 weekly trigger。尚无安全 event fixture/worker runtime evidence，因此没有创建或启用自动化。
- 使用本地 Spark 凭证前缀后，在线 logs/traces/metrics/analytics 命令可调用；当前 requests/latency、PV/UV 无有效数据，CPU/memory 有样本。member APIs 仍为 `feature_not_available`。
- `+member-settings-get` 返回 `feature_not_available`，提示该 app 的协作者设置需在 Miaoda 页面管理；此结果既不代表身份验证通过，也不证明 scope 故障。
- 最新 finished release 为 `7694615270979357961`，commit `1a2910bb6d678c3fe0b3cbb568d3ab6c9ecef7c8`，online URL 返回。该 commit 属于 Miaoda scaffold 和 workspace/database-page shell，不是 `jiahao89/magene-rqsys` 的 RQ-Sys implementation source。
- 妙搭 credential list 显示 app `app_17fqkjwyx1u` credential status valid；这只验证本地 Miaoda git push credential 状态，不代表 GitHub 镜像/导入或代码自动同步已配置。
- 以上只覆盖 app list/get、数据库 schema/changelog/quota、dev env 变量列表、release 状态和自动化列表。未覆盖 PostgreSQL 驱动/连接限制、事务和并发行为、backup/retention、job recovery、服务端读取 secret、在线观测数据/保留期、PV/UV 或 HeroUI runtime hosting。

## 实测记录（2026-10-08）
- 当前 TRAE 环境无法获取妙搭（spark 域）授权，本工单暂标记 `blocked`：
  1. `lark-cli` 为 TRAE 插件托管版，凭证外部加密管理，CLI 内交互式登录被禁用（`auth login` 返回 `credentials are provided externally and do not support interactive management`）。
  2. 托管凭证 scope 不含 `spark:app:read`（`apps +list` 返回 `missing_scope`）。
  3. TRAE 授权服务不支持 spark scope：显式申请 `spark:app:read`/`spark:app:write` 与默认（空 scope）申请均返回 `these scopes are not supported for authorization by the service`。
- 解除途径（任一）：TRAE 授权服务支持 spark scope 后重试；或由用户在妙搭控制台手动验证并回填记录；或在有 spark 权限的独立环境中执行本 POC。
- spark scope 开通已拆分为独立工单：[`10-spark-app-read-scope.md`](10-spark-app-read-scope.md)、[`11-spark-app-write-scope.md`](11-spark-app-write-scope.md)；两单完成（agent 验收通过）后本工单 spark 侧 blocker 解除。
- 本工单不阻塞 Ticket 02（飞书 Base POC），Base 域凭证已验证可用（2026-10-08）。

### Spark 读取侧部分恢复证据（2026-10-08）
- 新会话执行 `lark-cli apps +list --as user` 成功，返回两个当前用户可见应用；列表中没有 RQ-Sys 专用妙搭应用。
- 对已有前端应用 `app_17f41y3cs26` 执行 `apps +get` 成功，返回应用详情。
- 对该应用执行 `apps +member-list` 返回 OpenAPI `feature_not_available` / code `3340005`，提示该应用类型不支持通过 lark-cli 管理协作者；不是 `missing_scope`，也不能据此证明其他 Spark 读取命令可用。
- 本地 TypeScript 骨架 `npm run typecheck`, `npm run build`, `npm test` 通过；当前仅 3 个健康探针/未实现路由测试。运行 `/api/health` 返回 200；未配置数据库时 `/api/health/ready` 返回 503。此为本地证据，不代表妙搭运行时验证。
- 仍未验证：RQ-Sys 目标妙搭应用、应用设置、线上日志/指标、数据库持久化、部署/导入流程、身份、调度与后台任务。Spark 写侧仍 blocked；未进行部署、发布、线上环境变量或数据库写操作。

### Spark scope 复测（2026-10-08 晚）
- 经 TRAE 授权服务申请 `spark:app:read` 已被接受（不再报 scope 不受支持），但授权后 `apps +list`/`+get` 仍返回 `missing_scope: spark:app:read`——授权申请未实际传导到托管令牌。详见 [`10-spark-app-read-scope.md`](10-spark-app-read-scope.md) 复测记录。
- 用户指示：暂停重复授权、跳过妙搭侧验证；本工单 spark 侧 blocker 维持，后续验证待平台侧修复授权下发链路或提供独立授权环境。

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
