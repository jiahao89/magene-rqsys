# RQ-Sys MVP implementation and acceptance status (2026-10-12)

## Latest verification after retry/error fixes (2026-10-12)

- Root remote was refreshed before this change: `main` matched `origin/main` at `e604586`; the app remote matched `origin/sprint/default` at `2d90136`. Root changes are being committed locally. To keep shared code aligned, the matching Miaoda changes were committed locally as `cd64e8d`; that app commit is not pushed or published. The latest finished Miaoda release remains `7695421212881750997` / `2d901361`.
- Review fixes: Feishu Base failures now use structured error metadata instead of parsing English `Error.message`; analysis retry requests are audited when they reuse an existing job, conflict with a completed job, or fail to enqueue. Both root and Miaoda implementations pass the repository alignment check (19/19 shared modules).
- **Local verification:** root API 238/238 (including isolated local PostgreSQL), Web 36/36, typecheck/build; Miaoda route tests 61/61, server/client typecheck, lint, production client build, and `git diff --check` passed.
- **Target access retry:** a dry-run read-only Dev SQL query was prepared for the accidental batch and job status, then execution failed before reaching Feishu because DNS could not resolve `open.feishu.cn`. No target write was made. Current live batch status therefore remains unrefreshed from the earlier read.
- **Acceptance remains blocked:** the Dev batch/job disposition still needs the explicit decision requested earlier; target recovery and app-mediated E2E remain unverified; the Teambition `311` vs UI `311/314` discrepancy remains unresolved. Weekly sync and stakeholder notifications remain disabled.

## Latest verification after publish (2026-10-11)

- **Published:** Miaoda release `7695421212881750997` finished successfully with no error logs and is bound to app commit `2d901361ed19cb4fd26b77b446c8d3142b575c00`. The code is committed and pushed to `sprint/default`; no `.env` or secret file was included.
- **Online cold start:** a read-only browser check showed the page in “正在检查 API / 正在加载配置…” while requests were outstanding, then switched to “API 已连接” after loading the configured project. The online source is disabled and the online requirement/batch lists are empty. The Monday 09:00 schedule remains disabled.
- **Cold-start fix:** the workbench now checks `/api/health/ready`, waits for the source, batch, and requirement snapshot, and only then reports ready. A regression test failed before the change and passes afterward.
- **Dev AI and fixture evidence:** the user-approved `AI_API_KEY` write to Dev succeeded without displaying its value. A fixed synthetic requirement then completed analysis and was read back in the isolated POC Base; the previously failed synthetic analysis was also retried successfully and its Base row advanced to analysis version 2. These checks used the local workbench against Dev credentials; they do not by themselves prove the published runtime's full target E2E.
- **Unintended Dev sync, containment in progress:** during browser verification I used a stale accessibility button index and clicked “立即同步” instead of “刷新”. This created batch `020073d7-17ec-4c1f-8521-56a300882b8d`; a read-only Dev query found 30 imported Teambition rows and 30 sync items. The batch remains `running` with one sync job whose lease has expired. No AI or Base jobs were found. I stopped the local API process; recovery remains disabled. No notification was sent. A request for approval to cancel only this batch/job (preserving imported rows) is pending; do not restart a worker before containment is resolved.
- **Local verification at that point:** root API 236/236 (including isolated local PostgreSQL), Web 36/36, typecheck/build, alignment 19/19; Miaoda route tests 61/61, server/client typecheck, lint, production build, and `git diff --check` passed.
- **Acceptance remains blocked:** the accidental Dev import must be contained; the target recovery trigger has not been exercised; the Teambition `311` vs UI `311/314` difference remains unresolved. No real sync should be started again, and no schedule or stakeholder notification should be enabled during this acceptance pass.

## Earlier recheck (2026-10-11; superseded by the latest verification above)

