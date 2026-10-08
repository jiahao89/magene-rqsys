# Feishu Base 推送与自动化实测记录（Ticket 02）

> 实测日期：2026-10-08。全部操作通过 `lark-cli`（user 身份，凭证外部托管）在测试 Base 上完成。
> 对应工单：`.scratch/rq-sys-mvp/issues/02-feishu-base-poc.md`。

## 实测环境

| 对象 | 值 |
|------|-----|
| 测试 Base | TB同步测试(可删除) `OddqbqBeOamFjFsR5IXcJdjknmd`（owner 贾浩，时区 Asia/Shanghai，is_advanced=false） |
| POC 表 | RQ-POC-验证 `tblxbyvbdLGVnLaO`（视图 `vew9msdoyO`，rev=1） |
| 测试记录 1 | `recvxrwaGzPGJd`（poc_req_0001，含 PM 确认字段的完整记录） |
| 测试记录 2 | `recvxrwFnUJC0e`（poc_req_0002，空负责人起点） |
| 执行人 open_id | `ou_894482287d1f95aff25b5550604167fb`（贾浩，j***@magene.com，经 contact +search-user 解析） |
| 自动化 workflow | `wkf5C7AvESOSNy9n`（POC-执行人变更通知） |

> POC 表按完整 28 字段模型建表仅用于验证字段语法与四字段组协议；生产 Base 的字段范围仍以 PRD 批准的 `field_map` 为准（工单"不在范围"条款不因本表存在而失效）。

## 四字段组字段模型（已落地为表结构）

| 组 | 字段（类型） |
|----|----|
| 源事实（sync 写入，允许覆盖） | 标题(text 主字段)、TB需求ID、TB项目ID、任务类型、需求说明、范围说明、验收标准、提出人(text)、执行人(user multiple:false)、TB状态、TB创建/更新时间(datetime)、TB链接(text url style)、附件引用、源版本 |
| AI 建议（仅新版本覆盖） | AI模块建议(select 4项)、AI优先级建议(select P0/P1/P2)、AI分析版本 |
| PM 确认（Base 拥有，sync 永不写） | PM状态(select 默认"待处理")、PM确认模块、PM确认优先级、处理人(user)、处理时间(datetime)、结构化备注 |
| 推送元数据 | 推送状态(select 默认"待推送")、最后推送时间(datetime)、记录创建时间(created_at)、记录更新时间(updated_at) |

## 已实测

### 1. 全字段类型写入与默认值

- 首条记录（`recvxrwaGzPGJd`）一次性写入源事实 + AI 字段全部 15 项，类型全部成功：text/url→字符串；select→`["选项名"]`（单选数组仅一项）；datetime→`"yyyy-MM-dd HH:mm"`；user→`[{"id":"ou_xxx"}]`。
- 创建时未写 PM状态/推送状态，默认值自动生效（读回为"待处理"/"待推送"）；未写的 PM 字段读回为 `null`（非 `[]`）。
- 执行人为 `user` 类型（修正了遗留表 `tbl50Uz0YS3KyWnO` 中执行人 text 类型的缺陷）。

### 2. 复合键幂等 upsert 与空负责人

- 复合键查询：`--filter-json '{"logic":"and","conditions":[["TB需求ID","==","poc_req_0001"],["TB项目ID","==","674e77e9ee4037da9d4b9f8e"]]}'` 精确命中 1 条。
- 对同键记录执行 delta 更新后再查，仍命中 1 条；全表保持 2 条记录，无重复。
- 空负责人记录（`recvxrwFnUJC0e`）推送成功，执行人保持 `null`，推送状态流转正常。

### 3. PM 快照读取与 delta 保护

- 模拟流程：读 PM 快照（处理人/模块/优先级/时间/备注）→ 源字段实质变化 → 仅 delta 写源字段 + 推送元数据 + PM状态重置"待处理"，其余 PM 字段不碰。
- 读回验证：PM状态被重置，PM 五项确认字段（模块/优先级/处理人/时间/备注）零污染原样保留。
- 结论：`+record-batch-update` 按字段名精确覆盖，未提交的字段不受影响；"实质变化推送前先读快照"协议可在应用层安全实现。

### 4. 自动化触发与去重（workflow `wkf5C7AvESOSNy9n`）

构造：`SetRecordTrigger`（监听 RQ-POC-验证 表「执行人」字段，`field_watch_info: [{"field_name":"执行人"}]`，`trigger_control_list: []`）→ `LarkMessageAction`（receiver = ref 执行人字段 `$.step_trigger.fldH1kceOs`；content = ref 标题 `fldO1n30OZ`；btn = openLink ref TB链接 `fldu9qmKvl`）。创建后手动 `+workflow-enable` 启用。

