# PR-01 正式 Base 切换与通知闭环

> 批次：2026-11-06 生产就绪（PR）
> **Status**：`blocked-on-external`
> **优先级**：P0
> **创建**：2026-11-06；基线：root `5490d75`

## 背景 / 目标

线上 `BASE_APP_TOKEN/BASE_TABLE_ID` 当前可能指向测试 Base「TB同步测试(可删除)」（外部事实，需回读 env 确认），279 条已推送记录落在哪个 Base 未核对；正式「TB需求池」未授权本应用，正式表通知自动化收不到应用写入事件。目标：把生产 Base 切到正式表并完成通知闭环验证，含切换/回退演练与启动身份校验。

## 范围

- 平台只读回读 online env（`BASE_APP_TOKEN`/`BASE_TABLE_ID`），确认目标表并记录证据。
- 正式 Base 授权应用可编辑；字段/select/日期类型与 `BASE_FIELDS_JSON` 对齐校验。
- 1 条指定真实需求端到端：首推 → 正式表回读 → 通知实收 → 实质变更再通知。
- 已推送记录对账：正式表行数 vs `push_state=pushed`、无孤儿/无重复 TB ID；旧 `base_record_id` 迁移/回填方案。
- 启动 Base 身份校验：env 与预期环境不符时 fail-fast 或告警。
- 切换与回退演练（含关闭通知）。

## 验收标准（未取得目标环境证据前不得宣称完成）

- [ ] 回读 online env 并记录当前 Base token/table 与目标表结论（测试表/正式表）。
- [ ] 正式表授权应用可编辑；`BASE_FIELDS_JSON` 字段类型/选项与目标表一致（含 `AI优先级建议` P0–P3 选项）。
- [ ] 1 条指定真实需求首推后，正式表回读平台键、负责人、PM 状态、AI 字段正确。
- [ ] `owner_assigned` 自动化消息发到指定测试账号并实收（有证据）。
- [ ] 该需求内容实质变更后 `substantive_update` 再次实收（有证据）。
- [ ] 已推送记录与正式表行数对账完成；无孤儿、无重复 TB ID；差异有处置记录。
- [ ] 启动 Base 身份校验实现并通过 mismatch 场景验证（不匹配时 fail-fast/告警）。
- [ ] 回退演练：切回测试 Base 并关闭通知，10 分钟内恢复且不丢应用数据。

## 不在范围

- Base 字段扩容/28 字段模型（D-01）；通知文案与收件人规则改版（D-12 保持）。
- 历史已推送数据在测试 Base 的删除/归档（需单独确认）。

## 依赖 / 阻塞

- **blocked-on-external**：需要正式 Base 的授权（用户/平台操作）与线上 env 写权限；回退步骤参考 PR-12。
- 若回读发现当前已在正式表，则范围收缩为通知闭环 + 身份校验 + 回退演练。

## 证据引用

- `/tmp/rq-verify/pm-gaps.md` P0-1（第 48–71 行）；`/tmp/rq-verify/ops-readiness-gaps.md` P0-1（第 13–16 行）。
- `deployment/EXTERNAL-BLOCKER-RUNBOOK.md:284`：「未授权生产 Base『TB需求池』」。
- `specs/rq-sys-mvp/FEISHU-BASE-POC.md:10-11`（POC Base token/table）；`specs/rq-sys-mvp/RELEASE-CLOSEOUT.md:115-149`（正式表通知曾通过，当前未回读）。
- `specs/rq-sys-mvp/OPEN-DECISIONS.md` D-05（POC 与正式 Base 必须分开）。
