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

As of 2026-10-11, the local RQ-Sys checkout implements the MVP API, sync/analysis/owner/Base-push pipeline, retries/audit, rules, and workbench. Latest local verification: API 218/218 (including isolated local PostgreSQL integration), Web 21/21, root typecheck/build; Miaoda app adapter 38/38, lint, server/client typecheck and production build. Login-only access, Feishu select/datetime serialization, source/push metadata, POC-Base-gated synthetic fixtures, bounded queue draining, failed-job recovery, and version-scoped analysis retry are covered locally. Target app release and app-mediated synthetic E2E remain pending. The Teambition target returned 311 rows while the UI showed 311/314; confirm this discrepancy before asserting full-project coverage. See [LOCAL-AND-TARGET-STATUS.md](LOCAL-AND-TARGET-STATUS.md) for evidence boundaries.

The dedicated Miaoda app is `app_17fqkjwyx1u`. Latest code is pushed as root `main` commit `5790d80` and app `sprint/default` commit `87a2444`; the latest finished Miaoda release remains `7694878567301549280` on older app commit `be2d20a448d20634b3d0a564aecb109ca5757202`. Release and dev variable/automation dry-runs have passed; explicit user confirmation is still required before platform writes. An earlier online trace showed `/api/sources` HTTP 500 with `DEPTH_ZERO_SELF_SIGNED_CERT` under old commit `6773cc4`. A fresh authenticated workbench reload shows “API 已连接” and “尚未配置数据源”; the frontend only enters ready after health and source-list GETs succeed, confirming the app-mediated read path and an empty source list. No matching trace/runtime commit has been captured yet. Direct address-bar access returns the platform CSRF-header error and is not a valid substitute for the app request. Online managed DB has 13 expected tables, a publish changelog, and no pending dev→main schema diff; no source config exists.

The selected Teambition project `室外产品-码表软固件需求池` was verified with 311 unique requirement IDs and 16 custom-field ID/name pairs. The MVP field map uses standard `id`, `content`, `created`, and `executor_id` only; custom fields stay unmapped until types and task-type bindings are verified. Monday 09:00 `Asia/Shanghai` is confirmed. The POC Base field schema and an enabled owner-change workflow are read-only verified; app-mediated sync is not yet run. Test notifications must go only to the current user.

### Remaining external gates

- Ticket 00: local DNS/observability access is restored and all seven online/dev variable names read back; correlate the fresh successful app-mediated health/source GETs to the active runtime commit; don't repeat release or call TLS repair accepted based solely on `finished`.
- Identity: server code requires Feishu login and uses only Miaoda's trusted user context; deployed login behavior remains to verify. No RQ-Sys roles are used.
- Ticket 09: after safe dev Base credentials and a synthetic fixture path are available, run the target app through mock source → Web state → Base write → test notification to the current user. Verify retry, snapshot, idempotency and missed-week recovery.
- D-03's minimum field map and D-10's Monday 09:00 schedule are decided. Custom fields, Base production automation, target runtime, and release/trigger activation remain acceptance gates.

- The initial handoff claim that there are no code items is stale: a 2026-10-09 pass found and fixed a Teambition custom-field duplicate-normalization bug.
- `rq-sys-miaoda/` is a separate, clean app-scoped Miaoda Git repo; release evidence from it must not be confused with the GitHub implementation checkout.
- Do not claim any connector, schedule, runtime API, or end-to-end slice is “integrated” until it has target-environment evidence. The MVP excludes the complete 28-field model; roadmap expansion requires an approved field dictionary (D-01).

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

The local checkout (`origin`: `jiahao89/magene-rqsys`) contains the TypeScript modular API, PostgreSQL schema/repositories, OpenAPI contract, Teambition/AI/Feishu Base adapters, worker/retry/scheduler logic, and a HeroUI workbench. The root Web and Miaoda app worktrees now have server-side Feishu user search and explicit candidate selection; the operator no longer types an Open ID. The Miaoda app worktree also includes server-side requirement filters and full source-config creation persistence. Those Miaoda changes are local and uncommitted; the deployed release does not yet contain them.

The Miaoda adapter now uses `@NeedLogin()` and trusted `req.userContext.userId`; the deployed release still needs login acceptance. The running app polls the durable queue, while a 30-minute Miaoda automation will recover due weekly runs and persisted work after restart. Target runtime and app-mediated sync are not yet verified; do not describe local code as deployed or integrated.

D-08 is resolved by ADR-001: the current local Web baseline is HeroUI v3 + Tailwind v4. Compatibility with Miaoda hosting/import remains part of Ticket 00. The proposed Miaoda-first deployment architecture is documented in [TECHNICAL-PLAN-MIAODA.md](TECHNICAL-PLAN-MIAODA.md) and still requires target-tenant verification.

## Completion definition

A feature is complete only when its acceptance criteria pass through the public application/API seam and the relevant external integration has evidence from the target environment. Static mock screens do not prove integration. Do not add full lifecycle fields, Base-to-Web status sync, autonomous PM decisions, or roadmap stages under these MVP specs.
