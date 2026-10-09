# Sync persistence correctness — design rationale

Date. 2026-10-09. Status. Design agreed, implementation delegated. Scope. Four confirmed defects on the manual sync path. Local work, not verified in target environment.

## Problem

`PostgresRequirementRepository.upsertRequirement(sourceConfigId, externalId, d: Record<string, unknown>)` takes an untyped bag. The adapter in `apps/api/src/server.ts:39` hand-builds that bag. A key named `url` collides with a SQL read of `d.sourceUrl`, so `source_url` is silently dropped and the build stays green. The same loose seam drops `latestBatchId` and `startedAt`. Separately, `PostgresRequirementRepository.search` binds the keyset cursor's second component as a hardcoded SQL `null`, so page 2 is always empty.

| # | Defect | Evidence |
|---|---|---|
| D1 | `source_url` never persisted | `server.ts:39` passes `url:`; `repositories.ts:40` reads `d.sourceUrl` |
| D2 | `requirements.latest_batch_id` never written | orchestrator passes `latestBatchId` (`sync/service.ts:52`); SQL column list omits the column |
| D3 | `sync_items.started_at` discarded | orchestrator measures `startedAt` (`sync/service.ts:48,54`); `SyncItemRepository.upsert` cannot accept it |
| D4 | `requirements.search` page 2 empty | `repositories.ts:43` binds `$7` as literal `null` in `(created_at,id) < ($6,$7)` |

## Acceptance criterion

Any design that leaves the silent-field-drop class possible fails, however many of the four it fixes. D1 compiled clean.

## Candidates

A (opus). Branded ID types, nested `UpsertSyncedRequirement { sourceConfigId, requirement, provenance }`, an intermediate `PersistedRequirement` record type, cursor decoded at the app boundary.

B (sonnet). Flat `RequirementSyncWrite` reusing `NormalizedTeambitionRequirement`, a named `createPostgresSyncPersistence` adapter, a dedicated `http/requirement-cursor.ts` codec, repository values types enumerated on the SQL side.

## Synthesis decision

Base is B, with one graft from A and one subtraction against both.

Taken from B. Flat reuse of `NormalizedTeambitionRequirement` rather than a parallel nested shape. A dedicated cursor codec module so the wire cursor stays opaque and the composite keyset is validated once at the HTTP boundary. Explicit repository value types on the SQL side.

Taken from A. `latestBatchId` is a required field on the write input and is written inside the same `INSERT ... ON CONFLICT` as the requirement row, never a separate link call. The conflict-update clause for `sync_items.started_at` must state its retry semantics explicitly rather than inheriting the insert default.

Subtracted against both. No branded ID types. They would ripple through `domain/persistence.ts`, `http/app.ts`, and `analysisJobHandler` to close a class of bug the typed write input already closes. `SyncPersistence` stays in `sync/service.ts`; extracting it to a new `sync/persistence.ts` buys no type safety and costs import churn across `server.ts` and `jobs/worker.ts`. No change to `search`'s source filtering. Candidate A made `sourceConfigId` a required search filter; that is a query-semantics change this fix does not need.

## Sketch

### 1. Typed write input. `apps/api/src/adapters/postgres/repositories.ts`

Replace the `Record<string, unknown>` parameter. `sourceVersion` is a `number`. `sourceUrl` is `string | null` because `mappedFields.sourceUrl` may be absent.

```ts
export interface RequirementRowWrite {
  sourceConfigId: string;
  teambitionRequirementId: string;
  title: string;
  description: string | null;
  scope: string | null;
  acceptanceCriteria: string | null;
  proposerUserId: string | null;
  proposerName: string | null;
  executorUserId: string | null;
  executorName: string | null;
  statusId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  sourceUrl: string | null;
  uniqueId: number | null;
  attachmentRefs: string[];
  customFields: unknown[];
  payload: Record<string, unknown>;
  sourceHash: string;
  substantiveHash: string;
  sourceVersion: number;
  latestBatchId: string;
}
```

`upsertRequirement(sourceConfigId: string, externalId: string, d: RequirementRowWrite)` keeps its positional identity pair. The INSERT and the `DO UPDATE` list both carry `source_url` and `latest_batch_id`.

### 2. Named adapter. `apps/api/src/adapters/postgres/sync-persistence.ts` (new)

```ts
import type { SyncPersistence, SyncInput } from "../../sync/service.js";
import type { PostgresRepositories } from "./repositories.js";

// The only mapping from NormalizedTeambitionRequirement to RequirementRowWrite.
// Every field is a required property on both sides, so a renamed key fails the build.
export function createPostgresSyncPersistence(
  repositories: PostgresRepositories,
  sourceConfigId: string,
): SyncPersistence {
  throw new Error("not implemented");
}
```

`server.ts` stops hand-building the bag and calls this instead. The single-page `SyncSourceReader` bridge stays inline; it is one line and hides no policy.

### 3. Widen the item write. `SyncItemRepository.upsert` plus SQL

Add `startedAt: string` to the parameter. INSERT lists `started_at`. The `ON CONFLICT (batch_id, teambition_requirement_id) DO UPDATE` sets `started_at = EXCLUDED.started_at`, so a retried item records its most recent attempt's measured start. The orchestrator's `startedAt` is the fact. The column default remains only for out-of-band inserts.

### 4. Fix the keyset cursor

New `apps/api/src/http/requirement-cursor.ts`. `encodeRequirementCursor({ createdAt, id })` and `decodeRequirementCursor(value: string | undefined)` return `RequirementSearchCursor | undefined`. Decode validates both parts and returns `undefined` on a malformed value.

`RequirementQueryRepository.search` takes `cursor?: RequirementSearchCursor` instead of a raw string. `http/app.ts` decodes at the boundary before calling. `PostgresRequirementRepository.search` binds two parameters and appends the predicate only when a cursor exists.

```sql
AND (created_at, id) < ($n::timestamptz, $m::uuid)
ORDER BY created_at DESC, id DESC
```

`requirements.id` is `uuid` in `0001_initial.sql`, so the cast is `::uuid`, not the current `::text`. Query shape without a cursor is unchanged, so the nullable-parameter form is not needed.

## Constraints held

Identity stays unimplemented. No migration: `latest_batch_id` and `started_at` already exist in `0001_initial.sql`, which is applied and must not be rewritten. `jobs/worker.ts` dispatch payload unchanged. Pull, analysis, owner, push states stay independent. `PostgresRepositories` consumers in `http/app.ts` and `analysisJobHandler` keep compiling.

## Red-flag screen

Shallow module. Rejected shape. The adapter hides the domain-to-storage field mapping behind two methods. The bag shape it replaces was the shallow module.

Information leakage. Closed. SQL column names stop at `repositories.ts`. `server.ts` no longer knows that `source_url` exists.

Split ownership. Closed. One mapping site for requirement writes. The alternative of a separate `linkRequirementToBatch` was rejected by both candidates because two writes for one fact can half-succeed.

Two ways to do one task. The bag and the typed write coexisted during the change. The bag is deleted in the same change, not left as an overload.

Pass-through method. The adapter is not a pass-through. It owns the field mapping and the provenance fold.

## Open items for implementation

Confirm the `sync_items` unique constraint in `0001_initial.sql` matches the intended `ON CONFLICT` target before writing the clause. If it does not, that is the one case where an additive migration is warranted.
