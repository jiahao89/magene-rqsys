# RQ-Sys 发布验证清单（Q1/Q2/Q4 + 运维告警）

> **版本**：根仓 `61a645f`（`feature/arco-design` 与 `main`）、妙搭 `6537b41`（`sprint/default`）
> **适用环境**：妙搭 dev → 目标环境（生产）。每项必须有**目标环境证据**，本地测试不计。
> **原则**：不删除真实需求、不改生产数据来「制造」验证条件；无法安全验证的项明确标注「未取证」。

## 0. 发布前配置（缺一则对应功能静默关闭）

- [ ] 正式 Base「TB需求池」新增两个**文本**字段：`RQ重复标记`、`RQ主记录链接`
- [ ] 目标环境配置 `BASE_FIELDS_JSON`（保留现有键，追加 `duplicate`）：
      `{"duplicate":{"mark":"RQ重复标记","canonicalLink":"RQ主记录链接"}}`
- [ ] 目标环境配置告警 webhook（https）：
      `RQSYS_ALERT_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/...`
      （可选 `RQSYS_ALERT_COOLDOWN_MINUTES`，默认 360）
- [ ] 确认机器人安全策略：若启用了关键词校验，关键词包含 `RQ-Sys`
- [ ] 迁移：`0026_repair_trgm_index.sql`、`0027_source_missing.sql` 已在 dev 应用；按流程 `+db-env-migrate` 提升到目标库
- [ ] 回退准备：记录当前线上 release id 与 commit，确认通知工作流可单独停用

## 1. 发布

- [ ] 触发妙搭发布，release `status=finished`、`error_logs=[]`
- [ ] `/api/health/ready` 返回 200
- [ ] 发布后 10 分钟错误日志为 0

## 2. Q1 · 待匹配需求以空负责人推送（PRD-21）

**取数**：`SELECT id, platform_requirement_id, executor_user_id FROM requirements WHERE owner_state='pending_mapping' AND push_state='pushed' LIMIT 5;`

- [ ] 找一条 TB 有执行人、无映射的需求，确认它已 `pushed`（此前会被无限期拦住）
- [ ] Base 对应行：`推送状态=已推送`；`执行人` 为空或保留 PM 原值（未被清空）
- [ ] 没有产生通知（Base 四个通知字段无新事件；群/IM 无消息）
- [ ] 触发一次映射补齐（在「团队管理」或人员目录补上该 TB 用户），等待一个调度轮次
- [ ] 该需求被自动重推：Base `执行人` 补上，`最后推送时间` 更新
- [ ] 审计出现 `base.push.recheck_queued`，`reason=owner_mapped_after_push`
- [ ] 自动匹配不通知：Base 通知字段无新事件（符合 D-12）
- [ ] 回读 SQL：`owner_state='auto_mapped'`，`base_record_id` 未变化

**未取证项**：若生产暂时没有可补映射的人，可只验证前三项，补映射重推留到试点期观察。

## 3. Q2 · Base 重复行标记（PRD-22，不通知）

- [ ] 选一条**已推送**的需求 A 和同标题需求 B
- [ ] 对 B 执行「确认重复（选择主记录 A）」；判定成功
- [ ] Base 中 B 的行：`RQ重复标记=重复（主记录 RQ-xxxxxx）`，`RQ主记录链接` 指向 A 的 Web 详情
- [ ] A 的行不受影响（未写标记/链接）
- [ ] 没有产生任何通知（判定不触发通知）
- [ ] 审计出现 `duplicate.confirmed`；无 `requirement.duplicate_mark_failed`
- [ ] 对 B 执行「撤销判定」：Base 两个标记字段被清空，`duplicate.revoked` 审计
- [ ] 对另一条需求执行「忽略」：`RQ重复标记=已忽略`
- [ ] 对一条需求执行「确认非重复」：如原有标记，应被清空
- [ ] **缺字段容错**（可选，谨慎）：临时去掉 `BASE_FIELDS_JSON.duplicate` 后判定，功能应静默跳过，判定仍成功

**注意**：B 被压制后不再走正常推送，标记由判定接口直接写入；不要期待 `推送状态` 变化。

