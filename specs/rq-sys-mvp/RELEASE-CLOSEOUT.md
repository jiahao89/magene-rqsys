# MVP 发布收尾清单 — 2026-10-19

## 当前结论

**MVP 尚未达到全量生产验收。** 本轮已发布最新负责人 ID 类型修复并完成三条已分析需求的真实 AI→Base 推送与独立回读；通知失败补发仍没有实现/验收证据，当前版本的定时触发复验也未观察到应用侧执行证据。恢复配置后 Online 冷启动正常，正式周计划和恢复触发器均保持关闭。

| 顺序 | 工作 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| R1 | 负责人→Base真实需求链路 | 3条已分析需求推送成功；Base独立回读唯一、负责人正确、新行待处理、PM字段未被覆盖、重试不重复。 | **通过**。Release `7698012715814472718`（代码 `187b4d983425ebd5515b994e02429358ccce90d1`）完成且 `error_logs=[]`。三条获批记录均写入 Base，独立回读无重复，负责人映射正确，PM 状态保持“待处理”，字段保护通过。 |
| R2 | 通知实现与失败补发 | 首次/实质变更/负责人分配事件可通知；通知意图与逐收件人结果可恢复；重放静默；受控失败后只补发失败收件人且成功收件人不重复。 | **未通过**。POC 只证明有限的正常自动化样本；条件更新原子性、部分收件人精确补发均未证明，正式通知 workflow 保持关闭。 |
| R3 | 当前版本定时触发与运行交接 | 当前发布版本观察到 cron→应用 handler→持久周窗口→worker；同一窗口不重复；隔离链路完成后恢复配置并确认无活动任务。 | **未通过/未取证**。本轮检查两个 cron 窗口，没有应用 handler/guard 日志、scheduled batch 或 job，无法区分平台未投递和应用运行失败。根因分析发现 handler 原来只在 `pollOnce()` 成功后写完成日志；运行时初始化/调度异常会完全没有应用日志，且 CLI 没有触发实例历史查询接口。已补充脱敏的 handler 开始/失败阶段/完成日志；app commit `9f6fb5d` 已推送 `sprint/default`，release dry-run 指向正确 app/branch/reason；90/90测试及类型检查、lint、stylelint、生产构建通过。实际 release 仍待按发布门禁确认；未在线复验。历史 2026-10-15 定时链路曾通过，但不能替代当前版本复验。 |

## 本轮恢复确认

- Online 恢复发布 `7698036998015028248` 已完成，代码仍为 `187b4d9…`，`error_logs=[]`；Chrome 冷加载后 API 已连接，页面显示 314/314、4/314 已分析、3/314 已匹配及已推送。
- 定时恢复触发器为 disabled（cron `*/30 * * * *`、Asia/Shanghai）；来源的正式周计划仍为 disabled，设置为周一 09:00、Asia/Shanghai。
- 8 个原 Online 环境变量已从受保护备份恢复，临时 `RQSYS_SCHEDULE_FIXTURE` 与 `RQSYS_ENABLE_TEST_FIXTURES` 已删除；环境变量清单与原始名称集合一致，未回显密钥值。
- 数据库只读回查：0 个 queued/running jobs、0 个 running batches、最近两小时 0 个新批次。未因本轮定时观察发起 TB 拉取、模型调用、Base 写入或干系人通知。

## 下一步

先发布 app commit `9f6fb5d` 的 cron 可观测性修复，并在来源周计划关闭、无活动作业时临时验证一次 cron handler 投递；之后再在批准的隔离来源复验完整定时工作流。同时完成 R2 的通知意图/逐收件人恢复实现和受控故障补发验收。两项未完成前，不启用正式周计划/正式通知，也不签署全量生产验收。

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
