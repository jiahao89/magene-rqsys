# 术语改名 / 评分 v4 / 详情新布局 冒烟（只读）

- 日期：2026-11-28
- 发布：release `7713125459367005478`，妙搭 `c3e5db4`，根仓 `7b1db98`，CI `46122610189`
- 方式：登录态浏览器实点，只读；未提交表单、未调用模型、未写数据
- 视口：1440 / 1000，暗色用页面主题按钮切换

## 1. 术语（方案 A）

| 检查 | 结果 |
|---|---|
| 处理视图 | 显示「全部 / 仅活跃 / 已排除」✅ |
| 深链 `?stage=requirements&processingState=suppressed#requirements` | 页面保持该筛选，「已排除」单选为选中态（`arco-radio-checked`），0 条空态 ✅ |
| 总览 | 「已排除 0 条，不参与分析与推送」✅ |
| 我的需求 | 说明与页头「含已排除」、共 140 条 ✅ |
| 运维 | 「重复：已判定重复 0 · 疑似 27」✅ |
| 「压制」残留 | 需求池、我的需求、集团需求池、同步记录、数据源与计划、作业运维、总览、需求详情、回收站全文检索均 **0 处** ✅ |
| 行内状态标签「已判定重复 / 已忽略」 | **无样本**：线上 527 条全部 active、0 条已排除，无可显示的标签 |
| 409「该需求已被排除」 | 同上，无删除/排除样本可触发 |

## 2. 评分 v4

- 三条详情：
  - RQ-000528：当前综合评分 **6.00**、P2、`v1 · AI 建议 · 低置信度`；
  - RQ-000316：**0.80**、P3、`v2 · PM 人工 · 低置信度`，安全红警提示正常；
  - RQ-000346：**4.00**、P3、`v1 · AI 建议 · 低置信度`。
- U / M / S / C 四张维度卡均完整（分数、公式、AI 判断、理由），无空白、无报错。
- 列表排序：`?sort=priority_asc` 与界面「排序方式 → 按优先级（P0 → P3）」均生效（P0×8 → P1…，上限 100 条）。
- **小问题（不阻塞）**：0.8 分的详情里 Arco Statistic 的 DOM 是 int 段 `0.80` + decimal 段 `.8`，`innerText` 读作 `0.80.8`；截图视觉只显示 `0.80`，但读屏会重复。建议把 `renderFormat` 换成 `precision={2}`。当前影响 2 条 `score < 1` 的当前评分。

## 3. 详情页新布局

- 1440：摘要栏（返回、编号、版本、来源、状态）、标题、负责人/操作行、三个 Tab（核心信息与定级 / 需求评估与 PRD / 历史与高级）正常，无溢出。
- 1000：`pageScrollWidth = 1000`，无横向溢出，卡片与按钮正常折行。
- 暗色：`body` 计算背景 **`rgb(23,23,26)`**，整页统一暗色（上一版白画布问题已修复）。
- 上一轮遗留的窄屏表格：1000 下 `.arco-table-content-inner` `scrollWidth 1100 > clientWidth 700`，可滚 400px；滚到最右「操作」表头 x=840–960 可见，页面仍无整页横向溢出 ✅。

## 4. 登录与健康

- 登录态：`/api/health` 200 `{status:ok}`；`/api/health/ready` 200 `{status:ready,database:connected,expected:"0036_perf_indexes.sql"}`。
- 匿名：`/api/health`、`/api/health/ready`、`/api/requirements` 均 **302** 到飞书登录，`@NeedLogin()` 生效。

## 未做 / 说明

- 未点「重新分析」「生成评估」「生成 PRD 提示词」，未调用模型。
- 未写数据：需求 527 live / 0 deleted、`analysis_runs` 1631 与本轮开始一致。
- 行内标签与 409 文案因无已排除样本未验证；如需线上证据，需要一次「忽略 → 撤销」的可逆操作（待批准）。

## 证据

- `evidence/t-01-suppressed-deeplink.png` 深链「已排除」
- `evidence/t-02-overview.png` 总览提示
- `evidence/t-03-ops.png` 运维重复指标
- `evidence/t-04-mine.png` 我的需求「含已排除」
- `evidence/t-05-priority-sort.png` 优先级排序
- `evidence/t-06-detail-1440.png`、`t-07-detail-1000.png`、`t-08-detail-dark.png` 详情三态
- `evidence/t-09-narrow-list-left.png`、`t-10-narrow-list-right.png` 窄屏表格左右
- `evidence/t-12-score-crop-big.png` 0.8 分视觉放大
