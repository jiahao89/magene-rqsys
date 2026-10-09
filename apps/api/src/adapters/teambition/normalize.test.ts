import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTeambitionTask } from "./normalize.js";
import type { TeambitionTaskRecord } from "./raw-types.js";

const FIELD_ID = "custom-description";
function task(customFields: TeambitionTaskRecord["custom_fields"]): TeambitionTaskRecord {
  return { id: "stable-task-id", content: "Need", ...(customFields === undefined ? {} : { custom_fields: customFields }) };
}

test("duplicate allowlisted custom field IDs use the last returned value deterministically", () => {
  const raw = [
    { _customfieldid: FIELD_ID, type: "rtf", value: [{ meta: { html: "old" } }] },
    { _customfieldid: FIELD_ID, type: "rtf", value: [{ meta: { html: "new" } }] },
  ];
  const normalized = normalizeTeambitionTask("project-1", task(raw), { description: FIELD_ID });
  assert.deepEqual(normalized.mappedFields.description, raw[1]!.value);
  assert.deepEqual(normalized.sourcePayload.custom_fields, [{
    id: FIELD_ID,
    type: "rtf",
    value: raw[1]!.value,
    values: null,
  }]);
});

test("custom-field allowlist excludes unrelated and duplicate unknown IDs", () => {
  const normalized = normalizeTeambitionTask("project-1", task([
    { _customfieldid: FIELD_ID, value: "approved" },
    { _customfieldid: "unmapped", value: "private/unapproved" },
    { _customfieldid: "unmapped", value: "private/unapproved-again" },
  ]), { description: FIELD_ID });
  assert.deepEqual(normalized.sourcePayload.custom_fields, [{ id: FIELD_ID, type: null, value: "approved", values: null }]);
  assert.deepEqual(Object.keys(normalized.mappedFields), ["description"]);
});

test("malformed serialized custom fields fail closed to an empty projection", () => {
  const normalized = normalizeTeambitionTask("project-1", task("not-json"), { description: FIELD_ID });
  assert.deepEqual(normalized.mappedFields, {});
  assert.deepEqual(normalized.sourcePayload.custom_fields, []);
});
