# 15: 对齐同标题不同TB ID的保留规则

**What to build:** TB不同ID的同标题需求各自保留，同一ID的分页重放只处理一次，手工同标题需求也互不合并。

**Blocked by:** None（无代码前置；仍需检查下列外部门槛）

**Status:** implemented-local（2026-10-23：同标题“仅提示、独立处理”语义已在两仓实现并随 root `c422a0e` / app `7493524` 发布，release `7699805493326204199`；正式 T15 结论仍汇合到 V02-T16）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)

**Execution gate:** G-ID 已于 2026-10-23 随拆分确认：来源 ID 优先，不同 TB ID 的同标题需求独立保留；按此实施，无需再次确认该原则。

## Acceptance criteria

- [x] V02-T15-AC01：按已确认的来源ID不变量，取消以同标题丢弃不同TB ID的行为；保留同一来源ID去重。（`sync/service.ts` 只按 TB ID 去重；同标题走 `markDuplicateTitles` 仅写 `duplicate_of_requirement_id` 提示，不丢弃、不隔离；搜索/指标/分析/推送/负责人分配均不再过滤重复提示。root API 399、app 路由 107 测试含相关用例）
- [x] V02-T15-AC02：保留跨分页重复同一ID去重、分页停滞保护、source_only和指定ID重试能力。（`SyncOrchestrator.run`：`seen` 集合去重、cursor 不前进抛 `TB_PAGINATION_STALLED`、`source_only`/`onlyIds` 语义有专门测试）
- [x] V02-T15-AC03：不同ID同标题、规范化后同标题、空标题、内容后续变化均可独立导入和追溯。（service.test.ts：同标题导入、空标题不标注、标题恢复唯一时清除标注；发布后目标全量同步 315/315 succeeded，27 条历史重复重新导入并独立分析/推送）
- [ ] V02-T15-AC04：导入计数说明接口取得数、重复ID数、实际处理数；不把标题相同当数据已经对齐。（部分：批次计数只报实际处理数（totalCount/succeeded/failed），“接口取得数/重复ID数”未单独上报；是否需要拆分上报待产品确认）
- [x] V02-T15-AC05：已有数据不批量删行、不按标题合并，也不推断过去缺失记录就是测试数据；后续授权同步按源ID恢复。（当前代码无删行/合并路径；10-22 旧版清理掉的 27 条已于 10-23 同步按源 ID 重新导入）
- [ ] V02-T15-AC06：根仓与妙搭等价；与手工创建幂等和Base平台键用例共同回归。（两仓等价已达成：`check:alignment` 24/24 且 `sync/service.ts` 逐字一致；与 T04 手工创建幂等、T03 Base 平台键的联合回归等待那两票实施后补做）

## Verification

合成分页数据通过现有SyncOrchestrator公共接口及需求查询验证计数和ID集合；本轮不调用真实TB。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-23 实施记录

- 实现：同标题记录全部导入；后出现的记录写 `duplicate_of_requirement_id` 指向最早一条（标题键 NFKC+trim+空白折叠+小写）；标题恢复唯一时自动清除标注。详情页显示“疑似重复”提示并链接主记录，不阻断分析/推送/负责人分配。
- 目标证据（随发布产生的同步，不替代 T16 汇合验收）：release `7699805493326204199` 后全量同步 315/315 succeeded，315 条全部 analyzed，Base 288→312 行，24 条同标题记录首推静默，无孤儿/重复 TB ID。
- 回归加固（同日）：`markDuplicateTitles` 失败不再把已成功条目拖成整批失败，改记批次摘要（root `sync/service.test.ts` + app `rqsys-sync-orchestrator.test.cjs` 新增用例）。
- 本地验证：root API 399/399、Web 79/79；app 路由 107/107；两仓 typecheck/对齐通过。
