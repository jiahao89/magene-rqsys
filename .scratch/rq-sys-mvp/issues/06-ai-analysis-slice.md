# [blocked: 03, 05] 06 — AI 分析纵向切片

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

## Blocked by
Ticket 03（provider 与数据策略获批并验证）、Ticket 05（真实源数据已落库）。

## Local implementation evidence (2026-10-08)
- Added a pure TypeScript DeepSeek-compatible JSON-mode provider with dependency-injected `fetch`; API credential is optional server environment config (`AI_API_KEY`) and missing credentials fail before any network request.
- Added minimization, PII/contact/credential masking and an outbound payload built only from title, description, explicitly supplied business context and controlled dictionary/rule metadata. Provider response validation checks output shape, active module membership, evidence against the redacted source text, priority/rule consistency and labeled inferences.
- Added analysis orchestration that refuses to run before source snapshot persistence, appends a new attempt/version each run, records safe failures as retryable, and leaves PM-owned fields outside the write path. Added an adapter over the existing `AnalysisRunRepository` append/complete/latest/list methods; no schema migration or external DB write was performed.
- Verification: analysis-specific tests pass (8/8), executed with `AI_API_KEY` removed. Isolated strict TypeScript check passed for provider/contract/service/tests. Stub fetch only; no model API call was made and no credential value was printed or added to the repository.
- Boundaries: full-project `npm run typecheck` and `npm test` remain blocked by unrelated local files (`adapters/postgres/repositories.ts` duplicate method implementations; existing failing Postgres mapping and owner mapping tests). This slice is local pure-code groundwork only; provider approval/reachability, persistent database wiring, pipeline invocation, public retry API, and target Miaoda acceptance remain blocked.
