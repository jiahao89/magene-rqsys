# Spec 01 — Teambition Source and Synchronization

Status: [ready-for-agent] subject to the target Teambition API POC.

Read-only live metadata evidence for the selected `需求收集与管理` project is recorded in [TEAMBITION-LIVE-POC.md](./TEAMBITION-LIVE-POC.md). It confirms the task ID and current response shape, but does not close field-semantic, pagination, update-time, or cross-time ID-stability gates.

## Problem and outcome

Operators need a reliable weekly and manual import from one product-group Teambition project. A retry or repeated schedule must update the existing requirement record instead of creating duplicates.

## User stories

1. As an administrator, I want to configure one dedicated Teambition project and a weekly schedule, so that the source is synchronized without recurring manual work.
2. As a PM Leader or designated operator, I want to start a manual sync, so that urgent source changes do not wait for the next schedule.
3. As an operator, I want the first run to import all requirements in the selected project, including requirements without an owner, so that the initial data set is complete.
4. As an operator, I want later runs to detect new and changed requirements, so that the workbench remains current without duplicate records.
5. As an operator, I want item-level failures and safe retry, so that one external API failure does not lose successful work in the same batch.

## Functional requirements

- Scope is one dedicated product-group project. The initial run reads all requirements in that project; no-owner requirements are included.
- Weekly and manual triggers use the same pipeline and batch model. The batch records trigger source, actor where applicable, timestamps, counts, and errors.
- Prefer a verified Teambition updated-time filter. If unavailable or unreliable, fetch the project set and compare stable IDs/content hashes.
- Use project ID + Teambition requirement ID as the unique key in the application database and Feishu Base.
- Source-owned data in the current PRD: requirement ID, project/source, title, description, scope, acceptance criteria, proposer, executor/owner, source status, create/update times, source URL, and attachment references.
- Attachments are linked as references only; attachment files and contents are not sent to the model.
- Normalize the source response before writing. Preserve the original snapshot for traceability.
- A manual request includes an idempotency key. Duplicate submissions with the same key return the existing batch.
- Retry only failed items and preserve the original batch association. Never roll back successful items.
- No changes are written back to Teambition.

## Field mapping gate

The upstream requirements-definition table additionally names user type, impact level, product, constraints, supplemental description, feedback person, and feedback department. The current MVP PRD does not establish their Teambition API/custom-field mapping. Do not infer these values or silently add them to Base. Record each field as mapped, unavailable, or deferred during the target API POC.

The owner-name list is used for the documented product-group owner matching flow. The selected dedicated project defines the import scope; do not silently turn owner matching into an additional filter that would drop unassigned requirements.

## States and batch behavior

- Pull state: 待同步 → 同步中 → 已同步 or 失败.
- Batch state: 执行中 → 成功 / 部分失败 / 失败.
- “已同步” is set only after normalized source data and its version are persisted.
- A pull failure is distinct from analysis, owner-matching, and Base-push failures.
- If a batch contains both successful and failed items, the successful items remain committed and the batch is 部分失败.

## Interface contract

Use the service boundaries in the technical design:

- GET /api/sources — source configuration and connection self-check.
- PUT /api/sources/{id} — save project and weekly schedule.
- POST /api/sync/run — manual trigger with request idempotency key.
- GET /api/batches — list/filter by time and state.
- GET /api/batches/{id} — batch totals and item-level results.
- POST /api/items/{id}/retry — retry an eligible failed item.

The Teambition adapter owns authentication/token refresh, pagination, rate limits, and error classification. Keep provider-specific response fields outside the domain contract.

## Acceptance criteria

1. Given an enabled source, when the first sync runs, then every requirement returned by the configured project query is persisted once, including items with no owner.
2. Given the same project and requirement ID on a later run, when source data is unchanged, then no duplicate requirement or Base record is created and PM state is not reset.
3. Given a substantive source change, when sync runs, then the existing requirement key is updated and Spec 00 snapshot rules apply.
4. Given an owner, timestamp, or status-only change, when sync runs, then the metadata-specific update occurs without resetting PM processing.
5. Given one item fails, when the batch completes, then successful items remain committed, the item has an actionable error, and the batch reports partial failure.
6. Given the operator retries that failed item, when the retry succeeds, then it updates the same requirement key and does not duplicate prior successful results.
7. Given a repeated manual request with the same idempotency key, then it returns the original batch instead of starting a duplicate run.

## Verification strategy

Verify the public sync API against a target Teambition test project: initial full load, repeat/no-op load, source-field update, owner-only update, one induced API failure, and failed-item retry. Preserve request/response IDs and outcome counts without logging secrets. Static fixture data is useful for UI development but is not acceptance evidence.

## Out of scope

- Multiple projects or arbitrary source providers.
- Automatic changes to Teambition.
- Full import of the 28-field requirements-definition table until a field map is approved.
