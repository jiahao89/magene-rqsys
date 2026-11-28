# 评分 v4 启用与端到端验证（2026-11-28）

用户拍板 B：正式启用 `pragmatic_triage_v4`。执行人：测试。一步一停，零手动重试。

## 1. 发布规则（完成）

UI：「优先级规则」→「创建务实初筛规则 v4 草稿」（默认值即 80/60/40，季度重点留空）→「发布」。

| 项 | 值 |
|---|---|
| 版本 | **v4** |
| formulaType | `pragmatic_triage_v4` |
| 状态 | **published**（v3 → retired，全表 1 条 published） |
| 阈值 | `{p0: 80, p1: 60, p2: 40}` |
| quarterlyFocus | `null` |
| published_at | 2026-11-28 17:12:27 (+08) |
| created_by | 1868660374748201 |

审计：`priority_rule.created` 17:12:16、`priority_rule.published` 17:12:27。

## 2. 真实分析（RQ-000026）— 链路已通

选型：TB 来源、产品池、已分析已推送、负责人贾浩；改前 **6.00 / P2（v5，umsc_weighted_v3）**。点「重新分析」一次。

| 检查项 | 结果 |
|---|---|
| `promptVersion` | **`rq-analysis-v5`** ✅ |
| `triageScoring` | ✅ `{impact:3, urgency:3, version:"v4", costTier:null, guardrail:null, strategicMatch:false}` |
| 分数 0–100 | **60** = 3×12 + 3×8 ✅ |
| P 判定 | **P1**（60 ≥ 60，按 80/60/40）✅ |
| 评分行 | 1830 → **1831**，v4 形态 0 → **1** ✅ |
| 历史行显示 | `v6 · ai_suggested AI 建议 60 / 100 · P1` ✅（不是 `60.00`） |

`scoring.formula` 返回 `pragmatic_triage_v4`、阈值 80/60/40、
`score = clamp(0, 100, impact×12 + urgency×8 + costAdj + strategicAdj); 安全红警→P0, 严重缺陷(影响≥4)→不低于P1`。

## 3. 旧数据没有被重算（完成）

| 检查 | 结果 |
|---|---|
| 1830 行旧分指纹（id:version:score:priority 的 md5） | 分析前后同为 `078286c69cf2c853186523dee39e9f1f` ✅ |
| RQ-000267 v1 | 6.40 / P3 / `umsc_weighted_v2` / 2026-10-29，未变 ✅ |
| RQ-000316 v1、v2 | 1.60、0.80，`umsc_weighted_v2`，未变 ✅ |

## 4. 预期内行为（不是缺陷）

**4.1 一次点击消耗 2 次模型调用**（`analysis_runs` 1631 → 1633）

| 版本 | 开始 | 结束 | 状态 |
|---|---|---|---|
| av5 | 17:15:24 | 17:17:34 | `failed_retryable` / `interrupted`「Superseded by a later successful analysis version」 |
| av6 | 17:17:25 | 17:17:33 | `analyzed`，P1，9 秒完成 |

av5 约 120s 超时后由调度器自动重试（`MAX_SCHEDULER_ANALYSIS_RETRIES=3`）。
旁证：审计里**只有一条** `analysis.retry_requested`（17:15:22，force），第二次是调度器行为，不是人工重试。
现象记作「v5 首轮超时」；若 v5 普遍超时则是成本问题，需单独看。

**4.2 重分析触发了 Base 推送**（`base_push_runs` 2111 → 2112）

推送与分析解耦、不等分析成功；AI 优先级变了就更新 Base。产品池行 `recvxDsIbIdA04`：

| 字段 | 变化 |
|---|---|
| AI优先级建议 | P2 → **P1** |
| AI分析版本 | 4 → **6** |
| 最后推送时间 | 1794801498116 → 1795857455295 |
| 系统通知事件ID | `ai_retry_success:…:av4` → `…:av6`（类型「AI 重试成功」，收件人负责人贾浩本人） |

Base 全表 336 行，仅这 1 行 4 字段变化，其余 0 差异；`base.push` 审计带
`omitted_fields:AI模块建议=车辆传感器(not_in_base_select_options)`。

## 5. 未覆盖 / 已知限制

1. **主卡 `60 / 100` 无线上样本**：摘要卡与评分主视觉取 `scoring.current`（`summaryScore = current ?? ai`），
   新评分是 `ai_suggested`，`current` 仍是 v5（6.00 / P2）。线上详情打开看到的是「当前评分 已采用 AI P2 6.00」，
   `60 / 100` 只在评分历史行。要上主卡必须点「采用 AI 建议 v6」——单向写，本轮不拿真实需求做，故**未验证**。
2. **已发布规则没有回退入口**：`publish` 只收 `draft`，v1/v2/v3 全 `retired`（再发布 409），UI 发布按钮禁用，
   服务端无撤销发布/retire 接口。退回 v3 只能线上事务改库且**绕过审计**（回滚脚本已备、未执行，PR-16 已开票）。
3. **v5 首轮 120s 超时**：本轮首轮 120s 未返回、触发自动重试；是否为偶发或普遍，需要周一自动同步后观察样本。

## 6. 零写基线快照（本轮验收结束状态）

| 项 | 值 |
|---|---|
| 需求 live / 已排除 | **527 / 0** |
| `requirement_score_versions` | **1831** 行（v4 形态 **1** 条） |
| 已发布规则版本 | **1**（v4；v3/v2/v1 全 retired） |
| `analysis_runs` | **1633**（`rq-analysis-v5` **2** 条：1 超时 + 1 成功） |
| `base_push_runs` | **2112** |
| `audit_events` | **7502**（本轮 +6：rule.created、rule.published、analysis.retry_requested、scoring.suggested、analysis.terminal、base.push） |
| 产品池 Base | **336 行**（1 行 4 字段变化，即 RQ-000026） |

## 证据

- `evidence/r-01-after-create-draft.png`、`r-02-after-publish.png`
- `evidence/r-03-before-reanalyze.png`（改前 6.00 / P2）
- `evidence/r-04-after-reanalyze-v4-ui.png`（改后主卡仍是 6.00 / P2）
- `evidence/r-05-history-v4-row.png`（历史行 `60 / 100 · P1`）
- `base-after-push.json`（推送后产品池全表）
