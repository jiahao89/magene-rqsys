# 24: 总览页优先级分级统计与规则展示

**What to build:** 总览页新增优先级分级统计：P0–P3 需求数量、待评分数量；展示当前评分范围和规则版本；当前评分优先，无评分时使用历史分析优先级并明确标注。

**Blocked by:** 19（评分契约）、20（人工评分）、23（详情评分 UI）；指标 SQL 依赖 `0019_scoring_v2.sql`。

**Status:** implemented-local（2026-10-28：API/Web/妙搭 UI 与测试完成；目标发布验证待执行）

**Approval:** 2026-10-28 用户提出总览按分级统计并显示分级规则。

**Spec:** [V02-S06](../../../specs/rq-sys-v0.2/06-ai-scoring-and-priority.md) D10

## Acceptance criteria

- [x] V02-T24-AC01：总览显示 P0/P1/P2/P3 数量与待评分数量；合成 fixture 不计入。
- [x] V02-T24-AC02：分级优先使用当前评分版本；无评分但存在最近分析优先级时使用 legacy 并在 UI 标注；两者都无计入待评分。
- [x] V02-T24-AC03：显示评分规则版本和范围 P0≥45、P1 25–44.99、P2 10–24.99、P3<10；规则未发布时明确提示。
- [x] V02-T24-AC04：统计只读，不改变需求状态/优先级；接口/UI 空数据、规则缺失状态可恢复。
- [x] V02-T24-AC05：两仓 API/UI 对齐；根仓/妙搭 typecheck/build/测试通过。
- [ ] V02-T24-AC06：目标环境发布后验证统计数量、规则展示、legacy/待评分口径，并记录证据。

## Verification

- 本地：API 460/460、Web 90/90、妙搭 route 115/115；typecheck/build 待跑。
- 目标：release 后使用只读 API/UI 回读；不新造合成需求（统计只读）。

## 2026-10-28 本地实施记录

- API：`getPipelineCounts` 增加 `priority`（P0–P3/scored/legacy/unscored）；`/api/overview/metrics` 增加 `priorityRule`（版本/阈值/公式）。分取当前评分版本优先，无评分回退最近已分析优先级并标记 legacy；合成 fixture 排除。
- Web/妙搭总览：新增“优先级分级”面板（P0–P3 + 待评分）、评分范围（45/25/10）、规则版本与公式、legacy/待评分说明；响应式/深色样式。
- 本地验证：API **460/460**、Web **90/90**、妙搭 route **115/115**；根仓 typecheck/build、妙搭 typecheck/build:prod/eslint/stylelint、两仓对齐通过；本地真实 PostgreSQL overview 返回 `P2=6, scored=1, legacy=5`，SQL 正常。
- 目标：待 release 后只读回读；不创建合成需求。
