# 发版后验证 · 重新分析 force / 评估解锁 / 无 pool 深链（2026-11-23）

- 版本：release `7711218458428656832` / commit `e7e71ef`（含后端 `82b8b90` force、前端 `a0f8511`/`f51b3d1`）
- 预算：2 次模型调用，实际 **2 次**（① 重新分析 1、② 生成评估 1）；③ 全部 0 调用
- 结论：**③ 6 条全 PASS、① PASS、② PASS**

## 1. ③ 无 pool 深链（0 调用）

| # | 步骤 | 实测 | 判定 |
|---|---|---|---|
| 3-1 | 直接开 `?requirement=967634c9…`（集团 RQ-000526） | URL 保留 `requirement`，hash 变 `#group-requirements`，落在「集团需求池共 191 条」并自动打开详情，无 404 | PASS |
| 3-2 | 同页 F5 | 仍停在该详情、hash 与 `requirement` 都在 | PASS |
| 3-3 | 开 `?requirement=85837f43…`（产品 RQ-000316） | 落在产品池并打开详情 | PASS |
| 3-4 | 详情点「返回需求池」 | 回到集团池列表（191 条、25 行、无详情） | PASS |
| 3-5 | 负例 `?pool=product&requirement=<集团 UUID>` | 仍显示「无法载入需求详情」——接口守卫未被前端改动影响 | PASS |
| 3-6 | 列表点行 → 详情 | 详情正常打开，URL 重新带上 `requirement` | PASS |

证据：`evidence/deeplink-01-group-no-pool.png`

## 2. ① 重新分析真跑（1 次调用，Base 已还原）

样本 RQ-000323（`654edd88…`，开跑前分析 v2）。

| 断言 | 实测 | 判定 |
|---|---|---|
| 按钮旁成本提示 | 页面出现 2 处「会消耗一次模型调用」（重新分析 / 保存并重新分析） | PASS |
| 点击反馈 | 「已入队」 | PASS |
| 审计 | 12:29:48 `analysis.retry_requested`（`queued_new_job`，`priorAnalysisVersion=2`）→ **12:30:19 `analysis.terminal succeeded`** | PASS（旧缺陷正是缺这条） |
| 新版本 | 分析版本 `v2 → v3`，`analyzed` | PASS |
| 评分链路 | `scoring.suggested` score 6 / P2 / `scoreVersion 3` | PASS |
| 推送 | 12:30:25 `base.push succeeded`，`lastPushedAt` 更新 | PASS |
| Base 影响 | `AI分析版本` 1→3、`最后推送时间` 更新（`AI优先级建议` 仍是 P2，未变） | — |
| Base 还原 | 按快照 PUT 后复核 **0 差异** | PASS |

分析 v3 按既定口径保留。快照：`dumps/base-REANALYSIS-20261123-*.json`

## 3. ② 生成评估 → 提示词块自动解锁（1 次调用，未刷新页面）

样本 RQ-000316（`85837f43…`，此时评估 0 行）。

| 步骤 | 实测 | 判定 |
|---|---|---|
| 生成前 | PRD 块显示「先生成一条成功的需求评估，才能生成 PRD 提示词」，按钮 `disabled=true` | PASS（前置正确） |
| 点「生成评估」 | 201，约 24s，详情出现 `v1 · 建议暂缓 · 置信度：高 · rq-assessment-v1 · claude-sonnet-5-5` | PASS |
| **不刷新页面**看 PRD 块 | 变为「评估 v1 · 建议暂缓 / 基于该评估结论和下面的调研结论生成」，`disabled=false`，前置提示消失 | PASS |
| 失败不解锁 | 线上无安全触发方式，留组件用例 | 未验（如实记录） |

证据：`evidence/unlock-01-assessment-to-prd.png`

## 4. 清理

- 评估：RQ-000316 新增 1 行（`2026-11-23T04:30:59Z`，v1），**待 SQL 删除**；RQ-000526 已在上次清理后为 0。
- 提示词：A/D 均 0 行（本轮未生成提示词）。
- 补充上下文：A 为 `null`；本轮未写入 C。
- Base：产品表 334 / 集团表 191 行不变；C 行已还原 0 差异；A/B/D 行无变化。
- 需求：产品 334、`suppressed=0`、`pushPushed=334`；集团 191；B 仍 `active`、`duplicateOf` 为空。

```sql
DELETE FROM requirement_assessments WHERE requirement_id = '85837f43-1cd0-423b-9413-fe274e4ae8a1';
```

## 5. 复验口径说明

- ① 证明「重新分析」不再是静默空转：有 `analysis.terminal`、有新版本、有推送，三点齐全才算过。
- ② 判据是**不刷新页面**就解锁；若必须先刷新才算通过，本次按 FAIL 记录（实测无需刷新）。
- ③ 负例与守卫不变；深链只影响前端路由，接口层「显式 pool 不符 → 404」保持。
