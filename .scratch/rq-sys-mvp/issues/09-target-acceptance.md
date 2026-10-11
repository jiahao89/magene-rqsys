# [partially executed: local suites green; target Base read/write smoke passed; runtime/identity/alignment still open] 09 — 目标环境端到端验收

## 最新状态（2026-10-11，覆盖下方旧日期汇总）
- 用户要求继续直至 MVP 完成，安全 E2E 已获授权；项目安全门要求目标写操作先 dry-run，再由用户确认具体执行。
- 本地登录与数据边界已按最新决定更新：登录必需、无 RQ-Sys app roles；固定 Teambition 项目名；只用已核验的最小字段；模块词典先空置，优先级规则发布前保持空值。
- 根仓 `main` commit `5790d80` 与 Miaoda app `sprint/default` commit `87a2444` 已分别提交并 push，应用 release 尚未创建。最新本地验证：root API 218/218、Web 21/21、typecheck/build 通过；Miaoda route 38/38、lint、server/client typecheck、production build 通过。新增覆盖 safe POC Base fixture guard、周计划终态失败恢复、版本级分析重试。
- 目标安全验收环境使用固定 synthetic fixture + POC Base `OddqbqBeOamFjFsR5IXcJdjknmd` / `tblxbyvbdLGVnLaO`。当前 dev Base 配置与该 POC 不一致，尚未改动；正式 Base、真实 TB 需求和干系人均不得用于本次测试。
- POC Base 已启用负责人变更通知 workflow；只有 owner assignment 通知事件已被验证，目标 app 侧的 synthetic upsert/通知仍待验收。周计划为周一 09:00 `Asia/Shanghai`；recovery trigger 尚未创建。
- 新 app release、3 项 dev env 更新和 disabled 30-minute recovery automation 的 dry-run 全部返回 `ok=true`；等用户基于这些实际变更预览明确确认后执行。
- 项目内 Teambition skill 对目标需求类型调用一次 `getProjectTasks` 并返回 311 条，UI 显示 `311/314`；差异和 gateway 截断行为尚未解释。安全 fixture 不访问真实需求，不能用 synthetic E2E 代替这个完整性确认。

## 目标
在妙搭 dev / 指定安全测试环境用最小化真实需求验证 MVP 主链路及降级路径。生产应用与真实协作者不作为验证对象。

## 2026-10-10 本地实现回归与既有目标冒烟证据

### 本地全量套件（两仓，均通过）
- root 仓（本轮更新）：`npm run typecheck` ✓；`npm test` → API **203/203**（含 PostgreSQL 集成用例）+ Web **21/21** ✓；`npm run build` ✓。
- 集成用例本轮可安全执行的前提已核实：`.env` 的 `DATABASE_URL` 指向**本机 unix-socket 隔离实例**（`postgresql://postgres@/rq_sys?host=/Users/jacko/.local/share/rq-sys/postgres`），不是妙搭托管库，建/删 schema 不触及线上数据。
- 妙搭 app 仓（本轮更新）：`npm run test:rqsys-route` → **13/13** ✓；`npm run lint` ✓；`npm run type:check`（server+client）✓；`npm run build:prod` ✓。

### 目标环境真实 Base 冒烟（lark-cli user 身份直连，POC 测试 Base）
- Base：`OddqbqBeOamFjFsR5IXcJdjknmd` / `tblxbyvbdLGVnLaO`（Ticket 02 POC 测试表，临时记录可删除；脚本不写执行人字段、不触发通知自动化）。
- `transport-real-smoke` read：`SEARCH-OK recordId=recvxwGs5Js0PA`；`PM-READ-OK status="待处理" module="方案设计" priority="P0"`。
- `transport-real-smoke` all：`CREATE-OK` → `UPDATE-OK` → `CLEANUP-OK`。
- `adapter-real-smoke`：`PUSH1 created=true` → `PUSH2 created=false snapshots=1 pmStatusReset="待处理"` → `VERIFY title=实质变化 pmStatus=待处理`（PM 五项确认字段零污染）→ `CLEANUP-OK`。
- 结论：Feishu Base transport/adapter **代码**已在真实 Base 上验证通过（搜索、创建、幂等重复推送、实质变化快照 + “待处理”重置、字段零污染、清理）。该验证经 lark-cli 身份直连完成，**不代表**妙搭 app 运行时的 Base 写入路径已验收。

