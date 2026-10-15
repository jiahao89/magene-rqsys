# RQ-Sys MVP Spec Map

Status: [ready-for-agent] for the approved MVP scope; external integration gates and open decisions are listed separately.

## Purpose

This folder turns the current product and technical documents into implementation-sized specifications. It covers the Teambition-to-Feishu MVP only. It does not expand the MVP into the full requirements-management lifecycle.

## Source baseline

- Product scope and acceptance: Feishu MVP PRD, current revision 60: https://aimagene.feishu.cn/wiki/Ybftwjz6KiczNskNR0ec0oCinRc
- Technical decisions: Feishu technical design, current revision 17: https://aimagene.feishu.cn/wiki/RWzlw1yQDiHvnLk9k1kchOimndh
- Domain terms: ../../CONTEXT.md
- Web design reference: ../../design.md
- Upstream full field definitions: Feishu 需求处理流程, revision 4513: https://aimagene.feishu.cn/wiki/JEyLwBYOziz0bPknDSgcjhuTn9g#share-JZ6Admq5ioWqOux9ZIccnfKRnEc

The technical design was aligned with PRD revision 49, while the current PRD is revision 60. Where they differ, the current PRD controls product behavior; the technical design supplies implementation detail only when compatible. Resolve differences in OPEN-DECISIONS.md before coding affected behavior.

## MVP boundary

The MVP imports all requirements from one dedicated product-group Teambition project, on a weekly schedule or manual trigger; stores snapshots and workflow history; runs bounded AI analysis; maps owners; upserts records into Feishu Base; and lets Base automation notify stakeholders. The Web workbench shows workflow progress and supports configuration, manual sync, mapping, retry, and audit.

The upstream requirements-definition document has 28 fields across basic information, analysis, decision, and progress. The current MVP does not implement all 28. Use only fields enumerated in the current PRD and technical-design MVP tables. Do not silently add the full field model to Base or Web. Future expansion is staged in PRD Roadmap iterations 1–4.

## Map of content and implementation order

| Order | Spec | Main contract | Depends on |
|---|---|---|---|
| 0 | 00-foundation-and-data-contract.md | Objects, field ownership, states, invariants | None |
| 1 | 01-teambition-sync.md | Project configuration, scheduled/manual import, batches, idempotence | 00, 05 |
| 2 | 02-ai-analysis.md | Safe inputs, structured recommendations, validation, retry | 00, 05 |
| 3 | 03-owner-and-base-push.md | Owner matching, Base upsert, PM-field protection, notifications | 00, 01, 02, 05 |
| 4 | 04-workbench.md | Web workflows, APIs, login-only access, visible states | 00–03 |
| 5 | 05-platform-reliability-security.md | Miaoda persistence/scheduling, credentials, audit, acceptance gates | 00 |

## 5. Acceptance boundary and next steps

As of 2026-10-13, the selected Teambition project `室外产品-码表软固件需求池` returned 311 requirements with 311 unique, non-empty IDs. A Dev `source_only` batch completed successfully with 311/311 items, 0 failures, and every item matched a persisted non-fixture requirement row. At that snapshot Dev contained 311 Teambition requirements plus 7 fixtures; the 2026-10-14 follow-up contains 311 source rows plus 10 synthetic fixtures. The weekly schedule remains disabled at Monday 09:00 Asia/Shanghai; no AI or Base work was started by this source-only batch.

The historical `311/314` display is no longer an active Dev data-alignment issue: Dev now contains 311 source rows, matching the raw API snapshot. The dashboard had derived its counts from a paginated requirement response instead of a full-dataset aggregate, so the old denominator was not trustworthy; the exact three historical extra rows were not independently identified. Both root and Miaoda workbenches now use an authenticated server-side aggregate that excludes fixture rows. Miaoda release `7696073033094450405` finished against commit `5918960`; a read-only Dev query confirms 311 business rows and 7 excluded fixtures. The 2026-10-14 Dev visual readback now shows 311/311, with fixtures excluded. Do not identify the historical three rows as test tools or delete them based on that assumption.

The user resumed full acceptance on 2026-10-13. A fresh Dev synthetic batch `4cd73a7f` passed fixture → AI → isolated POC Base readback on 2026-10-14; the test notification was independently found in the current user's private chat at 19:17. Target due-window idempotency and lease takeover after an abandoned probe worker also passed (batch `80d4d908`, attempt 2, one sync job/source snapshot/Base row). The real server restarted and the independent Dev entry cold-loaded twice with API connectivity and 311/311; the requirement pool opened successfully. The editor's embedded preview still fails intermittently after refresh, so it is not declared fixed. No Teambition API was called in this follow-up. Keep the real schedule and stakeholder notifications disabled. Priority rules remain unpublished and priority blank; the POC module select retains 50 options, with 8 dictionary entries Web/DB-only as approved.

On 2026-10-15, a target directory-write failure was reproduced and fixed: advisory-lock `void` results now have a typed projection for Miaoda. Dev person/module CRUD, assignment rename propagation and unassignment passed; cleanup restored 7 people/54 modules, with dictionary v6 entries equal to v1. All eight unsupported-module push/omission and idempotent-replay cases passed using controlled analysis fixtures and the actual target Base transport. The user reports that a second tenant member has logged in; no independent full-action test of that other account was performed. Root `eb4a4dd` is pushed; app `d64d309` is released as `7696725123818540278` (`finished`, no error logs). Online API and directory reads passed after release. No TB request was made.

