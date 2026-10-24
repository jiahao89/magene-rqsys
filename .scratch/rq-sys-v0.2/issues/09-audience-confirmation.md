# 09: PM修改人群并保留人工确认

**What to build:** PM在详情调整L1–L6标签，AI建议、当前人工值和历史分开；重跑不覆盖确认。

**Blocked by:** 08 主AI增加需求类型与六层人群建议

**Status:** implemented-local（2026-10-25：迁移 0013 + audience 保存 API + 前端标签编辑器，两仓全量验证）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S02](../../../specs/rq-sys-v0.2/02-main-analysis-and-audience.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T09-AC01：支持多选、增删与明确空集合，区分未确认和已确认空集。
- [x] V02-T09-AC02：记录操作者、时间、独立修改版本和变更前后值，冲突可恢复。
- [x] V02-T09-AC03：AI重跑保留人工当前值，旧建议和来源版本仍可查看。
- [x] V02-T09-AC04：人工标签修改不改主优先级、不重置Base PM状态、不自动发通知或启动Kano。
- [x] V02-T09-AC05：未修改标签仍可正常创建和推送；无标签显示待判断，不强制选择。

## Verification

详情读写接口和UI交互，配合主分析重跑验证确认不丢失及无额外主任务。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 迁移 `0013`：audience_tags（jsonb 数组 CHECK）/audience_confirmed/audience_version（乐观版本，0=未修改）；本地库已应用。
- 仓储 `setAudienceTags`（两仓同 SQL）：行锁版本比对 → 去重保存 + confirmed=true + 版本递增 + audience.updated 审计，单事务；not_found/version_conflict 明确结局。
- 路由 `PUT /api/requirements/{id}/audience`（两仓）：枚举校验（L1–L6，≤6）、409 附当前版本；OpenAPI 路径与 Requirement.audience 状态。
- 前端：`AudienceEditor`（L1–L6 切换按钮 + 保存 + 确认状态提示；两客户端）；详情挂载带防御默认（滚动发布期旧响应无该字段不崩）。
- 测试：集成（多选/乐观冲突/确认空集/无副作用/审计 2 条）、root HTTP（保存/409 带版本/未知层 400）、妙搭路由（服务端 actor）。
- 验证：root typecheck/API **429**/Web **81**/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 **111**/build:prod/eslint 全绿。
