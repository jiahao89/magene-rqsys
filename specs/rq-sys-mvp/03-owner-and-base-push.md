# Spec 03 — Owner Mapping, Base Push, and Notifications

Status: [ready-for-agent] for the current Base-owned PM workflow; actual Base schema and automation triggers require target-environment POC.

## Problem and outcome

The pipeline must resolve Teambition owners to Feishu users when possible, push one record per source requirement, preserve PM-owned data, and trigger stakeholder notifications without duplicate reminders.

## User stories

1. As an operator, I want an owner to match by stable Teambition user ID first and unique name second, so that the Base person field is accurate.
2. As a PM Leader, I want to select a Feishu user when automatic mapping is ambiguous or missing, so that the requirement can still be pushed.
3. As an operator, I want a requirement with no Teambition owner to push with an empty owner, so that missing ownership does not block intake.
4. As a PM, I want a manually assigned Base owner preserved when Teambition is unassigned or unresolved, so that source sync cannot erase a deliberate assignment.
5. As a stakeholder, I want notifications only for meaningful push, change, assignment, or successful-retry events, so that repeated syncs do not create noise.

## Owner-matching rules

- If TB owner ID exists, match by ID.
- If ID is absent, match only when the TB name resolves uniquely to an active mapping.
- Missing or duplicate name match becomes 待匹配. PM Leader/designated operator selects a Feishu user in Web; persist the mapping for reuse; selection enables push.
- If TB has no owner, set owner state to 无需匹配 and allow an empty-owner push. Do not notify a nonexistent owner.
- If TB later changes to a mapped owner, update the Base owner and notify the new owner.
- If TB owner is empty or cannot be matched, preserve a manually assigned Base owner.
- Do not design behavior for users outside the configured project scope in this MVP.

## Verified owner-selection integration (2026-10-18)

Miaoda searches internal members through its browser platform SDK. A selected Miaoda ID is resolved server-side through AuthNPaasService in the authenticated request context; verify the enterprise employee association and profile, then return the associated Feishu `user_id` with an explicit `feishuIdType=user_id`. A live write to the approved Base table confirmed this identity format is accepted, while the app-scoped Open ID returned by the SDK was rejected for the same person. The Base create/update request must pass `user_id_type=user_id`; never label one ID format as another. GET `/api/feishu/users/resolve` is read-only; PUT owner persists the typed selection and enqueues push. The standalone search adapter uses the official user-token GET API, not a tenant token. See RELEASE-CLOSEOUT.md for release and end-to-end evidence.

## Base write and field protection

- The application database keeps its source identity `(project ID, TB requirement ID)`. The current Base contains one configured TB project, so Base lookup/upsert uses `TB需求ID` alone; never use the RQ-Sys display ID for matching.
- `需求平台ID` is an immutable, sequential RQ-Sys display value (`RQ-000001`, `RQ-000002`, …) stored in the application database and mirrored to Base. Existing rows receive values in stable `first_seen_at, id` order; later new requirements receive the next number.
- The Base column `TB项目ID` is not required for this single-project upsert. `TB需求ID` stays the source identifier. `TB地址` may contain only a verified source URL; the selected Teambition response has no confirmed task-detail URL, so the app must leave it empty rather than construct a URL.
- In the configured grid view, keep `需求平台ID` first and place `TB地址` immediately after `TB需求ID`.
- Initialize the configured PM status to 待处理 only when creating a new Base record; do not rely on a table default or initialize an existing record during a non-substantive upsert.
- Keep source facts, AI suggestions, owner, PM confirmations/status, and push metadata in distinct field groups.
- The sync service writes only source-owned fields. The analysis service writes only AI-owned fields. Human PM fields are never overwritten by either.
- On substantive source changes, read and persist a PM snapshot before mutating Base. After the snapshot succeeds, update source/AI fields, retain prior confirmations in history, and set PM status to 待处理.
- If a required snapshot read fails, leave the current Base record and PM fields unchanged, mark only that item failed/retryable, and continue other batch items.
- The MVP does not read Base-native comments.
- Base is the PM collaboration surface for this MVP. Web does not read PM-processing or notification-delivery state back.

