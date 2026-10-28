# 19: AI评分契约与U/M/S/C v2计算规则

**What to build:** 扩展主分析输出九项评分输入和α，服务端按固定公式计算综合分与P0–P3；新增评分版本持久化与规则v2，保留v1历史兼容。

**Blocked by:** —（Spec与产品口径已于2026-10-27确认）

**Status:** target-verified（2026-10-28：目标迁移0019、规则v2发布、AI九项评分/证据/服务端P已验证；release 7701533977702993200 / 57db23d）

**Approval:** 用户于2026-10-27确认允许AI直接评分、必须给依据/说明，并拆分本票。

**Spec:** [V02-S06](../../../specs/rq-sys-v0.2/06-ai-scoring-and-priority.md)、[V0.2 PRD §4.2](../../../docs/2026-10-21-rq-sys-v0.2-prd.md)

**Execution gate:** 本地实现与回归可直接进行；目标数据库迁移/发布属G-DEPLOY范围，须按项目授权执行。

## Acceptance criteria

- [ ] V02-T19-AC01：分析契约新增`scoring`（九项输入+α、逐项依据/假设、总体说明、安全标记、评分置信度、可选proposedScore）；非法/缺项/越界/无依据/证据不匹配拒绝整条评分并进入可重试失败。
- [ ] V02-T19-AC02：服务端纯函数按`U=pain×frequency`、`M=sellingPoint×competitor`、`S=roadmap×dependency`、`C=MAX(workload,technicalRisk,resource)`、`score=round2(U×α×(1+0.6M+0.4S)/C)`计算；模型自报P被忽略；P0≥45/P1≥25/P2≥10/P3<10。
- [ ] V02-T19-AC03：α范围0.5–2.0、步长0.1；默认0.8单渠道、1.0多渠道、1.5已确认安全；九项输入整数范围校验；C≥1，非法/非有限/除零不生成正式分。
- [ ] V02-T19-AC04：迁移新增`requirement_score_versions`与`requirements.current_score_version_id`；AI分析成功时生成`ai_suggested`或`current`版本，固定sourceVersion/analysisVersion/ruleVersion及输入快照；旧分析无评分时保持空。
- [ ] V02-T19-AC05：发布规则v2（`formulaType=umsc_weighted_v2`、输入定义、α默认、阈值、校准样例：6.40/8.53/16.00/15.20/12.16/3.20）；v1置retired但历史FK保留；不自动回算历史。
- [ ] V02-T19-AC06：需求详情读取接口返回current/aiSuggestion/history/formula（或等价的只读结构）；旧分析/旧评分可读；评分失败不影响需求详情打开。
- [ ] V02-T19-AC07：证据/假设校验、PII掩码、日志脱敏沿用现有分析适配器；不得把姓名/联系方式/ID/附件内容发送模型。
- [ ] V02-T19-AC08：根仓与妙搭仓共享模块/契约/迁移/OpenAPI对齐；单测覆盖公式边界、AI输出非法、旧版兼容；API/路由/typecheck/build/diff--check全绿。

## Verification

本地：评分计算器单测（边界45/25/10、α步长、C最大值、非法数）、AI输出校验、迁移/仓储版本状态、详情接口、旧分析兼容、双仓对齐。目标：本票不直接写目标；由T22汇总。

## 备注

- 旧规则v1的`priority_rule_versions`记录不删除；新分析使用v2。
- 评分输入9项对应PRD §4.2.2；`safetyFlag`只做复核标记，不自动改P。

## 2026-10-28 本地实施记录

- 迁移 `0019_scoring_v2.sql`：评分版本表、当前指针、v2规则与6个校准样例，v1退休保留历史FK。
- `scoring.ts` 固化九项输入、α、证据/假设校验、P0–P3 边界；AI输出新增`scoring`，证据/假设与原文校验；模型自报P被忽略。
- `requirement_score_versions` 仓储支持AI建议/current、人工确认、采用AI、版本冲突；详情返回current/aiSuggestion/history/formula。
- 验证：API **460**、Web **86**、妙搭路由 **115** 全绿；typecheck/build/对齐通过。目标环境未部署。
