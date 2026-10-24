# 09: PM修改人群并保留人工确认

**What to build:** PM在详情调整L1–L6标签，AI建议、当前人工值和历史分开；重跑不覆盖确认。

**Blocked by:** 08 主AI增加需求类型与六层人群建议

**Status:** ready-for-agent

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S02](../../../specs/rq-sys-v0.2/02-main-analysis-and-audience.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [ ] V02-T09-AC01：支持多选、增删与明确空集合，区分未确认和已确认空集。
- [ ] V02-T09-AC02：记录操作者、时间、独立修改版本和变更前后值，冲突可恢复。
- [ ] V02-T09-AC03：AI重跑保留人工当前值，旧建议和来源版本仍可查看。
- [ ] V02-T09-AC04：人工标签修改不改主优先级、不重置Base PM状态、不自动发通知或启动Kano。
- [ ] V02-T09-AC05：未修改标签仍可正常创建和推送；无标签显示待判断，不强制选择。

## Verification

详情读写接口和UI交互，配合主分析重跑验证确认不丢失及无额外主任务。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。
