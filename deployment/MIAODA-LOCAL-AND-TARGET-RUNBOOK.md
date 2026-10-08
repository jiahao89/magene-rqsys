# RQ-Sys Local API and Database Migration Runbook

## Status

This runbook is for the platform-neutral local Node.js API foundation. It does **not** configure or deploy a Miaoda application. Miaoda database, runtime, job scheduler, identity, Git import/publish path, and secret injection remain unverified under Ticket 00.

## Prerequisites

- Node.js 22 or newer.
- PostgreSQL database reachable from the server process.
- A local `.env` copied from `.env.example` with a valid `DATABASE_URL`.
- Any integration credentials required for a particular adapter configured only in the server environment. Never put credentials in frontend variables or browser bundles.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set the local PostgreSQL connection string.
3. Apply migrations with `npm run db:migrate`.
4. Start the API with `npm run dev:api`.
5. Verify `GET /api/health` returns the liveness response and `GET /api/health/ready` reports database readiness.

## Migration rules

- Migrations live in `database/migrations/` and must be additive and transactional.
- Never edit an already-applied migration; create the next numbered migration.
- Use application-generated UUIDs (`crypto.randomUUID()`); do not add privileged database extensions solely for UUID generation.
- Back up the target database before applying schema changes outside a disposable local database.
- Local PostgreSQL success is not evidence that the target Miaoda database supports the same driver, transaction semantics, migration runner, limits, or retention.

## Target Miaoda deployment gate

Before any Miaoda deployment or target migration, complete and record Ticket 00 evidence for:

- GitHub repository import, source-of-truth and repeatable publish path.
- Server-side TypeScript entrypoint and runtime compatibility.
- PostgreSQL persistence, driver/connection limits, transactions, constraints, indexes, and migrations.
- Secret storage/injection and redaction in responses/logs.
- User identity context and server-side role checks.
- Durable scheduled/background jobs, restart recovery, retry, timeout, and concurrency behavior.
- External HTTPS access to Teambition, Feishu, and the approved model provider.

Do not deploy, publish, initialize Git credentials in Miaoda, set online environment variables, or execute target database migrations while the relevant write-scope and Ticket 00 gates are blocked. When those gates are resolved, use an explicitly designated test Miaoda app/environment first; do not test writes against production data.

## Safe environment template

`.env.example` contains placeholder variable names only. Real secrets belong in an untracked local `.env` for local development or a verified server-side secret store for deployment. Do not copy `.env` into Git, frontend assets, build-time `VITE_*` variables, API responses, logs, or issue evidence.