## 4. Q4 · 来源已移除提示（PRD-23，只提示）

- [ ] 在 **TB 测试项目**（非正式需求）里删除一条已同步需求；等一次全量同步成功完成（`failedCount=0`）
- [ ] 需求池该行出现「来源已移除」徽标；详情页出现提示
- [ ] 处理/推送状态不变；Base 无变化；没有删除任何记录
- [ ] SQL：该需求 `source_missing_since` 非空、`processing_state='active'`
- [ ] 在 TB 恢复/重建该需求，再次同步：标记自动清除，徽标消失
- [ ] 单条重试（`onlyIds`）和失败批次不产生标记（可查看批次摘要无 removed-source 提示）

**生产限制**：不要删除真实需求来验证。若无测试项目，本条标记为「未取证」，仅以本地集成测试（`source-missing marking...`）作为实现证据。

## 5. 运维告警（PR-09/PR-11 子项）

- [ ] 制造一条失败作业（例如临时指向错误的 Base 配置后重试一条推送，验证后改回；或用已有 failed 作业）
- [ ] 一个调度轮次内，飞书群收到文本消息：含失败数、作业类型、主要错误码；**不含需求标题/负责人**
- [ ] 审计出现 `ops.alert_sent`，`safeDetails={failed,stuck,httpStatus}`
- [ ] 冷却期内不重复发送（同一组失败数/最新失败作业）；出现新失败时立即再发
- [ ] 发送失败场景（可选）：临时把 webhook 改错，确认审计出现 `ops.alert_failed`，恢复后下一轮补发

## 6. 已发布功能补验（此前无目标环境证据）

- [ ] 「作业运维」页可打开，失败/卡住表格有数据或正确空态
- [ ] 审计日志按事件类型筛选：输入 `analysis.retry_requested` 有结果；非法类型返回错误提示
- [ ] 点击审计「动作」列可联动筛选
- [ ] 总览显示「已压制 N 条不计入」，与 SQL 一致
- [ ] 需求池默认「仅活跃」；切到「全部」后 URL 出现 `processingState=all`，刷新保持
- [ ] 详情页「在飞书 Base 中打开」链接可直达对应 record
- [ ] 总览 P0–P3 卡片可点击，进入需求池并带 `priority=Px&sort=priority_asc`

## 7. 主链路回归

- [ ] 手动同步一次：批次成功，需求池新增/更新正常
- [ ] AI 分析：新需求产出评分与优先级；失败有可重试状态
- [ ] 负责人：自动映射/人工分配后推送成功
- [ ] Base：记录创建/更新、通知字段按事件写入
- [ ] 分诊视图：P0–P3 筛选、排序可用

## 8. 回退

- [ ] 记录当前 release id 与 commit
- [ ] 如需回退：停用通知工作流 → 回退到上一个 release（仍指向正式 Base）→ 验证 `/api/health/ready`
- [ ] 迁移 0026/0027 为加列/加索引，可保留不删（回退代码后列仍兼容）
- [ ] 回退耗时记录：______ 分钟（目标 ≤10）

## 9. 结果记录

| 区块 | 结果 | 证据（链接/截图/SQL 输出） | 执行人 | 日期 |
|---|---|---|---|---|
| 0 发布前配置 | ⬜ 通过 / ⬜ 未通过 / ⬜ 未取证 | | | |
| 1 发布 | ⬜ / ⬜ / ⬜ | | | |
| 2 Q1 | ⬜ / ⬜ / ⬜ | | | |
| 3 Q2 | ⬜ / ⬜ / ⬜ | | | |
| 4 Q4 | ⬜ / ⬜ / ⬜ | | | |
| 5 告警 | ⬜ / ⬜ / ⬜ | | | |
| 6 补验 | ⬜ / ⬜ / ⬜ | | | |
| 7 回归 | ⬜ / ⬜ / ⬜ | | | |
| 8 回退 | ⬜ / ⬜ / ⬜ | | | |

> 全部通过后，更新 PRD §9 Gate 的 G1/G2/G3/G4 状态，并在决策记录追加发布条目。
