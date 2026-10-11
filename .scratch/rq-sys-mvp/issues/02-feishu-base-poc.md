# [done: 2026-10-08; new Base schema created 2026-10-10] 02 — 验证 Feishu Base 字段、Upsert 与自动化

## 结果
四项验收标准全部通过，实测证据与差异决策见 [`specs/rq-sys-mvp/FEISHU-BASE-POC.md`](../../../specs/rq-sys-mvp/FEISHU-BASE-POC.md)。POC 表 `tblxbyvbdLGVnLaO`（28 字段）与测试记录保留在测试 Base `OddqbqBeOamFjFsR5IXcJdjknmd` 供复核。

## 当前 MVP 跟进（2026-10-11）
- POC Base 的字段类型/选项已只读复核；本地 adapter 对 single-select、datetime、文本版本字段的写法已有回归测试。
- 测试表启用负责人变更通知 workflow `POC-执行人变更通知`。妙搭 app 侧还未通过 synthetic fixture 写入并验证通知；测试收件人限定为用户本人。
- 正式 `TB需求池` 不作为验收表；它的 priority 单选只有 P0/P1/P2。模块词典项由用户维护，不凭空推断，新增时须同步 Base options。

## 目标
确认测试 Base 中的字段、权限和自动化行为足以支持 MVP 推送及负责人通知。

## 范围
- 验证目标 Base/表/字段 ID、读写权限、记录查询和按 Teambition 项目 ID + 需求 ID 的 create-or-update。
- 验证负责人 person 字段的飞书用户标识写入、空负责人推送、读取 PM 字段快照及受控更新权限。
- 验证需求实质变化时读取并保存 PM 字段快照，再将 PM 状态重置为“待处理”；快照失败时不得覆盖既有记录。
- 验证负责人后续分配/变更时自动化触发、收件人和去重行为。

## 验收标准
- 有字段映射、权限矩阵和测试 Base 的真实写入/更新证据。
- 同一需求重复 Upsert 不产生重复记录。
- 无负责人也可推送；匹配/手动分配后按规则通知；Base 自动化失败不回滚成功推送。
- 明确自动化是否能满足通知触发和去重；不足处形成明确差异与产品/技术决策。

## 不在范围
把完整 28 字段模型迁入 Base，或让 Web 读取 Base PM 状态。

## 2026-10-10 新测试 Base schema
- 用户指定链接解析为 Base「TB需求池」中的表 `tbl6Gfi0KJ2a1llK`，非旧 Ticket 02 POC Base。创建前只读确认该表仅有默认「文本」字段且 0 records；用户明确批准在该表只新增字段、不触碰记录。
- 已创建并回读 25 个 MVP 字段：`TB需求ID`、`TB项目ID`、`执行人`、`标题`、`需求说明`、`范围说明`、`验收标准`、`提出人`、`TB状态`、`TB链接`、`AI模块建议`、`AI优先级建议`、`AI分析版本`、`PM状态`、`PM确认模块`、`PM确认优先级`、`处理人`、`处理时间`、`结构化备注`、`推送状态`、`最后推送时间`、`源版本`、`附件引用`、`TB创建时间`、`TB更新时间`。创建后总计 26 字段（包括原有文本字段），records 仍为 0。
- MVP 适配以这些默认字段名为准；「AI模块建议」「PM状态」「PM确认模块」「PM确认优先级」目前按实现的 default field map 建为文本字段；未建立通知 workflow（本次明确仅创建字段）。
- 四项服务端环境变量仍未配置，也未写入。online env 只读列表只有 `GATEWAY_API_KEY`、`TEAMBITION_GATEWAY_URL`、`AI_API_KEY`。管理员安全配置四项后才激活 Base client；目标授权、Teambition 测试项目/owner fixture 与真实同步写入尚未验收。

## 2026-10-11 目标表 schema 复核

- 只读复核正式 Base `TB需求池` 的 26 个字段：目标字段名与默认 app field map 基本对齐，`执行人`/`处理人` 是单选用户字段，其他主要来源/AI/PM 字段为文本或时间/数字字段。
- `AI优先级建议` 是单选，选项仅 P0、P1、P2；PRD/分析契约支持 P0–P3。当前优先级规则未发布时值为空，不影响起步，但发布会产生 P3 的规则前必须将 P3 加入目标选项并回读验证。
- 正式表仍没有启用通知 workflow；本次仅 schema 读取，未改字段、选项、记录或 workflow。
