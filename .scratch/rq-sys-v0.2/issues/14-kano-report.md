# 14: 手动Kano生成证据化假设报告

**What to build:** 用户手动运行Kano，看到成对问题、虚拟倾向、分类假设、引用、置信度与缺口及报告历史。

**Blocked by:** 08 主AI增加需求类型与六层人群建议；13 Kano选择获批访谈资料版本

**Status:** implemented-local（2026-10-25：迁移 0016 + 共享 Kano 模块 + 独立 kano_run 作业 + 触发/列表路由 + Beta 面板运行与报告展示，两仓全量验证；目标模型语义验收按 17）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S05](../../../specs/rq-sys-v0.2/05-kano-beta.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T14-AC01：仅手动触发，固定需求/人群确认状态/资料/模型和提示词版本；无标签不阻断。
- [x] V02-T14-AC02：复用可恢复队列但使用独立Beta任务类型、去重键与结果状态；相同请求不重复调用，显式重跑生成新版本；限制同需求活动运行和超时，Beta重试不得饿死主流程。
- [x] V02-T14-AC03：针对具体能力/人群生成正反向问题和五选项，推演只到画像级，不创建虚构受访者答卷。
- [x] V02-T14-AC04：候选类型受控；期望型与一维质量为同一类，证据不足和冲突分别说明。
- [x] V02-T14-AC05：引用必须存在于选定资料版本中，可定位链接/章节/片段；不接受模型编造链接、样本量、比例或系数。
- [x] V02-T14-AC06：所有报告标记AI假设（待验证）；PM复核独立留痕，不能把AI假设改成真实问卷已验证。
- [x] V02-T14-AC07：模型超时/非法输出安全失败并可重试；不改变主AI、优先级、Base和通知状态。
- [x] V02-T14-AC08：来源/资料版本变化后旧报告保留并标明过期依据。

## Verification

已登录运行→真实worker→报告读取＋受控provider；目标小样本语义与隐私验收17。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 迁移 `0016`：kano_runs（UNIQUE(requirement,run_version)、输入快照列）+ pipeline_jobs 增加 kano_run 类型；本地库已应用。
- 共享模块 `beta/kano.ts`（SHARED 逐字一致，纳入对齐）：rq-kano-v1 提示词（资料=数据、层定义、禁造统计）、strict 输出 schema（六候选类型/五选项/ref 证据）、validateKanoReport（证据 ref 必须命中资料片段）、buildKanoRequest（需求文本经 maskPii）、createDeepSeekKanoProvider（复用主分析同名 env；测试注入受控实现）。
- 工作流：handleKanoRunJob（读 run→资料可用性门禁（approved 且未标记）→provider→校验→complete/fail；失败作业按成功结算）注册进两组合合根 kano_run handler；worker 分阶段表映射 kano_run。
- 仓储：listKanoRuns/getKanoRun/createKanoRun（活动守卫+版本+作业+审计同事务）/completeKanoRun/failKanoRun（两仓同 SQL）。
- 路由（两仓）：POST/GET /api/requirements/{id}/kano-runs（资料门禁 409、活动运行 409、staleInputs）；OpenAPI 路径。
- 前端：BetaPanel 增加 Kano 运行区（资料版本选择、手动触发、最近 3 次报告：能力点/人群/候选/正反向问题/推演/证据/缺口/置信度，全部标注 AI假设（待验证）+过期提示）。
- 测试：kano 单测（掩码/受控类型/伪造引用/统计字段拒绝/版本固定）、processing handler 两例（成功+主流程隔离；非法输出安全失败不重试）、集成（版本/守卫/作业/审计/生命周期/隔离）、root HTTP（未批准 409/触发 202/活动 409/列表 stale）、妙搭路由（服务端 actor）。
- 验证：root typecheck/API **440**/Web 81/build/对齐（新增 beta/kano.ts 入 SHARED 27/27）/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 **114**/build:prod 全绿。
