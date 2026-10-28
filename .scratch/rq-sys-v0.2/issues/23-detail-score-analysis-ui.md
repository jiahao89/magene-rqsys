# 23: 详情摘要评分卡与 AI 评分分析整合

**What to build:** 调整需求详情信息架构：摘要卡突出综合分/P 并把返回按钮置顶；把“评分与优先级”和“AI 分析与建议”整合为单一区域，展示 U/M/S/C 四维评分与 AI 依据；人群 AI 建议默认选中首个建议，并区分 AI 建议、PM 选择与保存按钮。

**Blocked by:** 21（评分详情UI）、22（评分v2目标验收）；本票是目标验收后的 UI 信息架构修订。

**Status:** target-verified（2026-10-28：release 7701549098247474481 / a215988；合成 RQ-000343 已验证并清理）

**Approval:** 2026-10-28 用户提出 5 条详情 UI 调整并确认“先整理进 PRD，然后修改”。

**Spec:** [V02-S06](../../../specs/rq-sys-v0.2/06-ai-scoring-and-priority.md)、[PRD §4.2.7/§4.4](../../../docs/2026-10-21-rq-sys-v0.2-prd.md)

## Acceptance criteria

- [x] V02-T23-AC01：摘要卡首屏显示当前综合分和 P0–P3；无评分显示“暂无评分”；返回需求池位于卡片最顶部。
- [x] V02-T23-AC02：评分与 AI 建议只有一个“AI 评分与优先级”区域；U/M/S/C 四维卡显示合成值、公式、AI 建议/理由/证据/缺失标记；九项输入仍可编辑。
- [x] V02-T23-AC03：模块/类型/人群/整体置信度作为次级 AI 建议，不再出现第二个“AI 分析与建议”大区块。
- [x] V02-T23-AC04：人群未确认且 AI 有建议时默认选中首个建议；是否保存由用户显式操作；已确认值（含空集）不被刷新覆盖。
- [x] V02-T23-AC05：AI 建议标签、PM 选择标签、保存按钮视觉区分；标签选中态明确；修改不触发主流程。
- [x] V02-T23-AC06：Web/妙搭两仓 typecheck/build/test 通过；桌面/移动/浅深色布局可读。
- [x] V02-T23-AC07：目标环境发布后验证摘要评分卡、整合区、人群默认选中，并清理合成数据/记录证据。

## Verification

- 本地：Web 89/89；妙搭 typecheck/build/route（115）通过；两仓对齐。
- 目标：待发布后使用受控合成需求复验，证据写入本票和验证报告。

## 2026-10-28 本地实施记录

- PRD §4.2.7 重写详情信息架构：摘要卡评分/P、返回置顶、评分与 AI 单一区域、U/M/S/C 维度卡；§4.4 增加人群默认选择与视觉分层；§7 增加第 18–21 项验收。
- V02-S06 D6 同步重写，新增 AC11–AC14。
- Web：摘要卡显示当前/建议评分与 P；单一“AI 评分与优先级”区域；四张维度卡（合成值+AI 建议/理由/证据/缺失）；九项输入分组；人群 AI 建议默认选中首个、AI 建议 chips/PM 选择/Save 按钮三层样式；响应式与深色样式。
- 妙搭仓镜像同一 UI/CSS/组件；typecheck、build:prod、route 115、eslint、stylelint 通过；Web 89/89、根仓 typecheck/build、两仓对齐通过。
- 目标发布：2026-10-28 10:41–10:55 多次 `+release-create` 返回平台 500（500000049），release-list 无新记录；11:01 重试成功，final release `7701549098247474481 / a215988`。目标复验合成 `RQ-000343`：摘要卡 7.20/P3、四维卡 U9/M2/S2/C3、单一“AI 评分与优先级”区域、AI 建议 L2/L3 默认选中 L2、保存按钮独立样式；删除需求/评分/分析/推送/审计/Base 行后 requirements 315、base_record_id 312、API 404。
- 目标证据：`target/detail-ui-refresh-evidence.json`、`ui/target-detail-score-summary.png`、`ui/target-detail-score-section.png`、`ui/target-detail-audience.png`、`ui/local-detail-*.png`。
