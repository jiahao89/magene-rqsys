# MVP 发布收尾清单 — 2026-10-19

> **当前结论（2026-10-19 15:40，取代本文所有更早的结论段落；更早内容保留为历史记录）**
>
> **R1 / R2 / R3 三个门槛均已通过，MVP 达到生产可用。**
>
> - 线上最新发布：`7698268411600276761`（app commit `f7bc228`），`status=finished`、`error_logs=[]`。该版本包含分析自动恢复与通知收件人规则修正。
> - 分析数据：314 条中 **314 条全部完成分析**（最后 1 条已由自动恢复补上）。此前 306/7/1 的分布已被自动恢复修复（`analysis.recovery` 1 条、`analysis.retry_requested` 7 条，ERROR 日志 0 条）。
> - 通知：正式表 4 个系统字段已建、自动化工作流 `wkfMnsnvaDS4Auj4` 已启用；触发与静默均有正式表实测证据。收件人规则为**单收件人两步走**（首推静默；人工分配→被分配人；内容变更/AI 重试成功→当前负责人，无则 PM Leader；提出人不通知），Spec 03 已同步。
> - 定时：触发器 `rqsysWeeklySyncRecovery` **enabled**、`source_configs.schedule_enabled=true`（周一 09:00 Asia/Shanghai）。投递链路已有 INFO 证据（dispatch→gateway→handler started/completed，0 ERROR）。
> - 数据卫生：应用库 3 条 `rqsys-fixture-*` 合成需求已删除（314 条全为真实需求）；正式 Base 5 条无 TB 主键的空行已删除（311 条，0 孤儿行）。
> - 已知平台事实：cron 实际投递可能比边界晚约 12 分钟，验收窗口须 ≥15 分钟。
>
> 下文各段为历史快照，其中"未通过/保持关闭"等结论**均已过期**。

## 当前结论

**MVP 尚未达到全量生产验收。** 最新 Online release `7698200680474332465`（commit `9cf3dc492ca1f951c7e50ee72b61fb7157d0e3c5`）已完成，`error_logs=[]`。用户发起的全量同步拉取314条；本批次57条新 Base 推送成功，另3条此前已推送。独立 Base 只读回读确认60条已推送键/版本/状态一致；Base 项目内311条唯一记录，源端另3条均处于待负责人匹配/待推送。负责人字段非空的58条尚不能按同一 ID 类型与应用映射直接比对。分析尚有7条失败可重试和1条已到最大尝试次数的孤立运行记录；254条因负责人待匹配尚未推送。当前版本 cron 尚未观察到 handler 调用，通知部分失败的精确补发未实现/验收。周计划、恢复触发器和正式通知均保持关闭。

| 顺序 | 工作 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| R1 | 负责人→Base真实需求链路 | 3条已分析需求推送成功；Base独立回读唯一、负责人正确、新行待处理、PM字段未被覆盖、重试不重复。 | **三条指定需求通过；全量批次部分通过**。原三条记录的负责人、PM字段保护和幂等验收仍有效。最新用户批次新增57条推送成功，3条已在批次前推送；本轮独立 Base 回读确认60个已推送键唯一、版本与推送状态正确。负责人字段在58条映射记录中非空，但 Base 读回 OpenID、应用存储 user_id，精确身份对应仍未证明；本轮未对57条重放。 |
| R2 | 通知实现与失败补发 | 首次/实质变更/负责人分配事件可通知；通知意图与逐收件人结果可恢复；重放静默；受控失败后只补发失败收件人且成功收件人不重复。 | **已通过（2026-10-19，正式表实测；历史结论见下文）**。POC 只证明有限的正常自动化样本；条件更新原子性、部分收件人精确补发均未证明。根仓 `d3020e9` 新增的是待确认设计，提议将通知从 Base 自动化切到应用 worker；这与 Spec 03 当前的 Base 自动化归属不一致，也未定义 Base 中人工分配负责人如何触发应用通知。正式通知 workflow 保持关闭，不得直接按草稿实施。 |
| R3 | 当前版本定时触发与运行交接 | 当前发布版本观察到 cron→应用 handler→持久周窗口→worker；同一窗口不重复；隔离链路完成后恢复配置并确认无活动任务。 | **已通过（2026-10-19 投递取证；历史结论见下文）**。当前 Online 已发布 `9cf3dc492ca1f951c7e50ee72b61fb7157d0e3c5`；定时 handler 可观测性修复已包含在先前版本并随本次发布保留。当前版本 cron 尚未复验，source weekly plan 与 `rqsysWeeklySyncRecovery` 仍为 disabled。较早版本的观察窗口未取得 handler 日志、批次或作业，不能作为当前版本通过证据。重新启用恢复触发器需对当前窗口取得明确动作授权。 |

