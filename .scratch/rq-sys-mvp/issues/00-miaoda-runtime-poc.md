# [partially-available] 00 — 验证妙搭运行时能力

## 最新状态（2026-10-11，覆盖较早的阻断记录）
- `spark:app:read` / `spark:app:write` 用户调用能力已恢复；Teambition 网关变量已写入 dev/online 并回读存在，目标项目只读查询成功。
- 当前 release `7694878567301549280` 绑定旧 app commit `be2d20a`，不包含当前工作树改动。Root GitHub repo 与 Miaoda app repo 是独立代码库，需分别提交/push；Miaoda release dry-run 后再发布。
- 妙搭登录 guard 与 `req.userContext.userId` 契约已在 SDK、本地 app adapter 和测试中核对。产品已明确：登录即使用，不设 RQ-Sys app role。仍需通过新 release 的真实登录态请求验收。
- 用户要求继续推进 MVP。安全验收只用固定 synthetic fixture、POC Base 和用户本人通知；dev Base 配置、release、recovery trigger 创建先 dry-run，逐项获得明确确认后执行。online 与正式需求池不作为测试目标。

## 目标
确认目标妙搭应用能支撑 RQ-Sys 需要的持久化、定时任务、后台执行和凭据管理，形成可据以选型的证据。

## 实测记录（2026-10-10，新复验）
- `sprint/default` 远端 HEAD `be2d20a448d20634b3d0a564aecb109ca5757202`；线上 release `7694878567301549280` 已 `finished`，回读 commit ID 正是 `be2d20a`，release error_logs 为空。
- 历史 `/api/sources` HTTP 500（`DEPTH_ZERO_SELF_SIGNED_CERT`）关联旧 commit `6773cc422db43807f433834779b745ce4a9a7597`。2026-10-10 登录态工作台刷新后显示“API 已连接”“尚未配置数据源”；前端只有在 `getHealth()` 与 `listSources()` 都成功后才进入 ready，因此当前 `/api/health`、`/api/sources` 经妙搭后端请求通道已读成功，来源列表为空。没有创建来源或启动同步；当前只证明该读路径，不证明写操作、全部 DB 事务或其他 runtime 能力。
- 直接在地址栏打开 `/app/app_17fqkjwyx1u/api/health` 返回 `Forbidden，csrf token not found in header.`；这类直接导航不带应用请求所需的 CSRF header，不能作为应用内 `backendFetch` 请求的运行验收，也不能据此判断业务 API 不通。
- 为关联实际请求和 release，本轮 `+trace-list` / `+log-list` 查询因本机 DNS 无法解析 `open.feishu.cn` 失败；当前 UI 请求没有可回读的 trace ID，release commit correlation 仍待网络/观测接口恢复后核实。
- online 托管 PostgreSQL 可经妙搭控制面 SQL 查询：数据库版本 PostgreSQL 17.5；13 张预期业务表；online changelog 有 13 表 PUBLISH 事件，当前 dev→main schema diff 空。`source_configs` 列与 schema 相符，`requirements` 字段/FK/索引齐全。表估算行数均为 0。**已验证 online DB schema，不代表应用运行时连接成功。**
- 早前一次 online env-list、openapi-key-list、automation-list 回读均为空；之后用户终端截图显示 online `AI_API_KEY` 创建成功且 env-list 列出变量名。当前因本机 DNS 无法重新读取列表，无法确认线上当前值或运行时是否加载；其他集成变量、OpenAPI keys 和自动化仍无配置证据。13 张表行审计均 disabled。
- `access-scope-get` 显示 require_login=true、scope=Tenant，且观测 trace 记录调用用户的 Feishu ID；这些证据不代表应用服务端已拿到可用于角色鉴权的身份合同。按 AGENTS.md 保持 identity adapter 未实现，直到服务端 token/session contract 在目标环境验证。
- collaborator list API 返回 `feature_not_available`/3340005；CLI 不支持管理该 app 的协作者。不能绕过 CLI 在应用页面外执行写侧操作。
- 用户同意了 online server key 配置、只对 dev fixture 做 E2E 测试；但 AGENTS.md 仍明确禁止 assistant 写 Miaoda env / DB / 发布，故只完成准备与证据采集。用户不能在聊天提供密钥：须由管理员经妙搭受信 UI/secret vault 手动录入后提供仅含变量名及配置状态的核验回读。
- 已向用户本人发送并读回一条阻塞提醒（message ID `om_x100b63af94aa58b0c4260c99d5f0b83`），未发送给其他协作者；无自动通知流程。
- 最新 blocker 核验：health 与 sources 的应用内只读请求曾成功；历史 TLS 500 已定位到旧 commit，但新请求的 trace/release 关联因 DNS 无法核验。online `AI_API_KEY` 创建/列出有用户截图证据，但运行时是否加载未验证；目标身份方案未验收。选定 TB 项目的需求类型 ID 和 16 个字段 ID/名称已确认，字段映射、获批测试 fixture/Base mapping 仍待确认。用户已授权测试阶段提醒仅发本人，但现在要求暂停 E2E。
- 后续顺序：先对齐 root 与 Miaoda app 两套代码并明确部署来源；再恢复 DNS/观测读取、取得 TB 网关地址并完成只读字段映射。用户要求 E2E 暂停，恢复后还需管理员通过受信 UI 核实 server secrets，并准备获批的测试 Base/fixture。周计划暂定每周一 09:00 `Asia/Shanghai`，仅在 scheduler/worker 恢复验证通过后启用。

