# 评估修复层 / error_detail / 提出人验收（2026-11-25）

- 线上版本：bundle `ff99603`，release `7712002699050929404`（迁移 0033 已先于发版同步到 online）
- 样本：RQ-000316（`85837f43-…`）
- 模型调用：**5 次**（批准 3 次；多出 2 次是我读错字段名后重跑，见 §4）
- 结论：**三件事全部 PASS**；修复层本次未触发（模型首次输出即合规）

## 1. 评估恢复正常（含 503/超时检查）

| 项 | 实测 | 判定 |
|---|---|---|
| 请求结果 | 200，评估 v1 `succeeded`，`model=deepseek-flash`，`promptVersion=rq-assessment-v1` | PASS |
| 耗时 | `created_at 15:13:59.462` → `completed_at 15:14:24.401` = **24.9 秒**（远低于 65s 前端超时） | PASS |
| 界面表现 | 显示「评估 v1 已生成 · 建议暂缓 · 置信度：高」，**没有**出现「请求失败/评估生成超时」 | PASS |
| 内容完整度 | 背景/目标/业务价值等段落成文，非空壳 | PASS |
| 失败原因列 | `error_code = null`、`error_detail = null` | PASS |
| 修复层 | `audit_events` 中 `assessment.output_repaired` 计数 **0** —— 本次没有触发（模型首轮就返回合规 JSON） | 如实记录 |

## 2. error_detail 列（只读 SQL）

```sql
-- 表结构
SELECT name, data_type, is_allow_null FROM information_schema.columns
WHERE table_name='requirement_assessments' AND column_name='error_detail';
-- 实际用 +db-table-get 确认：text、nullable、存在
```

- 列存在：`error_detail`，`text`，`is_allow_null = true`
- 成功行该列都是 null：本次 RQ-000316 v1 → `null`；库里另一条真实评估（需求 `2c4fe5c3-…`，13:35 生成）也是 `null`

## 3. 聊天粘贴的提出人（两次草稿，只看不提交）

| 用例 | 输入 | `draft.proposer` | 判定 |
|---|---|---|---|
| 转述 | 「…反馈人：李娜（客服）」 | **null** | PASS（不再出现「李娜（客服）」这类转述标注） |
| 已掩码 | 「…反馈人：（姓名已掩码）」 | **null** | PASS（占位串不再落进提出人） |

两次都 `fallback=false`、`aiFilledCount` 分别 6 / 5，草稿未提交、未产生需求记录。

## 4. 调用次数说明（超出预算）

- 账面上：评估 1 次 + 草稿 4 次 = **5 次**；审计 `intake.draft_extracted` 也是 4 条，可核对。
- 超出的 2 次是我的问题：先用接口直接跑了两条草稿，读的是 `proposerName` 字段，而实际字段名是 `draft.proposer`，读不到值只能再用 UI 重跑两次。

## 5. 数据与清理

| 项 | 结果 |
|---|---|
| 我造的评估行 | 1 行，**已删除**（`DELETE … rows_affected = 1`，删前 dry-run 预览过） |
| 提示词行 | 0 行 |
| 剩余评估行 | 库里还有 **1 行不是这次造的**（需求 `2c4fe5c3-9f24-4cad-9d60-c6182cfbb1f4`，13:35 生成，`deepseek-flash`）——不是我造的，没动 |
| 需求总数 | 产品 335 / 集团 191 |
| Base | 产品 335 行 / 集团 191 行；RQ-000316 的 Base 行未变（`AI分析版本=7`、`最后推送时间` 未变） |
| 聊天草稿 | 两次都未提交，无新需求 |
