# [blocked: project mapping, credentials, identity, test fixtures and E2E] 09 — 目标环境端到端验收

## 目标
在妙搭 dev / 指定安全测试环境用最小化真实需求验证 MVP 主链路及降级路径。生产应用与真实协作者不作为验证对象。

## 验收通知范围
用户授权测试阶段提醒可以发给本人，不得扩展到其他干系人。2026-10-10 已向用户本人发送一条阻塞提醒，message ID `om_x100b63af94aa58b0c4260c99d5f0b83`，回读确认内容与收件人均匹配。生产业务通知未发送。

## 当前事实（2026-10-10 新证据）
- 用户本轮确认：Teambition 来源为 `室外产品-码表软固件需求池`；MVP 周计划暂定每周一 09:00（`Asia/Shanghai`）；验收测试通知只发用户本人。完整验收仍按安全测试范围执行，不扩展到生产写入或其他干系人通知。
- 已通过 Chrome 登录态只读页面确认 Teambition 项目名称，URL 中项目 ID 为 `6960a3187384fa11aa07d7e6`；页面显示 `311/314`。项目 skill 的 `get_projects` 请求在本机返回连接失败，因此当前项目的 task type、字段元数据、raw API 条数和分页仍未确认。旧 `TEAMBITION-LIVE-POC.md` 的完整字段表对应另一项目，不能直接沿用。
- 2026-10-10 刷新登录态 RQ-Sys 工作台后，页面稳定显示“API 已连接”“尚未配置数据源”，且无错误横幅。当前前端实现先 await `/api/health`，再 await `/api/sources` 并仅在两者成功后显示 ready；因此这两条应用内只读调用已通过，来源列表为空，证明当前 runtime 至少能完成该 DB 读取路径。没有创建来源或执行同步。直接地址栏访问 `/api/health` 会被妙搭 CSRF 层拒绝（缺 header），与应用经 `backendFetch` 发出的请求不是同一条路径，不作为 API 故障证据。
- 秘钥核验：源码 provider 默认指向 DeepSeek（默认 endpoint/model），`AI_API_KEY` 变量名本身不代表密钥归属；此前本机 DeepSeek POC 的有效测试 key 已通过 T1–T3，但不证明妙搭运行时使用了当前 `.env` 值。妙搭源码编辑器中的 `.env` 显示为 modified；本轮没有读取其内容。app-scoped Git repo 将 `.env` 路径纳入跟踪，若其中含真实密钥，不要提交/发布，并应通过受信任的 server secret 配置注入；若已进入仓库历史应轮换。服务端密钥和目标出网仍未验收。
- 妙搭 app 仓 `sprint/default` 远端 HEAD 为 `be2d20a448d20634b3d0a564aecb109ca5757202`。线上 release `7694878567301549280` 状态 `finished`，绑定 commit 正是 `be2d20a`。
- release `7694878567301549280` 已确认 `finished` 且绑定 `be2d20a`；一次对该运行地址的线上错误日志仍来自旧 release `6773cc4`，`/api/sources` 当时返回 500 `DEPTH_ZERO_SELF_SIGNED_CERT`。我本次复核未获取到新的 runtime HTTP trace，故修复运行态尚未验收，Ticket 09 继续 blocked。
- online DB 通过妙搭 CLI 的 schema 与 SQL 查询均可访问，包含预期 13 张表；`source_configs` 列结构匹配迁移定义，`requirements` 含预期状态列、外键与索引，迁移历史记录从 dev 发布 13 张表到线上，`dev→main` diff 当前无待发布结构变更。表估算行数为 0。此项证明托管 DB 结构存在，不证明 RQ-Sys HTTP handler 在运行时连接成功。
- online RQ-Sys app env-list 为空；openapi-key-list 为空；automation-list 为空；online 行审计未启用。没有配置 AI / 飞书 Base / Teambition 集成变量或触发器。
- app 登录要求已启用，访问范围为 tenant。Miaoda CLI 观测日志可识别登录请求用户；但源码中 identity adapter 刻意保持未实现，尚无经验证的服务端身份注入合同，不得开始角色权限写操作。
- `+member-list` 因平台 `feature_not_available`（3340005）不可经 CLI 管理协作者；不是用户授予通用“帮我完成”即可绕过的平台限制。
- 用户已确认此前讨论的验收仅 dev 测试数据、测试阶段 E2E 写入，不包括生产写入、通知他人、online DB 变更。提醒接收人限定为用户本人。凭据应经受信任的服务端密钥入口配置，不通过聊天提供。Miaoda 平台 `spark:app:write` 变更仍受项目 AGENTS.md 中“环境变量/DB 写入在妙搭执行——只准备产物，不执行”的更具体约束；本 Agent 未执行平台 env / DB / automation / release 写入。
- 用户说“测试阶段可以随时给我发提醒”，提醒的精确内容/收件人/身份已另外确认并发送给用户本人。未设置或启用自动发送的通知；实际外部写入与周调度尚未测试。
- D-10 的初始时间值已确认（暂定周一 09:00 Asia/Shanghai）；由于持久调度和 worker 恢复能力仍未验收，尚未配置或启用计划任务。