- **Local implementation checks pass:** root API 232/232 (including the isolated local PostgreSQL integration suite), Web 36/36, typecheck/build; Miaoda adapter 54/54, server/client typecheck, lint and production build; repository alignment 19/19 shared modules and both `git diff --check` pass. The root Base adapter was brought back into alignment after replacing the app-token-incompatible `base/v3` lookup with official Bitable v1 composite filtering and safe error summaries.
- **Synthetic Base push is confirmed in the isolated POC table:** the fixed synthetic requirement is visible in the workbench as pushed, and a read-only Bitable v1 query against the approved POC table returned exactly one row matching the synthetic title marker, configured TB project ID, and fixture requirement ID. This confirms the tested workbench/API credential path can write and read the POC Base. It does **not** establish that the published Miaoda runtime is running this code or that its app-mediated E2E passed.
- **AI environment mismatch:** the latest workbench synthetic analysis ended with `AI provider authentication failed`, but a direct provider smoke loaded from `rq-sys-miaoda/.env.local` succeeded against DeepSeek's default base URL/model and passed schema validation (`confidence=中`, `priority=null`). This verifies that local key/provider pair, not the workbench or Miaoda runtime secret wiring. No key or raw model response was printed.
- **Earlier local harness result is separate:** an earlier run fetched 311 real Teambition rows and completed AI plus Base-adapter checks, but it used a different local harness/database context. It does not resolve the later empty-workspace/authentication failure and does not prove a persistent Miaoda runtime flow.
- **Owner-assignment notification passed in the POC Base:** the synthetic row's owner field was empty, then it was assigned to the signed-in user. The direct “also notify” option was unchecked; the configured Base automation run log shows the owner-change trigger and “send assignment notification” step both succeeded, with the signed-in user as the only recipient. No stakeholder was notified.
- Reloading the local workbench returned an empty local API workspace (no source or requirements), while the POC Base still held the synthetic row. This mismatch and its AI authentication failure indicate the workbench API process is not using the same validated persistent environment; they prevent claiming a coherent persisted end-to-end run.
- The Monday 09:00 source schedule and recovery trigger remain disabled. This recheck used read-only task-type/count queries against Teambition; no real rows were imported into RQ-Sys, sent to AI, written to Base, or used for notifications.
- The latest release could not be refreshed because `open.feishu.cn` DNS lookup failed. Do not treat this recheck as a new Miaoda publish or release verification.

## Product decisions aligned

- Login is required. Every signed-in Feishu tenant user can use all RQ-Sys functions; MVP has no app roles, per-user authorization, or pre-seeded user allowlist. The server actor comes only from Miaoda's trusted user context.
- The source is fixed to Teambition project `室外产品-码表软固件需求池` (`6960a3187384fa11aa07d7e6`). The Web form maintains the project name and schedule; the server resolves project/task-type IDs.
- The minimum field map and Base write allowlist are in [TEAMBITION-LIVE-POC.md](./TEAMBITION-LIVE-POC.md). Source identity is `(project ID, requirement ID)`; only title is sent to AI, created time is source metadata, and owner is used only for mapping. No unverified custom fields enter AI or Base.
- Module dictionary starts empty and is maintained through the versioned dictionary screen/API. Until the user supplies the product taxonomy, the analyzer returns `其他` or `待分类`; `待分类` remains in Web/DB and is omitted from Base single-select. The POC Base has four module options (`需求澄清`、`方案设计`、`缺陷修复`、`其他`); add new entries to both the Base field and `BASE_FIELDS_JSON.selectOptions.module` before publishing them.
- Priority stays blank until a validated U/M/S/C scoring rule is published. Current POC Base priority options are P0/P1/P2; do not publish any rule that may emit P3 until Base is updated.
- Monday 09:00 `Asia/Shanghai` is the chosen sync schedule. Persisted due jobs and bounded queue draining are implemented locally. Target trigger `rqsysWeeklySyncRecovery` exists on Miaoda as a 30-minute cron in `Asia/Shanghai` and is currently disabled. **Its delivery and handler wiring were exercised successfully in the target runtime on 2026-10-12**: one cron window fired (`instance_id 17695618791489929242`, `app_env=runtime`) with `dispatch`/`trigger`/`action` all `succeed`, and the app logged `RQ-Sys scheduled work poll completed` from `RqsysAutomation`; Dev row counts were unchanged and the trigger was re-disabled afterwards. This also confirms the safety property that the recovery path creates no work while the weekly schedule is off. Missed-week *recovery* semantics still require an enabled weekly schedule and remain unverified.
- Test notification recipient is the user only. Never sync actual Teambition rows or notify stakeholders for this acceptance pass.

## Local implementation

