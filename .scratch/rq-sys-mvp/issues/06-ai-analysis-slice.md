# [implemented-not-target-verified] 06 — AI 分析纵向切片

## 目标
对已落库的源需求生成可追溯的分析建议，并在 Web 需求详情显示结果和状态。

## 范围
- 仅将 Spec 02 允许且已脱敏的需求字段提交已批准 provider。
- 校验受控模块、整体置信度/理由/证据及 U/M/S/C 建议；保留分析版本。
- 规则未发布时优先级为空；低置信度、AI 失败不阻止推送流程继续。
- 展示分析中、已分析、分析失败待重试及可操作的重试入口。

## 验收标准
- 每条需求的分析状态和版本持久化并可审计。
- 非法结构或 provider 错误能被准确分类；不会生成虚构建议。
- 超时后的再次分析作为非阻塞重试，不延迟首次结果驱动的后续处理。
- 人工确认字段与 AI 建议字段分开保存，重跑不会覆盖人工值。

## Target verification remains
Ticket 03（provider 与数据策略获批并验证）、Ticket 05（真实源数据已落库）。

## Local implementation evidence (2026-10-08)
- Added a pure TypeScript DeepSeek-compatible JSON-mode provider with dependency-injected `fetch`; API credential is optional server environment config (`AI_API_KEY`) and missing credentials fail before any network request.
- Added minimization, PII/contact/credential masking and an outbound payload built only from title, description, explicitly supplied business context and controlled dictionary/rule metadata. Provider response validation checks output shape, active module membership, evidence against the redacted source text, priority/rule consistency and labeled inferences.
- Added analysis orchestration that refuses to run before source snapshot persistence, appends a new attempt/version each run, records safe failures as retryable, and leaves PM-owned fields outside the write path. Added an adapter over the existing `AnalysisRunRepository` append/complete/latest/list methods; no schema migration or external DB write was performed.
- At the time of this local slice verification, analysis-specific tests passed (8/8) with `AI_API_KEY` removed; isolated strict TypeScript check passed for provider/contract/service/tests. Those tests used stub fetch and made no model API call. See the later connectivity check below for the separately authorized real request.

### Latest connectivity check (2026-10-10)
- User-provided terminal screenshots show that online `AI_API_KEY` was created and that `env-list` returned its variable name; the value was not displayed. A live reread and runtime secret-loading check are currently blocked by local DNS failure to `open.feishu.cn`.
- One real provider request was explicitly authorized using synthetic, non-business text and the local server-side key; it failed with provider error `network_error`. No key or response body was printed. This does not establish whether the key is valid or whether Miaoda can reach the provider.
- Boundary: local implementation and tests are complete, but this synthetic provider request did not establish external reachability or target Miaoda behavior. Runtime credentials, persisted target execution and full acceptance remain Ticket 09 gates.

## Latest local status (2026-10-10)

The earlier 2026-10-08 blocker note is historical and superseded for local implementation. Analysis is wired into the persisted worker pipeline, exposes structured results/history and a retry API, and continues to owner/push handling after the first analysis terminal result. One real synthetic provider request was attempted this turn and failed with `network_error`. Target provider, data-retention and Miaoda acceptance remain Ticket 09 gates.