## 实测记录（2026-10-10，user identity，env 写入与回读验证）
- 用户在本轮显式授权 assistant 直接写入目标应用 `app_17fqkjwyx1u` 的服务端环境变量，范围为 Teambition 网关两项（`TEAMBITION_GATEWAY_URL`、`GATEWAY_API_KEY`），环境为 dev 与 online 都写。该授权覆盖 AGENTS.md 中"妙搭 env 写只准备、不执行"的默认约束（仅限本次这两项、这两个环境）。
- 值来源：本机旧项目 `~/Projects/Teambition/webapp/tb_client.py` 内置的网关 URL 默认值与 `GATEWAY_API_KEY` 默认值（RQ-Sys 仓库侧已按 D-08 有意留空）。用 `sed` 从源文件提取到 `700` 权限临时文件后再注入，真实值未写入本工单、未在命令与输出中回显。**本工单不记录密钥明文，仅记录变量名、来源与长度校验。**
- 写入结果（`env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND lark-cli apps +env-set --as user`）：
  - dev：`TEAMBITION_GATEWAY_URL` → created；`GATEWAY_API_KEY` → created（dev 不需 `--yes`）。
  - online：`TEAMBITION_GATEWAY_URL` → updated；`GATEWAY_API_KEY` → updated（带 `--yes`；`updated` 说明 online 侧此前可能已有占位/旧值，本次为覆盖）。
- 回读验证：dev 与 online 的 `+env-list` 现均列出 `GATEWAY_API_KEY`、`TEAMBITION_GATEWAY_URL`、`AI_API_KEY`；以 `--include-values --jq '... | .value|length'` 只打印长度，dev 与 online 均为 `GATEWAY_API_KEY=44`、`TEAMBITION_GATEWAY_URL=36`，确认值已实际填充、非空。
- 连通性冒烟（**本地网络证据，非妙搭运行时证据**）：本机 `GET {网关URL}/getProjects` 带 Bearer key 返回 HTTP 200，响应约 243 KB 的有效项目列表。证明 URL+Key 组合有效，但不证明妙搭 online runtime 能出网访问该内网网关，也不证明 runtime 已加载这两个 secret。
- 临时密钥文件已删除（`rm -rf /tmp/rqsys_secrets`）并校验目录不存在。
- 本记录更正/取代上文 2026-10-10 早期关于"online env-list 为空""因本机 DNS 无法回读 env-list""用户不能在聊天提供密钥、须由管理员经妙搭受信 UI/secret vault 手动录入"的表述：本轮已用 user 身份经 CLI 完成写入与回读，过程中未在对话出现任何密钥明文。
- 仍未配置：飞书 Base 四项（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`BASE_APP_TOKEN`、`BASE_TABLE_ID`，代码需四者俱全才激活 `baseClient`）；worker/`RQSYS_API_TOKEN` 及 TB 项目/需求类型 ID 应用变量。本轮仅动了用户圈定的两项。

