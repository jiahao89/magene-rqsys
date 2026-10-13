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

As of 2026-10-13, the selected Teambition project `室外产品-码表软固件需求池` returned 311 requirements with 311 unique, non-empty IDs. A Dev `source_only` batch completed successfully with 311/311 items, 0 failures, and every item matched a persisted non-fixture requirement row. Dev now contains exactly 311 Teambition requirements plus the 7 preserved synthetic fixtures. The weekly schedule remains disabled at Monday 09:00 Asia/Shanghai; no AI or Base work was started by this source-only batch.

The historical `311/314` display is no longer an active Dev data-alignment issue: Dev now contains 311 source rows, matching the raw API snapshot. The dashboard had derived its counts from a paginated requirement response instead of a full-dataset aggregate, so the old denominator was not trustworthy; the exact three historical extra rows were not independently identified. Both root and Miaoda workbenches now use an authenticated server-side aggregate that excludes fixture rows. Miaoda release `7696073033094450405` finished against commit `5918960`; a read-only Dev query confirms 311 business rows and 7 excluded fixtures. Visual dashboard readback remains pending. Do not identify the historical three rows as test tools or delete them based on that assumption.

The user resumed full acceptance on 2026-10-13. The synthetic sync → AI → POC Base → user-only notification E2E, missed-week recovery, worker restart, and tenant-wide access checks remain unverified. Keep the real schedule and stakeholder notifications disabled until those checks pass. Priority rules remain unpublished, so priority stays blank; the target Base priority select currently lacks P3. The POC module select also needs to match the maintained function-module dictionary before module suggestions can be written as selected values.

### Remaining external gates

- Visually verify the released full-dataset dashboard in Miaoda Dev; the target database aggregate already confirms 311 business requirements and 7 excluded fixtures.
- Verify the Teambition gateway's pagination/completeness behavior before scaling beyond the current 311-record project snapshot.
- Run synthetic AI/Base/notification E2E, missed-week recovery, worker restart, and tenant-wide access checks in the resumed acceptance pass.
- Align the POC Base module/priority select options with approved dictionary and priority-rule behavior before expecting every AI suggestion to be written as a selected field value.

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

The local checkout (`origin`: `jiahao89/magene-rqsys`) contains the TypeScript modular API, PostgreSQL schema/repositories, OpenAPI contract, Teambition/AI/Feishu Base adapters, worker/retry/scheduler logic, and a HeroUI workbench. The root Web and Miaoda app worktrees have server-side Feishu user search and explicit candidate selection; the operator no longer types an Open ID. The Miaoda app worktree also includes server-side requirement filters, full source-config creation persistence, guarded fixture-status UI, and source-time normalization. Latest published Miaoda code is commit `59189609c8260f6201d15e990ba2d8ca00e4f355` / release `7696073033094450405`.

The Miaoda adapter uses `@NeedLogin()` and trusted `req.userContext.userId`; the published app loaded for the current signed-in user, while tenant-wide signed-in access remains to be accepted. A 30-minute Miaoda recovery trigger exists and its one-window handler drill succeeded on 2026-10-12, after which it was disabled. Missed-week recovery and worker restart remain unverified. Target app-mediated sync and full workflow are not yet verified; distinguish the finished release from the stale Dev preview and local integration evidence.

D-08 is resolved by ADR-001: the current local Web baseline is HeroUI v3 + Tailwind v4. Compatibility with Miaoda hosting/import remains part of Ticket 00. The proposed Miaoda-first deployment architecture is documented in [TECHNICAL-PLAN-MIAODA.md](TECHNICAL-PLAN-MIAODA.md) and still requires target-tenant verification.

## Completion definition

A feature is complete only when its acceptance criteria pass through the public application/API seam and the relevant external integration has evidence from the target environment. Static mock screens do not prove integration. Do not add full lifecycle fields, Base-to-Web status sync, autonomous PM decisions, or roadmap stages under these MVP specs.