## Notification contract

Use Base automation where the target Base can express the trigger and recipient rules. Verify each trigger and deduplication in the target table.

**Recipient rule (confirmed 2026-10-19, supersedes the earlier multi-recipient design).** One notification has exactly one recipient. The first push is silent: the Base table is the PM Leader's workbench, and notifying per requirement turns a 151-requirement backfill into 151 messages that bury the only event needing action. Once an owner is assigned or changed, that owner is told. The proposer is never notified — the current field map has no approved proposer projection, so it stays recorded as `proposer_field_unavailable` rather than being guessed from the title or names. This deliberately narrows the earlier "PM Leader + proposer + owner" rule; multi-recipient fan-out and per-recipient resend were dropped because Base automation cannot express per-recipient outcomes, and the product decision is that a multi-recipient notification does not occur.

| Event | Recipient | Deduplication |
|---|---|---|
| First successful push, owner from automatic matching | **Silent** — no notification fields written | Not applicable |
| First successful push, owner **assigned by hand** (2026-10-21) | The assigned owner — a human decision must reach the person who now owns the work | New owner |
| Substantive source change successfully pushed | Current owner; PM Leader when there is no owner | One per substantive source version |
| Owner assigned after an empty-owner push | Newly assigned owner | One per assignment event |
| TB owner changes to a mapped person | New owner | One per mapped owner change |
| AI retry succeeds with new result | Current owner; PM Leader when there is no owner | One per new analysis result |
| No-op scheduled sync or retry with no new result | None | Silent |

PM Leader is configured by the environment variable `RQSYS_PM_LEADER_USER_ID` as a Feishu `user_id`. When it is absent, a first push writes no notification fields rather than falling back to the owner. Because Feishu's `user_id_type` is request-level, the notification fields are written in a second request when the owner's id type differs from the recipient's; otherwise a first push on an already-owned requirement would mix `open_id` and `user_id` and hit `1254066`.

A failed Base upsert must not emit a success notification. A notification delivery status is not represented as a Web workflow state.

## Interface contract

- PUT /api/requirements/{id}/owner — save manual Feishu-user selection, persist mapping, then trigger push.
- Push adapter performs lookup/create/update by the external requirement key and returns Feishu record ID.
- The automation layer owns message formatting and delivery history unless the target environment cannot express a required rule; any server-side fallback requires an explicit decision and audit record.

## Acceptance criteria

1. Given a valid TB user ID mapping, when an eligible requirement is processed, then the correct Feishu user is written.
2. Given no TB user ID and one unique name mapping, then the mapping is reused without manual action.
3. Given duplicate or missing owner mapping, then the record remains unmapped until an operator selects a Feishu user; no duplicate Base record is created.
4. Given the TB requirement has no owner, then the record is pushed with an empty owner and no owner notification.
5. Given Base already has a manual owner and TB owner is empty/unmatched, then sync preserves that manual owner.
6. Given TB owner later maps to a new Feishu user, then Base owner changes and only the new owner receives the owner-change notification.
7. Given a substantive source change, then a PM snapshot is saved before writes; if snapshot fails, the existing Base row and PM state remain intact.
8. Given an unchanged scheduled sync, then no PM state reset, duplicate row, or duplicate notification occurs.
9. Given analysis failure or low confidence, then an otherwise eligible requirement can still be pushed.
10. Given Base upsert fails, then push state is failed/retryable and no push-success notification is generated.

## Verification strategy

Use a real test Base with actual person fields and configured automation. Verify create, update, empty owner, manual owner preservation, owner change, duplicate-name disambiguation, substantive update snapshot, induced snapshot failure, and notification deduplication. Keep Base record IDs and automation execution evidence. Mock Base data is not integration evidence.

## Out of scope

- Base as the full 28-field requirements-management system.
- PM comment-stream import.
- Reading PM state or notification delivery into the Web workbench.
- Automatic adoption, priority commitment, solution selection, or release planning.