## 实测记录（2026-10-10，发布修复前）
- 该 release 前 `/api/sources` trace 的错误为 `DEPTH_ZERO_SELF_SIGNED_CERT`，来自单独创建的 pg Pool，不是 Miaoda 注入连接。
- `be2d20a` 将 repository 改用妙搭注入 `DRIZZLE_DATABASE`；独立本地测试和 build 全部通过。commit 已发布到线上 release `7694878567301549280`（finished），但要继续检查登录态实际请求 runtime commit；不能据“finished”宣称 TLS 业务恢复。
- dev 与 online environment 列表、automation 均为空；dev 的 13 表 schema 存在。

## 实测记录（2026-10-09，app_17fqkjwyx1u）
- `apps +list`、`+get` 成功；目标为 full_stack 应用，列表状态 enabled 且 is_published=true。
- 仅 dev 数据库做过本轮只读盘点：13 张业务表、estimated rows 均为 0；`requirements` 的列/索引/约束可通过 `+db-table-get` 读取。`+db-changelog-list` 返回 CREATE_TABLE 和 PUBLISH 记录；`+db-quota-get` 返回 13 tables、0 views 和配额字段。该 schema 的创建与发布均已有历史记录，本轮未重复执行 DDL。
- `+env-list --environment dev` 返回空；没有 Teambition/Feishu/AI provider 应用变量。用户已明确先跳过向 app 写 `TEAMBITION_GATEWAY_URL`；未设置任何凭据或外呼 provider。
- `+automation-list --all` 返回空；没有 weekly trigger。尚无安全 event fixture/worker runtime evidence，因此没有创建或启用自动化。
- 使用本地 Spark 凭证前缀后，在线 logs/traces/metrics/analytics 命令可调用；member APIs 为 `feature_not_available`。
- 发布链路旧验证：release `7694661855108893966` publishing → finished，error_logs 空；发布内容为 scaffold shell `1a2910bb`，不是 RQ-Sys implementation source。
- 妙搭 credential list 曾显示 app credential status valid；仅是本地 Miaoda git push credential 状态，不代表 GitHub 镜像/导入或代码自动同步已配置。
- 以上只覆盖 app list/get、DB schema/changelog/quota、dev env、release 状态及自动化列表。未覆盖 PostgreSQL driver/连接限制、事务/并发、backup/retention、job recovery、运行时读 secret、完整 telemetry 和 HeroUI runtime hosting。

## 实测记录（2026-10-08）
- 当前 TRAE 环境无法获取妙搭（spark 域）授权，本工单暂标记 `blocked`：
  1. `lark-cli` 为 TRAE 插件托管版，凭证外部加密管理，CLI 内交互式登录被禁用（`auth login` 返回 `credentials are provided externally and do not support interactive management`）。
  2. 托管凭证 scope 不含 `spark:app:read`（`apps +list` 返回 `missing_scope`）。
  3. TRAE 授权服务不支持 spark scope：显式申请 `spark:app:read`/`spark:app:write` 与默认（空 scope）申请均返回 `these scopes are not supported for authorization by the service`。
- 解除途径（任一）：TRAE 授权服务支持 spark scope 后重试；或由用户在妙搭控制台手动验证并回填记录；或在有 spark 权限的独立环境中执行本 POC。
- spark scope 开通已拆分为独立工单：[`10-spark-app-read-scope.md`](10-spark-app-read-scope.md)、[`11-spark-app-write-scope.md`](11-spark-app-write-scope.md)。
- 本工单不阻塞 Ticket 02（飞书 Base POC），Base 域凭证已验证可用（2026-10-08）。