| Area | Current evidence | Boundary |
|---|---|---|
| Login/access | Root API and Miaoda adapter require a trusted signed-in actor; tests cover 401, any logged-in user, and ignoring forged identity headers. The published app loaded for the signed-in user. A local-development identity seam (`RQSYS_LOCAL_IDENTITY`, `apps/api/src/http/local-identity.ts`) lets the local workbench exercise the real API on this machine; it requires an explicit variable, refuses to activate when `NODE_ENV=production`, and accepts loopback requests only. Verified end-to-end against the real API and local PostgreSQL with no request stubbing. | Unauthenticated rejection and another tenant user's access have not been target-tested. The local seam is not a target identity path and must never be enabled outside local development. |
| Teambition | Read-only project lookup found 311 requirements with unique nonempty IDs; fixed project name resolves to the selected project. The skill's `getProjectTasks` wrapper returns one array and exposes no pagination controls. | Target response count and UI total differ (311 vs 314); the intended row set and gateway truncation behavior are unresolved. Synthetic acceptance must not fetch real rows. |
| AI and mapping | Analysis output is versioned; PII/user identifiers are excluded; U/M/S/C suggestions carry reasons/evidence; empty module dictionary is supported. | At the time of this earlier snapshot, the synthetic run failed with provider authentication. This was later resolved: the user-approved Dev secret write succeeded and synthetic analysis completed; see the latest verification above. |
| Base | Field serialization, idempotent upsert, owner mapping, substantive-change snapshot/PM reset, queue retry, and safe select/date serialization have local regression coverage. The fixed synthetic-fixture guard is enabled. A value rejected by a Base single-select (for example a rule emitting `P3` while the target field only has P0–P2) is surfaced as an omission with a reason and safe audit detail. | A synthetic fixture was pushed and the resulting row was confirmed by a read-only query in the isolated POC Base. The owner-assignment automation was then triggered and its send step succeeded for the signed-in user only. This is workbench/API-path and POC automation evidence, not proof that the published Miaoda runtime ran the new code. The P3-vs-Base-options conflict remains a configuration decision. |
| Notification/schedule | The POC Base automation `RQ-Sys POC - 负责人分配通知（测试）` is enabled and was triggered by assigning the synthetic row to the signed-in user. Its run log shows the trigger and message-send step succeeded; the direct cell notification option was off. Durable queue recovery is wired to a Miaoda automation handler, and its target trigger remains disabled. | The notification test proves the POC Base automation path, not the published Miaoda app runtime or the full sync→push path. Missed-week recovery remains unverified. |
| Web | The current published release is `7695421212881750997`, bound to commit `2d901361ed19cb4fd26b77b446c8d3142b575c00`. Online cold start waits for readiness and a complete initial snapshot; source remains disabled and schedule off. Spec 04 UI additions and the scheduler status card are implemented. | The credential self-check has no API contract, so server-side credential/connectivity probing is deliberately not implemented. Local UI checks do not prove target integrations. |

## Target environment observations (historical detail; current state is summarized above)

The bullets in this section record integration details collected across earlier runs. Where they conflict with the latest verification above, the latest verification is authoritative.

