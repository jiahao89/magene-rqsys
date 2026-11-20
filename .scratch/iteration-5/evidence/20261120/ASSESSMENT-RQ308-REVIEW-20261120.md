# RQ-000308 需求评估验收数据复核（2026-11-20）

> 对象：`RQ-000308`《AT S 海外上市码表固件适配》
> 需求 UUID：`a2573c66-5887-45f7-a793-7805d54f1e88`
> 目的：确认 v1/v2/v3 三条验收数据可清理；清理前留档。

## 1. 版本概览

| 版本 | 状态 | 输入 | 结论 | 置信度 | 关键结果 |
|---|---|---|---|---|---|
| v3 | succeeded | background + goal | `investigate` | `medium` | `scope.in` 4、假设 5、openQuestions 8、提示词 1,298 字 |
| v2 | failed | 与 v3 完全相同的 inputs（hash 相同） | — | — | `analysis_failure`，`output=null`，无半成品 |
| v1 | succeeded | `{}`（空输入） | `investigate` | `low` | `scope.in` 3、假设 3、openQuestions 8、提示词 1,234 字 |

- v2 与 v3 的 inputs 规范化 hash 相同：`24bd7e23…`，确认失败不是输入差异，是模型偶发输出不符合契约；已另行交后端改「未知键忽略 + 字段路径日志」。
- `v2` 失败版本保留在历史中，UI 显示「v2（失败）」，没有覆盖 v1/v3。
- v1 空输入时明确写「依据不足/不编造/无法判断」，未虚构市场、成本、竞品或用户量。

## 2. 契约检查（v1 / v3）

| 项 | v1 | v3 |
|---|---|---|
| 全部字段齐全、无 `null` | ✓ | ✓ |
| `value` 是字符串 | ✓ | ✓ |
| `verdict` 三选一 | `investigate` | `investigate` |
| `confidence` 三档 | `low` | `medium` |
| `scope.in` 1–8 条 | 3 | 4 |
| `scope.out` 0–8 条 | 0 | 0 |
| `assumptions` 每条以「假设：」开头 | ✓（3 条） | ✓（5 条） |
| `openQuestions` 0–8 条 | 8 | 8 |
| `investigationPrompt` 100–5,000 字 | 1,234 | 1,298 |
| PII / Base record ID | 无 | 无 |

字段长度均在 PRD 上限内；v3 的 `scope.out` 为空是契约允许的 0 条，UI 显示「未提供」。

## 3. 内容复核

- **v1 空输入**：标题只有「AT S 海外上市码表固件适配」，评估没有硬编型号、市场、认证结论；将「AT S 含义」「目标市场」「认证/服务器状态」放进 openQuestions，判 `investigate/low` 合理。
- **v3 补充输入**：背景写德国/Q2/德语/CE/当地服务器，评估据此把范围落到德语、CE、服务器、版本冻结；技术/成本/依赖/风险均写「依据不足/无法判断」或具体依赖，没有编造工作量与市场数据；判 `investigate/medium` 合理。
- **v2 失败**：失败无输出，未返回半成品；属于已知的模型偶发契约不符，不是数据问题。

## 4. 一个需要确认的契约偏差（非内容质量）

`inputs` 目前只落非空键：

- v1：`{}`（三个键都缺）
- v3：`{background, goal}`（缺 `scenario`）

PRD §4.10.3 写的是「三个键，空字符串保留」。当前服务端代码注释也写「只存非空字符串」，与 PRD 不一致。建议后端/产品确认口径：

- 若要按 PRD 追溯，应在写入前规范化为 `{background:"", goal:"", scenario:""}` + 实际值；
- 若接受只存非空键，则应改 PRD 和接口说明，避免测试按错误契约断言。

这条不影响本次三条测试数据清理；证据已保存在 `assessment-rq308-versions.json`。

## 5. 另一个非阻塞 UI 观察

打开 v3 时，详情页「需求评估」的三个补充输入框是空的（0/2000），历史 `inputs` 没有回填到表单；版本结论和输出正常。是否要在切换历史版本时回填输入，交前端/产品决定，不影响本次清理。

## 6. 清理安排（2026-11-20 11:05 更新：暂缓）

**先不删，等发版后用一次真实调用验完容错改动，再一次性清理。**

清理范围（届时一次删）：

- 现有 v1 / v2 / v3 三行；
- 发版后新增的验收行（用 `{}` 或补充输入生成，用于验证 `inputs` 三键对齐和容错）。

清理后复核：

- `GET /api/requirements/a2573c66-5887-45f7-a793-7805d54f1e88/assessments` 返回 `items: []`；
- 按 `requirement_id` 查 `requirement_assessments` 为 0 行；
- RQ-000308 本体、AI 分析、Base/通知均不受影响。

发版后先验：

- `POST {}` 仍 201；
- 新行 `inputs` 必须含 `background` / `goal` / `scenario` 三个键，空值保留为 `""`；
- 成功行契约字段仍齐全，失败行仍保留 `failed` 版本。

## 7. 证据

- [assessment-rq308-versions.json](assessment-rq308-versions.json)：三条完整 API 响应。
- [assessment-rq308-review.json](assessment-rq308-review.json)：机器可读复核结果（含 inputs hash、契约检查）。
- [assessment-rq308-summary.png](assessment-rq308-summary.png)：版本 chips + v3 结论/范围/可行性。
- [assessment-rq308-detail.png](assessment-rq308-detail.png)：假设、openQuestions、Investigation 提示词折叠区。

## 8. 清理后复核（2026-11-20 11:14 完成）

- [x] `GET /api/requirements/a2573c66-5887-45f7-a793-7805d54f1e88/assessments` → `{items: []}`（[assessment-rq308-after-cleanup.json](assessment-rq308-after-cleanup.json)）
- [x] `requirement_assessments` 全表 **0 行**；该需求 **0 行**（只读 SQL 复核）
- [x] RQ-000308 本体仍在，`processing_state=active`，流水线 `synced/analyzed/manually_mapped/pushed` 未受影响
- [x] 详情页「需求评估」回到空态「还没有评估结果」，不报错（[assessment-rq308-after-cleanup.png](assessment-rq308-after-cleanup.png)）
- [x] 本轮只删 `requirement_assessments` 的 v1–v4 四行，未动 Base/通知/需求本体
