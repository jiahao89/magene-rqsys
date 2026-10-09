import test from "node:test";
import assert from "node:assert/strict";
import { stableHash, substantiveHash } from "./hashes.js";

test("stableHash is independent of object key insertion order", () => {
  assert.equal(stableHash({ a: 1, b: { x: 2, y: 3 } }), stableHash({ b: { y: 3, x: 2 }, a: 1 }));
});

test("substantiveHash changes only for substantive text and attachment references", () => {
  const base = { title: "T", description: "D", scope: "S", acceptanceCriteria: "A", attachmentRefs: ["f1"], ownerId: "u1", statusId: "open", updatedAt: "t1" };
  assert.equal(substantiveHash(base), substantiveHash({ ...base, ownerId: "u2", statusId: "closed", updatedAt: "t2" }));
  assert.notEqual(substantiveHash(base), substantiveHash({ ...base, title: "T2" }));
  assert.notEqual(substantiveHash(base), substantiveHash({ ...base, attachmentRefs: ["f2"] }));
});
