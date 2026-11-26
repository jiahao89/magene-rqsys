# RQ-Sys — Agent Skills Setup

## Repository and source of truth

- This is the local implementation checkout for `jiahao89/magene-rqsys` (canonical implementation source; current active development branch is `feature/arco-design`, ahead of `main`); `rq-sys-miaoda/` is the separate app-scoped Miaoda runtime repo released from `sprint/default`.
- Work from the active integration branch (`feature/arco-design` until merged to `main`) and preserve all unrelated working-tree changes. Never force-push, reset, or clean.
- Git fetch/pull/commit/push are allowed when the user requests the relevant work. Do not push release/deployment artifacts or write to Miaoda without the specified authorization gates.

## Issue tracker

- Historical work ticket indexes live under `.scratch/rq-sys-mvp/issues/README.md`, `.scratch/rq-sys-v0.2/issues/README.md`, and `.scratch/rq-sys-production/issues/README.md`; there is no configured GitHub issue tracker for this project. Individual historical ticket Markdown files were archived/removed from the working tree in commit `98d674c` (recoverable via `git show 98d674c:.scratch/...`; see `.scratch/README.md`).
- Before editing any ticket index README, reread it and keep status evidence synchronized.
- GitHub is used as the source repository, not as the issue tracker. Ordinary Git remote operations use the configured macOS credential helper.

## Domain documentation

- Domain docs live in `specs/rq-sys-mvp/`, `specs/rq-sys-v0.2/`, `docs/2026-10-21-rq-sys-v0.2-prd.md`, and `docs/2026-11-06-production-readiness-decisions.md` (PRD-13–PRD-33). Read `AGENTS.md`, `CONTEXT.md`, MVP README, the relevant numbered spec, OpenAPI, and OPEN-DECISIONS before behavior changes.
- `specs/rq-sys-mvp/openapi.yaml` remains the single API contract; extend it during implementation.
- Follow the current MVP PRD revision 60 together with `docs/2026-10-21-rq-sys-v0.2-prd.md` / `PRD-13–PRD-33` and project invariants in `AGENTS.md`; distinguish local implementation from target Miaoda/Teambition/Feishu verification. Use “implemented, not verified in target environment” unless verified there.

## Development workflow

- Choose the relevant installed Matt Pocock engineering skills by task: `diagnosing-bugs` for root-cause debugging, `tdd` for behavior changes/integration tests, `implement` for ticket/spec implementation, and `codebase-design` when changing module seams or architecture.
- Keep external credentials server-side; use stubs for local provider tests. Do not make real AI provider calls without authorized test credentials.
- For PostgreSQL repository integration tests, use the real local PostgreSQL in a unique temporary schema and drop only that schema on cleanup; never use pg-mem as proof of PostgreSQL behavior.
- Run typecheck, relevant tests, full suite, build, and `git diff --check` before claiming local completion. Do not alter or deploy the Miaoda app without explicit user authorization and the required safety gates.
- To exercise the workbench against the real local API, set `RQSYS_LOCAL_IDENTITY` for both processes (see `README.md`). It is loopback-only, refuses to activate under `NODE_ENV=production`, and is never target evidence.
- When a change touches a module shared with the app runtime, mirror it into `rq-sys-miaoda/server/rqsys` and run `npm run check:alignment`; it fails on any undeclared behavioural drift between the two repositories.
- External blockers and clearing steps live in `deployment/EXTERNAL-BLOCKER-RUNBOOK.md`.

## Required gates

- All `spark:app:write` operations are high risk: dry-run → explicit user confirmation → `--yes`; never bypass exit code 10.
- No deployment, release creation, Git credential initialization, external environment-variable writes, Miaoda database changes, or collaborator changes unless explicitly authorized by the project constraints.
- Miaoda `@NeedLogin()` and trusted `req.userContext.userId` identity adaptation is implemented in `rq-sys-miaoda/` and must still be verified after each release.