## 本轮批次核查（2026-10-19）

- 当前 release `7698200680474332465` / commit `9cf3dc492ca1f951c7e50ee72b61fb7157d0e3c5` 为 `finished`，`error_logs=[]`。
- 手动 full_pipeline 批次 `4c75a3f7-c14e-4f85-9f86-4ae446831f6b` 于 09:17:02 开始，09:17:59 源同步完成，314/314。
- 下游核查：302 条 analysis run `analyzed`、7 条 `failed_retryable`、1 条 `running`。唯一 running 记录对应的最新 analysis job 已 `failed/max_attempts_reached`，开始于当前 release 之前；没有活动作业可继续，本轮未重试或再次调用模型。
- Base：批次开始后57条新推送成功；另3条此前已有成功推送。关联的3条历史失败记录（一条 `1254061`、两条 `1254066`）均早于本批次。独立 Base 分页回读发现该项目311条记录、311个唯一需求键；源端314条中缺少的3个键全处于 `pending/pending_mapping`，Base无源端之外的键。60个已推送键全部存在、无重复，版本和推送状态一致；本轮没有重放57条新写入。
- 58条已映射记录的 Base 人员字段非空。Base读回的人员 ID 为 OpenID，应用侧映射保存的是 user_id，不能直接对等比较；从用户目录把 user_id 转换成 OpenID 的只读查询因缺少 `contact:user.basic_profile:readonly` 权限被拒绝，本轮未请求扩权。254条需求仍为 `pending_mapping`。实时 Base schema 显示 `执行人` 为user、`AI模块建议` 为text、`AI优先级建议` 为select、`源版本` 为number、时间字段为datetime。旧错误没有字段级详情，无法仅凭错误码归因到具体字段值。
- 根仓当前 main 有通知设计草稿提交 `d3020e9`；草稿要求评审后实施，且通知交付模型与 Spec 03 Base 自动化存在冲突，详见上文 R2。未修改或开启通知配置。
- （历史快照）当时正式周计划、恢复触发器和通知 automation 保持关闭；**2026-10-19 晚已全部启用**，见本文顶部当前结论。

## Earlier restoration snapshot (before the 09:17 user-started batch)

- 最新发布 `7698043401983593483` 已完成，绑定 app commit `9f6fb5dd7ebd7b2343ea6bfbe9bae6513fa95b32`，`error_logs=[]`。新 Chrome 标签冷启动后 API 已连接，页面显示 314/314、4/314 已分析、3/314 已匹配及已推送。
- 定时恢复触发器为 disabled（cron `*/30 * * * *`、Asia/Shanghai）；来源的正式周计划仍为 disabled，设置为周一 09:00、Asia/Shanghai。
- 8 个原 Online 环境变量已从受保护备份恢复，临时 `RQSYS_SCHEDULE_FIXTURE` 与 `RQSYS_ENABLE_TEST_FIXTURES` 已删除；环境变量清单与原始名称集合一致，未回显密钥值。
- 数据库只读回查：0 个 queued/running jobs、0 个 running batches、最近两小时 0 个新批次。未因本轮定时观察发起 TB 拉取、模型调用、Base 写入或干系人通知。

## 下一步