### 本轮新增本地闭环
- 严格项目名解析和唯一需求任务类型选择有单测覆盖；不存在项目、同名项目或多个需求类型时均拒绝保存，不会猜测。
- 妙搭 app 补齐了 Feishu 用户搜索 API/选择器、需求池状态/批次/时间筛选，以及来源创建时周计划/负责人名单/字段映射持久化；对应路由、SQL 参数和 API 请求测试通过。
- 本轮没有恢复完整目标 E2E：未创建数据源、未同步 Teambition、未调用模型、未写目标 Base、未发通知、未启用周计划或发布新版本。

### provider 冒烟（本地）
- `provider-smoke.mjs`：`SMOKE-FAIL auth_error` —— 本地 `.env` 的 `AI_API_KEY` 已失效。合成非 PII 数据，未发送任何真实需求/联系人信息。此结果**不证明**妙搭运行时密钥状态。

### 环境与依赖
- dev 与 online 的 `+env-list` 现均列出**全部 7 个变量**名称（含 4 项 Base 凭据 `FEISHU_APP_ID`/`FEISHU_APP_SECRET`/`BASE_APP_TOKEN`/`BASE_TABLE_ID`），仅名称、未读取值。
- `open.feishu.cn` DNS **已恢复**（解析至公网地址）；`lark-cli` bot/user 身份均为 ready。此前记录的 DNS 阻断不再成立。

## 验收通知范围
用户授权测试阶段提醒可以发给本人，不得扩展到其他干系人。2026-10-10 已向用户本人发送一条阻塞提醒，message ID `om_x100b63af94aa58b0c4260c99d5f0b83`，回读确认内容与收件人均匹配。生产业务通知未发送。