## Acceptance scenarios (截至 2026-10-10)

| Scenario | Result | Blocking evidence |
|---|---|---|
| 手动全量同步，含有负责人和无负责人的需求 | blocked | `/api/health`、`/api/sources` 只读路径通过；还没有配置来源，且已选 TB 项目的 task type / field map 未验证，也没有执行同步。 |
| AI 成功、低置信度、首轮失败/超时；验证分析结论不阻塞推送 | blocked in target / local POC passed | DeepSeek 本机 POC T1–T3 通过；当前妙搭服务端密钥是否配置并被运行时读取未验证，源码 `.env` 不能代替服务端 secret。 |
| 自动负责人匹配、姓名映射、手动映射、空负责人推送 | blocked in target | 有 Feishu Base POC 测试 Base/表，但目标运行时无已验证集成密钥/身份合同；当前 Teambition 项目字段映射也未核验。身份适配器必须保持未实现至身份合同在目标环境核验。 |
| Base 新建与重复更新、源实质变更快照/“待处理”重置、负责人后续分配/变更通知 | blocked in target | Base 写入协议和通知 workflow 已在 POC 测试 Base 验证；但没有当前目标运行时凭据/已映射需求 fixture，不能宣称目标链路通过。正式测试通知限用户本人。 |
| 周调度、单项失败重试、服务重启恢复、审计追溯 | blocked in target | 用户暂定周一 09:00 Asia/Shanghai；尚未启用 scheduler，妙搭自动化/持久任务和 worker 恢复能力未验收，online 行审计关闭。 |

## Evidence log
- 2026-10-10 — 当前 DB TLS 首要错误被观测确认：线上 trace `9114901e14998adf0e523b14d73b4a42` 下 `/api/sources` 服务端 HTTP 500；错误码 `DEPTH_ZERO_SELF_SIGNED_CERT`，来自 `pg-pool` 握手验证。日志关联到 release commit `6773cc422db43807f433834779b745ce4a9a7597`。严格 TLS 校验未被关闭，未改用独立 `DATABASE_URL`。
- 2026-10-10 — 线上修复发布核验：release `7694878567301549280` 回读 `finished`，commit `be2d20a448d20634b3d0a564aecb109ca5757202`，`error_logs=[]`。此前 TLS 500 关联旧 `6773cc4`；本轮登录态工作台刷新后 health/sources 读请求成功，未配置任何来源。新 trace 与 release commit 的关联仍待 `open.feishu.cn` DNS/观测查询恢复后补齐。
- 2026-10-10 — online schema readback：13 张预期表；DDL changelog 有 `PUBLISH` 记录，dev→main diff 为空；`source_configs` 列与 migration 一致；`requirements` 结构、FK、pipeline/status/source-status/title-search 索引存在。只读 SQL 确认连接到 Miaoda 托管的 PostgreSQL 17.5 数据库，未返回或提取任何连接秘密。估算全表行数 0。后来工作台 `listSources()` 成功且返回空，验证了当前应用 runtime 的来源列表 DB 读路径；DB 写事务及完整业务持久化仍未验收。
- 2026-10-10 — online `+env-list=[]`、`+automation-list=[]`、`+openapi-key-list=[]`；13 张表的行审计均 disabled。服务端集成 key 状态为未配置；未泄露或查询密钥值。
- 2026-10-10 — `+access-scope-get`: `require_login=true`, `scope=Tenant`; `+access-scope` 只证明访问范围设置，不证明服务端 identity provider 可用。源码身份适配器仍未实现。`+member-list` 返回平台 `feature_not_available` / 3340005，未变更协作者。
- 2026-10-10 — 用户本人飞书私信提醒发送并读回核实：message ID `om_x100b63af94aa58b0c4260c99d5f0b83`；未给群聊/干系人发送通知。
- 2026-10-10 — 刷新登录态工作台后状态为“API 已连接”“尚未配置数据源”，无错误横幅。按已部署前端的 `getHealth()`→`listSources()` 加载逻辑，应用内两个只读请求均返回成功；来源表为空。地址栏直接访问 `/api/health` 显示 `csrf token not found in header`，这是缺少妙搭应用请求 header 的直接导航结果，不替代应用内请求验收。只读 `+trace-list` / `+log-list` 本轮因本机 DNS 无法解析 `open.feishu.cn` 失败，因此新请求与 release commit 的 trace 关联仍待补。
- 最新 blocker 核验：health/sources 只读路径已通过，source config 仍为空；online secrets/身份方案未验收；新选 Teambition 项目的 task type/字段映射未查到，且该项目是实际需求池，不是独立 test project。虽已有 Feishu POC test Base，仍需确认经批准的测试字段映射/fixture，不能直接把实际需求池批量写入测试表。用户已确认测试通知仅发本人，并暂定周一 09:00 Asia/Shanghai；没有创建或启用 schedule。
- E2E 顺序：观测接口恢复后核对当前工作台只读 GET 的 trace/live commit→重新通过 Teambition skill 查询新项目 task type / field map→由有权限管理员通过可信 server-secret 管理入口设置所需集成变量→在专用测试 Base 用获批的单条/合成 fixture 执行并清理→逐项验收 AI/Base/重试/恢复。周计划只在 runtime 和持久调度能力通过后再启用。

