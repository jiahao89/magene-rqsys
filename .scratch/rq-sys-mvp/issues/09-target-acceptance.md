# [blocked: 00–08, 12–17, 10–11] 09 — 目标环境端到端验收

## 目标
在目标妙搭环境用最小化真实需求验证 MVP 主链路及降级路径。

- RQ-Sys code implementation in the target Miaoda checkout (`app_17fqkjwyx1u`): **not deployed**; current finished release `7694615270979357961` is the scaffold/workspace shell commit `1a2910b`, not the GitHub implementation at `ef9a288`.
- `dev` schema: 13 tables exist with zero estimated rows; changelog includes CREATE_TABLE and PUBLISH. No RQ-Sys sync/API workload has been executed in that environment.
- `+env-list` is empty; there are no app environment variables configured for Teambition, Feishu Base, or AI provider calls.
- `+automation-list --all` returns no triggers. Scheduler automation is not configured or running.
- `+member-settings-get` returns `feature_not_available` for this app; this does not verify an identity provider or production role mapping.
- Local API tests 167/167 and Web tests 13/13, typecheck/build/diff-check pass at `ef9a288`; these are local evidence only.
- No target runtime end-to-end scenario in this ticket has been executed; all five scenarios below remain blocked by Tickets 00/10/11, identity/provider setup, external test fixtures, and D-02/D-03/D-10.

## Acceptance scenarios (not yet run)
1. 手动全量同步，含有负责人和无负责人的需求。
2. AI 成功、低置信度、首轮失败/超时；验证分析结论不阻塞推送。
3. 自动负责人匹配、姓名映射、手动映射、空负责人推送。
4. Base 新建与重复更新、源实质变更快照/“待处理”重置、负责人后续分配/变更通知。
5. 周调度、单项失败重试、服务重启恢复、审计追溯。

## Evidence log
- 2026-10-09 — read-only current-state check: application `app_17fqkjwyx1u` is full_stack, enabled and published; latest finished release `7694615270979357961` uses commit `1a2910bb6d678c3fe0b3cbb568d3ab6c9ecef7c8` and has an `online_url`. This release commit belongs to the Miaoda scaffold/workspace shell, not the RQ-Sys GitHub implementation checkout (`main` `ef9a288`).
- 2026-10-09 — explicit dev environment schema probes: 13 tables, all estimated row count zero; `requirements` structure/indexes are readable; changelog reports CREATE_TABLE followed by PUBLISH; quota API returns successfully. `env-list` has no entries; automation list has none; member settings returns `feature_not_available`. No write-side application flow was run.
- 2026-10-09 — fresh local verification at `ef9a288`: API 167/167, Web 13/13, typecheck, build and `git diff --check` succeeded. Local-only evidence.

## Acceptance criteria
- 每个场景保留脱敏的目标环境证据；清楚标识真实验证、模拟验证、未验证。
- 错误情况下成功项不回滚，失败项可定位并安全重试。
- 使用 PMF/PRD 现行字段范围，不扩展 28 字段生命周期。
- 记录剩余问题、影响、责任人和后续版本建议。
