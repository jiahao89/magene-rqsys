import assert from "node:assert/strict";
import test from "node:test";
import { assertFixtureWorkAllowed, canEnableTestFixtures, createSyntheticFixtureTask, isSyntheticFixtureRequirement, readScheduledFixtureSource } from "./test-fixture.js";

const NOW = new Date("2026-10-15T02:00:00Z");
const SOURCE = "11111111-2222-4333-8444-555555555555";
const safe = {
  RQSYS_ENABLE_TEST_FIXTURES: "true",
  BASE_APP_TOKEN: "OddqbqBeOamFjFsR5IXcJdjknmd",
  BASE_TABLE_ID: "tblxbyvbdLGVnLaO",
};
const mode = { ...safe, RQSYS_SCHEDULE_FIXTURE: JSON.stringify({ sourceId: SOURCE, expiresAt: "2026-10-15T03:00:00Z" }) };

test("scheduled fixture mode is off by default and accepts only an explicit short-lived POC source", () => {
  assert.equal(readScheduledFixtureSource({}, NOW), undefined);
  assert.equal(readScheduledFixtureSource(mode, NOW), SOURCE);
  assert.equal(canEnableTestFixtures(safe), true);
});

test("invalid or expired fixture configuration never falls back to real synchronization", () => {
  for (const value of [" ", "{", "null", "[]", JSON.stringify({ sourceId: SOURCE }),
    JSON.stringify({ sourceId: "not-a-uuid", expiresAt: "2026-10-15T03:00:00Z" }),
    JSON.stringify({ sourceId: SOURCE, expiresAt: "2026-10-15T02:00:00Z" }),
    JSON.stringify({ sourceId: SOURCE, expiresAt: "2026-10-15T04:00:01Z" }),
    JSON.stringify({ sourceId: SOURCE, expiresAt: "2026-10-15T03:00:00" }),
    JSON.stringify({ sourceId: SOURCE, expiresAt: "2026-10-15T03:00:00Z", title: "caller input" }),
  ]) assert.throws(() => readScheduledFixtureSource({ ...safe, RQSYS_SCHEDULE_FIXTURE: value }, NOW));
  assert.throws(() => readScheduledFixtureSource({ ...mode, BASE_TABLE_ID: "formal-table" }, NOW));
  assert.throws(() => readScheduledFixtureSource({ ...mode, BASE_APP_TOKEN: "formal-base" }, NOW));
  assert.throws(() => readScheduledFixtureSource({ ...mode, RQSYS_ENABLE_TEST_FIXTURES: "false" }, NOW));
});

test("all stages reject real or other-source work while fixture mode is active", () => {
  assert.doesNotThrow(() => assertFixtureWorkAllowed({ sourceId: SOURCE, fixture: true }, mode, NOW));
  assert.throws(() => assertFixtureWorkAllowed({ sourceId: SOURCE, fixture: false }, mode, NOW));
  assert.throws(() => assertFixtureWorkAllowed({ sourceId: "another-source", fixture: true }, mode, NOW));
  assert.throws(() => assertFixtureWorkAllowed({ sourceId: SOURCE, fixture: true }, mode, new Date("2026-10-15T03:00:00Z")));
});

test("delayed fixture analysis or push cannot run after restoring a formal Base", () => {
  const fixture = { sourceId: SOURCE, fixture: true };
  assert.doesNotThrow(() => assertFixtureWorkAllowed(fixture, safe, NOW));
  assert.throws(() => assertFixtureWorkAllowed(fixture, { ...safe, BASE_TABLE_ID: "formal-table" }, NOW));
  assert.throws(() => assertFixtureWorkAllowed(fixture, { ...safe, RQSYS_ENABLE_TEST_FIXTURES: "false" }, NOW));
  assert.doesNotThrow(() => assertFixtureWorkAllowed({ sourceId: SOURCE, fixture: false }, {}, NOW));
});

test("fixed source identity survives retry and has no owner or proposer", () => {
  const task = createSyntheticFixtureTask("batch-1", "type-1");
  assert.deepEqual(task, createSyntheticFixtureTask("batch-1", "type-1"));
  assert.equal(task.executor_id, null);
  assert.equal(task.creator_id, null);
  assert.equal(task.created, "2026-01-01T00:00:00.000Z");
  assert.equal(isSyntheticFixtureRequirement(task.id), true);
  assert.equal(isSyntheticFixtureRequirement("6960a3187384fa11aa07d7e6"), false);
});