## 当前事实（2026-10-10 新证据）
- 用户此前确认：Teambition 来源为 `室外产品-码表软固件需求池`；MVP 周计划暂定每周一 09:00（`Asia/Shanghai`）；验收测试通知只发用户本人。E2E 已按用户“进行 E2E 全量测试”的指示部分执行（本地两仓套件 + 目标 POC 测试 Base 读写冒烟通过），后续仍限定在安全测试范围，不扩展到生产写入或其他干系人通知。
- 已通过 Chrome 登录态只读页面确认 Teambition 项目名称，URL 中项目 ID 为 `6960a3187384fa11aa07d7e6`；页面显示 `311/314`。获准的项目内 skill 元数据查询已确认需求 task type ID 和 16 个项目级字段 ID/名称；字段类型/选项/类型绑定、raw API 条数、分页和 MVP 映射仍未确认。当前 shell 缺少 `TEAMBITION_GATEWAY_URL`，新请求在 HTTP 前因 base URL 未设置失败。旧 `TEAMBITION-LIVE-POC.md` 中的需求记录字段表来自另一项目，不能直接沿用。
- 2026-10-10 刷新登录态 RQ-Sys 工作台后，页面稳定显示“API 已连接”“尚未配置数据源”，且无错误横幅。当前前端实现先 await `/api/health`，再 await `/api/sources` 并仅在两者成功后显示 ready；因此这两条应用内只读调用已通过，来源列表为空，证明当前 runtime 至少能完成该 DB 读取路径。没有创建来源或执行同步。直接地址栏访问 `/api/health` 会被妙搭 CSRF 层拒绝（缺 header），与应用经 `backendFetch` 发出的请求不是同一条路径，不作为 API 故障证据。
- 密钥核验：源码 provider 默认指向 DeepSeek；`AI_API_KEY` 变量名本身不代表密钥归属。用户提供的终端截图显示 online 变量创建成功且 env-list 仅列出名称；此前本机 DeepSeek POC 的 key 已通过 T1–T3，但不证明妙搭运行时加载该变量。一次获准的本机合成模型请求返回 `network_error`。源码编辑器曾显示 `.env` modified，但内容未读；app repo 的 `.env` 路径受 Git 跟踪，若文件含真实密钥不得提交/发布。服务端密钥是否加载及目标运行时出网仍未验收。
- 妙搭 app 仓 `sprint/default` 远端 HEAD 为 `be2d20a448d20634b3d0a564aecb109ca5757202`。线上 release `7694878567301549280` 状态 `finished`，绑定 commit 正是 `be2d20a`。
- release `7694878567301549280` 已确认 `finished` 且绑定 `be2d20a`；一次对该运行地址的线上错误日志仍来自旧 release `6773cc4`，`/api/sources` 当时返回 500 `DEPTH_ZERO_SELF_SIGNED_CERT`。此前应用内只读请求通过，但本次未获取新的 runtime HTTP trace，故修复与当前 runtime commit 的关联仍未验收；Ticket 09 按用户要求暂停。
- online DB 通过妙搭 CLI 的 schema 与 SQL 查询均可访问，包含预期 13 张表；`source_configs` 列结构匹配迁移定义，`requirements` 含预期状态列、外键与索引，迁移历史记录从 dev 发布 13 张表到线上，`dev→main` diff 当前无待发布结构变更。表估算行数为 0。此项证明托管 DB 结构存在，不证明 RQ-Sys HTTP handler 在运行时连接成功。
- 一次早前的 online RQ-Sys app env-list 回读为空；随后用户终端截图显示 `AI_API_KEY` 创建成功且 env-list 列出变量名。openapi-key-list 和 automation-list 早前为空；online 行审计未启用。当前无法因 DNS 阻断再次核验。其它 AI/Base/Teambition 集成变量没有经验证的配置记录。
- app 登录要求已启用，访问范围为 tenant。Miaoda CLI 观测日志可识别登录请求用户；但源码中 identity adapter 刻意保持未实现，尚无经验证的服务端身份注入合同，不得开始角色权限写操作。
- `+member-list` 因平台 `feature_not_available`（3340005）不可经 CLI 管理协作者；不是用户授予通用“帮我完成”即可绕过的平台限制。
- `+env-list` 当前显示 online 已有 `GATEWAY_API_KEY`、`TEAMBITION_GATEWAY_URL`、`AI_API_KEY`；本次未改这三项。目标 Base 的 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`BASE_APP_TOKEN`、`BASE_TABLE_ID` 均未配置，值未读取。不能以 dry-run 模拟配置；须由管理员通过妙搭受信服务端 Secret UI 填写，按 `AGENTS.md` Agent 只准备清单不写平台变量。
- 用户提供的 Wiki/Base 链接解析为 Base「TB需求池」中的表 `tbl6Gfi0KJ2a1llK`（Base token 来自链接解析）。写入前只读确认只有默认文本字段且无记录；用户明确批准只创建缺少字段、不改 records。已创建 25 个 MVP 字段，回读共 26 字段（含初始「文本」），records 仍为 0。详细字段和边界见 Ticket 02 新增验收记录。
- 尚不能称 Base 已连接或同步已验收。接下来须管理员安全注入 4 项 server secrets，再进行只读权限/表映射确认；真实写入仅按用户批准的测试环境范围及 fixture 执行。当前链接表未配置通知自动化。

- D-10 的初始时间值已确认（暂定周一 09:00 Asia/Shanghai）；由于持久调度和 worker 恢复能力仍未验收，尚未配置或启用计划任务。

