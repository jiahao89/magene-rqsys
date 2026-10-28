# RQ-Sys

RQ-Sys is the requirement pipeline for the bike-computer firmware team. Teambition is the read-only source of requirement facts, the application PostgreSQL database owns workflow state, source snapshots, AI versions, mappings, audit and retry state, and Feishu Base owns PM processing fields and notification automation. Product behavior is defined by the current Feishu MVP PRD plus the local Specs; this repository is the canonical implementation source.

## Current status

- **MVP (V0.1)**: implemented and exercised in the target Miaoda environment. Per-flow evidence lives in `specs/rq-sys-mvp/` and `.scratch/rq-sys-v0.2/verification-20261026/`.
- **V0.2**: core intake/owner increments are implemented; the U/M/S/C score v2 rule and its detail/overview UI were target-verified on 2026-10-28. See `specs/rq-sys-v0.2/README.md` and `.scratch/rq-sys-v0.2/issues/README.md`.
- **Open items**: unresolved external blockers and their clearing steps live in `deployment/EXTERNAL-BLOCKER-RUNBOOK.md`. Anything without target-environment evidence must be labelled “implemented, not verified in target environment” (see `AGENTS.md`).

## Repository layout

- `apps/api/`: canonical platform-neutral API (TypeScript modular monolith, `node:http` entry).
- `apps/web/`: Vite + React workbench.
- `rq-sys-miaoda/`: the Miaoda app runtime repository, with its own git history released from `sprint/default`. It is git-ignored in this checkout and shares RQ-Sys modules with `apps/api` (see “Keeping the two repositories aligned”).
- `database/migrations/`: PostgreSQL schema migrations.
- `specs/`: numbered specs, the API contract (`specs/rq-sys-mvp/openapi.yaml`) and decision registers.
- `deployment/`: local/target runbooks and acceptance checklists.

## Local API foundation

Requirements: Node.js 22+ and PostgreSQL. The Miaoda runtime is Node-based; local PostgreSQL behavior is not production proof (see `AGENTS.md`).

```sh
npm install
cp .env.example .env
# Set DATABASE_URL to a local PostgreSQL database.
npm run db:migrate
npm run dev:api
```

Product endpoints are implemented, and [`specs/rq-sys-mvp/openapi.yaml`](specs/rq-sys-mvp/openapi.yaml) remains the contract source of truth. The root API runs standalone for local development; the Miaoda-deployed application is assembled from `rq-sys-miaoda/`, not from this directory.

## Exercising the API locally

Protected routes fail closed until an identity provider is configured, so the API returns `401` by default. For local development only, set an arbitrary local user id and run both processes with the same value:

```sh
# terminal 1 — API accepts loopback requests carrying the identity header
RQSYS_LOCAL_IDENTITY=local-operator npm run dev:api
# terminal 2 — Vite proxy injects the matching header
RQSYS_LOCAL_IDENTITY=local-operator npm run dev:web
```

Three guards keep this from becoming a production auth path: the variable must be explicitly set, `NODE_ENV=production` disables it regardless of value, and only loopback requests are accepted. The target environment gets its identity from Miaoda's trusted `req.userContext` instead.

## Keeping the two repositories aligned

`apps/api/` (canonical, platform-neutral) and `rq-sys-miaoda/server/rqsys/` (app runtime) share the same RQ-Sys modules. They are built differently and have different platform adapters, so "byte-identical" is not the goal — every difference must be a declared adaptation instead:

```sh
npm run check:alignment
```

The check verifies that the declared shared modules (Base write path, analysis, owner mapping, retry, scheduler, hashes, job claim, ports) are still identical after import-extension normalisation, and that every remaining difference is either a declared platform adaptation or root-only by design. It exits non-zero on any undeclared drift. `rq-sys-miaoda/` is a separate repository and is not tracked here; changes to shared modules must be mirrored there before a release.

## Project references

- Product and implementation scope: [`specs/rq-sys-mvp/README.md`](specs/rq-sys-mvp/README.md)
- Current increments and gates: [`specs/rq-sys-v0.2/README.md`](specs/rq-sys-v0.2/README.md), [`specs/rq-sys-v0.2/DECISIONS-AND-GATES.md`](specs/rq-sys-v0.2/DECISIONS-AND-GATES.md)
- Database and API design: [`specs/rq-sys-mvp/DB-AND-API-DESIGN.md`](specs/rq-sys-mvp/DB-AND-API-DESIGN.md)
- Teambition live metadata check: [`specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md`](specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md)
- API contract: [`specs/rq-sys-mvp/openapi.yaml`](specs/rq-sys-mvp/openapi.yaml)
- Externally blocked items and how to clear them: [`deployment/EXTERNAL-BLOCKER-RUNBOOK.md`](deployment/EXTERNAL-BLOCKER-RUNBOOK.md)
- Step-by-step target acceptance checklist (run after a successful release): [`deployment/TARGET-ACCEPTANCE-CHECKLIST.md`](deployment/TARGET-ACCEPTANCE-CHECKLIST.md)
- V0.2 target runbook: [`deployment/V0.2-TARGET-RUNBOOK.md`](deployment/V0.2-TARGET-RUNBOOK.md)
- Agent workflow and constraints: [`AGENTS.md`](AGENTS.md)