### Online follow-up (2026-10-15 afternoon)

The approved isolated Online manual and combined platform cron/persisted-safe-source → AI → POC Base flows passed. Two actual successful deliveries reused one scheduled fixture batch `25638a3a` and one Base row `reczz28Nbhq0Mvtw`. All original Online environment values have been restored, the short-lived mode deleted, source/weekly plan disabled and cron restored disabled at its original 30-minute interval. No TB request was made. Fixture guard diagnostics, identity-preserving retries, batch failure fencing and expanded-detail refresh/generation protection are implemented in both repositories. Current local counts are API266, Web45 and Miaoda76; full evidence/release snapshots are in Ticket09 and LOCAL-AND-TARGET-STATUS.md.

### Remaining external gates

- Isolate the intermittent embedded-editor preview lifecycle; the independent Dev cold-load path and 311/311 dashboard now pass. Capture a fresh failed document request URL/status/body before attributing it to routing.
- Verify the Teambition gateway's pagination/completeness behavior before scaling beyond the current 311-record project snapshot.
- The combined cron/persisted safe-source test passed in Online on 2026-10-15; test configuration and triggers were restored afterward. Keep real schedules disabled unless enabling operational use is explicitly requested. Second-user login is user-reported passed; its full action set was not independently inspected.
- Directory CRUD and all eight unsupported-module non-blocking omissions passed in Dev on 2026-10-15. Keep the 50-option allowlist and blank priority until a calibrated rule is published; controlled module outputs do not constitute semantic model-quality acceptance.

- `rq-sys-miaoda/` is a separate app-scoped Miaoda Git repo; release evidence from it must not be confused with the root documentation checkout.
- Do not claim any connector, schedule, runtime API, or end-to-end slice is fully accepted without target-environment evidence. The MVP excludes the complete 28-field model; roadmap expansion requires an approved field dictionary (D-01).

## PRD traceability

| Current PRD section | Spec coverage |
|---|---|
| 3. MVP scope and core flow | 00–05 |
| 4.1 Web sync workbench | 04 |
| 4.2 TB sync and Base push | 01, 03 |
| 4.3 Post-sync AI analysis | 02 |
| 4.4 Stakeholder notification | 03 |
| 5.1 States and 5.2 Acceptance | 00–05 |
| 6. Roadmap | Deferred from MVP specs; use OPEN-DECISIONS.md and the PRD phase gates |

## Shared invariants

1. Teambition is authoritative for source fields. RQ-Sys does not write to Teambition.
2. The application database owns sync batches/items, normalized source snapshots, AI versions, mappings, workflow history, and audit.
3. Feishu Base is the MVP collaboration surface and owns current PM processing fields. The MVP does not read PM state or notification-delivery state back into Web.
4. AI suggestions never overwrite human-confirmed fields. Low confidence, a blank priority, or an initial AI failure never blocks a push.
5. A push is an idempotent create-or-update keyed by Teambition project ID plus requirement ID.
6. No-owner requirements are imported and can be pushed with an empty Base owner. Base automation notifies after a person is assigned.
7. Only substantive source changes reset PM processing to 待处理. Owner, status, and timestamp changes are handled separately.
8. A published priority-rule version is required to emit P0–P3. Before publication, keep priority blank and preserve U/M/S/C recommendations.

## Current codebase seam

The local checkout (`origin`: `jiahao89/magene-rqsys`) contains the TypeScript modular API, PostgreSQL schema/repositories, OpenAPI contract, Teambition/AI/Feishu Base adapters, worker/retry/scheduler logic, and a HeroUI workbench. The root Web and Miaoda app worktrees have server-side Feishu user search and explicit candidate selection; the operator no longer types an Open ID. The Miaoda app worktree also includes server-side requirement filters, full source-config creation persistence, guarded fixture-status UI, and source-time normalization. The latest publication evidence is recorded in LOCAL-AND-TARGET-STATUS.md and Ticket09; the Online scheduled-fixture follow-up is newer than the morning directory-only release.

The Miaoda adapter uses `@NeedLogin()` and trusted `req.userContext.userId`; published access passed for the current user, and second-user login was reported by the user. A 30-minute Miaoda recovery trigger exists; its disabled-source handler drill passed on 2026-10-12 and it remains disabled. Target missed-window idempotency, abandoned-worker lease recovery and synthetic Dev AI → POC Base → current-user receipt passed separately. The combined cron/enabled persisted safe-test-source path passed in Online on 2026-10-15; embedded-preview stability remains a platform limitation. Keep these evidence boundaries separate from the finished release.

D-08 is resolved by ADR-001: the current local Web baseline is HeroUI v3 + Tailwind v4. Compatibility with Miaoda hosting/import remains part of Ticket 00. The proposed Miaoda-first deployment architecture is documented in [TECHNICAL-PLAN-MIAODA.md](TECHNICAL-PLAN-MIAODA.md) and still requires target-tenant verification.

## Completion definition

A feature is complete only when its acceptance criteria pass through the public application/API seam and the relevant external integration has evidence from the target environment. Static mock screens do not prove integration. Do not add full lifecycle fields, Base-to-Web status sync, autonomous PM decisions, or roadmap stages under these MVP specs.