## Acceptance scenarios (截至 2026-10-10)

| Scenario | Result | Blocking evidence |
|---|---|---|
| 手动全量同步，含有负责人和无负责人的需求 | blocked | `/api/health`、`/api/sources` 只读路径曾通过；还没有配置来源，field types/options/bindings 和 approved map 未确认，也没有执行同步。 |
| AI 成功、低置信度、首轮失败/超时；验证分析结论不阻塞推送 | blocked in target / local POC passed | DeepSeek 本机 POC T1–T3 通过；online `AI_API_KEY` 变量创建/列出有用户截图证据，但运行时是否加载和成功推理未验证。 |
| 自动负责人匹配、姓名映射、手动映射、空负责人推送 | blocked in target | 有 Feishu Base POC 测试 Base/表，但目标运行时无已验证集成密钥/身份合同；当前 Teambition 项目字段映射也未核验。身份适配器必须保持未实现至身份合同在目标环境核验。 |
| Base 新建与重复更新、源实质变更快照/“待处理”重置、负责人后续分配/变更通知 | partial（adapter/transport 真实冒烟通过；app 运行时仍 blocked） | 本轮 lark-cli 身份直连 POC 测试 Base 的 transport/adapter 冒烟通过（创建/幂等重复推送/快照+“待处理”重置/字段零污染/清理）；但未走妙搭 app 运行时凭据与已映射需求 fixture，app 端 Base 写入与通知 workflow 仍未验收。正式测试通知限用户本人。 |
| 周调度、单项失败重试、服务重启恢复、审计追溯 | blocked in target | 用户暂定周一 09:00 Asia/Shanghai；尚未启用 scheduler，妙搭自动化/持久任务和 worker 恢复能力未验收，online 行审计关闭。 |

