# Agent instructions — RQ-Sys

## Start here

1. Read `CONTEXT.md`, `specs/rq-sys-mvp/README.md`, the relevant numbered Spec, and `specs/rq-sys-mvp/OPEN-DECISIONS.md` before changing behavior.
2. Product scope is controlled by the current Feishu MVP PRD revision 60. The technical design is implementation guidance only where it does not conflict with that PRD.
3. Tickets in `.scratch/rq-sys-mvp/issues/` are local drafts. Respect their dependency/status labels and target-environment evidence requirements.

## Current project layout

- `apps/api/`: TypeScript modular-monolith API skeleton.
- `database/migrations/`: PostgreSQL schema migrations.
- `specs/rq-sys-mvp/openapi.yaml`: API contract source of truth.
- `specs/rq-sys-mvp/DB-AND-API-DESIGN.md`: data ownership and endpoint rationale.
- `specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md`: read-only Teambition schema evidence and unresolved mapping items.
- `design.md`: product design system; do not build production UI until D-08 is resolved against the actual GitHub repository and Miaoda constraints.

## MVP invariants

- Teambition owns source facts. The application database owns workflow state, source snapshots, AI versions, mappings, audit and retry state. Feishu Base owns PM processing fields and notification automation in this MVP.
- Requirement identity is `(Teambition project ID, Teambition requirement ID)`. Use source `id` as text; never use title or floating `unique_id` for deduplication.
- Keep pull, analysis, owner-mapping and Base-push states independent. Low confidence, missing priority, or first-pass AI failure never blocks an otherwise eligible push.
- No-owner requirements are imported and can be pushed with an empty owner. Unresolved/empty TB ownership must not erase a manually assigned Base owner.
- AI output is versioned and separate from PM-confirmed fields. Do not send names, user IDs, contact information, credentials or attachment contents to a model.
- The MVP does not implement all 28 upstream fields or all 114 Teambition custom fields. Only approved fields in the source `field_map` may enter the normalized projection, model request or Base write.
- Keep PM processing state and notification delivery out of Web unless a new approved read path is added.

## Teambition integration facts

- The project-local skill is `skills/teambition/SKILL.md`; use its API client for authorized, read-only Teambition verification.
- Target project verified on 2026-10-08: `需求收集与管理`, project ID `674e77e9ee4037da9d4b9f8e`; requirement task type ID `674e7a7e5f95a1404621bb4c`.
- The selected task-list response had 1,285 records and fields including `id`, `content`, `creator_id`, `executor_id`, `taskflow_status_id`, `created`, and JSON-encoded `custom_fields`.
- That response did not include an updated timestamp. Use full-project fetch plus canonical allowlist hash comparison until a reliable update-time API is proven.
- The Teambition skill filters completed/archived rows in its default convenience command. The MVP import must include all requirements from the configured project; call the raw task-list endpoint and do not apply that local completion filter.
- Current skill metadata exposed 114 custom-field definitions. Custom fields are arrays of `{_customfieldid, type, value, values}` after JSON parsing. Keep field IDs in configuration and do not create columns for every custom field.
- Preserve the existing server-side default API-key fallback in the Teambition adapter, allow `GATEWAY_API_KEY` to override it, and never print or return the key. Never bundle integration credentials into browser code.
- `source_url`, attachment references, pagination, delete detection, and cross-time ID stability remain unverified; do not fabricate these values.

## Database and API rules

- PostgreSQL is the current schema target. Miaoda PostgreSQL availability, driver/runtime, connection limits, migration execution, and backup/retention are not yet verified; do not call local PostgreSQL behavior production proof.
- Generate UUIDs in application code with `crypto.randomUUID()`; migrations do not require privileged extensions.
- Keep migrations additive and transactional. Never rewrite an already applied migration; add the next numbered migration.
- Preserve source snapshots append-only. Only create a new version when the normalized source hash changes. A substantive update must snapshot Base PM fields before write; if snapshot read fails, do not mutate the Base row.
- Business API contracts belong in `specs/rq-sys-mvp/openapi.yaml`. Keep auth/role enforcement on the server. The current identity adapter is intentionally not implemented until Miaoda identity is verified.
- Never claim an endpoint, schedule, retry, external write, or notification works until it is implemented and verified in its target environment.

## Commands

- `npm run dev:api`: local API server.
- `npm run typecheck`: TypeScript type check.
- `npm run build`: compile API to `apps/api/dist`.
- `npm run db:migrate`: apply SQL migrations to the `DATABASE_URL` database.

Run tests only when the user or ticket explicitly asks for them. For integration calls, use an approved test project/Base and do not send stakeholder notifications without a safe test configuration.

## Source repository workflow

This workspace currently contains the project documents and scaffold but is not the GitHub implementation checkout. Before production code work, open the actual `jiahao89/magene-rqsys` repository, inspect its branch and uncommitted changes, and establish the agreed source-of-truth workflow with Miaoda. Do not initialize this documentation workspace as a substitute repository or assume the deleted mock prototype is the baseline.

## Agent skills

- Use `.agents/skills`/Hermes-installed Matt Pocock skills selectively: `diagnosing-bugs` for root-cause work, `tdd` for behavior changes and integration tests, `implement` for scoped tickets, and `codebase-design` for module/interface decisions. Read `docs/agents/issue-tracker.md` and `docs/agents/domain.md` first.
- GitHub actions use `software-development:github`; read the corresponding reference before clone/pull/push/commit/PR operations. The GitHub remote is code source only; local Markdown files under `.scratch/rq-sys-mvp/issues/` are the ticket tracker.
- Before editing a shared ticket, reread `.scratch/rq-sys-mvp/issues/README.md`; synchronize status evidence between the ticket and README.

## Safety and verification gates

- Treat `spark:app:write` operations as high risk: dry-run → explicit user confirmation → `--yes`. Never bypass exit code 10.
- Do not deploy/create releases, initialize Git credentials, write external environment variables, mutate Miaoda databases, or change collaborators unless explicitly authorized under the project constraints.
- Keep secrets server-side; use stubs for local provider tests. Do not call the AI provider without an authorized test key.
- Keep the identity adapter unimplemented until target Miaoda identity is verified.
- Label work “implemented, not verified in target environment” unless actual target verification evidence exists. Local PostgreSQL/tests do not prove Miaoda behavior.
- Run typecheck, relevant/full tests, build, and `git diff --check` before claiming local completion.