- Current RQ-Sys Miaoda app is `app_17fqkjwyx1u`. The latest published release is `7695421212881750997`, bound to commit `2d901361ed19cb4fd26b77b446c8d3142b575c00`. Both repositories were pushed on 2026-10-12: root `main` at `b023600` and app `origin/sprint/default` at `cd64e8d`. Publishing `cd64e8d` is currently blocked platform-side: eight `+release-create` attempts (with and without `--branch`, spread over roughly an hour including a cooldown retry) all returned `code 500000049`, while `git` is verified in sync with the remote, `db-env-diff` shows no pending schema change, and the local production build passes. No `release_id` was returned, so there is no release to poll; the cause is not established and is not guessed at here.
- Both environments now hold all eight integration variables. **Correcting an earlier claim that "online variables were not changed":** online had also been populated (it was already carrying the valid `AI_API_KEY`, the POC-era gateway/Feishu variables, and `RQSYS_ENABLE_TEST_FIXTURES=true`). On 2026-10-12 the online fixture flag was set to `false` as defence in depth; the route was already inert there because the guard also requires the safe POC Base identity, which online does not use.
- **Dev `AI_API_KEY` was invalid and has been replaced (2026-10-12).** The platform value returned `HTTP 401` from the provider (`api key: ****0d15 is invalid`), which is why app-mediated analysis in dev failed with `AI provider authentication failed`. The valid key (the same value online already used) was written to `dev` via `+env-set`; value was never printed. Readback confirms the expected hash and a live provider call now returns `HTTP 200`.
- The safe POC Base is app token `OddqbqBeOamFjFsR5IXcJdjknmd`, table `tblxbyvbdLGVnLaO`. Its field types/options were read-only verified. Do not use the formal `TB需求池` table for synthetic acceptance. The enabled owner-assignment workflow is `RQ-Sys POC - 负责人分配通知（测试）` and is attached to the `RQ-POC-验证` table.
- The current POC record readback returned one synthetic match with the approved project key and a fixture requirement ID. The query returned only a count/match booleans to the verifier; no personal fields were read back. App-mediated creation is confirmed only for the workbench/API context used in this run, not the published Miaoda release.
- The POC Base automation run log records a successful owner-change trigger and successful message-send step for that synthetic row, with the current signed-in user as the only recipient. This does not verify notification delivery from a published Miaoda runtime.
- Local fixture route `POST /api/dev/fixtures/sync` is enabled only when `RQSYS_ENABLE_TEST_FIXTURES=true` **and** the configured Base app/table identifiers exactly match the isolated POC Base. It ignores request data and enqueues one fixed synthetic requirement. This two-key guard is what keeps the route inert in online, which uses the formal table; the online flag is now `false` as well so a future Base change cannot silently arm it. Configure it in dev only; do not point the online app at the POC Base.
- Trigger `rqsysWeeklySyncRecovery` is present with cron `*/30 * * * *`, timezone `Asia/Shanghai`, and is currently disabled after the 2026-10-12 drill. No source schedule is configured or enabled (`schedule_enabled=false`), which is why the fired drill created no work. The actual weekly schedule remains Monday 09:00 and must stay off until acceptance passes.
- Historical target observation: a dev-preview source creation request using verified project/type IDs, sync enabled, and weekly schedule disabled returned `FORBIDDEN` with an outdated “role checks” client message. The `403` came from the server, but that wording existed only in unreleased client builds and no commit contained RQ-Sys role logic on the server. This is not evidence of a platform ACL decision; do not bypass the server refusal. See `deployment/EXTERNAL-BLOCKER-RUNBOOK.md` B-1.
- Earlier editor observations about a stale preview, pending merge, and `.env` editor state have been superseded by the published release above. The app repository commit excluded `.env` and secret files.
- The published `分类规则` page was read-only verified: it contains no module-dictionary versions and no priority-rule versions. This matches the approved empty-by-default taxonomy/rules policy; product modules and P0–P3 calibration still need user-approved contents before creation/publishing.

## Repository alignment (declared)

