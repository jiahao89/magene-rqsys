# Spec 05 — Platform, Reliability, Security, and Acceptance Gates

Status: [ready-for-agent] for platform-neutral contracts; production implementation is gated on target Miaoda and external-service POC evidence.

## User stories

1. As an administrator, I want credentials held only by server-side components, so that they cannot leak through the browser or logs.
2. As an operator, I want failed provider calls classified and retryable, so that transient failures do not corrupt already completed work.
3. As a PM Leader, I want auditable changes and versioned AI/rule outputs, so that recommendations and manual actions can be reconstructed.
4. As a project owner, I want storage and scheduling to use capabilities actually available in the target Miaoda application, so that weekly sync does not depend on an ephemeral local file or process.

## Platform contracts

- Persist source snapshots, mappings, batches/items, workflow history, analysis versions, rule/dictionary versions, PM snapshots, and audit in the application database supported by the target Miaoda environment.
- Do not assume a local SQLite file is durable in deployment. Select the concrete database only after target-environment verification.
- Schedule the weekly run using a Miaoda-supported durable scheduler/background task. Persist run state so a worker restart can resume or safely retry.
- Use the project’s React/TypeScript frontend and a server-side API. Keep Teambition, Feishu, and model provider details behind adapters.
- Preserve the explicitly requested hard-coded Teambition API-key fallback in the existing helper. It remains server-side, is not echoed by any config endpoint, and is redacted from logs. Do not copy it into browser code.
- Cache and refresh access tokens server-side. Return only credential self-check status and safe error codes to Web.
- Respect field ownership from Spec 00; all external writes must use an allowlist.
- Record actor, action, time, object key, source/analysis version, outcome, and safe error details for writes and retries.

## Reliability behavior

- A provider failure is scoped to the smallest actionable item; successful items remain committed.
- Retry requests are idempotent and do not create duplicate batches, requirements, Base records, or notifications.
- A per-table Base write queue is serialized. The technical design proposes a conservative write rate below 20 requests/second and batches no larger than 500 items; validate actual API/platform limits during POC before using these values.
- Model calls have a per-attempt timeout. The first attempt must reach a recorded success/failure/timeout state before the push pipeline continues. Any subsequent retry is independent and non-blocking.
- Teambition unavailable: mark the batch failure and show an actionable error.
- Model unavailable: keep AI failure visible and continue owner/push handling.
- Base unavailable: preserve local state and retry the failed push without duplicating already successful records.
- Base automation unavailable: do not roll back a successful push; show no false Web claim that a notification was delivered.
- Prevent concurrent duplicate runs for the same source unless the implementation has a proven safe locking strategy.

## Data protection

- Minimize model input to the fields in Spec 02.
- Keep credentials, personal IDs, phone numbers, and email addresses out of application logs; mask phone/email before model submission.
- Do not send source attachments or their contents to the model.
- Apply authorization on the server and audit privileged configuration, owner mapping, retry, and publish-rule operations.
- Retain original source facts for traceability; retention duration follows the organization’s data policy and must not be invented in the application.

## External acceptance gates

Before production acceptance, complete a target-environment POC for:

1. Teambition authorization, list/detail query, stable requirement ID, pagination/delta behavior, owner and custom fields.
2. Feishu app permission, Base schema, record lookup/upsert, person fields, PM-field read/snapshot/write permissions, and automation trigger/recipient/dedup behavior.
3. Miaoda database persistence, scheduled/background execution, task restart behavior, storage limits, and secret injection.
4. Approved model provider, structured output behavior, timeout/error behavior, and data-retention policy.
5. Actual end-to-end flow with a minimized real requirement: pull, save, analyze, map or empty-owner path, Base upsert, notification evidence, and retry.

Static mocks, local fixtures, and a successful HTTP status alone do not prove these gates.
