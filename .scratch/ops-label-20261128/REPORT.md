# 运维页重复指标文案：已判定重复 → 已排除

- 日期：2026-11-28
- 提交：根仓 `f88e162`（已推 `f9d552b..f88e162`）、妙搭 `52cbc5a`（已推 `074d13d..52cbc5a`）
- 背景：后端 SQL 里该指标是 `decision IN ('duplicate','ignored')` 的合计，写「已判定重复」会把「已忽略」也算进去；软件产品定文案为集合词「已排除」。

## 改动

`ops-page.tsx` 一行文案：

- 改前：`重复：已判定重复 {confirmedSuppressed} · 疑似 {suspected}；`
- 改后：`重复：已排除 {confirmedSuppressed} · 疑似 {suspected}；`

只动字：查询、接口字段、`confirmedSuppressed` 取值都没变。

## 实测（1440，mock 数据）

页面文本：`负责人：自动 210 · 手工 118 · 待匹配 8 · 无需 0；重复：已排除 12 · 疑似 5；评分：AI 建议 300 · 人工修改 36 · 采用 AI 291（采纳率 97%）`

全文不再出现「已判定重复」。截图：`ops-duplicate-label.png`。

## 回归守卫

- 根仓 `panels.test.tsx`（OpsPanel 用例）：断言 `重复：已排除 2 · 疑似 1`，并断言页面不出现 `已判定重复`；先把文案改回旧值确认**会失败**，再在修复后确认通过。
- 妙搭 `scripts/rqsys-client-detail-wiring.test.mjs`：新增静态守卫，要求 `opsPanel` 含 `重复：已排除 … · 疑似 …`、不含 `重复：已判定重复`。

## 门禁

| 检查 | 结果 |
|---|---|
| 根仓 web 单测 | **266/266** |
| 根仓 typecheck / build | 通过 |
| 妙搭 client 测试 / typecheck | **29/29** / 通过 |
| 两仓 `ops-page.tsx` | 文案逐字一致 |
