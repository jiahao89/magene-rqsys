# RQ-Sys local implementation and target acceptance status (2026-10-10, refreshed)

## Implemented and locally verified

| Check | Result | Evidence |
|---|---|---|
| API unit tests | Passed (183/183 across 32 files); PostgreSQL integration excluded in this recheck | Node test runner; avoided the integration helper because the configured `DATABASE_URL` target was not verified as isolated |
| Web tests | Passed (20/20) | `npm test` |
| API/Web typecheck | Passed | `npm run typecheck` |
| Production builds | Passed | `npm run build` |
| Diff whitespace check | Passed after documentation update | `git diff --check` |
| Feishu owner selection | Implemented locally | Protected server-side directory-search API, minimal candidate projection, Web search/selection UI, and fake-fetch/API/component tests |
| Miaoda adapter regression checks | Passed (5/5) | App repo `npm run test:rqsys-route`; mount-prefix, parameter binding, Drizzle query/transaction and rollback paths |
| Miaoda app lint and production build | Passed | App repo `npm run lint` and `npm run build:prod` |

The previous repository status recorded a 196-test API + PostgreSQL integration run. This recheck does not repeat that database integration suite; the current evidence is 183 API unit tests plus the other checks above.

The local code covers the platform-neutral MVP API, Teambition import pipeline, structured AI analysis, owner mapping, Feishu Base adapter, schedule/retry/audit logic and the Web workbench. Local tests do not prove external credentials, network access, target permissions, or production execution.

## Miaoda target evidence (2026-10-10)

- Release `7694878567301549280` is `finished` and binds app commit `be2d20a448d20634b3d0a564aecb109ca5757202`. This only verifies release state.
- The historical `/api/sources` HTTP 500 with `DEPTH_ZERO_SELF_SIGNED_CERT` is associated with old commit `6773cc4`. On 2026-10-10, a fresh authenticated workbench reload showed “API 已连接” and “尚未配置数据源” without an error banner. Its load path awaits health and source-list calls before showing ready, so the app-mediated `/api/health` and `/api/sources` GETs succeeded and the source list is empty; this verifies the current handler's source DB read path, not writes or full E2E. Direct address-bar navigation to `/api/health` returns the platform CSRF-header error and is not the same request path. CLI trace/log lookup could not resolve `open.feishu.cn`, so request-to-release commit correlation remains open.
- Online Miaoda-managed PostgreSQL schema contains the expected 13 tables; the changelog has a publish event; `dev→main` schema diff is empty. Table structure reads match expected fields/indexes. The RQ-Sys handler's runtime DB read path for `source_configs` succeeded through the authenticated workbench; DB writes, transaction behavior and persistence across the full pipeline remain unverified.
- Online environment variables and OpenAPI keys are empty; automations are empty; all 13 table row-audit settings are disabled. No server integration credentials are configured.
- App requires login and has tenant-level access, but the source identity adapter remains deliberately unimplemented. No verified server user/session contract is available yet.
- No target E2E data writes, Teambition sync, AI provider request, Base write, scheduler, or notification automation has been tested. A reminder was sent only to the user; no stakeholder was notified.

### Follow-up observation (2026-10-10)

- The authenticated online RQ-Sys workbench was refreshed; it renders “API 已连接” and “尚未配置数据源” without an error banner. The client marks itself ready only after its health and source-list GETs succeed, so the current app-mediated GET path and empty source read are verified. No source was created and no sync was run. Direct navigation to the endpoint is rejected by the platform CSRF guard; CLI trace lookup failed due local DNS, leaving exact request-to-release correlation open.
- User selected Teambition project `室外产品-码表软固件需求池`; the authenticated project page URL identifies `6960a3187384fa11aa07d7e6`, and the UI shows `311/314`. The project-local skill request to its API gateway failed to connect in this shell; task type and field map are unknown. The previous live POC is for a different project.
- User provisionally chose Monday 09:00 `Asia/Shanghai`; test notifications are limited to the user. The target scheduler remains disabled/unverified.
- The Miaoda code editor shows `.env` as modified. Its contents were not opened; this does not prove runtime secret injection. The app-scoped Git repository tracks a `.env` path. If the edited file contains a real key, do not commit or publish it; use trusted server-side secret storage and rotate it if it has entered Git history. The code defaults to DeepSeek, but that does not verify the identity of an unseen key.

## Not implemented or not verified in target

- Identity adapter remains intentionally unimplemented pending target Miaoda session/token contract and must stay so until then.
- The development worker poller is not a durable Miaoda scheduler. Weekly trigger, worker restarts, retry recovery, and audit retention need target verification; the provisional business schedule is Monday 09:00 `Asia/Shanghai`.
- Feishu user search needs server-side `FEISHU_APP_ID` / `FEISHU_APP_SECRET` and contact-search permission; the target app's contact scope/result visibility are not verified.
- Base schema mapping, PM snapshot/write permission, notification automation, DeepSeek provider, Teambition gateway, and full deployed import→analysis→mapping/push flow remain Ticket 09 acceptance work.
- App-scoped Miaoda repo `rq-sys-miaoda/` is separate from the GitHub implementation checkout. Do not confuse their source histories or releases.

## Next blockers

1. Once local DNS/observability access is restored, read back the fresh app-mediated health/source GET traces and correlate runtime commit. Do not create another release to address stale/ambiguous traces.
2. If a new trace on `be2d20a` again shows a TLS certificate error, provide that trace/log to Miaoda support. Do not disable certificate validation or inject an independent DB URL.
3. A Miaoda administrator manually sets required server-side integration secrets through the trusted secret UI; report only variable names/configured status. Do not provide values in chat. Assistant must not set app env variables, execute Miaoda DB writes, or create releases under `AGENTS.md`.
4. After the runtime GET succeeds, provide a dedicated test Teambition project/owner allowlist and a test Base/table plus approved field mapping. Run only authorized dev fixtures; send no notices except to the user.
5. Verify durable trigger/worker restart behavior before enabling the provisional Monday 09:00 `Asia/Shanghai` schedule.

All RQ-Sys modules remain “implemented, not verified in target environment” unless explicit target evidence proves otherwise. Do not call any module Miaoda-integrated.