## Evidence log
- 2026-10-11 — 按 PRD revision 60 补齐 Web 需求详情的 U/M/S/C 建议、各自理由与证据、缺证提示。回归用例先因页面无维度内容而失败，改后通过（Web 文件 8/8）。正式 Base 表和 POC 测试表只读 schema 复核：正式表 26 字段，AI 优先级单选只有 P0/P1/P2；通知 workflow 未启用。Miaoda app role-list 总数为 0；latest finished release `7694878567301549280` 绑定 `be2d20a`，释放版控制器曾在 roles 缺失时采用 `pm` 默认值，当前本地代码已 fail-closed。没有改表、记录、workflow、角色或 release。
- 2026-10-11 — 修复未定义的 `BASE_PROJECT_ID`：Base push worker 从 requirement 的 `sourceConfigId` 加载来源项目 ID；手动推送重试统一入队，由 worker 执行。回归测试覆盖 Base 项目键传递及队列请求。复验 root API 216/216、Web 21/21、妙搭 app route 25/25，typecheck/build/lint 全部通过；PostgreSQL integration 连到已核实的本机隔离 socket。两仓 diff check 通过。当前 Miaoda 预览只读显示 API health/sources/batches/requirements 成功但来源为空。`lark-cli +role-list` 因 `open.feishu.cn` DNS 失败未拿到真实 role IDs，身份适配和线上写入保持未验收；未改线上变量/DB、未同步项目数据、未写 Base、未启用周计划、未发通知、未发布。
- 2026-10-10 — 用户要求“进行 E2E 全量测试”，本轮执行：root 仓 `npm run typecheck` ✓、`npm test` **API 196/196（含 PostgreSQL 集成）+ Web 20/20** ✓、`npm run build` ✓；妙搭 app 仓 `test:rqsys-route` **5/5** ✓、`lint` ✓、`type:check`（server+client）✓、`build:prod` ✓；两仓 `git diff --check` 均退出码 0。集成用例本轮可跑的前提是已核实 `DATABASE_URL` 指向本机 unix-socket 隔离实例（非妙搭托管库）。目标环境真实 Base 冒烟（lark-cli 身份直连 POC 测试 Base `OddqbqBeOamFjFsR5IXcJdjknmd`/`tblxbyvbdLGVnLaO`）全部通过：read `SEARCH-OK recordId=recvxwGs5Js0PA` + `PM-READ-OK status="待处理" module="方案设计" priority="P0"`；all `CREATE/UPDATE/CLEANUP-OK`；adapter `PUSH1 created=true`、`PUSH2 created=false snapshots=1 pmStatusReset="待处理"`、`VERIFY title=实质变化 pmStatus=待处理`（PM 五项零污染）、`CLEANUP-OK`。`provider-smoke.mjs` 返回 `SMOKE-FAIL auth_error`（本地 `.env` AI key 失效，合成非 PII 数据）。`+env-list` 复核 dev 与 online 均列出全部 7 个变量名（含 4 项 Base 凭据），仅名称未取值；`open.feishu.cn` DNS 已恢复，lark-cli bot/user 身份 ready。本轮未创建来源、未跑 app 端同步、未改平台变量/数据库、未发布、未启用 schedule、未发业务通知。
- 2026-10-10 — 本轮完成本地回归复核：主仓 API 单测 183/183、Web 测试 20/20、typecheck/build 通过；妙搭 app repo 路由测试 5/5、lint、typecheck、production build 通过。PostgreSQL integration 未运行，因为 `DATABASE_URL` 是否指向隔离测试库未确认。根仓 `main` commit `71be7e9`（ahead 1），妙搭 app 仓 `sprint/default` 为 `be2d20a`；46 个同路径 API 文件中 33 个不同，且 app repo 缺少 `GET /api/feishu/users`。部署 app repo 当前 commit 不会自动包含根仓实现。
- 2026-10-10 — 用户提供的终端截图证明 online 环境变量 `AI_API_KEY` 已创建，并且 env-list 能列出变量名；没有读取或展示变量值。当前只读 CLI 请求因 `open.feishu.cn` DNS 解析失败，无法复核线上变量列表或新 runtime trace。一次获准的本机合成模型请求（无业务数据）返回 `network_error`；不代表线上 key 无效，也不代表妙搭模型调用成功。
- 2026-10-10 — Teambition 只读 skill 元数据结果确认用户选定项目的需求 task type ID 与 16 个自定义字段 ID/名称。当前 shell 缺少 `TEAMBITION_GATEWAY_URL` 与 `GATEWAY_API_KEY`，新调用在请求前因 base URL 未设置失败。`~/Desktop/TB_Plan` 没有 `SKILL.md` 或网关 URL 配置，不能用于发现内部网关地址。
- 2026-10-10 — 用户要求暂停 E2E，先解决其他问题。本轮没有部署、发布、写线上环境变量/数据库、同步 TB 数据、写 Base、启用计划任务或发送通知。
- 2026-10-10 — 当前 DB TLS 首要错误被观测确认：线上 trace `9114901e14998adf0e523b14d73b4a42` 下 `/api/sources` 服务端 HTTP 500；错误码 `DEPTH_ZERO_SELF_SIGNED_CERT`，来自 `pg-pool` 握手验证。日志关联到 release commit `6773cc422db43807f433834779b745ce4a9a7597`。严格 TLS 校验未被关闭，未改用独立 `DATABASE_URL`。
- 2026-10-10 — 线上修复发布核验：release `7694878567301549280` 回读 `finished`，commit `be2d20a448d20634b3d0a564aecb109ca5757202`，`error_logs=[]`。此前 TLS 500 关联旧 `6773cc4`；本轮登录态工作台刷新后 health/sources 读请求成功，未配置任何来源。新 trace 与 release commit 的关联仍待 `open.feishu.cn` DNS/观测查询恢复后补齐。
- 2026-10-10 — online schema readback：13 张预期表；DDL changelog 有 `PUBLISH` 记录，dev→main diff 为空；`source_configs` 列与 migration 一致；`requirements` 结构、FK、pipeline/status/source-status/title-search 索引存在。只读 SQL 确认连接到 Miaoda 托管的 PostgreSQL 17.5 数据库，未返回或提取任何连接秘密。估算全表行数 0。后来工作台 `listSources()` 成功且返回空，验证了当前应用 runtime 的来源列表 DB 读路径；DB 写事务及完整业务持久化仍未验收。


