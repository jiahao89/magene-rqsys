# 遗留项补跑方案（等发版后执行）

- 日期：2026-11-20
- 触发：Chief 分批推进遗留项，测试负责「A12 四条样例」与「块 3 AI 草稿 + 重复提示」
- 前置：等本轮代码修复（`base_form` 编辑入口、评估输入回填、假设前缀归一化）发版后再执行；执行前先确认新发版号

## 0. 执行规矩（沿用）

- 建数据前在群里报**时间 + 标题前缀**；建完报**新 RQ 号与前后计数**；验完当轮请后端删 App 行 + Base 行，我复查基线回 **334/333/0/1/0**、`requirement_assessments` 全表 0。
- 不触发 PM 通知：首推本来静默（`first_push` 返回 undefined），不写「系统通知事件ID」；验完确认该字段为空。
- 评估行随需求删除级联，不单独清。

## 1. A12 四条样例

样例集：[SAMPLES-20261120.md](</Volumes/Files/A_Projects/RQ-Sys/.scratch/ai-assessment-samples/SAMPLES-20261120.md>)
判定：[RUBRIC-20261120.md](</Volumes/Files/A_Projects/RQ-Sys/.scratch/ai-assessment-samples/RUBRIC-20261120.md>)

### 两种跑法（成本不同，需 Chief 选）

| 方案 | 做法 | 模型调用 | 造数 | 还原度 |
|---|---|---|---|---|
| **A（推荐，忠实样例）** | 新建 4 条 `[验收]A0x样例` 需求（`intakeOrigin:"chat_paste"`），正文用样例的需求文本与补充输入 | **8 次**（4 次创建后自动 AI 分析 + 4 次评估） | 4 条需求 + 4 个 Base PM 行 | 完全对齐样例与 RUBRIC |
| B（省调用） | A01 用 RQ-000308（信息完整）、A02 用 RQ-000335（仅标题）跑真实需求；A03/A04 仍需新建 2 条 | **6 次**（4 评估 + 2 分析） | 2 条需求 + 2 个 Base PM 行 | A01/A02 的正文与样例不同，RUBRIC 的「必须引用事实」要放宽 |

- 推荐 A：样例是虚构的，用真实需求替换会让 RUBRIC 的硬失败判据（必须引用哪些事实、禁止编造哪些）失去基准，验收结论不可比。
- 注意：方案 A 的「新建需求」会自动触发 AI 分析与 Base 首推，这是样例文档里「不写 Base」无法完全避免的，按「写后当轮删」处理；如 Chief 不接受临时写 Base，则只能走方案 B 且 A03/A04 改为对现有需求做「技术不可行/价值存疑」抽检，结论降级为抽检而非 A12。

### 若走方案 A 的执行步骤

1. 逐条 `POST /api/requirements`（标题 `[验收]A01样例 …`，`intakeOrigin:"chat_paste"`，`sourceChannel:"售后"`），记 4 个 RQ 号；等 `pipeline.analysis=analyzed`。
2. 逐条 `POST /api/requirements/{id}/assessments`，body 用样例的 `background/goal/scenario`（各自在 2000/1000/2000 限内）。
3. 拉 `GET .../assessments` 原始 JSON 落盘：`a12-A0x.json`。
4. 按 RUBRIC 判：硬失败（缺字段/枚举非法/编造数字规格/假设不标/结论无依据/越界承诺/PII）任一 → FAIL；否则按 80 分线与维度打分。
5. 逐条出结论：`verdict` 是否命中样例期望（advance/investigate/hold/hold）、置信度是否在期望区间、`scope.in` 1–8 / `scope.out` 0–8、`assumptions` 全以「假设：」开头（本轮归一化后应全角）、`investigationPrompt` 100–5000 字且含 9 项要素。
6. 汇总为 `A12-RESULT-20261120.md`，附每条证据 JSON 与硬失败命中情况。

## 2. 块 3 · 聊天粘贴 AI 草稿 + 重复提示

### N6a AI 草稿（1 次模型调用，不造需求）

- `POST /api/requirements/intake-draft`，body `{text:"<一段口语化聊天内容，含型号/场景/提出人>"}`。
- 断言：HTTP 200；响应含 `draft`（title/description/sourceChannel/模块/提出人等）、`fallback`（布尔）、`aiFilledCount`；`title ≤200`、`description ≤20000`。
- 不写入需求：执行前后 `source-counts` 不变；审计各 1 条 `intake.draft_extracted`（含 `requestId`、`promptVersion`、`textLength`，不含正文）。
- 兜底路径（可选）：同一文本重复请求触发每用户限流时应 429 + `Retry-After`，不审核一次模型（若已命中限流则记录，不额外造调用）。

### N6b 重复提示（1 条造数 + 1 次自动分析）

- 用一条**已有需求的原标题**新建 `[验收]` 需求（`intakeOrigin:"chat_paste"`），例：与 RQ-000308 同标题。
- 断言：201；池里该行带「疑似重复」徽标；详情「重复处理」显示已发现同标题候选、「确认重复」可选主记录（只开不提交）；`processing_state` 仍是 active（未自动压制）。
- 副作用：新建会触发 1 次 AI 分析与 Base 首推（首推静默、无通知字段）。
- 验完删除该行 + Base 行；已有需求不受影响（不产生判定记录）。

## 3. 清理清单（两批一起清）

| 批次 | App 行 | Base PM 行 |
|---|---|---|
| A12 | 4 条 `[验收]A0x样例` + 各自派生（分析/评分/快照/推送/审计/评估 4 行） | 4 行 |
| 块 3 N6b | 1 条 `[验收]…重复标题` + 派生（分析/评分/快照/推送/审计） | 1 行 |

- 评估行随需求 `ON DELETE CASCADE`；删除后复查 `requirement_assessments` 全表 0 行。
- 清理后基线必须回 **334 / TB 333 / 手工 1 / 多维表格 0 / 聊天粘贴 0**，PM 表 334，收集表 0。

## 4. 成本与风险

- 模型调用合计：方案 A **10 次**（4 分析 + 4 评估 + 1 草稿 + 1 分析）、方案 B **8 次**。
- 风险：评估上游偶发契约解析失败（`analysis_failure`），单条失败按「失败版本」记录、重跑一次；仍失败则记 BLOCKED 并说明供应商侧。
- 风险：新建的 `[验收]` 行会短暂出现在池与 PM 表（约 10–20 分钟），执行前在群里报时间，避免与后端数据核对撞车。

## 5. 通过判据

- A12：4 条中无硬失败、每条达 80 分线，且 `verdict`/置信度落在期望区间；任一条硬失败 → A12 FAIL，附命中项与证据。
- N6：草稿字段可用且不写库；重复提示正确显示且不自动压制，人工判定入口可开。
- 两批数据全部删除，基线回归。
