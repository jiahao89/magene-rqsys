# RQ-Sys

RQ-Sys MVP project workspace. Product behavior is defined by the current Feishu MVP PRD and the local Specs; the implementation skeleton is being prepared for the Teambition → AI analysis → Feishu Base workflow.

## Local API foundation

Requirements: Node.js 22+ and PostgreSQL. Node.js 22 is an LTS line; the actual Miaoda runtime remains subject to Ticket 00 verification.

```sh
npm install
cp .env.example .env
# Set DATABASE_URL to a local PostgreSQL database.
npm run db:migrate
npm run dev:api
```

The skeleton currently exposes `GET /api/health` and `GET /api/health/ready`. Product endpoints are specified in [`specs/rq-sys-mvp/openapi.yaml`](specs/rq-sys-mvp/openapi.yaml) and will be implemented by their tickets. The local server is not yet a deployable Miaoda application.

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

The check verifies that the declared shared modules (Base write path, analysis, owner mapping, retry, scheduler, hashes, job claim, ports) are still identical after import-extension normalisation, and that every remaining difference is either a declared platform adaptation or root-only by design. It exits non-zero on any undeclared drift.

## Project references

- Product and implementation scope: [`specs/rq-sys-mvp/README.md`](specs/rq-sys-mvp/README.md)
- Database and API design: [`specs/rq-sys-mvp/DB-AND-API-DESIGN.md`](specs/rq-sys-mvp/DB-AND-API-DESIGN.md)
- Teambition live metadata check: [`specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md`](specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md)
- API contract: [`specs/rq-sys-mvp/openapi.yaml`](specs/rq-sys-mvp/openapi.yaml)
- Externally blocked items and how to clear them: [`deployment/EXTERNAL-BLOCKER-RUNBOOK.md`](deployment/EXTERNAL-BLOCKER-RUNBOOK.md)
- Agent workflow and constraints: [`AGENTS.md`](AGENTS.md)

