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

## Base write and field protection

- Upsert by project ID + TB requirement ID; do not create a second row for the same key.
- Keep source facts, AI suggestions, owner, PM confirmations/status, and push metadata in distinct field groups.
- The sync service writes only source-owned fields. The analysis service writes only AI-owned fields. Human PM fields are never overwritten by either.
- On substantive source changes, read and persist a PM snapshot before mutating Base. After the snapshot succeeds, update source/AI fields, retain prior confirmations in history, and set PM status to 待处理.
- If a required snapshot read fails, leave the current Base record and PM fields unchanged, mark only that item failed/retryable, and continue other batch items.
- The MVP does not read Base-native comments.
- Base is the PM collaboration surface for this MVP. Web does not read PM-processing or notification-delivery state back.

## Notification contract

Use Base automation where the target Base can express the trigger and recipient rules. Verify each trigger and deduplication in the target table.

| Event | Recipients | Deduplication |
|---|---|---|
| First successful push | PM Leader, resolvable proposer, current mapped/assigned owner | One per source requirement and push version |
| Substantive source change successfully pushed | Same recipients as the initial push; omit unresolved proposer/empty owner | One per substantive source version |
| Owner assigned after an empty-owner push | Newly assigned owner | One per assignment event |
| TB owner changes to a mapped person | New owner | One per mapped owner change |
| AI retry succeeds with new result | PM Leader and assigned owner | One per new analysis result |
| No-op scheduled sync or retry with no new result | None | Silent |

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
