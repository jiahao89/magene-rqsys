# Schedule, Retry, and Audit — Local-First Engineering Plan

Status: approved for platform-neutral local implementation; target Miaoda wiring and acceptance remain blocked on Ticket 00 and preceding vertical slices.

## Scope guard

This document describes code that may be developed and tested locally. It does not assert that the scheduler, worker, retry engine, or audit persistence is integrated with Miaoda. Use dependency ports so a target platform adapter is added only after the Miaoda runtime POC verifies its APIs and lifecycle guarantees.

## Proposed modules

- `jobs/`: durable job state types, claim/lease policy, idempotency and attempt metadata.
- `scheduler/`: pure calculation of due schedule windows and stable scheduled-run idempotency keys. No local cron process is production scheduling evidence.
- `retry/`: stage-specific retry classification and backoff calculation; successful stages must not be rerun or rolled back.
- `audit/`: event schema and safe-detail allowlist; secrets, personal contact data and provider raw payloads are forbidden.
- `ports/`: storage, clock and execution interfaces so tests use deterministic adapters and target implementations remain separate.

## Invariants to test

1. One active run per source; duplicate schedule/manual triggers with the same idempotency key do not create duplicate work.
2. Retry targets only the failed stage and retains prior successful results.
3. Expired worker leases can be reclaimed safely; a still-valid lease cannot be concurrently claimed.
4. Backoff and attempt limits are deterministic and bounded.
5. Audit records capture actor, action, object, outcome and timestamp while redacting forbidden fields.
6. Scheduler calculations require explicit timezone and schedule configuration; never use machine-local timezone as a business default.

## Target Miaoda gate

Only after Ticket 00 verifies durable database writes/transactions, scheduled automation invocation, worker timeout/restart behavior, secret injection and target identity should the platform-neutral ports be wired to Miaoda. Keep target acceptance blocked until one scheduled run, retry path and audit record have been exercised in an approved test application/environment.
