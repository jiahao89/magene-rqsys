# 07: 手工编辑需求保留版本并安全更新Base

**What to build:** 用户修改手工需求后重跑必要分析、更新原Base行并保留PM历史；并发及旧任务不覆盖新内容。

**Blocked by:** 04 最小新建需求贯通AI与Base

**Status:** implemented-local（2026-10-25：PATCH 编辑 + 乐观版本 + 事务化快照/审计/任务 + 编辑回执幂等，两仓全量验证；目标链路按 16）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S01](../../../specs/rq-sys-v0.2/01-manual-intake-and-edit.md)、[V02-S03](../../../specs/rq-sys-v0.2/03-base-and-notifications.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T07-AC01：手工事实可编辑，TB事实仍只读；使用期望来源版本和请求幂等键。
- [x] V02-T07-AC02：并发冲突明确返回并保留未提交内容；规范化后无变化不新建快照或分析。
- [x] V02-T07-AC03：影响需求含义的变更原子保存新版本/审计/主分析任务；渠道/链接等元数据变化只更新投影，不重置PM状态。
- [x] V02-T07-AC04：旧AI、旧push、旧租约不能结算为当前结果或写回旧内容；当前状态与输入版本一致。
- [x] V02-T07-AC05：实质变更前读取并保存Base PM快照，成功后写同recordId并置待处理；快照失败该行不改、可重试。
- [x] V02-T07-AC06：人工负责人、人群确认和Base PM确认不被来源编辑或AI重跑覆盖。
- [x] V02-T07-AC07：内容通知按新实质版本发给当前负责人，无负责人回落PM Leader；重放同请求/任务静默。
- [x] V02-T07-AC08：保存后详情刷新能区分旧分析与新分析，不将旧建议当作当前已分析。

## Verification

内容编辑→新快照/worker→同Base行的集成行为；覆盖并发更新、旧任务迟到、事务失败和PM快照失败。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 迁移 `0012`：requirement_edit_receipts（编辑幂等回执，与更新同事务）；本地库已应用。
- 仓储 `updateManualRequirement`（两仓同 SQL）：回执幂等 → 行锁版本比对 → 实质/元数据分流（实质 v+1+快照+分析任务+推送重置；元数据仅投影+非实质 base_push；无变化 unchanged）→ 审计 intake.updated → 回执写入，单事务提交。
- 路由 PATCH（两仓）：鉴权/键/枚举校验；版本冲突 409 带当前版本；TB 行 409；OpenAPI PATCH 路径。
- 前端：`updateRequirement` API + `ManualEditSection`（详情内编辑表单：预填当前值、期望版本基准、失败保留内容、成功刷新详情）；两客户端。
- 测试：集成 1 例覆盖六分支（实质/重放/键冲突/版本冲突/元数据/无变化/TB 拒绝）；root app.test PATCH（更新/409 带版本/TB 409/缺键 400/非法标题 400）；妙搭路由 1 例。
- 验证：root typecheck/API **426**/Web 81/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 **110**/build:prod/eslint 全绿。