- 2026-10-10 — 本轮本地安全复验：API 单测 183/183（32 个文件；明确排除 PostgreSQL integration，未连接 `DATABASE_URL`），Web 20/20，root typecheck/build 通过；Miaoda adapter 路由/Drizzle 测试 5/5，lint 与 production build 通过，`git diff --check` 通过。PostgreSQL integration 未重跑，因为当前未确认测试连接串对应隔离数据库。本地工作树仍有用户已有及本轮新增的未提交改动，未 push。以上不能替代妙搭运行态验收；Miaoda app repo 是独立仓库。
- 2026-10-10 — 本轮只读运行验收：刷新线上工作台后“API 已连接”“尚未配置数据源”稳定呈现且无错误横幅；前端加载逻辑要求健康检查与来源列表读取成功后才进入 ready，因此 `/api/health`、`/api/sources` 的应用内 GET 均成功，来源列表为空。直接地址栏 GET `/api/health` 返回 `Forbidden，csrf token not found in header.`；该探测未走 `backendFetch`，不能据此判定应用内 API 失败。CLI 查询新 trace/log 因本机 DNS 无法解析 `open.feishu.cn` 未成功。未创建来源、同步、写 Base、发业务通知或启用 schedule。
- 2026-10-10 — 本轮本地安全复验：API 单测 183/183（32 个文件；明确排除 PostgreSQL integration，未连接 `DATABASE_URL`），Web 20/20，root typecheck/build 通过；Miaoda adapter 路由/Drizzle 测试 5/5，lint 与 production build 通过，`git diff --check` 通过。PostgreSQL integration 未重跑，因为当前未确认测试连接串对应隔离数据库。本地工作树仍有用户已有及本轮新增的未提交改动，未 push。以上不能替代妙搭其他运行态验收；Miaoda app repo 是独立仓库。

## Current next action
- 妙搭平台 env / DB / release 写继续按 `AGENTS.md` 只准备、不执行；D-10 初始时间值已由用户暂定，但 scheduler 仍不能在缺少 runtime/worker 验证时启用。
- Ticket 09 下一步：待 DNS/观测 API 恢复后回读刚才工作台 GET 的 trace/runtime commit；重新通过 Teambition skill 查询新项目 task type / field map；再由有权限的管理人员通过可信 server-secret 管理入口设置所需集成变量；最后仅在批准的测试 Base/fixture 范围执行 E2E，通知只发用户本人。
- `.env` 在 app-scoped repo 中被跟踪且在线编辑器标为修改；不要提交/发布其中的真实凭据。若密钥确实进入 Git 历史，先轮换，再用受信 server-side secret 管理。
