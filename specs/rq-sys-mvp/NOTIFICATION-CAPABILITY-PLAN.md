# Notification Capability Verification Plan

> **For agentic workers:** Use executing-plans for this serialized external-state verification. Do not delegate mutations of the shared POC; a reviewer may inspect this plan. Steps use checkbox syntax for tracking.

**Goal:** Determine whether native Base automation can satisfy the approved notification design without changing production behavior.

**Architecture:** Four candidate system fields and narrowly filtered synthetic POC workflows. Use native CLI/UI and actual workflow/message evidence; stop the four-field approach at the first required capability proven unsupported. No production code or formal Base changes.

**Tech Stack:** lark-cli Base v3, native Base workflows, CUA browser, local Markdown evidence.

## Files and targets

- Design: `specs/rq-sys-mvp/NOTIFICATION-CLOSEOUT-DESIGN.md` (user approved isolated POC on 2026-10-16).
- Plan: this file. Evidence: `specs/rq-sys-mvp/NOTIFICATION-CAPABILITY-RESULTS.md`.
- Temporary definitions/backups: `/tmp/rqsys-notification-poc-20261016/`; mode0700, no credentials in committed artifacts.
- Only Base `OddqbqBeOamFjFsR5IXcJdjknmd`, table `tblxbyvbdLGVnLaO`. Resolve its current name and field IDs by CLI before constructing steps.
- Only recipient `ou_eb8d2f149cdbe50c2fb73afedd49184f` (贾浩). All created records must use project key `rqsys-notify-poc-20261016` and requirement IDs starting `rqsys-fixture-notify-`.

### Task 1: Baseline and schema

- [x] Saved current field/workflow definitions and enabled states. Inspected the enabled owner-notification flow; disabled it during fixture writes and restored its original enabled state after probes. Formal workflow and schedule were re-read unchanged.
- [x] Dry-ran then created only the four approved candidate fields: `系统通知事件ID` text, `系统通知类型` text, `系统通知收件人` user multiple, `系统负责人通知归并值` user single.
- [x] Read back created fields and persisted IDs. No partial field-create retry was needed.

Commands (prefix all with existing user identity env wrapper):
`lark-cli base +table-list --base-token OddqbqBeOamFjFsR5IXcJdjknmd --as user`
`lark-cli base +field-list --base-token OddqbqBeOamFjFsR5IXcJdjknmd --table-id tblxbyvbdLGVnLaO --as user`
`lark-cli base +workflow-list --base-token OddqbqBeOamFjFsR5IXcJdjknmd --as user`
`lark-cli base +field-create --base-token OddqbqBeOamFjFsR5IXcJdjknmd --table-id tblxbyvbdLGVnLaO --json @fields.json --as user --dry-run` (then actual under user approval).

### Task 2: Conditions and frozen-event probe

- [x] Created a disabled, fixture-key-filtered workflow using native Base actions; dry-run, created, read back and enabled only for the probe. No HTTP action or other recipient was used.
- [x] Tested same-write owner/marker, empty owner, delayed immutable E1/E2 payloads and same-event replay. Evidence and message IDs are in `NOTIFICATION-CAPABILITY-RESULTS.md`.
- [x] Native immutable trigger references and delay were exercised with actual messages; the sequential sample passed. This does not prove concurrency guarantees.
- [x] Same event-ID replay remained silent in the bounded sample. Inputs, records, execution IDs and message IDs are recorded.

### Task 3: Required reliability gates

- [x] Verified A→empty→A with the same real self user; clear was silent and each assignment generated one message.
- [x] Exercised a conditional update filtered by the synthetic project, requirement and current owner. The stale A update affected 0 rows after the owner had been cleared.
- [x] Atomic condition-and-write is unproven; stopped the four-field approach under the approved stop condition. No production rollout or workaround was added.
- [x] Partial-recipient failure resend remains unproven. The gate was recorded and the approach was stopped; no invalid IDs, permission changes or other recipients were used.

### Task 4: Restore and report

- [x] Disabled both newly created probe workflows and restored the original POC workflow to enabled. Formal rows/workflow were not modified.
- [x] Kept synthetic probe rows and candidate fields for audit; disabled the new workflows; performed no schema deletion.
- [x] Re-read the formal table/workflow and confirmed the formal workflow remains disabled/empty and the real weekly schedule remains off. No TB request came from this POC.
- [x] Recorded pass and unproven gates in the results file; no claim of notification delivery completion is made.
- [ ] Commit plan/evidence Markdown and push under existing authorization. A failed native gate requires a separately reviewed implementation design, not silent scope change.
