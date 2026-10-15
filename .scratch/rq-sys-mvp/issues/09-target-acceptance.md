# [核心链路验收通过；Dev 编辑器平台预览问题保留] 09 — 目标环境端到端验收

## Online 隔离验收与恢复（2026-10-15 下午）

- 用户明确批准定时合成模式及 Online 临时切换/恢复。默认关闭的 `RQSYS_SCHEDULE_FIXTURE` 只允许指定来源、最长两小时和精确 POC Base；sync/analysis/push 每次执行均守卫，恢复正式配置后延迟夹具不得调用外部系统。单项重试沿用原夹具身份；策略拒绝为终态，同步 batch/job 原子失败并带 attempt fencing。两轴代码复核发现的身份重试/孤儿批次/迟到覆盖均已修复。
- **Online 手动完整链路通过：** batch `9fc4b67f-9b6a-4d28-8022-a87a5bfea879` 1/1；需求 `70d77cd3-d562-49d5-9a14-d8632d2a6c24`。首次 analysis 被安全策略拒绝，旧摘要未保存原因，不能认定具体根因；新增有限原因码后在新发布实例重试成功。真实 DeepSeek 分析为“无法识别 / 低置信度”，priority 为空、owner `not_required`，仍推送成功。独立 POC Base readback `reczz28NbRH5CwFh`：source/analysis v1、待处理/已推送。新诊断只保存常量原因，不输出环境值。
- **平台 cron + 持久计划 + 队列 + AI + Base 组合路径通过：** 线上自动化日志 15:40:24、15:45:59 两次触发/执行均成功；对应服务日志 `RQ-Sys scheduled work poll completed`，trace `d9e75faeb77b98275fc5b400d41d0ef5` / `2c454790f7f54a32ec799239cfa821b9`。只有一个 scheduled batch `25638a3a-9695-4c6e-9483-7e70b223e1f1`，1/1、0失败；幂等窗口 `fixture-sched:99331edb-663b-4635-99f4-597e26304ab1:_batch_:2026-10-12T01:00:00.000Z`。需求 `48da6421-c7a4-43fa-ac39-8be541285a41` 已分析/已推送；独立 Base `reczz28Nbhq0Mvtw` 读回 source/analysis v1、待处理/已推送、模块/优先级空。第二次真实平台投递未创建重复 batch/job/需求。未访问 TB，不替代 TB 语义/分页验证；新行无负责人，未通知其他人。
- 15:30 后立即查询无投递日志，稍后记录实际执行为15:40:24，不能把即时查询为空当成永久失败。CLI 拒绝5分钟 cron（最小30分钟），未生效；随后临时 `15,45 * * * *` 保持30分钟间隔。调试按钮曾报“预览服务未就绪”，不计成功调度证据。
- **恢复完成：** 先停 cron、关闭来源/周计划，回读0 queued/running，再将4项 Base/fixture 变量恢复备份并删除新增 mode。全部原9项变量逐值比对相等，密钥未变；cron恢复 `*/30 * * * *`、Asia/Shanghai、disabled。来源恢复 disabled、周一09:00、Asia/Shanghai、schedule disabled。仅保留两条合成历史用于审计，Online业务记录仍为0；Dev业务311条未改。
- **验收发现的详情刷新问题：** 两仓刷新列表时同步重取展开详情，防止后台已完成而详情仍显示pending；用请求版本守卫防止A的迟到刷新覆盖后选B。先红后绿回归及两轴复核通过。
- **当前本地回归：** API266/266（含隔离本机PostgreSQL）、Web45/45、Miaoda76/76；两仓类型/构建、Miaoda lint、alignment21/21、diff检查通过。新代码和发布结果见下方追加记录。

最终发布核验：root代码 `8e5ff4f` 已推 main；Miaoda代码 `be3be6d6bf5599155384f746c4a1fddcca6fbe47` 已推 sprint/default。最终 release `7696803946761276694` 为 finished，绑定该提交、error_logs=[]；它包含安全定时夹具与详情刷新/迟到响应修复，使用恢复后的原Online配置。新实例登录/API及fixture入口关闭状态已检查；需求页展开定时夹具后点击刷新，详情仍正确显示analyzed/not_required/pushed和POC record引用。截图 `/tmp/rqsys-online-accepted-20261015.jpg`。最终只读SQL再次确认来源/计划false、周一09:00 Asia/Shanghai、0活动job/batch、0业务行；定时需求恰好1源快照/1分析/1push run/1sync job。


剩余平台问题：编辑器 Dev 沙箱/内嵌 IDE 仍间歇 `400 ErrorSandboxNotRunning`、`biz_status:toStart` 或“IDE加载失败”。进入代码工作区唤醒后 `/dev/health` 为200/ready，独立 Dev 可恢复；这是保留的平台开发工具问题，不能称已根治。Online 的隔离完整链路与组合调度已有当前证据，可据此进入受限内测。未独立复测另一用户完整写操作；8个模块仍按已批准的Web/DB-only边界，优先级规则未发布时继续留空。

## 较早验收闭环（2026-10-15 上午）