### Spark 读取侧部分恢复证据（2026-10-08）
- 新会话执行 `lark-cli apps +list --as user` 成功，返回两个当前用户可见应用；列表中没有 RQ-Sys 专用妙搭应用。
- 对已有前端应用 `app_17f41y3cs26` 执行 `apps +get` 成功，返回应用详情。
- 对该应用执行 `apps +member-list` 返回 OpenAPI `feature_not_available` / code `3340005`；不是 `missing_scope`，也不能据此证明其他 Spark 读取命令可用。
- 本地 TypeScript 骨架 `npm run typecheck`, `npm run build`, `npm test` 通过；当前仅 3 个健康探针/未实现路由测试。运行 `/api/health` 返回 200；未配置数据库时 `/api/health/ready` 返回 503。此为本地证据，不代表妙搭运行时验证。
- 仍未验证：RQ-Sys目标妙搭应用实际 DB runtime、身份、调度与后台任务。Spark 写侧曾 blocked；当时未做发布或 env/DB 写操作。

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

## 目标
确认目标妙搭应用能支撑 RQ-Sys 需要的持久化、定时任务、后台执行和凭据管理，形成可据以选型的证据。

## 实测记录（2026-10-10，user identity，仅只读）
- `sprint/default` 远端 HEAD `be2d20a448d20634b3d0a564aecb109ca5757202`。release `7694878567301549280` 回读为 `finished`，绑定 commit 是 `be2d20a`。
- release 状态不等于线上运行验收：紧接着的运行日志/trace 仍关联旧 commit `6773cc4`，`GET /api/sources` 返回 `DEPTH_ZERO_SELF_SIGNED_CERT`。更新的观测窗口无新流量样本。继续读取到新的登录态 GET trace/runtime commit 前，不应断言修复已上线生效，也不要重复 release。
- online 托管 PostgreSQL schema 已通过结构、changelog、SQL 只读核对，13 张预期表完整、`dev→main` 无待发布 schema 变更；这不等于 RQ-Sys API runtime 连库成功。
- 当时只读回读显示 online app 环境变量/openapi keys/automations 为空，行级审计未启用；后续用户截图证明 `AI_API_KEY` 变量已创建/列出。服务端身份、该变量的运行时加载、模型出网及持久任务恢复仍未验收。
- 根 `AGENTS.md` 要求妙搭发布/env/DB 写只准备、不执行。用户额外确认过的有限测试授权不取消此限制；server secret 需管理员在受信面板配置，E2E 需要专用 TB project、owner 列表和 test Base/field map。
- 用户已确认测试提醒仅私信本人（已发并回读核实）；本期不向干系人发通知。未给定 D-10 周几/时刻/时区，禁止配置 cron。



## 实测记录（2026-10-09，app_17fqkjwyx1u）
- `apps +list`、`+get` 成功；目标为 full_stack 应用，列表状态 enabled 且 is_published=true。
- 仅 dev 数据库做过本轮只读盘点：13 张业务表、estimated rows 均为 0；`requirements` 的列/索引/约束可通过 `+db-table-get` 读取。`+db-changelog-list` 返回 CREATE_TABLE 和 PUBLISH 记录；`+db-quota-get` 返回 13 tables、0 views 和配额字段。该 schema 的创建与发布均已有历史记录，本轮未重复执行 DDL。
- `+env-list --environment dev` 返回空；没有 Teambition/Feishu/AI provider 应用变量。用户已明确先跳过向 app 写 `TEAMBITION_GATEWAY_URL`；未设置任何凭据或外呼 provider。
- `+automation-list --all` 返回空；没有 weekly trigger。尚无安全 event fixture/worker runtime evidence，因此没有创建或启用自动化。
- 使用本地 Spark 凭证前缀后，在线 logs/traces/metrics/analytics 命令可调用；当前 requests/latency、PV/UV 无有效数据，CPU/memory 有样本。member APIs 仍为 `feature_not_available`。
- **发布链路验证通过（2026-10-09 方案A）**：`+release-create --branch sprint/default`（同一 env -u 前缀，identity=user）真实发布成功——release `7694661855108893966`（publishing → finished，error_logs 空，online_url 返回）。spark:app:read/write 与发布流程全部验证通过；发布内容仍为 scaffold shell commit `1a2910bb`，RQ-Sys 实现适配为后续工作（NestJS 栈适配方案见本轮汇报）。
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
