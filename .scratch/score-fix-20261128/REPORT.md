# 评分小于 1 时读成「0.80.8」的修复

- 日期：2026-11-28
- 提交：根仓 `e8ac1e9`（已推 `7b1db98..e8ac1e9`）、妙搭 `8366dc3`（已推 `c3e5db4..8366dc3`）
- 现象（测试线上发现）：`ArcoStatistic` 把整数位和小数位渲染成两个 `<span>`；之前用 `renderFormat` 把整串格式化结果塞进整数位，于是 `0.8` 变成 `<span>0.80</span><span>.8</span>`，`innerText` / 读屏念成「0.80.8」。

## 两种做法都验证过（1440，真实 DOM 取值）

| 做法 | 0.8 | 6 | 4 | DOM |
|---|---|---|---|---|
| ① 单一文本节点 `<span className="score-number">{score.toFixed(2)}</span>` | `0.80` | `6.00` | `4.00` | 1 个节点 |
| ② `precision={2}`（**采用**） | `0.80` | `6.00` | `4.00` | `0` + `.80` 两段，整体文本 `0.80` |

两种都能修好、都不丢小数位。选 ②：改动只有一行、保持 Arco 组件与现有 26px 字号（①是 28px/600，会让分数视觉上变大一点），也符合仓库「优先用 Arco 原生」的约定。

## 实测（`precision={2}`，浏览器取值）

| 需求 | `.score-number-line` textContent | 页面是否出现 `0.80.8` |
|---|---|---|
| score 0.8 | `0.80P3` | 否 |
| score 6 | `6.00P3` | 否 |
| score 4 | `4.00P3` | 否 |

截图：`precision-scoring-0.80.png`、`precision-scoring-6.00.png`、`precision-scoring-4.00.png`；对照用 `single-node-scoring-0.80.png`。

## 回归用例

- 新增 `panels.test.tsx`：「renders a sub-1 score once in the DOM instead of duplicating the decimal」断言 `.score-number-line` 的文本是 `0.80P3` 且不含 `0.80.8`。
- 先把它跑在旧实现上确认**会失败**（`0.80.8`），再在修复后确认通过——不是只写个能过的用例。
- 原有的 `ScoringPanel` 断言 `getByText("6.40")` 因节点拆分改为读 `.arco-statistic` 的 `textContent`（仍断言 `6.40`）。

## 门禁

| 检查 | 结果 |
|---|---|
| 根仓 web 单测 | **265/265** |
| 根仓 typecheck / build | 通过 |
| `check:arco-styles` | 通过 |
| `check:alignment` | 12/12，无未声明漂移 |
| `git diff --check` | 通过 |
| 妙搭 client 测试 / typecheck | **29/29** / 通过 |
| 两仓该段代码 | 逐字一致 |

## 一个顺带发现（未改，供定夺）

「AI 评分与优先级」区块里的综合分固定用 `toFixed(2)`，而评分 v4 是 0–100 分制：线上 v4 记录这里会显示 `80.00`，而上方摘要卡显示 `80 / 100`。这不在本次缺陷范围内，是否统一成「v4 不带小数、v3 保留两位」等产品确认。
