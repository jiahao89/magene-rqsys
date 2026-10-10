import assert from "node:assert/strict";
import test from "node:test";
import { decodeBatchCursor, encodeBatchCursor } from "./batch-cursor.js";

test("batch cursor preserves both startedAt and id for stable pagination", () => {
  const cursor = { startedAt: "2026-01-02T00:00:00.000Z", id: "33333333-3333-4333-8333-333333333333" };
  assert.deepEqual(decodeBatchCursor(encodeBatchCursor(cursor)), cursor);
});

test("malformed batch cursor is ignored safely", () => {
  assert.equal(decodeBatchCursor("not-a-cursor"), undefined);
  assert.equal(decodeBatchCursor(Buffer.from(JSON.stringify({ startedAt: "2026-01-01", id: "x" })).toString("base64url")), undefined);
});
