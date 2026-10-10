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
| 4 | 04-workbench.md | Web workflows, APIs, roles, visible states | 00–03 |
| 5 | 05-platform-reliability-security.md | Miaoda persistence/scheduling, credentials, audit, acceptance gates | 00 |

## 5. Acceptance boundary and next steps

As of 2026-10-10, the local RQ-Sys checkout contains platform-neutral implementations for the MVP API, sync/analysis/owner/Base-push pipeline, retries/audit, rules, and workbench. The latest recheck passed API unit tests (183/183; PostgreSQL integration excluded because its configured database target was not confirmed isolated), Web tests (20/20), typecheck, production build, and Miaoda adapter tests (5/5), lint, and production build. This proves local code paths only; it does not establish Miaoda, Teambition, AI-provider, Feishu contact search, Base automation, or end-to-end target acceptance. See [LOCAL-AND-TARGET-STATUS.md](LOCAL-AND-TARGET-STATUS.md) for exact verification boundaries.

The dedicated Miaoda app is `app_17fqkjwyx1u`. Release `7694878567301549280` reports `finished` for `rq-sys-miaoda/sprint/default` commit `be2d20a448d20634b3d0a564aecb109ca5757202`. An earlier online trace showed `/api/sources` HTTP 500 with `DEPTH_ZERO_SELF_SIGNED_CERT` under old commit `6773cc4`. A fresh authenticated workbench reload shows “API 已连接” and “尚未配置数据源”; the frontend only enters ready after health and source-list GETs succeed, confirming the app-mediated read path and an empty source list. No matching trace/runtime commit has been captured: local CLI trace/log lookups failed because `open.feishu.cn` did not resolve. Direct address-bar access returns the platform CSRF-header error and is not a valid substitute for the app request. Online managed DB has 13 expected tables, a publish changelog, and no pending dev→main schema diff; no source config exists.

The user selected Teambition project `室外产品-码表软固件需求池` (project ID `6960a3187384fa11aa07d7e6` from its authenticated page URL; UI count `311/314`). The skill's read-only API request could not connect, so task type and project-specific field mapping remain unverified; prior API evidence belongs to a different project. The user provisionally set Monday 09:00 `Asia/Shanghai` and limited test notifications to themselves. No source, sync, Base write, notification, or schedule was created/enabled. The Miaoda editor shows `.env` modified, but its contents were not inspected; the app-scoped Git repository tracks a `.env` path, so do not commit/publish any real key from it. This also does not prove server-side secret injection.

### Remaining external gates

- Ticket 00: when local DNS/observability access is restored, correlate the fresh successful app-mediated health/source GETs to the active runtime commit; don't repeat release or call TLS repair accepted based solely on `finished`.
- Identity: keep the identity adapter unimplemented until the target Miaoda token/session contract is verified; API production authorization remains blocked without it.
- Ticket 09: after DB runtime succeeds and safe test fixtures plus administrator-controlled server secrets are available, run approved dev-environment end-to-end acceptance for Teambition import, DeepSeek, Feishu Base writes/snapshots/owner/notification dedupe, scheduler, identity, failures and retries. Notifications remain limited to the user.
- Resolve and record D-02 (Base PM workflow architecture) and D-03 (project-specific field mapping) before affected production behavior. D-10 has a provisional user-selected value; scheduler runtime/recovery remains unverified.

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

The local checkout (`origin`: `jiahao89/magene-rqsys`) now contains the TypeScript modular API, PostgreSQL schema/repositories, OpenAPI contract, Teambition/AI/Feishu Base adapters, worker/retry/scheduler logic, and a HeroUI workbench. The Web owner-mapping flow now searches the Feishu contact directory through the server and requires explicit candidate selection; it no longer asks the operator to type an Open ID.

The server identity adapter remains deliberately unimplemented until the Miaoda session/token contract is verified. The worker's local polling is for development only. The target Miaoda database/runtime/scheduler/identity and app credentials, Feishu contact-search permission, real integrations and notification automation remain unverified; do not describe local code as deployed or integrated.

D-08 is resolved by ADR-001: the current local Web baseline is HeroUI v3 + Tailwind v4. Compatibility with Miaoda hosting/import remains part of Ticket 00. The proposed Miaoda-first deployment architecture is documented in [TECHNICAL-PLAN-MIAODA.md](TECHNICAL-PLAN-MIAODA.md) and still requires target-tenant verification.

## Completion definition

A feature is complete only when its acceptance criteria pass through the public application/API seam and the relevant external integration has evidence from the target environment. Static mock screens do not prove integration. Do not add full lifecycle fields, Base-to-Web status sync, autonomous PM decisions, or roadmap stages under these MVP specs.
