# 需求评估 analysis_failure 根因定位（2026-11-25）

## 结论（先说结果）

1. **不是空内容、不是超时、不是限流**：线上两次失败都是模型返回之后、落库之前被判定失败，`error_code=analysis_failure`，每次约 22 秒（远小于 `AI_TIMEOUT_MS=120s`）。空内容会走同一错误码，但本地复现的失败样本里没有出现空内容。
2. **用线上同 prompt、同 model、同参数本地复现成功**：18 次调用 3 次失败（16.7%），失败分两类：
   - **非 JSON（2 次）**：一次是对象里出现尾随逗号（`,"}`），一次是模型提前闭合根对象后继续输出 `,"openQuestions"...`。
   - **契约失败（1 次）**：JSON 合法，但 `feasibility` 的键被模型写成中文——`{"technical": "...", "成本": "..."}`，缺少 `cost`，Zod 报 `feasibility.cost`。
3. **`response_format: {type:"json_object"}` 本来就带上了**（评估/分析/PRD 提示词/聊天粘贴四条路径都带），不是漏参数；问题是 deepseek-flash 仍会偶发 JSON 语法错误或翻译键名。
4. **应用代码没有内部重试**：线上一次客户端 POST 在同一个 trace 里产生了 3 次 handler 执行（503 → 503 → 201，间隔≈0），是妙搭平台侧对 5xx 的自动重试，不是我们的 service 重试。
5. **一次修复调用可以兜住**：把三类坏输出（尾随逗号 / 提前闭合 / 中文键名）交给同一个模型做「只修格式与键名」的修复调用，3/3 全部修成合法且契约完整的 JSON，耗时 7.5 / 7.6 / 9.6 秒。

## 证据

### 线上（RQ-000316，2026-11-25 13:45:26–13:46:33，Asia/Shanghai）

- 客户端：1 个 POST，65,066ms 后 `canceled`（`app_web` 日志 13:46:31）。
- 平台：1 个 gateway span，66,642ms，最终 201。
- 服务端：同一 trace `767994085a25978e6bae7f77c844f44d` 内 3 次执行：
  - 13:45:26.799 → 13:45:49.535（22,736ms）503
  - 13:45:49.498 → 13:46:11.061（21,563ms）503
  - 13:46:11.007 → 13:46:33.275（22,270ms）201
- 每次执行各建一行 `requirement_assessments`（v1/v2 failed、v3 succeeded），与「一个请求 3 次尝试」一致。
- 对照组：13:36:01 RQ-000527 的评估（一次成功）只有 1 次执行、1 个 201。

### 服务端日志不可用（重要）

- `assessment_failed` 诊断只在契约失败时写（`app.ts`：仅 `AssessmentContractError` 调 `reportAssessmentFailure`），走 NestJS `logger.error`。
- 平台日志检索不收录应用自身 stdout/stderr：把 13:45:20–13:46:40 的 100 条日志全部拉完（data 61 / app_server 19 / gateway 17 / app_web 3），没有任何 `assessment_failed` / `event` 行；近 3 天用其它诊断事件名（`intake_draft_failed`、`feishu_user_search_failed` 等）检索也全部为 0。
- 因此**线上那两次失败属于哪种 `analysis_failure` 已经无法事后判定**；这本身是需要修的观测缺口。

### 本地复现（同 prompt / 同模型 / 同参数）

- 输入：`requirements` 里 RQ-000316 的字段 + `analysis_runs` v9 的 `structured_result` 与 `confidence_reason` + 线上请求体里的三条补充（background/goal/scenario）。
- 调用：`createAssessmentRunner`（真实 service、真实 provider、真实 schema），密钥取自 dev 环境变量（不落盘、不打印）。
- 第一轮 6 次：6 成功，耗时 14.3–20.8s，completion 2.4k–3.3k tokens，`finish_reason=stop`。
- 第二轮 12 次：9 成功、3 失败：
  | # | 结果 | 耗时 | 具体 |
  |---|---|---|---|
  | 4 | failed | 19.7s | `non-JSON`：根对象在 assumptions 后提前闭合，随后又输出 `,"openQuestions":…` |
  | 6 | failed | 21.1s | 契约：`feasibility` 键为 `{"technical","成本",…}`，缺 `cost` |
  | 12 | failed | 20.0s | `non-JSON`：对象内尾随逗号 |

### 修复调用验证

- 3 个坏样本各发一次修复调用（system：只修格式与键名；user：契约 + 原输出）。
- 结果：3/3 通过（JSON 合法 + 11 个顶层键 + feasibility 四键齐全），耗时 7.5 / 7.6 / 9.6 秒。

## 预算口径（回答「90s / 65s / 72s 怎么对上」）

- 应用侧评估：**一次模型调用，无内部重试**；单次上限 `AI_TIMEOUT_MS=120s`（线上），running 超过 120s 由 stale 兜底。评估没有 90s 限制，90s 是 PRD 提示词的。
- 平台侧：对 5xx 自动重试，本次 1 次请求 → 3 次执行（1 + 2 次重试），**无退避**。最坏 3×120s=360s；本次实测 3×22s≈66s。
- 前端（旧）：65s = 「服务端排队 60s + 5s 余量」，这个 60s 假设已经不存在，65s < 66s 实测，所以先超时。前端新提交 `fdb6151` 已改成 125s 超时 + 90s 核对窗口，能覆盖本次 66s，但覆盖不了 3×120s 最坏情况。
- 结论：真正要收敛的是「平台盲重试 × 单次上限」，不是把前端超时继续调大。