- **发现并修复目标目录写入异常：** Dev 新增临时人员成功，但更名失败。使用同一临时人员在平台注入数据库上复现：`SELECT pg_advisory_xact_lock(...)` 返回 PostgreSQL `void`，妙搭 JSON 驱动报 `Unexpected end of JSON input`。人员更名、人员删除、模块保存共三处改为 `IS NULL AS lock_acquired`，保留原事务与锁。两仓先补失败回归，再修复；未改表结构、鉴权、业务 API 或 `.env`。
- **目标 Dev 目录全路径通过：** 临时人员新增/更名；模块新增/更名并关联临时人员；关联人员再次更名后模块分配自动跟随；删除人员后模块显示“未分配”；删除临时模块。最终只读 SQL 回读为 7 人、54 模块、已发布字典 v6，entries 与 v1 完全相同，0 活动作业、0 启用周计划。只操作 `RQSYS验收人员-20261015*` 和 `RQSYS验收模块-20261015*`，临时项已清理。
- **8 个 Base 不支持模块逐项通过：** 使用既有合成需求 `aa7ddb47-4b52-4dbe-b758-ceeb6f878854` 和 POC record `reczz28NHB2Vegk7`，构造受控分析版本 2–9，调用真实目标 repositories、Base push service 和 Feishu transport。8 项均推送成功，返回 `not_in_base_select_options`；Web/DB 保留模块，同幂等键重放不新增 Base 行，PM 字段和空模块未被覆盖，审计保留省略原因。独立 Base 回读只有 1 行，源版本 1、分析版本 9、`待处理`/`已推送`，模块和优先级留空。这里的分析输出是 `acceptance_mock` 序列化夹具，**不是模型语义分类质量的证据**；没有调用 TB、模型或通知其他人。8 项为日志/异常文件管理、电源管理（后续转交）、GNSS管理、显示设置、系统管理、偏好设置、锁屏/解锁、场景+表盘+场景设置（后续转交）。
- **第二用户登录：** 用户针对第二位租户成员登录验收请求回复“已登录”。按用户反馈记录登录通过；未独立读取另一账号的 actor/API 或逐页操作，不扩大为第二用户全操作验收。
- **提交和发布：** root `eb4a4dd` 已在用户明确授权后推送 `main`；app `d64d309ef49cf55bb5011fc348759e58df936c72` 已推送 `sprint/default`。Release `7696725123818540278` 为 `finished`，绑定该 app commit，`error_logs=[]`。发布后当前用户重新授权既有权限并进入 Online 工作台，`API 已连接`，人员 7、模块 54 可读。Online 未进行测试数据写入或业务同步。
- **本地回归：** root API 254/254（含本机隔离 PostgreSQL integration）、Web 43/43、Miaoda 73/73；两仓 typecheck/build、Miaoda lint、alignment 20/20 及 `git diff --check` 通过。截图：`/tmp/rqsys-online-modules-20261015.jpg`。
- **Dev 生命周期边界：** 本轮初始直连文档再次捕获 `400 ErrorSandboxNotRunning` / `biz_status:toStart`。进入 Code 工作区后 `/dev/health` 返回 HTTP 200、`ready:true`，独立 Dev 重载恢复 311/311 并完成上述 CRUD。编辑器内嵌区域仍出现“系统启动中/IDE 加载失败”，未修复平台生命周期问题。

**上午快照（由上方 Online 证据覆盖）：** 编辑器内嵌预览稳定性；平台 cron 与启用中的持久安全测试来源的组合验收。平台 cron 关闭态投递、目标错窗幂等与 worker 租约接管已分别通过；现有 fixture 入口仅支持手动，调度器生成真实 TB job，直接启用真实来源不能充当安全夹具测试。正式周计划及干系人通知保持关闭。本轮没有 TB API 请求。

## 追加验收闭环（2026-10-14）

