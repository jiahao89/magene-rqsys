# MVP 发布收尾清单 — 2026-10-19

## 当前结论

**MVP 尚未达到全量生产验收。** 最新 Online release `7698200680474332465`（commit `9cf3dc492ca1f951c7e50ee72b61fb7157d0e3c5`）已完成，`error_logs=[]`。用户发起的全量同步拉取314条；本批次57条新 Base 推送成功，另3条此前已推送。分析尚有7条失败可重试和1条被最大尝试次数终止的孤立运行记录；254条因负责人待匹配尚未推送。当前版本 cron 尚未观察到 handler 调用，通知部分失败的精确补发未实现/验收。周计划、恢复触发器和正式通知均保持关闭。

| 顺序 | 工作 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| R1 | 负责人→Base真实需求链路 | 3条已分析需求推送成功；Base独立回读唯一、负责人正确、新行待处理、PM字段未被覆盖、重试不重复。 | **三条指定需求通过；全量批次部分通过**。原三条记录的独立回读、负责人、PM字段保护和幂等验收仍有效。最新用户批次新增57条推送成功，3条已在批次前推送；本轮未对这57条独立回读或重放。 |
| R2 | 通知实现与失败补发 | 首次/实质变更/负责人分配事件可通知；通知意图与逐收件人结果可恢复；重放静默；受控失败后只补发失败收件人且成功收件人不重复。 | **未通过**。POC 只证明有限的正常自动化样本；条件更新原子性、部分收件人精确补发均未证明，正式通知 workflow 保持关闭。 |
| R3 | 当前版本定时触发与运行交接 | 当前发布版本观察到 cron→应用 handler→持久周窗口→worker；同一窗口不重复；隔离链路完成后恢复配置并确认无活动任务。 | **部分完成，定时运行仍未验收**。当前 Online 已发布 `9cf3dc492ca1f951c7e50ee72b61fb7157d0e3c5`；定时 handler 可观测性修复已包含在先前版本并随本次发布保留。当前版本 cron 尚未复验，source weekly plan 与 `rqsysWeeklySyncRecovery` 仍为 disabled。较早版本的观察窗口未取得 handler 日志、批次或作业，不能作为当前版本通过证据。重新启用恢复触发器需对当前窗口取得明确动作授权。 |

## 本轮批次核查（2026-10-19）

- 当前 release `7698200680474332465` / commit `9cf3dc492ca1f951c7e50ee72b61fb7157d0e3c5` 为 `finished`，`error_logs=[]`。
- 手动 full_pipeline 批次 `4c75a3f7-c14e-4f85-9f86-4ae446831f6b` 于 09:17:02 开始，09:17:59 源同步完成，314/314。
- 下游核查：302 条 analysis run `analyzed`、7 条 `failed_retryable`、1 条 `running`。唯一 running 记录对应的最新 analysis job 已 `failed/max_attempts_reached`，开始于当前 release 之前；没有活动作业可继续，本轮未重试或再次调用模型。
- Base：批次开始后57条新推送成功；另3条此前已有成功推送。关联的3条历史失败记录（一条 `1254061`、两条 `1254066`）均早于本批次。当前数据库中60条需求状态为 `pushed`；此处是应用数据库回读，不是本轮独立 Base API 回读。
- 254条需求仍为 `pending_mapping`。实时 Base schema 显示 `执行人` 为user、`AI模块建议` 为text、`AI优先级建议` 为select、`源版本` 为number、时间字段为datetime。旧错误没有字段级详情，无法仅凭错误码归因到具体字段值。
- 正式周计划、恢复触发器和通知 automation 保持关闭。

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