## Test-table schema created (2026-10-10)
- The user-approved link resolved to Base `TB需求池`, table `tbl6Gfi0KJ2a1llK`. Before writes it had only the default `文本` field and 0 records. After explicit approval, 25 MVP fields were added; readback confirmed 26 fields total and still 0 records. No records were changed, no workflow was created, and the Base is not connected to the Miaoda app yet.
- Field names/types created: `TB需求ID` (text), `TB项目ID` (text), `执行人` (single user), `标题` (text), `需求说明` (text), `范围说明` (text), `验收标准` (text), `提出人` (text), `TB状态` (text), `TB链接` (URL text), `AI模块建议` (text), `AI优先级建议` (single select P0/P1/P2), `AI分析版本` (text), `PM状态` (text), `PM确认模块` (text), `PM确认优先级` (text), `处理人` (single user), `处理时间` (datetime), `结构化备注` (text), `推送状态` (select with default `待推送`), `最后推送时间` (datetime), `源版本` (integer number), `附件引用` (text), `TB创建时间` (datetime), `TB更新时间` (datetime).
- The existing app default map expects those names. Some values are storage placeholders in the current field contract (e.g. attachments as text); create has not validated app value serialization.
- The four server secrets remain absent from the online env name list. The administrator must enter them through Miaoda's trusted server-side secrets UI; do not send values in chat. After setup, first verify presence only and credentials/table access read-only. Do not start sync E2E until selected Teambition test project/owner fixture and target identity gates are resolved.

- 2026-10-10 — `+access-scope-get`: `require_login=true`, `scope=Tenant`; `+access-scope` 只证明访问范围设置，不证明服务端 identity provider 可用。源码身份适配器仍未实现。`+member-list` 返回平台 `feature_not_available` / 3340005，未变更协作者。
- 2026-10-10 — 用户本人飞书私信提醒发送并读回核实：message ID `om_x100b63af94aa58b0c4260c99d5f0b83`；未给群聊/干系人发送通知。
- 2026-10-10 — 刷新登录态工作台后状态为“API 已连接”“尚未配置数据源”，无错误横幅。按已部署前端的 `getHealth()`→`listSources()` 加载逻辑，应用内两个只读请求均返回成功；来源表为空。地址栏直接访问 `/api/health` 显示 `csrf token not found in header`，这是缺少妙搭应用请求 header 的直接导航结果，不替代应用内请求验收。只读 `+trace-list` / `+log-list` 本轮因本机 DNS 无法解析 `open.feishu.cn` 失败，因此新请求与 release commit 的 trace 关联仍待补。
- 最新 blocker 核验：health/sources 只读路径曾通过，source config 仍为空；online `AI_API_KEY` 创建有用户截图，但当前 DNS 阻断 env-list/trace 回读，运行时密钥和身份方案未验收。新选 Teambition 项目的需求类型 ID 与字段 ID/名称已查到，字段映射仍不完整；该项目是实际需求池，不是独立 test project。虽已有 Feishu POC test Base，仍需批准的测试字段映射/fixture。用户已确认测试通知仅发本人，周一 09:00 Asia/Shanghai 暂定；没有创建 schedule。
- 用户要求暂停 E2E。恢复前先对齐 root 与 Miaoda app 代码来源、补齐 TB 网关地址及只读字段映射、恢复 DNS/观测回读；E2E 仅在用户明确恢复且安全 fixture/身份/字段映射齐备后继续。周计划只在 runtime 和持久调度能力通过后再启用。

