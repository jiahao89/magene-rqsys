# 01: 收敛共同工作流入口并保持TB行为

**What to build:** 现有TB需求从拉取到分析、负责人、Base和状态查询继续按原契约工作；后续手工收录可复用同一工作流入口。

**Blocked by:** None（无代码前置；仍需检查下列外部门槛）

**Status:** implemented-local（2026-10-24：两仓落地并通过全量本地验证；未在目标环境验证/发布，正式结论汇合到 16）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S02](../../../specs/rq-sys-v0.2/02-main-analysis-and-audience.md)、[V02-S03](../../../specs/rq-sys-v0.2/03-base-and-notifications.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T01-AC01：只抽取收录后主流程的就绪判断、安全分析输入准备和推进编排；平台启动、身份和数据库驱动继续由各自运行时适配。（新增共享模块 `requirements/processing.ts`：`isIntakeComplete`（在 `domain/workflow.ts`，TB synced 语义不变）、`analysisPiiMarkers`、`dispatchAfterSync`、`handleAnalysisJob`、`handleBasePushJob`；`server.ts`/`runtime.ts` 仅保留 env 装配、worker 生命周期与日志出口）
- [x] V02-T01-AC02：现有TB成功、AI失败非阻断、待匹配、无负责人、重试与source_only语义不改变。标题过滤冲突由15单独处理，不在重构中混改。（既有行为套件全部原样通过：root API 410/410（含新增 8 个模块接缝用例）、Web 79/79、妙搭路由 108/108；`source_only` 路由用例不变）
- [x] V02-T01-AC03：业务模块有小而完整的Interface，隐藏配置获取和版本/任务规则；不新增仅做一层转发的框架。（模块隐藏词典/优先级规则加载、分析版本与 dedupe 键规则、夹具守卫环境；作业体整体移入而非包一层——组合根直接委托）
- [x] V02-T01-AC04：根仓与妙搭仓复用同一业务行为契约，共用模块纳入严格对齐，新差异不得只写"平台不同"规避验证。（`requirements/processing.ts` 纳入 SHARED 逐字对齐 26/26；并按 PRD 8.5 EQ-10 前置完成对齐脚本加固：双向遍历 + `audit/event.ts` 从豁免挪入 SHARED，app 独有 5 模块全部声明）
- [x] V02-T01-AC05：现有HTTP/worker行为用例仍可驱动完整链路；外部模型/Base可替换，不新增测试专用生产路由。（provider 经 `createProvider` 注入、Base 经 deps.base 注入，均沿用生产构造默认值；未新增任何路由）
- [x] V02-T01-AC06：只调整本次涉及职责，不整体重排所有前端/仓储模块或更换技术栈。（改动面：新增 1 个共享模块 + 测试；两仓组合根改委托；`advance.ts`/`push-service.ts`/`http/app.ts` 的 pull 门禁换用 `isIntakeComplete`（语义等价）；`domain/workflow.ts` +1 函数；对齐脚本 EQ-10 加固。前端/仓储布局未动）

## Verification

复用当前HTTP→worker→Base行为回归及两仓契约用例；保留旧结果对照，验证可观察行为一致。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记"已实现，未在目标环境验证"。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-24 实施记录

- 新模块：`apps/api/src/requirements/processing.ts` ＝ `rq-sys-miaoda/server/rqsys/requirements/processing.ts`（SHARED）。三段作业体（同步后下游推进 / analysis / base_push）从两仓组合根收敛到此；本地开发入队上限（RQSYS_MAX_ANALYSIS_PER_SYNC）改为依赖注入，妙搭侧行为不变（默认不限）。
- 就绪判断：`domain/workflow.ts` 新增 `isIntakeComplete(pull)`（当前仅 `synced`）；`pipeline/advance.ts`（两处）、`base/push-service.ts`、`http/app.ts`（analysis 重试/推送/负责人共 3 处）的 `pull !== "synced"` 门禁统一改经该函数，语义等价，V02-T02/T04 扩展 `collected` 时只改一处。
- 顺带修正的既有漂移（统一行为契约的收益）：妙搭推送作业此前丢弃"外部写成功但记账失败"信号，现与根仓一致输出 stderr 日志。
- 对齐加固（PRD 8.5 EQ-10，T01 前置）：`check-repo-alignment.mjs` 改为双向遍历（app 独有 5 模块入 `APP_ONLY` 声明），`audit/event.ts` 挪入 SHARED（键序统一后逐字一致）。
- 本地验证（2026-10-24）：root typecheck/API **410**/Web 79/build/对齐 26/26/契约 20 通过 0 失败/`git diff --check` 全绿；妙搭 type:check/路由 **108**/build:prod/eslint/stylelint 全绿。目标环境未迁移、未发布——发布前无需数据库迁移（本片无 schema 变更），但需按滚动发布惯例确认旧实例退出。