- CLI Keychain 刷新问题已通过正常沙箱外执行解决；既有登录和权限可用，无新增授权或密钥变更。
- 新 Dev 合成批次 `4cd73a7f-48bf-4011-8a3d-1af7c2324ce7`：1/1 成功、0 失败；AI 已分析、Base 已推送。POC record `reczz28NGUPExYnY` 回读版本 1、`待处理` / `已推送`，模块和优先级留空符合弱证据夹具/未校准规则。
- 只将该合成行分配给当前用户贾浩。POC 自动化运行 `7696481037590072568` 在 19:17:24 成功；本人消息搜索实读到 `om_x100b63c2029724a8def194eec76e31b`（19:17 私聊，正文匹配安全测试需求）。[本人测试通知](https://applink.feishu.cn/client/chat/open?openChatId=oc_a333a80cc307650f7a1d343ef6b5a0ba&position=4)。不是仅凭发送步骤推断送达。
- 目标错窗/恢复演练使用平台注入数据库、真实 scheduler/repositories、仅内存启用的周一 09:00 配置及命名空间隔离的 fixture job。相同过期窗口两次调度仅生成一批次/一 sync job；探针 worker 领取后退出，真实 Dev worker 在租约过期后接管。批次 `80d4d908-966e-4e2d-a38c-9249b9126e52` 1/1 成功；job `a3b22776-941b-4113-9c34-6685ef351f37` attempt=2 / succeeded，source snapshot=1，POC record `reczz28NHB2Vegk7` 只有一行且版本为 1。未启用持久化真实周计划，未调用 TB。
- Dev 服务 PID 2003→4616 自动恢复，worker 已启动。工作台恢复后，健康、来源、需求、批次、总览 API 刷新全部成功。独立 Dev 地址连续两次完整加载成功、显示 `API 已连接` / `311/311`，需求池可读取。编辑器内嵌预览刷新仍间歇 `应用加载失败`，切换面板可恢复已加载工作台；尚未取得这次内嵌失败请求的 HTTP 状态/响应体，不能套用旧的 PreviewProxy 400，也不能宣布内嵌问题已根治。
- 云端平台自动升级 commit `130701b` 与本地 `5918960` 的 62 个业务文件内容一致（combined SHA-256 `a278fc210a798e95702a470a9275d2f829b4cb4c6c84b16f1501b654c2d1533b`）；`.env` 原改动保留。Dev 为 311 TB + 10 合成夹具、0 活动 job/batch、7 人/54 模块、0 优先级规则、0 启用周计划。访问配置 `Tenant` / `require_login=true`。
- 最后单独重启已核实的前端组：Vite PID 1895→7840，后端仍为 4616；`/dev/health` HTTP 200 / `ready:true`，独立入口再次冷加载成功且 311/311。内嵌编辑器重载仍失败，因此前端重启没有根治该问题。最终只读汇总确认 311 TB + 10 夹具、0 活动 job/batch、0 启用计划，新合成批次仍 1/1 succeeded。
- 尚余：内嵌预览稳定性；第二位真实租户用户登录；8 个不支持模块的目标推送/省略行为；平台 cron 与启用中的持久安全测试计划的组合验证。此次已关闭错窗幂等及进程退出后租约接管的证据缺口，但并不等于所有调度/访问路径已验收。

本轮无产品代码变更或发布；正式周计划和干系人通知保持关闭。独立可用入口：<https://ecn8egz1lhkq-app_17fqkjwyx1u-1877652261857433.aiforce.run/app/app_17fqkjwyx1u?locale=en_US>。

## 较早复核（2026-10-14，由上方追加记录更新）

- **正式版页面与只读业务 API：** 登录态工作台显示“API 已连接”。需求池、同步批次、负责人映射和审计页面均加载到 API 返回的状态；当前无业务需求、批次或待映射负责人。审计页可读到来源配置变更记录。没有触发真实同步、AI、Base 写入或通知。
- **正式版来源设置写入/回读通过：** 项目为`室外产品-码表软固件需求池`；同步关闭，周一 09:00 `Asia/Shanghai`，周计划关闭。按用户先前授权，将时间暂改为 09:01 后，页面提示“来源配置已保存并从 API 重新读取一致”；再恢复 09:00 保存，页面再次确认读回一致。最终同步开关与周计划开关均为关闭，审计页出现对应配置变更记录。
- **正式版人员与模块目录：** 页面 API 加载完成后，人员页返回截图中的 7 人；功能模块页返回 54 项及截图对应的负责人分配。首次页面快照发生在请求完成前，显示的临时空态不是目录缺失。优先级页没有已发布校准规则，符合“规则发布前优先级留空”的决策。
- **正式版视觉复核：** 工作台导航、状态卡、批次空态和来源状态在页面可见；总览显示 0 条业务需求/0 批次及来源停用。发布版 UI 的基本布局和空态可读，尚不等于完整业务链路验收。
- **Dev 预览网络证据与阻塞：** 之前从应用页面进入需求池时看到 `Request failed (404)（REQUEST_FAILED）`。本次直接在已登录 Chrome 的 Dev 预览 Network 面板复核，实际加载文档请求为 `GET https://ecn8egz1lhkq-app_17fqkjwyx1u-1877652261857433.aiforce.run/app/app_17fqkjwyx1u?locale=en_US`，状态 `400 Bad Request`，响应体为 `{"error_code":"ErrorSandboxNotRunning","kerr_code":"k_sbgw_ec_400002649","message":"httpCode:400, error_msg: k_sbgw_ec_400002649 ErrorSandboxNotRunning client_error|sandbox not running|cause: [@lark.apaas.sandbox_gateway@PreviewProxy: sandbox fileOperate status is not ready, biz_status:toStart, fail_reason: ], codeId:400002649, module:sandbox_gateway"}`。重载后仍为同一 400；Network 面板没有捕获到 404 请求。由此当前请求在应用代码加载前已被 PreviewProxy 拦截，尚不能把先前页面内 404 归因到 `/api/requirements`，也不能据此改代码。已发布提交包含 `/api/requirements` 路由，本地 Miaoda checkout 与 release commit 一致。下一步须先让 Miaoda Dev sandbox 进入 running/ready，再重新捕获页面内失败 API 的 URL/状态/响应体；本次证据未记录 Cookie、令牌或请求头。未触碰两个用户云端编辑会话，也未在 Dev 启动同步。
- **本轮预览重启复试（2026-10-14）：** 在原编辑页点击“重新加载”，又从新 Chrome 标签打开同一编辑任务并再次重载；两次均先出现“系统启动中/应用加载中”，随后回到“应用加载失败”。iframe 为 `about:blank`；接口日志通道显示“未连接”，成功/失败请求均为 0，列表无记录。新标签复试未消除故障，当前没有应用级 API 请求可供定位；之前的 404 仍未复现。没有改代码或发布，也没有触发同步、Base 写入、通知或计划任务。
- **追加重启复试（2026-10-14）：** 对妙搭编辑器页面本身执行整页重载后，编辑器会话恢复，但 Dev 预览仍显示“应用加载中”；iframe 仍为 `about:blank`，预览刷新控件处于禁用状态。没有产生新的应用级请求或 404，也没有改代码、发布或触发任何业务写入。当前阻塞仍在 Dev sandbox/PreviewProxy 启动阶段。
- **沙箱恢复排查（2026-10-14）：** 从妙搭应用入口新开页面后仍自动回到同一个开发任务；在预览失败页执行应用级“重新加载”，等待 15 秒后再次显示“应用加载失败”，iframe 为 `about:blank`、页面日志为空。当前 `lark-cli apps` 没有沙箱状态/重启命令，项目附带的妙搭技能也未定义用户侧恢复流程。无 Cookie/令牌的直连 GET 只返回 302 到登录派生 Cookie 页面，不作为沙箱状态证据；此前已登录预览网络面板捕获的 400 `ErrorSandboxNotRunning` 仍是有效诊断。已排除单一浏览器标签或编辑器页面缓存，尚无可用用户侧修复入口；需要妙搭平台恢复该 app 的 Dev sandbox/PreviewProxy。
- **本轮本地回归（2026-10-14）：** root API 253/253（含随机临时 schema 的 PostgreSQL integration）、Web 43/43、Miaoda 路由 72/72；两仓 typecheck/build、Miaoda lint/stylelint、共享逻辑对齐和 `git diff --check` 均通过。未发现可归因于当前预览加载故障的代码失败。
- **夹具与 Base 约束：** 已批准的隔离 POC Base 模块单选保留 50 个选项（4 个原选项 + 46 个词典模块）；另外 8 个模块仅用于 Web/数据库。`BASE_FIELDS_JSON` 的值此前已按同一 50 项配置，优先级选项仍是 P0/P1/P2；正式 Base 未修改。发布版 app-mediated fixture→AI→POC Base upsert/readback 及只通知当前用户的完整路径仍未验证。
- **调度安全：** 正式版来源的周计划保持关闭；Dev 汇总中 `enabled_schedule_count=0`。应用自动化清单有 `rqsysWeeklySyncRecovery`，类型为 cron、频率 `*/30 * * * *`、时区 `Asia/Shanghai`，当前为 disabled。本轮未启动真实 TB 同步。真正周计划启用后的错窗恢复、durable worker 重启和第二位已登录租户用户访问仍未验收。
- **合成目标 E2E 与通知（2026-10-14）：** 已加载的 Dev 应用会话中，固定合成批次 `944d4ff4-ac0f-4d04-8dff-92772581020e` 完成 1/1、0 失败；页面显示拉取完成、AI 已分析、Base 已推送，负责人未匹配。详情返回模块“无法识别”、整体低置信度及理由/证据，U/M/S/C 建议带证据，优先级留空；这符合弱证据 fixture 和未发布优先级规则。隔离 POC Base 对应记录回读为 `待处理`、`已推送`，source/analysis version 均为 1；“无法识别”未写入单选模块字段符合约定。将该记录负责人设为当前用户时未勾选 Base 内置“同时发送通知”；POC 工作流配置的接收方是执行人，运行日志在 18:30:56 显示运行成功，耗时 1.3 秒，`发送分配通知` 步骤成功。POC 表当前 8 行；清理了误建的 1 条空白行。该证据只覆盖合成数据和当前用户。
- **重启复核与本地可靠性测试（2026-10-14）：** 完成上述 E2E 后再次打开妙搭编辑器预览，等待并点击预览入口仍停在“系统启动中…”，未加载应用 iframe；本次没有应用级请求。之前捕获的 PreviewProxy `400 ErrorSandboxNotRunning` 仍是可用根因证据，不能据此声称已恢复，也不应改业务代码。针对 due-window、幂等调度和 worker lease/fencing 的本地测试 20/20 通过；这不替代目标 Miaoda 的错窗恢复和 durable worker 重启验收。`lark-cli apps +automation-list` 本轮因本机 keychain 无法写入刷新凭证而未返回结果，未绕过该限制。
- **CLI 与发布回读：** 首次 `+db-execute` 调用因本机 DNS 失败而未执行 SQL；获准重试后只读汇总成功，未读取需求详情。最近发布仍为 `7696073033094450405` / `finished`，绑定 app commit `59189609c8260f6201d15e990ba2d8ca00e4f355`，`error_logs` 为空。

尚未完成：让 Miaoda Dev sandbox 进入 running/ready，并在恢复后复查最新预览及页面/API 请求；若应用启动后仍复现需求池 404，再按真实 URL、状态码和响应体修复（当前 404 未复现，不能先改业务代码）；在安全测试来源验证错窗恢复与 durable worker 重启；用另一位普通已登录用户验证登录访问范围。311 条 TB 原始 API ID 与 Dev 业务数据已对齐，`311/314` 不再是当前同步差异；历史额外 3 条仍未逐条识别。正式周计划与干系人通知保持关闭。

## 验收更新（2026-10-13，发布后）

- root commit `ae8fc89` 已推送到 `main`；Miaoda `sprint/default` commit `59189609c8260f6201d15e990ba2d8ca00e4f355` 已推送。Release `7696073033094450405` 已 `finished`，绑定该完整 app commit，`error_logs` 为空。
- 修复并发布了 PostgreSQL `TIME` 读回 `HH:mm:ss`、而 API 仅接受 `HH:mm` 导致的来源设置更新 `400 VALIDATION_FAILED`。本地 API GET→PUT→GET 与 PostgreSQL round-trip 回归已通过；发布后登录态设置保存/回读仍待核验，周计划继续关闭。
- 最新本地验证：root API 253/253（含隔离 PostgreSQL integration）、Web 43/43、妙搭路由 72/72；typecheck/build、妙搭 server/client typecheck、lint/stylelint、直接生产构建、共享逻辑对齐及两仓 `git diff --check` 通过。妙搭 wrapper `npm run build` 因 npm mirror DNS (`ENOTFOUND registry.npmmirror.com`) 未完成；直接 server/client 生产构建通过。
- Dev source-only 批次已按 TB 原始 API 的 311 个唯一需求 ID 完成数据对齐：311 条业务需求已拉取，另保留 7 条合成夹具；0 分析、0 推送、0 失败，0 running batch/job。此模式不调用 AI、不推 Base、不通知。周计划和恢复触发器保持关闭。
- `311/314` 已不再作为当前数据对齐阻塞项：原始 TB API 和 Dev 持久化数据均为 311 个唯一需求 ID，旧 UI 分母口径不可靠；历史多出的 3 条未被逐项识别，不能推断为测试工具。后续验收使用 TB 原始接口范围作为基准。
- 尚未完成：最新 release 的已登录来源设置保存/回读与视觉复核；发布版合成 fixture→AI→隔离 POC Base upsert/readback→仅通知当前用户；错窗恢复和 durable worker 重启；租户登录态的目标行为复核。不要启用正式周计划或发送干系人通知来替代这些测试。

## 较早验收更新（2026-10-13，source-only 发布；由上方最新记录补充）

- root source-only 实现 commit `c3a91b2` 已推送至 `main`；妙搭 `sprint/default` 已推送至 `4de6d8c`。Release `7695978028435049655` 为 `finished`，绑定完整 commit `4de6d8cb038c31769365d345b6a5e87686d40873`，`error_logs` 为空。
- 本地验证：root API 235/235（未运行指向非 loopback 数据库的 PostgreSQL integration）、Web 39/39、妙搭路由 66/66；根仓 typecheck/build、妙搭 server/client typecheck、lint、production build、共享逻辑对齐和两仓 `git diff --check` 均通过。最后一轮审查发现并修复了 job 记录缺失时 source-only 单项重试可能落入完整流水线的问题。代码已推送并发布。
- 本轮经妙搭 `+db-execute` 只读聚合回读确认：1 个启用来源、37 条需求（7 条夹具）、7 人、已发布字典 54 个模块、0 running batch/job、周计划关闭。查询只返回汇总数，没有写入。
- Teambition 原始需求 API 最后复核为 311 条、311 个非空唯一 ID；UI `311/314` 的额外 3 条仍未识别。按用户指示，导入范围采用 API 的 311 条，不将 3 条臆断为测试工具。
- 手动 `source_only` 同步已发布：保存 TB 源数据与快照，不排 AI、不做负责人匹配、不推送 Base、不通知；单项重试也从持久化批次键恢复该模式。完整同步仍为默认；后续完整同步会重新排队处于 `pending` 的分析。目标 Dev 数据对齐尚未执行。
- Dev 尚未对齐到 311 条（最新聚合为 37 条，包含此前确认的 7 条夹具），且周计划关闭、无运行批次/作业。发布后开发态入口在 Chrome 可打开，但预览一直处于“系统启动中… / IDE 加载中…”，因此 source-only 同步尚未触发、Dev 数据未改变。发布版 app-mediated E2E、启用测试周计划后的错窗恢复、durable worker 重启仍未验证。周计划和干系人通知保持关闭。

## 历史处置记录（2026-10-12，已完成）

用户授权后完成以下处置。所有目标侧写入均已执行并回读验证；密钥值全程未打印。

- **Dev `AI_API_KEY` 已修复。** 修复前平台值直连 provider 返回 `HTTP 401`（`api key: ****0d15 is invalid`），这正是 dev 侧 app-mediated 分析报 `AI provider authentication failed` 的原因。已用 online/`.env.local` 同一有效值经 `+env-set` 写入 dev；回读 hash 与有效值一致，实测 provider 返回 `HTTP 200`。
- **误触批次已隔离。** 批次 `020073d7-17ec-4c1f-8521-56a300882b8d` 置为 `failed`、`completed_at` 补齐、计数按实际 `sync_items` 校正为 total 30 / succeeded 30 / failed 0，并在 `error_summary` 注明为验收期误触且已保留导入行。**30 行数据保留。**
- **卡住作业已取消。** sync job `16a3be4c-c55b-4c4c-8e16-3b457d21091b`（租约过期）与 analysis job `ebb5a9a5-1141-4484-afea-d7d92c339eba`（attempt 5、租约过期）置为 `cancelled`；对应的 `analysis_runs` `61f9d27c-bbf3-42c5-af7d-a703a299f8a6` 由 `running` 结算为 `failed_retryable`。回读确认：running 批次 0、running 作业 0、running 分析 0，唯一来源不再被 `ActiveBatchConflict` 阻塞。
- **未泄漏确认。** 30 条真实 TB 需求全部停在 `owner_state=pending_mapping`（有 TB 负责人但未映射飞书用户），符合既定不变量；`base_record_id` 为空，POC Base 未出现任何真实需求行。
- **POC Base 残留清理。** 删除本人早前验证失败留下的两条探针记录 `recvxI4GS86HHO`（adapter-smoke-临时）与 `recvxI4PLj1Jjf`（select-probe-临时），9 → 7 条。保留 5 条合成夹具记录与 2 条 POC 基线记录作为验收证据。
- **online 夹具开关收紧。** online `RQSYS_ENABLE_TEST_FIXTURES` 由 `true` 改为 `false`。该路由此前已因双键守卫（必须同时匹配安全 POC Base）在 online 不可用，本次为纵深防御。
- **两仓已推送。** root `main` → `b023600`，app `sprint/default` → `cd64e8d`；两仓工作区干净。

## 前一版发布记录（2026-10-12；已被后续 release 取代）

`+release-create` 连续 9 次返回 `code 500000049` 后，**第 10 次成功**：

- release `7695624698437651669`，`+release-get` 轮询至 **`finished`**，绑定 commit **`cd64e8dc6152e0eca6b55f266ffe7ff97cecadba`**（即 app `sprint/default` HEAD），`error_logs` 为空。
- 线上地址：`https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`。
- 发布后检查线上日志：**2026-10-12 当天 ERROR 记录为 0**（最新 ERROR 仍为 2026-10-11 的历史记录）。

**根因（高置信，但未做对照实验证实）**：唯一变化的变量是 `--apply-reason` 的取值。此前 9 次都用**含 ASCII 冒号**的英文理由（`"fix: correct Base failure classification and retry audit attribution"`），全部失败；改用**不含冒号**的简短理由（`"RQ-Sys MVP 修复发布"`）后**第一次即成功**。因此判断平台发布接口对含冒号的理由处理异常，并返回了泛化错误。**下次发布请避免在 `--apply-reason` 中使用冒号**；若再遇 `500000049`，先换一个不含冒号的纯文本理由重试，而不是反复重发同一参数。

已排除的其它因素（保留以便复核）：`git` 与 `origin/sprint/default` 一致；`+db-env-diff` 无待发布结构变更；`npm run build:prod` 通过；推送提交不含 `.env` 或密钥；执行过 `+git-credential-init` 刷新凭证后再 push（`Everything up-to-date`）并重试仍失败——这些排除了"分支未同步 / 凭证过期 / schema 未发布"这类解释。

另记录一个本地可复现但**与本故障无关**的观察：平台部署构建命令 `npm run build`（`scripts/build.sh`）在未设置 `CI=1` 时会于步骤 0 `npx fullstack-cli action-plugin init` 进入交互式提问并以 `ERR_USE_AFTER_CLOSE` 退出；设置 `CI=1` 后正常（"No plugins found"）。该脚本为 CLI 自动生成，本次未改动。

### 当时尚未验收（当前状态见文末）

- 发布版 runtime 的 app-mediated 完整 E2E：发布本身已完成且冷启动无错误日志，但**尚未在已登录浏览器里跑通** sync → AI → Base → 仅通知本人。可执行步骤见 `deployment/TARGET-ACCEPTANCE-CHECKLIST.md`。
- 恢复触发器的**错窗恢复**语义（触发器投递与关闭态安全已通过，见下）。
- Teambition 项目 2026-10-12 再次通过项目 skill 原始只读接口查询，仍为 311 条、311 个非空唯一 ID、无重复/缺失 ID；UI 的 `311/314` 口径仍需在页面确认，不能推断多出的 3 条是什么。
- 空模块词典和未发布优先级规则是已接受的 MVP 默认值，不阻塞上线：模块保持“待分类”、优先级留空；Base 目前仅允许 P0–P2，因此未校准规则不得输出 P3。
- 周计划与干系人通知保持关闭。

### 恢复触发器演练：**已实跑并通过**（2026-10-12）

本轮在确认安全前提后完成了此前一直搁置的恢复触发器演练：

- **安全前提（代码级确认）**：`createDueSyncJobs` 对 `!source.enabled || !source.scheduleEnabled` 的来源直接跳过；Dev 唯一来源 `enabled=true` 但 `schedule_enabled=false`（时间 09:00、周一、`Asia/Shanghai`），且 `pipeline_jobs` 无 `queued` 作业。因此 `pollOnce`（= `createDueSyncJobs` + `drainReadyJobs`）在当前状态下不会创建任何真实同步工作。这修正了我此前"启用触发器可能触发真实同步、风险不可控"的判断。
- **演练过程**：`+automation-enable` 启用 → 等待一个 cron 窗口（`*/30 * * * *`、`Asia/Shanghai`）→ 回读证据 → `+automation-disable` 复原。
- **证据（线上 runtime 日志）**：`instance_id 17695618791489929242`，`app_env=runtime`，三个阶段全部 `succeed`——`phase=dispatch`（`duration_ms 10851`）、`phase=trigger`、`phase=action`（`duration_ms 663`），完成时间 `2026-10-12T03:35:31Z`（即本地 11:35:31，对应 11:30 窗口）。同刻 `module=app_server` 记录到应用侧 handler 日志：`RQ-Sys scheduled work poll completed`（来源 `RqsysAutomation`）。
- **无副作用**：演练前后 Dev 计数一致（batches 10、jobs 27、queued 0、running_batches 0），证明恢复路径在周计划关闭时确实不产生工作。
- **已复原**：触发器回读为 `disabled`，周计划仍关闭。

结论：**触发器的定时投递、handler 接线与"周计划关闭时不启动真实同步"这一安全性质均已验证。** 仍未验证的是"错过的周窗口能被真正恢复"——那需要先有一个启用中的周计划，属于真实同步范围，须在安全测试来源获批后再做。

## 此前验收更新（2026-10-12 早间）

- 本轮审查修复两项问题：Base 失败分类改用结构化 Feishu 错误字段；分析重试复用队列任务时也记录 actor、时间、源版本和分析版本。修复已同步到两仓，共用逻辑对齐 19/19。
- 本地回归：root API 238/238（含隔离 PostgreSQL）、Web 36/36、typecheck/build；妙搭路由测试 61/61、server/client typecheck、lint、production build 均通过。
- 最新代码仅在本地提交：妙搭 app commit `cd64e8d` 尚未 push/release；已发布版本仍是 `7695421212881750997` / `2d901361`。
- 对误触批次的 Dev 查询先完成 dry-run，执行时因 DNS 无法解析 `open.feishu.cn` 而未到达飞书；没有进行任何目标写入。批次与队列任务当前状态未能刷新，之前读到的 30 条导入、running 批次、过期租约仍是最后已确认状态。
- Ticket 09 仍 blocked：误触批次处置（批次设为 schema 支持的 `failed`、同步 job 设为 `cancelled`，保留导入行）需用户明确确认；目标 recovery 和发布版 app-mediated E2E 未验证；Teambition `311` vs UI `311/314` 未解释。周计划及干系人通知保持关闭。

## 此前验收更新（2026-10-11，发布后）

- Miaoda release `7695421212881750997` 已完成，绑定提交 `2d901361ed19cb4fd26b77b446c8d3142b575c00`，`error_logs` 为空。提交已推送到 `sprint/default`，未包含 `.env` 或密钥文件。
- 线上只读冷启动复核显示：请求未完成前保持“正在检查 API / 正在加载配置…”，完成后才显示“API 已连接”和已保存项目。线上来源处于停用状态，需求/批次为空；每周一 09:00 计划仍关闭。
- 修复了工作台提前显示空数据的问题：改用 `/api/health/ready`，并在首屏来源、批次、需求快照全部返回后再显示 ready。回归测试先红后绿；已发布冷启动复核通过。
- 用户确认的 Dev `AI_API_KEY` 写入成功，未回显密钥。写入后，固定合成需求分析成功并写入隔离 POC Base；之前失败的合成需求重试成功，Base 分析版本更新至 2。该结果来自本地 workbench + Dev 凭据，不等同发布版 runtime 的完整目标验收。
- **误触后的 Dev 批次待隔离：** 浏览器验收时我使用了过期的按钮序号，误点“立即同步”并创建批次 `020073d7-17ec-4c1f-8521-56a300882b8d`。最后一次成功的只读 Dev 查询显示已导入 30 条真实 TB 记录/30 条 sync items；当时批次为 `running`，关联 sync job 的租约已过期，未发现 AI 或 Base 队列作业。本地 API 进程已停止，恢复触发器保持 disabled，未发通知。之后的状态查询在 DNS 阶段失败，当前状态未能刷新。拟处置为将批次设为 schema 支持的 `failed`、同步 job 设为 `cancelled`，保留已导入数据；此前已请求用户明确确认，确认前不重启 worker 或写入状态。
- 当时本地验证：root API 236/236、Web 36/36、typecheck/build、alignment 19/19；妙搭路由/adapter 61/61、server/client typecheck、lint、production build、diff check 均通过。
- Ticket 09 仍 blocked：待隔离误触批次、验证恢复触发器、解释 Teambition 311 vs UI 311/314 差异；不得再次拉取真实项目或启用周计划/干系人通知。

## 此前验收更新（2026-10-11；已由上方发布后状态补充）

- 修复并同步了 Base app-token 查询路径：使用官方 Bitable v1 `records` 列表接口及精确的项目 ID + 需求 ID 过滤，限制返回字段，并在复合键重复时失败关闭。根仓和 Miaoda 仓现已对齐。
- 合成夹具已通过当前 workbench/API 路径推送到隔离 POC Base；官方 v1 只读回查到唯一匹配记录。该证据不代表当前已发布 Miaoda runtime 的代码发布或完整 E2E 验收。
- 该夹具的 workbench 分析失败，安全摘要为 `AI provider authentication failed`。随后用 app 仓 `.env.local` 的配置直连 DeepSeek provider 冒烟成功，结构化结果校验通过（置信度“中”、priority 留空）。因此本地 key/provider 配对有效，问题仍在 workbench/目标 runtime 是否加载了同一 secret；没有读取或回显密钥。
- 将该合成记录的负责人设为当前登录用户，且关闭记录编辑器的直接通知选项；POC 自动化运行日志显示“监控执行人字段变更”与“发送分配通知”均成功，收件人配置仅为当前用户。此为 Base 自动化验收，不代表发布版 Miaoda runtime 发起完整链路。
- 刷新本地工作台后 API 返回空数据（无数据源、无需求），与 Base 中的合成记录不一致；需在同一持久运行环境重跑，才能验收完整端到端一致性。
- 本地回归通过：root API 232/232、Web 36/36；Miaoda adapter 54/54、typecheck、lint、production build；两仓对齐检查和 `git diff --check` 均通过。
- 已触发且成功执行仅通知当前用户的负责人自动化；本次验收仅做 Teambition 类型/数量只读查询，没有将真实记录导入 RQ-Sys、发送给 AI 或写入 Base（此前有独立本地 harness 导入 311 条记录的证据，不属于妙搭目标验收）。周一 09:00 计划及 30 分钟恢复触发器保持 disabled。最新 release 查询因 DNS 无法解析 `open.feishu.cn` 失败，未进行发布操作。

## 历史 FORBIDDEN 归因更新（2026-10-11；后续发布及 Dev 验证已更新状态）

`403` 是**服务端真实返回**的，但“角色校验由服务端强制执行”这句话**不是服务端写的**——它来自客户端硬编码文案。历史回溯（`git grep` 全历史，`rq-sys-miaoda`）：

- 该字符串位于 `client/src/rqsys/panels.tsx`，存在于尚未发布的提交 `1deb70d`、`5e6dbc3`、`ae4c452`、`6773cc4`、`be2d20a`、`b2ea3d8` 等；
- 已发布的 `87a2444` 已改为：“飞书平台或集成服务拒绝了此请求（code）。请检查应用授权与目标资源访问权限。”；
- **服务端在任何提交里都没有 RQ-Sys 角色逻辑**：`87a2444` 的 `server/rqsys/http/app.ts` 中 `forbid|role` 计数为 0；root 仓从未包含该字符串。

**结论修正**：dev preview 显示“角色校验”文案，是因为它运行的是**未发布的旧客户端构建**；这不构成“妙搭平台存在角色/ACL 拦截”的证据。因此：

1. 不要再把该 403 归因为平台角色策略或 ACL，也不必等待平台侧“解除拦截”；
2. 首要动作是安全完成编辑器合并并对齐到远端 `c226862`（保留 `.env` 与 `server/database/schema.ts`；提交前按文件名确认 `.env` 不在 index），再通过遵守 `spark:app:write` 门禁的受支持路径发布和对齐 Dev；
3. 若对齐后仍返回 403，应按新文案核查**飞书平台/集成资源授权**与运行 commit，而不是应用角色矩阵。

## 历史目标状态快照（2026-10-11；后续状态见顶部“最新验收更新”）
- 用户已确认按实际 dry-run 预览执行。Miaoda release `7695216916613073890` 已完成，commit 为 `87a2444a4ee2c802d40cf6d63a53c3a915b22196`；线上工作台加载成功，显示“API 已连接”，数据源列表为空，配置表单只维护项目名称并默认 `室外产品-码表软固件需求池`。
- 已在 **dev** 环境写入 `BASE_APP_TOKEN`、`BASE_TABLE_ID` 和 `RQSYS_ENABLE_TEST_FIXTURES=true`，指向批准的 POC Base；env-list 仅核对变量名，未回显任何值。Online 环境变量未改。
- 已创建 `rqsysWeeklySyncRecovery`，`*/30 * * * *`、`Asia/Shanghai`、状态 `disabled`。来源配置和周一 09:00 计划均未创建/启用，因此不会触发真实同步。
- 目标安全验收仍未执行：没有调用模型、创建 POC Base 测试记录、写 Base 或发送通知。目标 Base workflow `POC-执行人变更通知` 先前只读确认已启用；app 侧 owner assignment 事件未验证。
- 发布版工作正常，但 Miaoda 编辑器 dev preview 属于分歧工作区，仍显示旧版 ID/字段映射表单。误启动的合并会话已取消，`git merge --abort` 成功；预览可加载并显示 API 已连接；未提交/推送，原有 `.env`、`server/database/schema.ts` 未提交改动保留。仅尝试在预览中创建未启用周计划的 dev 来源，服务端返回 `FORBIDDEN`（提示角色校验由服务端执行）；来源未创建。随后已清空未提交表单，周计划保持关闭。
- 发布代码的 RQ-Sys controller 只要求妙搭登录，未实现应用角色判断；因此当前 403 尚不能归因到该代码中的角色策略，可能是妙搭平台/目标 runtime 的权限拦截或运行代码与发布 commit 不一致。不得绕过这条服务端拒绝；需先核实 target ACL/runtime commit，并按“租户内所有已登录用户可用”的已批准产品范围调整。
- 下一步：安全完成 Dev 编辑器合并并发布/对齐已验证远端 `c226862`，保留 `.env` 与 `server/database/schema.ts`；提交前只核对文件名，确保 `.env` 不在提交清单。当前发布命令无法满足 `--yes` 门禁时停止，不绕过。然后创建 schedule-disabled 来源，运行固定合成夹具，验证同步→AI→POC Base→仅通知当前用户，最后验证恢复触发器。
- Teambition skill 查询返回 311 条，而 UI 显示 `311/314`；需在启用真实周同步前查清差异。合成夹具不访问真实需求，不能替代这一完整性核验。

## 较早复核快照（2026-10-11；已被上方“最新验收更新”覆盖）

- 本机两仓回归通过：root API 231/231（含隔离本机 PostgreSQL）、Web 36/36、typecheck/build；Miaoda adapter 41/41、server/client typecheck、lint、production build；alignment 与两仓 `git diff --check` 通过。此为本地证据，不替代 Miaoda 目标运行时验收。
- 已发布 release 仍是 `7695216916613073890` / `87a2444`；Miaoda `sprint/default` 远端为 `c226862`，尚未发布。release-create dry-run 指向正确分支，但当前 CLI 对该命令不接受 `--yes`（返回 `unknown flag`）；按项目安全门禁未执行真实发布，也未改用其他写入路径绕过。
- 当前 Miaoda Dev 编辑器仍显示旧版来源表单（要求项目 ID、需求类型 ID、字段映射），预览实时更新已断开。工作区处于 merge 未完成状态：源代码管理显示 51 项挂起更改、49 项暂存，并有“继续合并”操作；`.env` 标签显示已修改，但未能安全核实其是否在暂存清单。编辑器内代码 Agent 曾检查 `.env` 并仅在对话中报告其中有 AI API Key；密钥值未出现在可见对话中。不要继续提交/推送，直到以仅文件名方式确认 `.env` 不在提交清单，并保留 `server/database/schema.ts` 的既有改动。
- 该 Dev 预览当前显示来源为空、需求为 0；本轮没有创建来源、启动同步/fixture、调用模型、写入 Base、触发通知或启用恢复计划。这里的旧表单/空列表与“本机 API 使用 Dev 凭据完成的外部服务流程”是不同环境证据，后者不能当作 Miaoda app-mediated 验收。
- 目前的具体阻塞是安全完成分歧编辑器的合并/版本对齐并发布 `c226862`，然后重新验证来源表单和已登录用户的来源创建。若平台/CLI 无法安全完成该写入，需由用户在妙搭编辑器完成冲突处理或提供支持 `--yes` 的批准发布路径；不得丢弃 `.env` 或 schema 修改，也不得绕过 `spark:app:write` 门禁。

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

## 2026-10-12 时的下一步（历史记录，已由顶部最新状态覆盖）
- Latest published release: `7695657025665305793`, status `finished`, commit `3309d0b4a158e661e0177a24b1f7ccc2dceb02b0`, no release errors. The acceptance button now reads a server-authenticated fixture-status endpoint and stays hidden when the server flag is off.
- Dev snapshot (2026-10-12, aggregate-only SQL): 1 source config (enabled), schedule disabled; 37 requirements, 7 synthetic fixture IDs, 5 analyzed and pushed, 0 running batches/jobs. This is a state check only; it does not prove this release processed those rows.
- The Dev browser preview loaded but did not show the new fixture button, and its visible API log did not contain `GET /api/dev/fixtures/status`. Therefore this release's Dev app-mediated fixture → analysis → POC Base flow remains unverified. Do not trigger real Teambition sync. Reconcile the preview/runtime code alignment first.
- Historical remaining gaps in this snapshot: Dev preview/runtime alignment; complete app-mediated synthetic fixture → analysis → POC Base upsert/readback and user-only notification; missed-window recovery and worker restart; interpret UI `311/314`. The count mismatch is superseded by the latest source-only alignment recorded above. Keep weekly schedule and stakeholder notifications disabled.
- E2E 续跑/恢复时仅使用获批的测试 Base/fixture，通知只发用户本人。
- 历史 `.env` 编辑器状态已被后续干净提交覆盖；本次发布提交未包含 `.env` 或密钥文件。后续仍不得提交/发布真实凭据。

## Evidence log (2026-10-12 follow-up)
- Root checks: API unit tests 226/226; isolated local PostgreSQL integration 13/13; Web 36/36; root typecheck/build/alignment passed. Miaoda app route tests 62/62; server/client typecheck, lint and production build passed; both repos passed `git diff --check`.
- Committed and pushed acceptance visibility fix: root `b3aaa2b`; Miaoda app `3309d0b`. Code review found no actionable standards or spec issues.
- Release `7695657025665305793` reached `finished`, bound to Miaoda commit `3309d0b4a158e661e0177a24b1f7ccc2dceb02b0`, with empty `error_logs`.
- Browser preview evidence: Dev workbench loaded and displayed its prior dashboard; no synthetic acceptance button appeared and visible request logs lacked `/api/dev/fixtures/status`. No sync button, fixture action, schedule, notification or external record write was triggered in this follow-up.
- `+db-execute` aggregate-only SELECT against Dev returned 37 requirements, 7 fixture-prefixed requirement IDs, 5 analyzed, 5 pushed, 0 running batches, 0 running jobs, and 0 enabled schedules. No titles, people, contacts, or secrets were selected.
- Read-only Teambition skill call with `--include-archived` returned 311 raw tasks, 311 unique nonempty IDs, 0 empty IDs and 0 duplicate IDs. No task fields or values were printed. This repeats the API count but does not explain the UI's 314 denominator.

## 2026-10-15 晚 — 定时合成验收执行结果（未取得夹具证据）

- **执行**：按 SCHEDULE-FIXTURE-ACCEPTANCE.md 启用短时夹具模式与 cron 触发器；平台于 18:10:04 CST 真实投递到 `/app/app_17fqkjwyx1u/__innerapi__/automation/invoke`（`context=TriggerClient`，status=succeed）。
- **发现（阻断性）**：`+env-set` 写入的 `RQSYS_SCHEDULE_FIXTURE` / `RQSYS_ENABLE_TEST_FIXTURES` **未在运行实例中生效**。18:43 产生的批次幂等键为 `sched:acce0000-…`（非 `fixture-sched:`），作业 `testFixture=null` → 走的是无保护分支。**结论：夹具开关必须伴随运行时重启/发布才生效，方案第 3 步需补此前置。**
- **未造成损害**：探测来源的项目 ID 刻意不存在且正式来源计划始终关闭；该次同步 `total_count=0`、创建需求 0、`base_push_runs` 0 → 未写正式 Base、未发通知。
- **环境已恢复**：两库夹具环境变量删除、临时来源删除、正式来源 `schedule_enabled=false`、触发器 disabled、无活动作业/批次。
- **顺带确认**：cron 的**实际执行环境是 online**（此前不确定）；`log-list` 因此可用。
- **仍未验证**：夹具模式生效后的完整路径（合成 fixture→AI→POC Base upsert/readback→仅通知本人）。**必须在修正方案第 3 步后重跑**，不得以本次结果计入验收。
