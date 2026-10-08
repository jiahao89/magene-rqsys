# Spec 04 — Web Sync Workbench

Status: [ready-for-agent] for the screens and operations defined by the MVP PRD. Existing mock-only routes are not proof of completed behavior.

## Problem and outcome

Operators need one place to configure and run synchronization, see each pipeline stage independently, resolve owners, and recover failures. The Web workbench is not the PM decision authority in this MVP.

## User stories

1. As an administrator, I want to view and maintain the selected project, weekly plan, and owner-name list, so that the pipeline has a known scope.
2. As an authorized operator, I want to start a manual run and see its batch progress, so that I can act without waiting for the schedule.
3. As a PM Leader, I want to find a requirement by title, batch, or state, so that I can quickly locate a failure or unmapped owner.
4. As an operator, I want to inspect source facts, the latest AI result, owner state, push state, and errors together, so that I can decide the next operation.
5. As an operator, I want to map an unresolved owner and retry an eligible failure, so that work can continue without duplicate records.
6. As an administrator, I want an audit view, so that configuration changes and manual actions are attributable.

## Pages and behavior

| Page | MVP behavior |
|---|---|
| Dashboard | Show configured source, last/next sync, scheduler health, latest batch and counts for pull, AI, owner matching, push, and failures |
| Source settings | Configure one dedicated project, weekly schedule, owner-name list, and connection self-check; show credentials as valid/invalid only |
| Requirement pool | Filter by title, batch, time, pull/AI/owner/push state; show independent stage states |
| Batch list/detail | Show actor, trigger, times, counts, item actions, errors, and eligible retry controls |
| Requirement detail | Show immutable source snapshot/version, latest AI suggestion/evidence, owner mapping, Base record link, and all pipeline states |
| Owner mapping | Select Feishu user for unresolved/duplicate name; save reusable mapping and trigger push |
| Dictionary/rule settings | Manage only versioned module dictionary and priority rules explicitly in the PRD; priority remains blank until a rule is published |
| Audit | Search sync, analysis, mapping, push, retry, and configuration actions by actor/time/object |

PM processing fields and notification delivery are not displayed as if Web had read them. If a Base link is available, open the Base record for PM work.

The removed local UI prototype had Dashboard, Pool, Sources, Preview, Batches, BatchDetail, RequirementDetail, Rules, and Audit routes. These are not evidence of implemented product behavior. Do not build a Preview/approval gate unless separately approved; implement the required routes in the actual GitHub repository after it is available in the workspace.

## Roles and permissions

| Operation | Administrator | PM Leader | Designated operator | Other PM |
|---|---|---|---|---|
| Configure project/schedule/owner names | Write | Read | No | No |
| Manual sync / batch review / retry | Yes | Yes | Yes | No |
| Read requirement details | Yes | Yes | Yes | Authorized read-only |
| Manual owner mapping and push | Yes | Yes | Yes | No |
| Maintain module dictionary / publish priority rules | Per PRD | Yes | Participate in calibration only | No |
| Edit PM processing state | No Web editor | No Web editor | No Web editor | In Base, per Base access |

Authorization must be enforced by the server/API, not only by hiding controls.

## API contract

- GET /api/sources
- PUT /api/sources/{id}
- POST /api/sync/run
- GET /api/batches
- GET /api/batches/{id}
- POST /api/items/{id}/retry
- GET /api/requirements/{id}
- PUT /api/requirements/{id}/owner
- POST /api/analysis/{id}/retry
- GET /api/audit

All write responses return the resulting workflow state and a stable object identifier. Long-running sync returns a batch ID; the UI polls or subscribes to batch progress. Do not report PM state or notification delivery unless the system has an approved read path.

## Acceptance criteria

1. Given a user lacks the required role, when they call a protected write API directly, then the server rejects the operation.
2. Given a manual run is accepted, then the UI shows a batch ID and stage counts that reflect persisted API state rather than local mock counters.
3. Given an item has AI failure but push succeeded, then the UI shows AI failure and push success independently.
4. Given an owner is unresolved, then the UI offers mapping and does not claim the requirement is pushed.
5. Given a retry succeeds, then the UI refreshes the same requirement/batch association and does not create a duplicate.
6. Given no schedule or credentials are configured, then the page gives a safe, actionable configuration error without exposing secrets.
7. Given the API is unavailable, then the UI shows a recoverable error and does not claim a workflow transition occurred.

## Design and accessibility

Follow the project design reference at ../../design.md for semantic tokens, light/dark themes, keyboard operation, focus-visible states, loading/empty/error states, and accessible status labels. Resolve the component-library mismatch recorded in OPEN-DECISIONS.md before building production UI components.

## Verification strategy

Verify each required route through a running frontend connected to the API in a target-like environment. Cover role-denied, empty, loading, partial-failure, retry, owner-mapping, and successful-run states. Any future mock screen is layout-only and cannot satisfy integration acceptance.