| 实测场景 | 写入内容 | 结果 |
|---------|---------|------|
| 首次分配（null→贾浩） | OpenAPI `+record-batch-update` 写执行人 | ✅ 触发。16:12 收到卡片通知：「需求已分配」，标题/链接 ref 全部正确解析，发送方为 Base 应用自有机器人 |
| 同值重写（贾浩→贾浩） | 相同 payload 重复写 | ❌ 不触发。值级去重生效，同步循环重写不会刷屏 |
| 元数据写入 | 更新最后推送时间 + 源版本（非监听字段） | ❌ 不触发。`field_watch_info` 字段级过滤有效 |
| 清空负责人（贾浩→null） | 写 `null` | ❌ 不触发。负责人移除不产生空通知噪音 |

## 权限矩阵（实测）

| 操作 | 身份 | 结果 |
|------|------|------|
| 读 Base/表/字段元数据（+base-list / +table-list / +field-list / +workflow-list） | lark-cli user 凭证 | ✅ 全部可读 |
| 记录查询/读回（+record-search / 复合键 filter） | 同上 | ✅ 可读，select/user/datetime 读回形态见第 1 节 |
| 记录创建/更新（+record-batch-create / +record-batch-update，≤200 条/次） | 同上 | ✅ 可写，含写空（null）与写 user 字段 |
| 建表/字段创建（+table-create，28 字段含 default_value） | 同上 | ✅ 可写 |
| Workflow 创建/启用（+workflow-create / +workflow-enable） | 同上 | ✅ 可操作，新建默认 disabled |
| Workflow 执行历史读取 | — | ❌ 无 API（差异决策见下节第 4 条） |

> 未验证：生产环境中 sync 服务身份（应用凭证/自建应用）对 Base 的授权方式与最小 scope 集合，需在 Ticket 04/05 落地时按目标环境凭证再次验证；本 POC 的 user 凭证结论不直接等同于服务端凭证结论。

## 自动化能力结论与差异决策（验收标准第 4 条）

**结论：Base 自动化可满足 MVP"负责人已分配"通知链路，链路闭环为 sync 服务 OpenAPI 写执行人 → Base workflow → 通知执行人。应用侧无需自建通知服务。**

差异事实与决策：

1. **OpenAPI 写入默认触发自动化**。`trigger_control_list: []` 语义为"全部写入路径均触发（含 OpenAPI）"。schema 文档的可选值列表（SetRecordTrigger 未列 `openAPIBatchUpdate`）描述的是"可排除的路径"而非"默认触发的路径"，与实测一致（AddRecordTrigger 文档示例即含 `openAPIBatchUpdate` 排除项）。
2. **去重无需应用侧防抖**。值级去重（同值重写不触发）+ 字段级过滤（非监听字段不触发）由 Base 侧完成；同步服务每次推送可安全写源版本/推送元数据。
3. **通知发送方为 Base 应用自有 bot**（`cli_aa4dec71d2f85d23`，与 lark-cli 凭证应用 `cli_a965abcba6fadbd3` 不同），消息落在执行人与该 bot 的单聊。产品侧需知悉通知来源标识。
4. **自动化运行历史无编程可读 API**。`+workflow-get` 仅回显 steps 配置（且服务端归一化后不返回 `trigger_control_list`/`condition_list`），无执行日志接口。审计缺口：自动化运行状态只能从消息侧或 Base 界面人工确认。决策：MVP 接受该缺口；自动化失败不回滚已成功推送（与工单第 3 条一致）。
5. **ref 引用语法以 fieldId 为准**（`$.stepId.fldXXX`），receiver/title/btn link 全链路验证通过；步骤 id 必须唯一，新建 workflow 默认 disabled。

## 尚未验证

- `SetRecordTrigger` 的 `trigger_control_list` 排除语义（如显式排除某写入路径）未实测。
- 换人通知（负责人 A→B）需第二个飞书账号，未测；同值/清空边界已覆盖。
- 批量写入 200 条上限边界（实测规模为单条与双条）。
- workflow 被 Base 管理员或租户策略限制的场景（当前租户未受限）。
- `+workflow-update` 对已启用 workflow 的热更新行为（本次仅创建/启用）。

## 对后续工单的影响

- **Ticket 05（手动同步纵向切片）**：推送实现按本记录的复合键 upsert + delta 写 + 推送元数据协议执行；"负责人已分配"通知直接依赖 Base 自动化，应用侧仅需写执行人字段。
- **Ticket 04（持久化领域模型）**：Base 写入的 CellValue 语法（本记录第 1 节）与 PM 快照协议（第 3 节）作为 `base_push` 模块的设计输入。
- 生产 Base 建表时需同步创建通知 workflow；`workflow_id` 应纳入部署配置而非硬编码。
