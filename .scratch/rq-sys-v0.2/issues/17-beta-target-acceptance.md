# 17: RICE与Kano Beta独立目标验收

**What to build:** Beta功能可单独启用/关闭，RICE可复算、Kano引用和推断边界可核对，主流程始终不受影响。

**Blocked by:** 12 RICE按获批量纲计算并保留版本；14 手动Kano生成证据化假设报告；16 核心V0.2兼容迁移与目标验收

**Status:** target-verified（2026-10-25：Kano 真实模型运行在目标完成——合成资料导入→批准→kano_run 作业→deepseek-chat 报告落库并抽检通过；RICE 计算为纯函数+集成已证、UI 交互点检留用户统一验证）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S04](../../../specs/rq-sys-v0.2/04-rice-beta.md)、[V02-S05](../../../specs/rq-sys-v0.2/05-kano-beta.md)

**Execution gate:** G-RICE、G-KANO和目标模型/环境写入授权满足后执行；无正式问卷则只验AI假设。

## Acceptance criteria

- [x] V02-T17-AC01：目标RICE草稿/计算/历史可读回，配置版本和人工actor正确，缺项/非法值不出正式分数。
- [x] V02-T17-AC02：目标Kano以获批最小材料生成报告，证据链接/章节/片段和人群覆盖逐项复核。
- [x] V02-T17-AC03：无虚构受访者、人数、百分比或Kano系数，PM复核不升级为真实研究。
- [x] V02-T17-AC04：Beta运行、失败、重试及关闭不影响主AI/P0–P3/Base/通知；残留Beta作业不能阻塞主队列。
- [x] V02-T17-AC05：两种来源均能手动使用Beta，旧报告保存输入快照，源内容变更提示旧版本。
- [x] V02-T17-AC06：目标模型隐私和语义质量分别留证；不以本地stub冒充模型真实输出。
- [x] V02-T17-AC07：Beta有独立验收结论；未通过可以继续关闭，不倒置为核心新建流程未通过。

## Verification

目标公共接口/详情与独立存储回读，受控模型小样本复核；不触发正式干系人消息。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 目标环境验证记录（无登录态部分）

- 基础设施：rice_drafts(+history)/kano_evidence_versions/kano_runs 在 online 建表并可访问（当前空）；pipeline_jobs CHECK 含 kano_run；发布版 worker 全量同步端到端成功（315/315），Beta 作业类型就绪。
- 待人工点检：RICE 四项输入保存→“已计算”分数显示（量纲 rice-v1）；Kano 资料导入（含 PII 拒绝路径）→批准→手动运行→报告“AI假设（待验证）”标注。
- 语义质量抽检（真实模型小样本、证据逐条可核对）保持与 API 联通验收分离，待人工执行。

## 2026-10-25 Kano 真实模型运行验证（目标环境）

- 受控输入：合成去标识资料 v1（标题标注“（合成验收）”、3 条证据片段、覆盖限制注明 L2/L3 合并与 L1 缺样本）→ approved；kano_run v1（RQ-000099，rq-kano-v1）。
- 真实模型：deepseek-chat 一次成功；报告落 kano_runs.result。
- 语义抽检结论（逐项）：证据引用 S3 存在于片段 ✓；候选类型受控且**证据不足时拒绝强行归类**（fail-closed 生效）✓；成对正反向问题针对具体能力 ✓；推演明确标注“并非真实受访者作答”✓；缺口准确复述覆盖限制并声明无样本量/占比推断 ✓；researchStatus=AI假设（待验证）✓；audience 空（未确认）不强行分层 ✓。
- 隔离：Kano 运行前后需求主状态不变（analyzed/pushed）、队列清空、error 日志（4h）0。
- 留用户统一验证：RICE 表单交互与分数显示、Kano 面板在 UI 上的呈现。

## 2026-10-26 目标 UI 点检（用户授权）

- 在目标 Online 合成需求 `RQ-000343` 详情 Beta 面板完成 RICE：200 / 3 / 80 / 4 → UI 显示“已计算 · RICE = 120”，依据源版本 v1、草稿版本 v1。
- Kano：选择目标已批准合成资料 v1 手动运行 → `deepseek-chat` / `rq-kano-v1` / 3 个能力项 / `AI假设（待验证）`；证据不足处明确标注且无样本量/比例/系数；报告 UI 正常展示。
- 主分析、优先级、Base/通知状态在 RICE/Kano 操作前后未变化（目标会话内核对）。
- 截图：`verification-20261026/ui/target-rice.png`、`target-kano.png`。
