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

## Project references

- Product and implementation scope: [`specs/rq-sys-mvp/README.md`](specs/rq-sys-mvp/README.md)
- Database and API design: [`specs/rq-sys-mvp/DB-AND-API-DESIGN.md`](specs/rq-sys-mvp/DB-AND-API-DESIGN.md)
- Teambition live metadata check: [`specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md`](specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md)
- API contract: [`specs/rq-sys-mvp/openapi.yaml`](specs/rq-sys-mvp/openapi.yaml)
- Agent workflow and constraints: [`AGENTS.md`](AGENTS.md)

