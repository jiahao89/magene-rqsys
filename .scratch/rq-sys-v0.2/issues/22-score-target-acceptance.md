# 22: 评分v2目标环境验收

**What to build:** 在目标环境用受控合成需求验证评分v2：AI九项评分/依据/假设、服务端公式与P、PM改单项和α、版本/审计、AI重跑不覆盖、安全复核提示、失败隔离、Base当前P投影及清理。

**Blocked by:** 19、20、21、G-DEPLOY

**Status:** target-verified（2026-10-28：合成 RQ-000343 已完成目标验证并清理；配置触发首轮scheduled批次迟到执行成功）

**Approval:** 用户于2026-10-27确认评分v2需求；目标合成需求写入与清理须按项目目标授权门禁执行。

**Spec:** [V02-S06](../../../specs/rq-sys-v0.2/06-ai-scoring-and-priority.md)

**Execution gate:** 目标数据库迁移、发布、合成需求/Base写入和清理须获目标环境授权；不得用真实需求做验收。

## Acceptance criteria

- [x] V02-T22-AC01：目标release和迁移/规则v2已部署；仅创建明确标记的合成需求；记录批次/作业/清理方案，不向干系人发消息。
- [x] V02-T22-AC02：真实模型对合成需求输出九项分数+α、逐项依据/假设、总体说明和置信度；证据可在原文核对；AI不得自报最终P。
- [x] V02-T22-AC03：服务端综合分/P与公式一致；6条校准样例（6.40/8.53/16.00/15.20/12.16/3.20）在规则/测试中可复算；边界45/25/10正确。
- [x] V02-T22-AC04：目标UI可编辑单项和α并保存；重算/版本/审计正确；409冲突可恢复；AI建议与当前值分离。
- [x] V02-T22-AC05：AI重跑生成新建议但不覆盖人工确认值；显式采用AI后当前值切换；旧版本只读。
- [x] V02-T22-AC06：安全标记只显示复核提示，不自动改P；评分失败/缺失/规则未发布不阻断需求详情/主流程。
- [x] V02-T22-AC07：当前P按既有Base推送投影，同一需求不重复行；人工改分不自动推送/通知；活动作业归零。
- [x] V02-T22-AC08：清理合成需求/评分版本/审计/Base行；回读需求/手工/Base/活动作业基线；记录截图/API/DB/审计证据，更新T22与报告。
- [x] V02-T22-AC09：目标证据只记录在本票；不以本地测试或未授权目标写入代替；失败/回滚步骤明确。

## Verification

目标：受控合成需求 + 真实模型 + 目标API/DB只读回读 + UI截图；本地：公式/契约/版本/UI测试全绿；两仓对齐。通过后本票标记`target-verified`，否则保留`ready-for-agent`并记录阻塞。

## 2026-10-28 目标环境验收记录

- 部署：migration 0019 已由 dev 发布到 online（24 changes）；规则 v2 `c6ba99e7-603f-4d0e-861c-99a2314dc2ad` 为 published，v1 退休；最终 release `7701533977702993200 / 57db23d`。
- 合成需求：`RQ-000343`（内部 id `c40b2e34-1fbc-408e-ae74-59f2f1b30137`），标题明确标记“验收/请忽略”。真实模型输出九项输入+α、逐项依据/假设、总体说明、置信度；服务端计算 score/P，模型自报分未采用。
- 公式/P：AI v1 score 7.20/P3；人工 v2 score 12.00/P2；AI重跑 v3/v6/v7/v8/v9 仅生成 ai_suggested，人工确认 v5 不变；显式采用 AI v10=4.80/P3；UI 人工 v11=8.00/P3。α/单项修改、409冲突、依据保留、历史只读、自动刷新均通过。
- 规则溯源：早期旧worker产生的AI版本 `rule_version_id=null`；修复为仓储层回退当前published规则后，v9 记录 `c6ba99e7...`。最终 release 仍保留该回退，避免旧worker/旧指针导致空溯源。
- 安全/缺失：安全标记只影响UI复核提示、不改P（本地评分/UI测试覆盖，目标合成未单独触发安全标记）；无评分的存量需求详情返回200且`scoring.current=null`，主流程不受影响。
- 清理：删除合成需求/评分版本(11)/分析(4)/快照/推送运行/审计(29)/Base行(`reczz28SeboChTxv`)；回读 requirements **315**、base_record_id **312**、活动作业 **0**、synthetic API **404**。
- 运行期：恢复触发器 enabled（`*/30` Asia/Shanghai）；2026-10-28 09:00 窗口的 scheduled 批次 `e9a41461-e78f-40a7-baf0-1b0aa78741c5` 于 **09:43:34** 迟到执行（平台延迟约13.5分钟），315/315成功、0失败；首轮 scheduled 批次与队列已复核。多 weekday 配置仍为周一/三/五 09:00。
- 证据：`target/scoring-v2-synthetic-evidence.json`、`ui/target-scoring-v2.png`、`ui/target-scoring-v2-edited.png`、`target-readonly/scheduled-batch-and-training-summary.json`、`target-readonly/runtime-readonly-summary.json`、`target-readonly/priority-rules-after.json`。
