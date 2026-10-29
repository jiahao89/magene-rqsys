import test from "node:test";
import assert from "node:assert/strict";
import { effectiveProcessingState, isProcessingSuppressed } from "./requirement-resolution.js";

test("suspected resolutions never suppress processing", () => {
  assert.equal(effectiveProcessingState({ decision: "duplicate", reviewState: "suspected" }), "active");
  assert.equal(isProcessingSuppressed("active"), false);
});

test("confirmed duplicate/ignored suppress; confirmed_unique stays active", () => {
  assert.equal(effectiveProcessingState({ decision: "duplicate", reviewState: "confirmed" }), "suppressed_duplicate");
  assert.equal(effectiveProcessingState({ decision: "ignored", reviewState: "confirmed" }), "suppressed_ignored");
  assert.equal(effectiveProcessingState({ decision: "confirmed_unique", reviewState: "confirmed" }), "active");
  assert.equal(effectiveProcessingState(null), "active");
  assert.equal(isProcessingSuppressed("suppressed_duplicate"), true);
});