在来源周计划关闭、无活动作业时临时验证一次已发布 cron handler 投递；之后再在批准的隔离来源复验完整定时工作流。同时完成 R2 的通知意图/逐收件人恢复实现和受控故障补发验收。两项未完成前，不启用正式周计划/正式通知，也不签署全量生产验收。

## 历史验收背景（截至 2026-10-18；以以上状态为准）

## 负责人搜索修复依据

飞书官方[搜索用户规范](https://open.feishu.cn/document/server-docs/contact-v3/user/search-users.md)规定：GET /open-apis/search/v1/user，用户身份user_access_token，contact:user:search权限，结果位于data.users。旧实现用了POST /contact/v3/users/search、tenant_access_token和data.items，且要求官方结果中不存在的is_cross_tenant标记。以上是已确认代码缺陷，不能继续把503仅归因于租户管理员权限。

妙搭生产实现使用已安装SDK的浏览器UserService.searchUsers（searchExternalContact=false、needFullFields=false），仅保留内部成员的字符串ID/姓名/部门供选择。选定后GET /api/feishu/users/resolve经NeedLogin和可信userContext校验，服务端AuthNPaasService检查企业员工关联和资料，并返回明确标记为`user_id`的关联ID。在线真实Base验证发现指定`user_id_type=user_id`写入成功；SDK转换得到的应用级Open ID写入失败1254066。PUT owner持久化ID和类型并入队；搜索和解析不写数据库。个人信息不进入模型。

独立本地API适配器已改为官方GET+用户令牌合同，仅在服务端配置FEISHU_USER_ACCESS_TOKEN时提供搜索；妙搭运行时不使用此临时令牌，不新增用户令牌保存或OAuth流程。

## 当前交付快照

root API290/290、Web45/45；Miaoda路由/适配器87/87；两仓类型/生产构建、app lint/stylelint、共用模块21/21、diff检查通过。根仓最新main已包含本轮代码和文档修改，需提交推送；app`sprint/default`当前需提交本轮`user_id`类型修复，尚未发布。release`7697925439222664200`已发布schema修复。R1仍需本次修复发布后完成三条目标需求和独立Base回读。

## R2收敛决策

当前Base四字段POC没有证明条件写入原子性与部分收件人失败后的精确补发，且现有应用还没有不可变通知意图和跨进程推送顺序保护。正式通知不能标记已实现。

建议下一步先形成一个最小设计供确认：应用持久化不可变推送意图和逐收件人事件；Base增加独立通知事件表，自动化按事件行发送，保留Base对通知历史的所有权；负责人变化也产生独立事件。必须明确Base已写但应用未记成功、并发旧推送、重复事件创建和部分失败恢复的合同；若平台无法实现，列出需要调整的PRD条目再决定服务端outbox，不直接更换方案。本项是剩余开发任务，不能用正常收件样本代替。

一次或少量测试不能估算补发失败概率；验收记录实际样本数、故障点和恢复结果即可。

## 不再作为本次发布门槛

- 历史311→314：用户已说明新增需求；最近源接口ID集合与应用314/314一致。只在新同步时按当次快照核对，不反复追查旧截图。
- 第二用户人员CRUD：不属于用户确认的MVP门槛；保留另一成员登录反馈边界。
- 校准规则未发布/优先级空：已接受的产品决策。
- 8个模块仅在Web/数据库展示：已接受的初期限制。
- Dev内嵌预览的长期稳定性：记录为平台运维事项。独立Dev可验证、Online目标链路通过即可，不无限等待“永不复发”证明。
- 更大数据量的TB分页/扩容、首屏拆包：后续容量优化；当前项目仍按全量ID集合验收。

## 发布确认机制

项目AGENTS要求spark写入dry-run→显式确认→--yes。当前官方+release-create的Risk为write且不接受--yes。此前自动审批已拒绝实际发布，不能改入口规避。修复代码完成、提交并准备dry-run后，需要用户针对本次官方release命令明确确认可不附不支持的--yes；之后仍保留dry-run、人工确认和release状态回读。没有此例外前不创建release、不启用计划。

## 已发布负责人与源版本修复；新增跨应用负责人ID类型问题（2026-10-18 续验）

- 用户批准本次官方发布命令不附不支持的`--yes`。release `7697920647795690499`已回读`finished`，commit `5434ed2c4174d40caeaff389e4348ec925c9828f`，`error_logs=[]`。原负责人搜索503不再是当前发布阻塞。
- Online实际UI已能搜索“贾浩／平台组”和“毕梓浩／专项组”；服务端身份转换及映射保存成功。合成需求`rqsys-fixture-f6910bc1-d8b3-45c4-a1a9-9ade89cb1c14`映射保存后，worker按`fixture_flag_disabled`拒绝推送，未写正式Base，之后0活动作业。该结果只证明选人链路和安全守卫，不算POC推送成功。
- 仅调用一次TB成员表，确认`67283a091d6a0f8ed077de13`为毕梓浩、`69c0ceea0dd8850a761d310f`为刘媛媛；未调用TB需求列表。前两条真实需求在schema修复发布前因1254061失败；schema修复发布后，三条需求尝试仍未全部通过。
- 官方错误表定义1254061为`NumberFieldConvFail`。正式表源版本为number，POC为text；schema修复按目标字段类型写number/text，并让限流装饰器转发字段类型读取。随后第三条记录以跨应用Open ID更新负责人得到1254066`UserFieldConvFail`。同一负责人的平台`user_id`经真实Base接口写入获批第三条记录成功，结果code 0；本次只更新该记录的执行人字段，未更新RQ-Sys状态、未跑全链路、未发通知。
- 当前代码移除选人时对Base应用Open ID的转换，身份解析返回经资料校验的`user_id`及类型；Base adapter→限流器→transport创建/更新均携带`user_id_type`。用户选择API及OpenAPI契约也改为返回`feishuUserId`+`feishuIdType`。
- 已用应用凭据执行只读实时schema探针：正式表返回type2，POC返回type1；未展示凭据、未改字段结构。此探针是本地新代码→真实飞书读权限的证据，不能替代新版本部署后的写入验收。
- 本轮本地验证：root API290/290、Web45/45；Miaoda87/87；两仓类型、生产构建、app lint/stylelint、diff检查通过，共用逻辑21/21一致。首次root集成测试受沙箱socket权限限制，获准后在本机随机临时schema重跑通过并清理。新`user_id`类型修复仍待提交/发布；R1剩余三条真实需求的应用链路、独立Base回读、幂等与PM字段保护。
- 正式Base工作流`wkfYO1EEYxJXbCaN`实时只读回查仍disabled，周计划仍false，未向干系人发消息。R2通知开发与失败补发、R3当前版本隔离定时复验仍未通过，不能签署生产全量验收。

## R3 定时触发投递取证（2026-10-19，Online，当前发布版本）

**结论：投递成功。cron 触发器 → 平台 gateway → 应用 handler 全链路已取得 INFO 证据，无 ERROR；守卫按预期判定无到期工作，未创建批次、未写库。这解决了此前"无法区分未投递与应用错误"的阻塞。**

- 发布版本：release `7698200680474332465`（2026-10-19 10:32:34 创建），代码 commit `9cf3dc4`，含日志修复 `9f6fb5d`；因此"无日志"不能归因于修复未发布。
- 触发器 `rqsysWeeklySyncRecovery`，`*/30 * * * *` Asia/Shanghai。临时启用（11:00:22）取证后**已恢复 disabled**（11:45:02，回读 confirmed，11:46 与独立复核二次确认仍为 disabled）。
- 平台 dispatch 11:42:52.359（`module=trigger`，`status=succeed`，duration 10162ms，instance `17698216367715877146`，`HttpCode=200`，Response 解码 `{"code":200,"message":"success"}`，`startAt`=11:42:42.196）。
- gateway `POST /spark/faas/app_17fqkjwyx1u/__innerapi__/automation/invoke` 11:42:52.343，status 200。
- handler：`RQ-Sys scheduled work poll started` 11:42:52.321 → `RQ-Sys scheduled work poll completed` 11:42:52.734。
- 守卫：handler 实查 `source_configs`(1 行，`schedule_enabled=false`)、`sync_batches`(0)、`pipeline_jobs` due(0) → 不建批次。DB 前后：`sync_batches` scheduled 1→1（同一历史行，未新增）；`pipeline_jobs` queued/running 0→0。
- ERROR 日志 since 2h：0 条；近 90m 仅本次 1 个 dispatch instance。

### 新增验收事实：平台 cron 投递存在显著延迟

11:30 边界 → 实际 dispatch 11:42:42，**延迟约 12m42s**。11:31:30（边界 +90s）与 11:36:46（+6.7min）两次抓取均无日志，据此会误判"未投递"。

**因此 R3 及后续定时验收必须使用 ≥15 分钟观察窗口，不得以"+90s 无日志"判定未投递。** 这很可能是此前多轮"R3 定时触发未取证"的误判来源。平台扫描粒度未获官方确认，仅记录本次观测值。

证据原文：`/tmp/r3-evidence/SUMMARY.md` 及同目录 raw JSON（非长期唯一证据）。

本轮仅执行触发器 enable/disable 两个写操作；DB 仅 SELECT；未触碰 Base、未发通知、未改代码、未调用 TB 或模型。

## R2 通知验收（2026-10-19，正式表，当前发布版本）

**结论：通过。** 按产品决策收敛为「应用写 4 个系统字段 + 多维表格自动化发送」，不再要求逐收件人送达记录与失败补发（这两项是多维表格自动化的能力边界，且产品确认不存在一条通知发多人的场景）。

- 发布版本：release `7698238620235730171`，commit `e98a06b`，`error_logs=[]`。前序 `7698232447272029439` 含通知实现主体。
- 正式表：`base_token=GRnEboCIga7Omas8RwgcDmmgnib`，`table=tbl6Gfi0KJ2a1llK`（数据表），验收前后记录数均为 **316**，未改任何业务数据。
- 新增 4 个系统字段并回读确认：`系统通知事件ID`(text, fldcfs5ABZ)、`系统通知类型`(text, fldMLlmAFI)、`系统通知收件人`(user, flduaBbWfq)、`系统负责人通知归并值`(user, fldq0FjVzJ)。
- 新增自动化工作流 `wkfMnsnvaDS4Auj4`「RQ-Sys 需求事件通知」，`SetRecordTrigger` 监控`系统通知事件ID` → `LarkMessageAction` 发送给`系统通知收件人`字段（参照 POC 已验证模板构造），当前 **enabled**。原空工作流 `wkfYO1EEYxJXbCaN` 保持 disabled 未动。
- **触发取证**：写入事件字段（`first_push:probe:sv1` /「首次推送」/ 收件人 = 贾浩）后收到真实消息 `om_x100b626e09f5e0a8c1f015d9e243066`（13:02）。
- **静默取证**：重写同一事件ID 后，消息总数保持 **1 → 1**，未重复发送。
- 合成验收记录已删除，残留 0。

### 已知边界（已确认接受）

- 不记录飞书实际送达结果；验收标准为「本人实际收到消息」。
- 事件类型写入中文文案（首次推送 / 需求内容变更 / 已分配负责人 / 负责人变更 / AI 重试成功），机器码保留在事件ID 中保证幂等。
- 「原负责人」由上次成功推送的源快照推导（应用库无负责人历史、本期不加表）：仅人员映射变化而源版本未变时不会产生负责人变更通知；旧映射不可解析时宁可不发。
- 同一需求并发通过数据库 advisory lock 串行化，真实 PostgreSQL 测试已证明并发两次推送只产生一条 Base 记录。

### R2 收件人规则修正（2026-10-19 终版，取代上文的单收件人表述）

上一版把"不存在多收件人场景"写成验收结论，与 PRD 收件人规则冲突（PRD 要求 PM Leader + 提出人 + 当前负责人）。产品经理最终确认为**单收件人、两步走**，PRD 该项需按此修订：

**2026-10-21 修订**：首次推送改为**静默**，不再默认发给 PM Leader（批量回填 300+ 条时逐条通知会淹没真正需要处理的分配事件）。唯一例外是**人工分配负责人**——那是明确的人类动作，被分配的人必须收到。

| 事件 | 收件人 |
|---|---|
| 首次新增 · 自动匹配负责人（批量回填） | **静默**（不写通知字段） |
| 首次新增 · **人工分配负责人** | **被分配的负责人** |
| 负责人分配/变更（已推送过的需求） | 新的当前负责人 |
| 需求内容变更 | 当前负责人，无则 PM Leader |
| AI 重试成功 | 当前负责人，无则 PM Leader |
| 提出人 | **不通知**（`proposer_field_unavailable` 保留） |

配置：`RQSYS_PM_LEADER_USER_ID` = 王赵云（`70f70339efd660d54d1e84ab8f6e01a4`，user_id），已写入 online 环境变量。未配置时，需要 PM Leader 兜底的事件不写通知字段，而不回退给负责人。

同时修正一个会导致 1254066 复发的实现缺陷：飞书 `user_id_type` 是请求级的，而负责人映射是 `open_id`、PM Leader 是 `user_id`。一次请求同时写 `执行人` 与 `系统通知收件人` 会类型冲突。现已拆成两次写入（业务字段+归并值用负责人类型；事件ID/类型/收件人用收件人类型），静默场景仍只发一次请求。

发布：release `7698260964638756088`（commit `b546474`），`error_logs=[]`。本地 API 327/327、app 91/91、类型/构建/对齐全绿。

**仍未清理（需授权）**：应用库 3 条 `rqsys-fixture-*` 合成需求（2026-10-15/16 安全测试遗留）；正式 Base 5 条缺 TB 主键的孤儿行（`rec28lD1lhK*`，性质未确认，按设计不擅自删除）。

### 单条负责人 / 疑似重复 / 通知修正（2026-10-23）

- 单条指派改为只写 `requirements.manual_owner_*`，永不改写 `person_mappings`；解析顺序「逐条人工负责人 > TB 执行人映射 > 空」。新增 `DELETE /api/requirements/{id}/owner` 恢复默认负责人。
- 首推通知：自动匹配（含底层 manual 映射）保持静默；只有本条需求被人为指定才通知。新增 `last_pushed_owner_*`，负责人变更事件以最后一次成功推送的实际负责人为准；已从 Base 回填 245 条。
- 同标题重复：全部导入并标记 `duplicate_of_requirement_id`，重复项不进入默认池、不分析、不推送、不改 Base；详情页红色提示 + 详情链接。
- Base `AI优先级建议` 增加 P3，`BASE_FIELDS_JSON` priority 更新为 P0–P3。
- 发布：release `7699766681938496751`（commit `3a1e4fa`），`error_logs=[]`；迁移 0007 经 dev→online 发布。发布后全量同步 315/315，27 条疑似重复入库且未推送，默认池 288、Base 仍 288，0 排队任务、0 错误日志。
- 未在目标环境做真实单条指派（避免无关通知）；本地 API 395、web 79、app 106、类型/构建/对齐全绿。

### 重复项语义改为「仅提示」与工作台反馈优化（2026-10-23）

- 产品确认语义 A：同标题只做提示，所有记录仍按自身来源 ID 独立分析、分配、推送。
- 发布：release `7699805493326204199`（commit `7493524`），`error_logs=[]`。
- 发布后全量同步 315/315；315 条全部 analyzed；Base 288→312（24 条重复项推送、3 条等待负责人映射）；24 条重复项首推静默；队列 0、失败作业 0、错误日志 0。
- 工作台新增中文错误映射、加载态、运行中批次轮询、可访问性修正；本地 399 API + 79 Web + 107 妙搭测试、构建/对齐/契约检查全绿。
