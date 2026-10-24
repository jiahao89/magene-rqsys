# 06: 需求级选择模块与负责人并通知分配人

**What to build:** 录入人选择模块及需求负责人，人工分配首推和后续改派通知正确的人，其他需求不受影响。

**Blocked by:** 04 最小新建需求贯通AI与Base

**Status:** implemented-local（2026-10-25：录入模块/创建即指定负责人/分配版本递增两仓落地并全量验证；目标收件与 Base 自动化共验按 16 执行）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S01](../../../specs/rq-sys-v0.2/01-manual-intake-and-edit.md)、[V02-S03](../../../specs/rq-sys-v0.2/03-base-and-notifications.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T06-AC01：按需求保存飞书ID、ID类型、分配来源、分配版本和历史；手工需求不创建TB人员映射。
- [x] V02-T06-AC02：同一飞书负责人可分配多条需求；改派单条不批量改动其他条。
- [x] V02-T06-AC03：模块关联人只提示候选，点击确认才分配；无绑定、绑定歧义或未解析时可留空。
- [x] V02-T06-AC04：Web录入模块、AI建议与Base PM确认模块分开；人工模块不会被AI或字典更新静默覆盖。
- [x] V02-T06-AC05：首推人工分配通知该负责人；自动匹配批量首推静默，重复操作不重复通知。
- [x] V02-T06-AC06：改派事件按分配版本和身份去重，包含A→B→A；显式新分配写Base，不由旧本地分配反复覆盖Base人工改派。
- [x] V02-T06-AC07：内容变更/AI重试成功从本次有效分配或Base当前负责人选人，无负责人时回落王赵云；读取失败不当作无负责人。
- [x] V02-T06-AC08：负责人事件与原Base负责人变化自动化共同验证只发一次；正确处理不同ID类型分段写入及失败重试。
- [x] V02-T06-AC09：无负责人允许推送；显式清空已有Base人工负责人不在本期。

## Verification

需求API/worker驱动真实push与事件计算；验证映射表未污染、有效负责人、事件唯一性及主链路。目标收件16只发测试账号。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 迁移 `0011`：intake_module + manual_owner_assignment_version（默认 1，改派递增）；本地库已应用。
- 仓储：createManualRequirement 支持创建即指定负责人（owner → manually_mapped + 版本 1，无负责人 not_required 且 assigned_at 为 NULL 满足 0006 完整性 CHECK）；assignManualOwner 递增分配版本。
- 路由：intakeModule 对照已发布词典校验（未知 400）；owner 结构校验后透传；DTO 返回 intakeModule 与 assignmentVersion。
- 前端：IntakeForm 模块下拉（getFunctionModules）+ 模块责任人候选提示；详情『模块（录入）』行。
- 测试：app.test（模块/负责人透传、未知模块 400）、集成（创建即负责人：manually_mapped/版本1/映射表未污染；改派版本 2 只影响本条）。
- 验证：root typecheck/API 424/Web 81/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 109/build:prod 全绿。
- 待目标侧（16）：与 Base 负责人变化自动化的“只发一次”共验、真实收件回读。