- 2026-10-10 — 本轮本地安全复验：API 单测 183/183（32 个文件；明确排除 PostgreSQL integration，未连接 `DATABASE_URL`），Web 20/20，root typecheck/build 通过；Miaoda adapter 路由/Drizzle 测试 5/5，lint 与 production build 通过，`git diff --check` 通过。PostgreSQL integration 未重跑，因为当前未确认测试连接串对应隔离数据库。本地工作树仍有用户已有及本轮新增的未提交改动，未 push。以上不能替代妙搭运行态验收；Miaoda app repo 是独立仓库。
- 2026-10-10 — 本轮只读运行验收：刷新线上工作台后“API 已连接”“尚未配置数据源”稳定呈现且无错误横幅；前端加载逻辑要求健康检查与来源列表读取成功后才进入 ready，因此 `/api/health`、`/api/sources` 的应用内 GET 均成功，来源列表为空。直接地址栏 GET `/api/health` 返回 `Forbidden，csrf token not found in header.`；该探测未走 `backendFetch`，不能据此判定应用内 API 失败。CLI 查询新 trace/log 因本机 DNS 无法解析 `open.feishu.cn` 未成功。未创建来源、同步、写 Base、发业务通知或启用 schedule。
- 2026-10-10 — 本轮本地安全复验：API 单测 183/183（32 个文件；明确排除 PostgreSQL integration，未连接 `DATABASE_URL`），Web 20/20，root typecheck/build 通过；Miaoda adapter 路由/Drizzle 测试 5/5，lint 与 production build 通过，`git diff --check` 通过。PostgreSQL integration 未重跑，因为当前未确认测试连接串对应隔离数据库。本地工作树仍有用户已有及本轮新增的未提交改动，未 push。以上不能替代妙搭其他运行态验收；Miaoda app repo 是独立仓库。

- 2026-10-10 — 本轮本地实现回归：root API 测试 203/203（含隔离的本机 PostgreSQL 集成用例）、Web 21/21、typecheck/build 通过；妙搭 app `test:rqsys-route` 13/13、lint、server/client typecheck、production build 通过。新增覆盖 Feishu 用户目录权限与租户过滤、需求池筛选、来源周计划/负责人名单/字段映射持久化、项目名及需求类型歧义拒绝。改动仍在两个独立仓库的本地工作树，未提交或发布。本轮没有恢复目标 E2E；历史 POC Base 冒烟证据未重跑。

## Current next action
- 妙搭平台 env / DB / release 写继续按 `AGENTS.md` 只准备、不执行；D-10 初始时间值已由用户暂定，但 scheduler 仍不能在缺少 runtime/worker 验证时启用。
- Ticket 09 状态：历史目标 E2E 已**部分执行**（本地全量套件 + 目标 POC 测试 Base 读写冒烟通过）；用户此前要求暂停目标 E2E，本轮继续完成本地开发和回归，没有恢复线上写入。剩余待办：① 按用户/妙搭工作流提交并发布当前 Miaoda app 改动，并在发布后对齐代码来源；② 验证 app runtime 加载四项 Base 凭据并进行只读权限/表映射确认；③ 完成选定 Teambition 项目的字段类型/绑定、获批 MVP 字段映射和安全测试 fixture；④ 在批准的测试范围内验证 runtime AI 推理；⑤ identity 适配器保持未实现，直到目标身份合同核验；⑥ 恢复线上 trace/观测后补齐运行请求与 release commit 关联；⑦ 验收持久调度、重启恢复及通知自动化。
- E2E 续跑/恢复时仅使用获批的测试 Base/fixture，通知只发用户本人。
- `.env` 在 app-scoped repo 中被跟踪且在线编辑器标为修改；不要提交/发布其中的真实凭据。若密钥确实进入 Git 历史，先轮换，再用受信 server-side secret 管理。
