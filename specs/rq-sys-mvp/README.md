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

The local workspace now contains a TypeScript API foundation, a PostgreSQL migration, and an OpenAPI contract. The foundation currently implements only health/readiness probes; business handlers and target Miaoda adapters remain unimplemented. The former `rq-sys-web` React prototype was mock-backed and had no real TB, Base, or model integration, so it was removed during the 2026-10-08 requirements-stage cleanup. The actual GitHub implementation repository still needs to be opened and inspected before choosing a UI baseline or claiming the local scaffold is the production source.

The technical design and `design.md` refer to HeroUI v3 + Tailwind v4. The removed UI prototype used shadcn/Base UI + Tailwind v4. Keep the component-library decision open until the GitHub repository and target Miaoda import/runtime are checked; record the final choice in an ADR.

The proposed Miaoda-first implementation architecture is documented in [TECHNICAL-PLAN-MIAODA.md](TECHNICAL-PLAN-MIAODA.md). It remains subject to target-tenant POC and verification against the GitHub repository.

## Completion definition

A feature is complete only when its acceptance criteria pass through the public application/API seam and the relevant external integration has evidence from the target environment. Static mock screens do not prove integration. Do not add full lifecycle fields, Base-to-Web status sync, autonomous PM decisions, or roadmap stages under these MVP specs.
