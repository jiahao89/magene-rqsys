# MVP 发布收尾清单 — 2026-10-18

## 当前结论

当前不能签署全量生产验收。负责人搜索已找到并修复具体调用合同错误，等待部署后验证；正式通知仍有未完成开发，不能靠反复执行验收消除。以本页三个发布门槛为当前收尾入口；历史逐次证据保留在 Ticket 09，不再把旧快照中的已解决问题重新登记成阻塞。

| 顺序 | 工作 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| R1 | 发布负责人选择修复，完成少量真实需求链路 | Online用平台通讯录搜索内部成员；服务端将妙搭ID按Base应用的FEISHU_APP_ID转换为Open ID；选定正确负责人后，3条已分析的最新需求推送成功，Base独立回读无重复、负责人正确、新行待处理、PM字段保护有效。所有测试消息只发贾浩，正式通知保持关闭。 | root15a5e85本地提交；app5434ed2已推送，dry-run通过；root GitHub TLS推送失败，release等待确认例外，目标复验未做 |
| R2 | 补齐通知实现与安全验收 | 首次/实质变更/负责人分配变更/AI重试成功的通知规则有实际实现；事件与收件人固定，重放静默；用本人收件的受控故障验证补发，成功者不重复；完成后再配置正式自动化。 | 未完成开发；原四字段POC只部分通过，正式workflow仍无steps |
| R3 | 当前版本定时复验与运行交接 | 隔离定时夹具在当前发布版本上完成cron→持久周窗口→worker→AI→POC Base，同窗口不重复；确认API与worker加载相同测试策略，恢复配置后0活动任务；R1/R2通过后再启用周一09:00 Asia/Shanghai及恢复cron。 | 历史10月15日通过；10月16日worker策略与触发问题仍需当前版本复验 |

R1先执行。R2的实现设计和R3的夹具排查可独立准备；正式计划启用依赖三项全部通过及正式收件人确认。

## 负责人搜索修复依据

飞书官方[搜索用户规范](https://open.feishu.cn/document/server-docs/contact-v3/user/search-users.md)规定：GET /open-apis/search/v1/user，用户身份user_access_token，contact:user:search权限，结果位于data.users。旧实现用了POST /contact/v3/users/search、tenant_access_token和data.items，且要求官方结果中不存在的is_cross_tenant标记。以上是已确认代码缺陷，不能继续把503仅归因于租户管理员权限。

妙搭生产实现使用已安装SDK的浏览器UserService.searchUsers（searchExternalContact=false、needFullFields=false），仅保留内部成员的字符串ID/姓名/部门供选择。选定后GET /api/feishu/users/resolve经NeedLogin和可信userContext校验，服务端AuthNPaasService检查企业员工关联，用getBatchOpenIds指定FEISHU_APP_ID，并从平台回填姓名。既有PUT owner负责持久映射和入队；搜索和身份解析不写数据库。个人信息不进入模型。

独立本地API适配器已改为官方GET+用户令牌合同，仅在服务端配置FEISHU_USER_ACCESS_TOKEN时提供搜索；妙搭运行时不使用此临时令牌，不新增用户令牌保存或OAuth流程。

## 当前交付快照

root API287/287、Web45/45；Miaoda路由/适配器84/84；两仓类型/构建、app lint/stylelint、共用模块21/21、diff检查通过。root实现提交15a5e85；app提交5434ed2已推送sprint/default。GitHub main推送两次均遇到TLS错误；保留本地提交，不改TLS或代理设置。App release dry-run返回正确app/branch，尚未创建release。

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
