# RQ-Sys MVP implementation and acceptance status (2026-10-11)

## Product decisions aligned

- Login is required. Every signed-in Feishu tenant user can use all RQ-Sys functions; MVP has no app roles, per-user authorization, or pre-seeded user allowlist. The server actor comes only from Miaoda's trusted user context.
- The source is fixed to Teambition project `室外产品-码表软固件需求池` (`6960a3187384fa11aa07d7e6`). The Web form maintains the project name and schedule; the server resolves project/task-type IDs.
- The minimum field map and Base write allowlist are in [TEAMBITION-LIVE-POC.md](./TEAMBITION-LIVE-POC.md). Source identity is `(project ID, requirement ID)`; only title is sent to AI, created time is source metadata, and owner is used only for mapping. No unverified custom fields enter AI or Base.
- Module dictionary starts empty and is maintained through the versioned dictionary screen/API. Until the user supplies the product taxonomy, the analyzer returns `其他` or `待分类`; `待分类` remains in Web/DB and is omitted from Base single-select. The POC Base has four module options (`需求澄清`、`方案设计`、`缺陷修复`、`其他`); add new entries to both the Base field and `BASE_FIELDS_JSON.selectOptions.module` before publishing them.
- Priority stays blank until a validated U/M/S/C scoring rule is published. Current POC Base priority options are P0/P1/P2; do not publish any rule that may emit P3 until Base is updated.
- Monday 09:00 `Asia/Shanghai` is the chosen sync schedule. Persisted due jobs, bounded queue draining, and a Miaoda recovery automation are implemented locally. The target recovery trigger is not yet configured or verified.
- Test notification recipient is the user only. Never sync actual Teambition rows or notify stakeholders for this acceptance pass.

## Local implementation

| Area | Current evidence | Boundary |
|---|---|---|
| Login/access | Root API and Miaoda adapter require a trusted signed-in actor; tests cover 401, any logged-in user, and ignoring forged identity headers. | Must verify after the new app release. |
| Teambition | Read-only project lookup found 311 requirements with unique nonempty IDs; fixed project name resolves to the selected project. The skill's `getProjectTasks` wrapper returns one array and exposes no pagination controls. | Target response count and UI total differ (311 vs 314); the intended row set and gateway truncation behavior are unresolved. Synthetic acceptance must not fetch real rows. |
| AI and mapping | Analysis output is versioned; PII/user identifiers are excluded; U/M/S/C suggestions carry reasons/evidence; empty module dictionary is supported. | Target model call remains pending. |
| Base | Field serialization, idempotent upsert, owner mapping, substantive-change snapshot/PM reset, queue retry, and safe select/date serialization have local regression coverage. | POC Base direct transport smoke is not app-mediated acceptance. |
| Notification/schedule | POC Base has enabled owner-change workflow `POC-执行人变更通知`; durable queue recovery is wired to a Miaoda automation handler. Terminal failed/cancelled jobs are reopened by a repeated recovery poll. | Only owner-assignment notification is proven in the Base workflow; initial push, substantive update, empty-owner assignment, and TB owner-change events remain unverified. No target recovery trigger has been run. |
| Web | Source, batch, requirement, owner-mapping, dictionary/rule and audit workbench are wired to APIs; requirement detail shows U/M/S/C reasons/evidence. | Target release currently does not contain this working tree. |

## Target environment observations

- Current RQ-Sys Miaoda app is `app_17fqkjwyx1u`; latest finished release is `7694878567301549280` on old app commit `be2d20a`. Root GitHub `main` and nested Miaoda `sprint/default` are separate repositories. Both contain local changes that have not yet been committed/pushed/released.
- Dev and online environments list the expected integration variable names. Values were not printed. The configured Base token/table do not match the safe POC Base, so app-mediated writes must not run until dev is deliberately redirected to the POC Base.
- The safe POC Base is app token `OddqbqBeOamFjFsR5IXcJdjknmd`, table `tblxbyvbdLGVnLaO`. Its field types/options were read-only verified. Its owner-change workflow is enabled. Do not use the formal `TB需求池` table for synthetic acceptance.
- Local fixture route `POST /api/dev/fixtures/sync` is enabled only when `RQSYS_ENABLE_TEST_FIXTURES=true` and the configured Base app/table identifiers exactly match the isolated POC Base. It ignores request data and enqueues one fixed synthetic requirement. Configure it in dev only; do not point the online app at the POC Base.
- No RQ-Sys recovery trigger is currently configured. Desired trigger is a disabled 30-minute recovery poll in `Asia/Shanghai`; the user-facing weekly schedule remains Monday 09:00.

## Verification completed locally

Latest run: root API 218/218 (including the isolated local PostgreSQL integration suite), Web 21/21, typecheck and build passed; Miaoda route/adapter 38/38, lint, server/client typecheck and production build passed. Regression coverage includes safe-Base fixture gating, failed-job recovery, and version-scoped analysis retry. No target test data or notification has been written/sent in this pass.

## Remaining target acceptance steps

1. Commit and push root and Miaoda app repositories separately; run Miaoda release dry-run and obtain explicit confirmation before release.
2. After release, dry-run dev-only Base configuration (`BASE_APP_TOKEN`/`BASE_TABLE_ID` → POC Base; `RQSYS_ENABLE_TEST_FIXTURES=true`) and obtain explicit confirmation before writing app environment variables.
3. Run the fixed synthetic fixture through the signed-in app, verify sync → AI → Base upsert, confirm no real TB row was fetched, and assign only the current user to verify the POC Base notification.
4. Dry-run creation of disabled 30-minute recovery trigger; obtain explicit confirmation before creating it. Exercise recovery in dev and verify a missed weekly window can be resumed.
5. Keep the actual Monday 09:00 sync disabled until the synthetic acceptance is clean. Do not publish a product module dictionary or a priority rule until the user supplies/approves its contents.

All local completion claims are distinct from target-environment proof. Until those steps finish, the integration is “implemented locally, not verified in target environment.”
