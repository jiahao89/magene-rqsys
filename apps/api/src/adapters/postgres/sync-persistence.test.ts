import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresSyncPersistence } from "./sync-persistence.js";
import type { PostgresRepositories } from "./repositories.js";

test("sync terminal state is accompanied by an actor-attributed audit event", async () => {
  let audit: Record<string, unknown> | undefined;
  const repositories = {
    batches: {
      complete: async (_id: string, result: { status: string; completedAt: string }) => ({
        id: "batch-1", sourceConfigId: "source-1", triggerType: "scheduled", actorId: "actor-1",
        idempotencyKey: "weekly-1", status: result.status, startedAt: result.completedAt,
        completedAt: result.completedAt, totalCount: 2, succeededCount: 1, failedCount: 1,
        errorSummary: null, createdAt: result.completedAt,
      }),
    },
    audit: { append: async (event: Record<string, unknown>) => { audit = event; } },
  } as unknown as PostgresRepositories;

  const persistence = createPostgresSyncPersistence(repositories, "source-1");
  await persistence.completeBatch("batch-1", {
    status: "partial_failure", totalCount: 2, succeededCount: 1, failedCount: 1,
    errorSummary: "1 item failed", completedAt: "2026-10-10T00:00:00.000Z",
  });

  assert.deepEqual(audit, {
    id: (audit as { id: string }).id,
    actorId: "actor-1", eventType: "sync.completed", entityType: "sync_batch", entityId: "batch-1",
    result: "failed", safeDetails: { trigger: "scheduled", reason: "partial_failure" },
    occurredAt: "2026-10-10T00:00:00.000Z",
  });
});
