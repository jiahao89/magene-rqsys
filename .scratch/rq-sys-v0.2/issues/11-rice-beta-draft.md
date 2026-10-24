# 11: 详情Beta入口保存RICE人工草稿

**What to build:** 用户按需打开RICE并保存部分人工输入及依据，默认流程和优先级完全不受影响。

**Blocked by:** 02 扩展统一来源身份并读回现有TB记录

**Status:** implemented-local（2026-10-25：迁移 0014 + 草稿读写 API + 详情 Beta 面板，两仓全量验证；正式分数/排名留给 12（G-RICE 量纲门槛））

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S04](../../../specs/rq-sys-v0.2/04-rice-beta.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T11-AC01：入口仅位于需求详情更多/Beta，主导航和默认需求池不加评分列。
- [x] V02-T11-AC02：保存四项人工输入/依据、actor、需求来源版本、编辑版本与历史；打开面板不调用AI。
- [x] V02-T11-AC03：未配置量纲或不完整输入显示待配置/待补充，不返回正式分数或排名。
- [x] V02-T11-AC04：并发保存冲突可恢复，输入缺项允许草稿；AI不能写成负责人已确认值。
- [x] V02-T11-AC05：新需求/源内容变更后旧草稿保留并提示依据版本，不静默清空。
- [x] V02-T11-AC06：Beta禁用或失败不更新主分析、主推送状态，不入主队列或发通知。

## Verification

Beta HTTP读写＋详情入口集成；保存/刷新/历史/冲突与主状态对照。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 迁移 `0014`：rice_drafts（PK=需求，乐观 edit_version）+ rice_draft_history；本地库已应用。
- 仓储 getRiceDraft/saveRiceDraft（两仓同 SQL，单事务：行锁版本比对→合并保存→历史追加）；未传字段保留、null 清空。
- 路由 GET/PUT /api/requirements/{id}/rice-draft（两仓）：量纲未获批时 score 恒 null、状态 待配置/待补充；OpenAPI 路径。
- 前端：BetaPanel（详情次级折叠区，两客户端）——四项草稿输入+依据，保存后显示状态/源版本/草稿版本。
- 测试：集成（保存/合并/冲突/历史/零副作用：无新作业、流水线不变）、root HTTP（默认态/保存/待配置/409）、妙搭路由（服务端 actor）。
- 验证：root typecheck/API **431**/Web 81/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 **112**/build:prod 全绿。