`apps/api/src` (canonical) and `rq-sys-miaoda/server/rqsys` share the RQ-Sys modules but differ by build system (tsc/ESM-with-extension vs NestJS/SWC-extensionless) and platform adapters (pg vs Drizzle, local identity seam vs Miaoda `userContext`). `npm run check:alignment` normalises import extensions and asserts: **19/19 declared shared modules are identical** (Base write path, analysis contract/provider/service/priority-rule/repository-adapter, owner mapping, retry policy, scheduler due/due-jobs, sync hashes, job claim, ports, audit storage, contracts/rules, workflow/persistence domain), 28 modules are byte-identical overall, 19 declared platform adaptations genuinely differ (9 more currently coincide), and 4 modules are root-only by design (`application/batch-cursor.ts`, `application/idempotency-keys.ts`, `db/migrate.ts`, `http/local-identity.ts` — the last must not exist in the app repo because the target uses Miaoda's trusted context). The check exits non-zero on any undeclared drift.

## Earlier full-flow run (2026-10-11, local harness, dev credentials, real external services)

This historical run predates the later accidental 30-row Dev import recorded above. It used a separate local harness and is not the current published-app E2E result.

Ran the local API pipeline with Dev environment credentials against real external services. This is evidence for the local pipeline/adapters only; it is not an app-mediated Miaoda Dev acceptance run. The current Miaoda Dev preview still has no source and 0 requirements.

- **Source creation**: `POST /api/sources` with project name only returned `201`; server resolved
  `6960a3187384fa11aa07d7e6` / requirement type `6960a3b76586dfa001dc14df` and persisted them.
- **Teambition sync**: a real `POST /api/sync/run` imported **311/311 rows, no failures**, with 311
  source snapshots. All four statuses are included, so no completed/archived filter is applied.
  `page`/`limit` pagination parameters are rejected by the gateway (HTTP 500), so a single call
  returns the complete set.
- **AI analysis**: the dev `AI_API_KEY` works — provider smoke `SMOKE-OK` with `priority=null`
  (correct: no calibrated rule published), plus 3 real analyses reaching `analyzed`.
- **Base write (adapter, managed identity)**: `PUSH1 created=true` → `PUSH2 created=false` with
  `pmStatusReset=待处理` → PM confirmation fields unpolluted → `CLEANUP-OK`. The POC Base was left
  with zero leftover records.
- **Defect found and fixed by this run**: single-select fields were written as arrays. Real Feishu
  rejects that on update (`1254062`, "the value of 'Single Option' must be a string"), so
  substantive-change PM resets silently failed. Now single-select writes a string and multi-select
  an array, verified against the live Base.
- **Owner gating confirmed as designed**: all 309 owned requirements stayed at
  `owner_state=pending_mapping` and were not pushed; the 2 no-owner rows advanced to
  `not_required` and triggered a push.
- **Base document app access granted; app-credential path not yet verified**: the developer console
  for the exact `固件需求池` app used by Dev shows `bitable:app` and `bitable:app:readonly` enabled
  and published. With the user's confirmation, the app was added as “Can edit” to the isolated POC
  Base “TB同步测试(可删除)”; UI showed “App added” and lists the app with that role. Production Base
  access was not changed. A local CLI verification attempt was blocked before sending a request by
  DNS failure resolving `open.feishu.cn`. The Miaoda Dev preview loaded and its internal health,
  sources, requirements, and batches GETs succeeded, but it shows no configured source and zero
  requirements; no app-mediated Base API call or synthetic record write was made. Composite-key
  lookup separately calls `base/v3` and previously returned `99991672`; the exact scope still needs
  a fresh complete response. Previous no-owner pushes failed and recorded no `base_record_id`.
  Earlier adapter smoke used `lark-cli` user identity and does not prove app-credential access. See
  `deployment/EXTERNAL-BLOCKER-RUNBOOK.md` B-6.
- **Analysis flakiness**: for a title-only requirement the model intermittently returns empty
  `facts[].evidence` or quotes text absent from the source, which the validator rejects. Analysis
  failure did **not** block the push, as required, but it burns up to 5 identical retries. See B-7.
- **Local-only knob added**: `RQSYS_MAX_ANALYSIS_PER_SYNC` bounds how many requirements are queued
  for analysis during local development; import and snapshots always cover every requirement. Unset
  by default and must not be set in the target environment.

## Latest local verification (2026-10-11)

Root API 236/236 (including isolated local PostgreSQL integration), Web 36/36, typecheck/build, alignment 19/19; Miaoda route tests 61/61, server/client typecheck, lint, production build and `git diff --check` passed. Synthetic Dev analysis and POC Base readback succeeded after the approved Dev key write. The POC owner-assignment automation sent only to the signed-in user. The published app cold-start check passed. These results still do not prove the complete published-runtime sync → AI → Base → notification flow.

## Remaining target acceptance steps

1. Resolve the unintended Dev batch `020073d7-17ec-4c1f-8521-56a300882b8d` after the pending user decision; preserve the already imported rows and do not restart workers before containment.
2. Verify the recovery trigger safely in the target runtime, then reconcile the Teambition API result of 311 versus UI `311/314` before enabling any real scheduled import.
3. Complete a safe, app-mediated target E2E using only the approved synthetic fixture and POC Base, with notification addressed only to the user. Do not enable the weekly schedule or stakeholder notifications during acceptance.
4. Keep the module dictionary and priority rule empty until approved contents are supplied; decide the P3 policy before a rule can emit P3.

All local completion claims are distinct from target-environment proof. Until those steps finish, the integration is “implemented locally, not verified in target environment.”
