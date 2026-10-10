# [implemented-not-target-verified] 14 — 闭合分析到飞书 Base 推送链路

## 目标

对每条已成功同步的需求，在首次 AI 分析成功、失败或超时进入可见终态后，继续执行负责人处理与 Base upsert；AI 不是推送门槛。

## 依据

- `specs/rq-sys-mvp/01-teambition-sync.md`
- `specs/rq-sys-mvp/02-ai-analysis.md`
- `specs/rq-sys-mvp/03-owner-and-base-push.md`
- `specs/rq-sys-mvp/00-foundation-and-data-contract.md`

## 范围

- 在首次分析尝试记录成功/失败/超时后，按需求版本幂等入队 Base 推送；分析后续重试独立运行，不阻塞推送。
- 将最新 AI 版本中 Feishu Base POC 已确认的 AI 模块、优先级、分析版本映射到 Base；置信度/理由/证据和 U/M/S/C 建议保存在分析版本并通过 Web 详情读取，不擅自新增 Base 字段或写入 PM 确认字段。
- 对齐当前 Base POC 的优先级选项与 PRD 的 P0–P3 范围；不得静默丢弃 P3。若测试 Base schema 需修改，将其作为目标环境验收前置并记录证据。
- 按 `(Teambition project ID, requirement ID)` upsert，成功后持久化 Feishu Base record ID 和推送结果。
- 正确区分负责人状态：TB 无负责人时允许空负责人推送且不通知；TB 有负责人但无法匹配时等待人工映射；空/未匹配 TB 负责人不能清除 Base 中已手动分配的负责人。人工映射持久化成功后再入队推送。
- 以实质源字段 hash/version 判断是否需要 PM 快照和“待处理”重置；快照读取失败时不得改写 Base 记录。
- 记录安全的成功/失败审计；推送成功不能被描述为通知送达成功。

## 验收标准

- AI 成功、低置信度、优先级为空、首次 AI 失败/超时四种路径都能按负责人规则继续推送。
- 无负责人可空负责人推送；未匹配负责人在映射前不误报已推送；手动映射写入成功后触发推送。
- 重复处理同一需求和源版本不会重复创建 Base 记录；成功结果保存并返回 Base record ID。
- 新源版本实质变更时先保存 PM 快照，再更新 source/AI 字段并把 Base PM 状态设为“待处理”；快照失败则原记录不变。
- 手动负责人映射在持久化成功后才入队；任一步失败都返回准确可重试状态，不留下虚假的成功。
- 使用 fake adapter 覆盖本地场景；真实 Feishu Base 验收仍以 Ticket 09 的测试环境证据为准。

## Target verification remains

Ticket 02 的 Base schema/upsert POC 已完成；真实 Base/自动化执行证据属于 Ticket 09。
