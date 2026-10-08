# RQ-Sys runtime acceptance and limitation status (2026-10-08)

This file records local execution evidence and separates it from unverified target Miaoda behavior. Update only after new target-environment evidence is obtained.

## Implemented and locally executed

| Check | Result | Evidence |
|---|---|---|
| TypeScript API typecheck | Passed | `npm run typecheck` exit 0 |
| API build | Passed | `npm run build` exit 0 |
| API automated tests | Passed (3/3) | `npm test`; liveness, no-DB readiness, and explicit 501 for an unimplemented product API |
| Local liveness | Passed | `GET /api/health` => HTTP 200, `{"status":"ok","service":"rq-sys-api"}` |
| Local lark-cli Spark read probe | Partially available | Fresh `lark-cli apps +list --as user` succeeded and returned two visible apps; no RQ-Sys Miaoda app is present. Separate member-list probe on existing frontend app returned `feature_not_available` rather than a missing-scope error. This does not prove all read surfaces (settings/logs/metrics) are available. |

## Not implemented or not verified

- No local `.env` / `DATABASE_URL` was configured; PostgreSQL migration execution, CRUD/API persistence, audit writes and job recovery were not exercised.
- Product routes remain explicit HTTP 501 stubs; no domain handlers or server authorization adapter are implemented.
- No scheduler, worker, durable retry loop or audit subsystem implementation was added in this pass.
- No deployment or write was executed in Miaoda. Miaoda PostgreSQL, Node runtime, secret injection, identity, automation/scheduler, background tasks and Git import/publish path remain unverified under Ticket 00.
- No statement that RQ-Sys is integrated with Miaoda, Teambition, Feishu Base or an AI provider is permitted on this evidence.