## 建议修法（待批）

**P0（评估路径，两个仓同步）**

1. **本地修复层（零模型调用、零额外延迟）**：在 `parseModelJson` 之后加 `repairAssessmentOutput()`，按顺序尝试三种确定性修复，**每一步都必须通过完整 Zod 契约才接受**，否则继续下一步/照旧失败：
   - 去掉字符串外的尾随逗号（状态机，字符串内不动）；
   - 键名白名单映射：`技术/成本/依赖/风险 → technical/cost/dependency/risk`，顶层同义键同理；
   - 提前闭合：`JSON.parse` 报 `Extra data` 且剩余文本以 `,"key"` 开头时，尝试去掉该多余根闭合括号后重解析。
   - 三个线上失败样本本地实测全部修复成功（尾随逗号 → 11 键齐全；`成本` → 四键齐全；提前闭合 → 合并后合法）。不改内容、不改语义，只修语法与键名。
2. **模型修复只在本地修复失败后兜底（可选，先不做）**：正式环境若出现本地规则覆盖不了的坏法，再加一次「只修格式与键名」的模型调用；本次 3 个样本已在本地修复层解决，不需要它。
3. **失败子类型落库**：迁移 `0033` 给 `requirement_assessments` 加 `error_detail text`，记录 `empty_content | non_json | contract:<fields> | envelope | repaired:<how> | timeout`；`fail()` 带 detail，DTO 返回 `errorDetail`。以后线上失败直接查库，不依赖日志。
4. **收口通用 catch**：`EnvelopeSchema.parse` / `response.json()` 失败目前落成通用 “AI assessment failed.”，改为明确子类型 `envelope`。
5. **提示词加固（不改 skill 正文）**：在 user 消息末尾追加硬约束——键名逐字用英文（technical/cost/dependency/risk…），禁止翻译键名、禁止尾随逗号；与修复层形成双保险。
6. **超时对齐**：修复层不增加模型调用；前端 125s / 核对窗口 90s 与「单次主调用 120s」对齐后不再误报。

**P1（成本与并发，可选）**

6. **幂等键**：POST body 加可选 `requestId`（前端每次点击生成 uuid，平台重试会原样重放），同 requestId 的终态版本直接返回、不再调模型。这样平台 3 次重试只花 1 次调用，也顺带防用户连点。两仓 + openapi + 前端一起改。
7. PRD 提示词（45s、失败同样 503）按同一套「修复调用 + error_detail」处理，单独一批。

## 复现脚本

- `.scratch/repro-assessment.mts`（18 次调用，真实 service）
- `.scratch/repro-repair.mts`（3 个坏样本的修复验证）
- 两个都是未跟踪的临时脚本，不提交；结论以本文件为准。

## 实施结果（2026-11-25，P0）

- **修复层**：新增 `apps/api/src/assessment/repair.ts`（两仓镜像）——字符串外尾随逗号、提前闭合根对象合并、契约键名白名单（`feasibility` 的 technical/cost/dependency/risk，顶层同义键，scope in/out）；每个候选都必须通过完整 Zod 契约才接受，只改语法与键名、不改内容；修不好按 `non_json` / `contract:<字段路径>` 分类。
- **失败可观测**：迁移 `0033_requirement_assessment_error_detail.sql` 给 `requirement_assessments` 加 `error_detail`；`fail()` 带 detail，DTO / openapi 增加 `errorDetail`。类型：`non_json` / `empty_content` / `envelope` / `contract:<fields>` / `unexpected`。
- **修复留痕**：修复成功写审计 `assessment.output_repaired`，`safeDetails` 只含 `version / promptVersion / repairs / model`（`repairs` 已加入审计白名单；不含模型输出、不含正文）。
- **提示词**：评估 user 消息追加输出硬约束（逐字英文键名、禁止尾随逗号），skill 正文不改（保持同源断言）。
- **PII**：`sanitizeChatDraft` 的 proposer 拒绝掩码占位（`（姓名已掩码）`/`***`/`某某`）、纯角色词、`姓名（客服）` 这类转述标注；prompt 补「提出人被掩码时返回 null」。
- **测试**：修复层 6 条单测（三种坏法 + 修不好分类 + 键名不覆盖）；service 新增 4 条（尾随逗号修复并写审计、中文键名修复、提前闭合并回、失败子类型落库）；chat-extract 新增 1 条（客服转述/掩码/角色词）；审计白名单与 schema 各 1 条；PG 集成 1 条（error_detail 落库并在成功版本清空，CI 真库）。
- **门禁**：root typecheck / build / alignment 35/35 / migrations / arco-styles 通过；API **766 用例、696 通过、70 失败全是 ENOENT**（新增 13 条，其中 PG 1 条交 CI）；妙搭 typecheck + route **139/139**。
