# RQ-Sys — Agent Skills Setup

## Repository and source of truth

- This is the local implementation checkout for `jiahao89/magene-rqsys`; the GitHub repository is the only code source of truth until the Miaoda import/publish workflow is verified.
- Work from the existing `main` branch and preserve all unrelated working-tree changes. Never force-push, reset, or clean.
- Git fetch/pull/commit/push are allowed when the user requests the relevant work. Do not push release/deployment artifacts or write to Miaoda without the specified authorization gates.

## Issue tracker

- Work tickets are local Markdown drafts under `.scratch/rq-sys-mvp/issues/`; there is no configured GitHub issue tracker for this project. Treat statuses and dependency labels there as binding; before editing a shared ticket, reread its README and synchronize the ticket/README status with evidence.
- GitHub is used as the source repository, not as the issue tracker. `gh` is not installed; ordinary Git remote operations use the configured macOS credential helper.

## Domain documentation

- Single-context domain docs live in `specs/rq-sys-mvp/`. Read `AGENTS.md`, `CONTEXT.md`, MVP README, the relevant numbered spec, OpenAPI, and OPEN-DECISIONS before behavior changes.
- Follow the current PRD revision 60 and project invariants in `AGENTS.md`; distinguish local implementation from target Miaoda/Teambition/Feishu verification. Use “implemented, not verified in target environment” unless verified there.

## Development workflow

- Choose the relevant installed Matt Pocock engineering skills by task: `diagnosing-bugs` for root-cause debugging, `tdd` for behavior changes/integration tests, `implement` for ticket/spec implementation, and `codebase-design` when changing module seams or architecture.
- Keep external credentials server-side; use stubs for local provider tests. Do not make real AI provider calls without authorized test credentials.
- For PostgreSQL repository integration tests, use the real local PostgreSQL in a unique temporary schema and drop only that schema on cleanup; never use pg-mem as proof of PostgreSQL behavior.
- Run typecheck, relevant tests, full suite, build, and `git diff --check` before claiming local completion. Do not alter or deploy the Miaoda app while Spark write access remains blocked.
- To exercise the workbench against the real local API, set `RQSYS_LOCAL_IDENTITY` for both processes (see `README.md`). It is loopback-only, refuses to activate under `NODE_ENV=production`, and is never target evidence.
- When a change touches a module shared with the app runtime, mirror it into `rq-sys-miaoda/server/rqsys` and run `npm run check:alignment`; it fails on any undeclared behavioural drift between the two repositories.
- External blockers (dev runtime alignment, Teambition row count, AI key, P3 policy, empty taxonomy) each have executable steps in `deployment/EXTERNAL-BLOCKER-RUNBOOK.md`. Do not mark the MVP complete while those remain open.

## Required gates

- All `spark:app:write` operations are high risk: dry-run → explicit user confirmation → `--yes`; never bypass exit code 10.
- No deployment, release creation, Git credential initialization, external environment-variable writes, Miaoda database changes, or collaborator changes unless explicitly authorized by the project constraints.
- Identity adapter remains unimplemented until target Miaoda identity is verified.
