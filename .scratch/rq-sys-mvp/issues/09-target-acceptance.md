# [blocked: publishing cd64e8d fails platform-side; target E2E still unverified] 09 — 目标环境端到端验收

## 处置完成（2026-10-12，用户授权「修复所有问题」后执行）

用户授权后完成以下处置。所有目标侧写入均已执行并回读验证；密钥值全程未打印。

- **Dev `AI_API_KEY` 已修复。** 修复前平台值直连 provider 返回 `HTTP 401`（`api key: ****0d15 is invalid`），这正是 dev 侧 app-mediated 分析报 `AI provider authentication failed` 的原因。已用 online/`.env.local` 同一有效值经 `+env-set` 写入 dev；回读 hash 与有效值一致，实测 provider 返回 `HTTP 200`。
- **误触批次已隔离。** 批次 `020073d7-17ec-4c1f-8521-56a300882b8d` 置为 `failed`、`completed_at` 补齐、计数按实际 `sync_items` 校正为 total 30 / succeeded 30 / failed 0，并在 `error_summary` 注明为验收期误触且已保留导入行。**30 行数据保留。**
- **卡住作业已取消。** sync job `16a3be4c-c55b-4c4c-8e16-3b457d21091b`（租约过期）与 analysis job `ebb5a9a5-1141-4484-afea-d7d92c339eba`（attempt 5、租约过期）置为 `cancelled`；对应的 `analysis_runs` `61f9d27c-bbf3-42c5-af7d-a703a299f8a6` 由 `running` 结算为 `failed_retryable`。回读确认：running 批次 0、running 作业 0、running 分析 0，唯一来源不再被 `ActiveBatchConflict` 阻塞。
- **未泄漏确认。** 30 条真实 TB 需求全部停在 `owner_state=pending_mapping`（有 TB 负责人但未映射飞书用户），符合既定不变量；`base_record_id` 为空，POC Base 未出现任何真实需求行。
- **POC Base 残留清理。** 删除本人早前验证失败留下的两条探针记录 `recvxI4GS86HHO`（adapter-smoke-临时）与 `recvxI4PLj1Jjf`（select-probe-临时），9 → 7 条。保留 5 条合成夹具记录与 2 条 POC 基线记录作为验收证据。
- **online 夹具开关收紧。** online `RQSYS_ENABLE_TEST_FIXTURES` 由 `true` 改为 `false`。该路由此前已因双键守卫（必须同时匹配安全 POC Base）在 online 不可用，本次为纵深防御。
- **两仓已推送。** root `main` → `b023600`，app `sprint/default` → `cd64e8d`；两仓工作区干净。

### 当前唯一阻塞：发布 `cd64e8d` 平台侧失败

- `+release-create`（带 `--branch sprint/default` 与不带该参数）共尝试 5 次，均返回 `code 500000049`（"Something went wrong. Please try again later."），**未返回 `release_id`**，因此没有可轮询的发布记录。
- 已排除的本地因素：`git` 与 `origin/sprint/default` 完全一致（`cd64e8d`，ahead/behind = 0/0）；`+db-env-diff` 无待发布结构变更；`npm run build:prod` 通过；推送提交不含 `.env` 或密钥。
- **未确定的原因不作猜测。** 另记录一个本地可复现的观察：平台部署构建命令 `npm run build`（`scripts/build.sh`）在步骤 0 `npx fullstack-cli action-plugin init` 处进入交互式提问（"What do you want to create?"）并以 `ERR_USE_AFTER_CLOSE` 退出；该脚本为 CLI 自动生成，本次未改动。此现象是否与线上发布失败相关尚未证实。
- 建议由用户在妙搭编辑器侧发布，或携 `log_id`（如 `2026101211035665FC73895B15ACF98711`）向平台支持核对。

### 恢复触发器演练：**已实跑并通过**（2026-10-12）

本轮在确认安全前提后完成了此前一直搁置的恢复触发器演练：

- **安全前提（代码级确认）**：`createDueSyncJobs` 对 `!source.enabled || !source.scheduleEnabled` 的来源直接跳过；Dev 唯一来源 `enabled=true` 但 `schedule_enabled=false`（时间 09:00、周一、`Asia/Shanghai`），且 `pipeline_jobs` 无 `queued` 作业。因此 `pollOnce`（= `createDueSyncJobs` + `drainReadyJobs`）在当前状态下不会创建任何真实同步工作。这修正了我此前"启用触发器可能触发真实同步、风险不可控"的判断。
- **演练过程**：`+automation-enable` 启用 → 等待一个 cron 窗口（`*/30 * * * *`、`Asia/Shanghai`）→ 回读证据 → `+automation-disable` 复原。
- **证据（线上 runtime 日志）**：`instance_id 17695618791489929242`，`app_env=runtime`，三个阶段全部 `succeed`——`phase=dispatch`（`duration_ms 10851`）、`phase=trigger`、`phase=action`（`duration_ms 663`），完成时间 `2026-10-12T03:35:31Z`（即本地 11:35:31，对应 11:30 窗口）。同刻 `module=app_server` 记录到应用侧 handler 日志：`RQ-Sys scheduled work poll completed`（来源 `RqsysAutomation`）。
- **无副作用**：演练前后 Dev 计数一致（batches 10、jobs 27、queued 0、running_batches 0），证明恢复路径在周计划关闭时确实不产生工作。
- **已复原**：触发器回读为 `disabled`，周计划仍关闭。

结论：**触发器的定时投递、handler 接线与"周计划关闭时不启动真实同步"这一安全性质均已验证。** 仍未验证的是"错过的周窗口能被真正恢复"——那需要先有一个启用中的周计划，属于真实同步范围，须在安全测试来源获批后再做。

### 仍未验收（本次无法由本人完成）

- 发布版 runtime 的 app-mediated 完整 E2E（source → sync → AI → Base → 仅通知本人）。
- 恢复触发器的**错窗恢复**语义（触发器投递本身已通过，见上）。
- Teambition `311` vs UI `311/314` 的 3 条差异未解释。
- 模块词典与优先级规则仍为空（需产品内容）；P3 与线上 `AI优先级建议`（仅 P0–P2）冲突未决。
- 周计划与干系人通知保持关闭。

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

## Current next action
- 妙搭平台 env / DB / release 写继续遵循 `AGENTS.md` 安全门禁；本轮没有启用周计划或写线上数据。
- Dev AI secret has already been written after the user's confirmation; the fixed synthetic analysis and POC Base readback succeeded. Do not write it again or repeat the analysis without a concrete failure.
- The accidental Dev batch `020073d7-17ec-4c1f-8521-56a300882b8d` is awaiting the user's decision to set the batch to schema-supported `failed` and the sync job to `cancelled`, retaining imported requirement/snapshot rows. Do not restart a worker or mutate the batch until that decision arrives.
- After containment: verify the disabled recovery trigger safely, reconcile Teambition's 311 result versus UI `311/314`, and run the remaining app-mediated E2E with the synthetic fixture only. Keep the weekly schedule and stakeholder notifications disabled; test notices may go only to the user.
- E2E 续跑/恢复时仅使用获批的测试 Base/fixture，通知只发用户本人。
- 历史 `.env` 编辑器状态已被后续干净提交覆盖；本次发布提交未包含 `.env` 或密钥文件。后续仍不得提交/发布真实凭据。
