import assert from "node:assert/strict";
import test from "node:test";
import { resolveOwnerMapping, type OwnerMapping } from "./mapping.js";

const maps: OwnerMapping[] = [
  { teambitionUserId: "tb-1", displayName: "Ada Chen", feishuUserId: "fs-1", active: true, manuallySelected: false },
  { teambitionUserId: null, displayName: " ADA   CHEN ", feishuUserId: "fs-2", active: true, manuallySelected: false },
  { teambitionUserId: null, displayName: "Lin", feishuUserId: "fs-3", active: true, manuallySelected: false },
  { teambitionUserId: null, displayName: "Lin", feishuUserId: "fs-4", active: true, manuallySelected: false },
  { teambitionUserId: "tb-manual", displayName: "Manual Name", feishuUserId: "fs-manual", active: true, manuallySelected: true },
  { teambitionUserId: "tb-disabled", displayName: "Disabled", feishuUserId: "fs-disabled", active: false, manuallySelected: false },
];

test("resolves by TB ID before a colliding normalized name", () => {
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: "tb-1", displayName: "Ada Chen" }, maps), {
    state: "auto_mapped", feishuUserId: "fs-1", matchMethod: "tb_user_id",
  });
});

test("uses exactly one active normalized-name match when ID is absent", () => {
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: null, displayName: " ada chen " }, maps.filter((mapping) => mapping.teambitionUserId === null)), {
    state: "auto_mapped", feishuUserId: "fs-2", matchMethod: "unique_name",
  });
});

test("classifies duplicate normalized names as ambiguous", () => {
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: null, displayName: "LIN" }, maps), {
    state: "pending_mapping", reason: "ambiguous",
  });
});

test("classifies unmatched or inactive ID as unmatched without falling back to name", () => {
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: "unknown", displayName: "Ada Chen" }, maps), {
    state: "pending_mapping", reason: "unmatched",
  });
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: "tb-disabled", displayName: "Disabled" }, maps), {
    state: "pending_mapping", reason: "unmatched",
  });
});

test("permits no owner and does not return an owner mapping", () => {
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: null, displayName: null }, maps), {
    state: "not_required", feishuUserId: null,
  });
});

test("preserves manual mappings when automatic resolution is empty or unresolved", () => {
  const manual = maps.find((mapping) => mapping.manuallySelected)!;
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: null, displayName: null }, maps, manual), {
    state: "manually_mapped", feishuUserId: "fs-manual", matchMethod: "manual",
  });
  assert.deepEqual(resolveOwnerMapping({ teambitionUserId: "unknown", displayName: "Nobody" }, maps, manual), {
    state: "manually_mapped", feishuUserId: "fs-manual", matchMethod: "manual",
  });
});
