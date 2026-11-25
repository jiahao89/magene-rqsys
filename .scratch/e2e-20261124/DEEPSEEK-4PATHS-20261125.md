# DeepSeek 切换后 AI 四路径验收（2026-11-25）

- 线上版本：bundle `2004d15`（`index-D9AFGRp4.js`），release `7711955620015099143`
- 配置：`AI_BASE_URL=https://api.deepseek.com`、`AI_MODEL=deepseek-flash`、超时 120s
- 样本：RQ-000316（`85837f43-1cd0-423b-9413-fe274e4ae8a1`，手工样例）
- 模型调用：**6 次**（批准 4 次；多出的 2 次是评估路径的失败重试，见 §2）
- 结论：**4 条路径最终都通，但「需求评估」在 DeepSeek 下不稳定，且失败会导致前端误判为超时**

## 1. 四路径结果表

| 路径 | 结果 | 返回 model | 耗时 | 备注 |
|---|---|---|---|---|
| ① 需求分析（重新分析 force） | ✅ PASS | `deepseek-flash`（`provider=deepseek`） | 模型 7.2s（05:44:11.396→05:44:18.612）；点击到 Base 推送完成约 16s | 分析 v9，`analyzed`；审计 `analysis.retry_requested(force)` → `analysis.terminal succeeded` → `base.push succeeded`；评分 score 2 / P3 |
| ② 需求评估（生成评估） | ⚠️ 最终成功，过程失败 | `deepseek-flash` | **v1 失败 22.7s → v2 失败 21.9s → v3 成功 22.1s，总计约 72s** | v1/v2 `analysis_failure`，v3 `succeeded`（建议暂缓 / 高置信度）；前端 65s 超时先触发，UI 显示「请求失败 · 评估生成超时」，服务端仍在 72s 完成 v3 |
| ③ PRD 提示词 | ✅ PASS | `deepseek-flash` | 45.3s（05:56:48.772→05:57:34.071），未到 90s 上限 | v1，`rq-prd-prompt-v1`，5,991 字、10 章按序、4 条假设、6 个开放问题、含「调研结论未回填」标记 |
| ④ 聊天粘贴 intake-draft | ✅ PASS | 未回传 model | 约 5s | 7 处「AI 填充」：标题《C606 码表无法连接 ANT+ 心率带》、来源渠道「售后」、产品型号「C606」、需求类型「质量修复」、功能模块「车辆传感器」（并给出模块责任人候选 贾浩）、需求描述成段整理；未提交，草稿不落库 |
| Kano | 跳过 | — | — | 线上无已批准访谈资料，接口要求 approved 且未标 PII 的资料版本，前置不满足 |

## 2. 关键问题

### P1 · 评估在 DeepSeek 下 2/3 失败，且失败重试把耗时推过前端超时

- v1（05:45:26）、v2（05:45:49）都以 `analysis_failure` 结束，间隔约 22 秒；v3（05:46:11）成功。
- `analysis_failure` 在代码里覆盖三种情况：模型返回空内容、非 JSON、或不符合评估输出契约（字段路径会写服务端脱敏日志）。**具体属于哪一种需要看妙搭服务端日志**，客户端拿不到。
- 前端超时是 **65s**（`panels.tsx`：服务端排队上限 60s + 5s 余量）。三次尝试合计约 72s，因此前端在 65s 中止并显示「评估生成超时」，而服务端在 72s 完成了 v3 —— 用户看到失败，数据其实已经成功落库。

### P2 · 评估成功后 PRD 提示词块没有自动解锁（本次场景）

- 11-23 验过的行为是：评估成功 → 提示词块立刻从「先生成一条成功的需求评估」变成「评估 v1 · …」，不用刷新。
- 本次因为客户端先超时中止，`generate()` 走了 catch 分支、没调 `onSaved?.()`，所以 `assessmentRevision` 没递增，提示词块一直是禁用态；**刷新页面后才变成「评估 v3 · 建议暂缓」并可点**。
- 复现条件：服务端最终成功但耗时超过前端 65s（即失败重试场景）。建议前端在超时后轮询一次历史，或在 `load(true, true)` 里发现最新版本已成功就手动 `onSaved`。

### 观察 · 姓名掩码表现和 11-23 不一致

- 11-23 那次草稿描述里写的是「（姓名已掩码）」；本次「李娜（客服）」**整段没有出现**，既没泄露、也没有掩码占位。
- PII 安全没问题（姓名未进草稿、未进面板），但表现不稳定，需要产品确认预期是哪一种。

## 3. 数据与清理

| 项 | 数值 |
|---|---|
| 评估行（本次新增） | **3 行**：v1 failed、v2 failed、v3 succeeded |
| 提示词行（本次新增） | **1 行**：v1 succeeded |
| 需求总数 | 产品 335 / 集团 191（未变） |
| 推送/压制/失败 | 335 已推送、已压制 0、失败 0 |
| Base | 分析路径改动了 `AI分析版本` 7→9 与 `最后推送时间`，已按快照 PUT 还原，**复核 0 差异** |
| 分析版本 v9 | 按老规矩保留，报告注明 |

待执行 SQL（无删除接口，需后端/Chief 执行）：

```sql
DELETE FROM requirement_assessments WHERE requirement_id = '85837f43-1cd0-423b-9413-fe274e4ae8a1';
DELETE FROM requirement_prd_prompts WHERE requirement_id = '85837f43-1cd0-423b-9413-fe274e4ae8a1';
```

## 4. 证据

- `evidence/k-01-deepseek-analysis.png`（① 分析结果）
- `base-4paths-before.json` / `base-4paths-after1.json` / `base-4paths-restored.json`（Base 快照与还原）
- 评估三行的时间戳与错误码：05:45:26 failed / 05:45:49 failed / 05:46:11 succeeded（API `GET /assessments`）
