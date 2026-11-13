import assert from "node:assert/strict";
import test from "node:test";
import { FeishuApiError } from "./transport.js";
import { markDuplicateInBase } from "./duplicate-marker.js";
import type { BaseFieldMap } from "./client.js";

const fields = {
  requirementId: "TB需求ID",
  owner: "执行人",
  source: {},
  ai: {},
  pm: [],
  duplicate: { mark: "RQ重复标记", canonicalLink: "RQ主记录链接" },
} as unknown as BaseFieldMap;

function harness() {
  const updates: Array<{ recordId: string; payload: Record<string, unknown> }> = [];
  let error: Error | null = null;
  const base = {
    async update(recordId: string, payload: Record<string, unknown>) {
      if (error) throw error;
      updates.push({ recordId, payload });
      return { recordId, fields: {} };
    },
  } as never;
  return { updates, base, setError: (next: Error | null) => { error = next; } };
}

test("writes the duplicate mark and canonical link without touching other fields", async () => {
  const h = harness();
  const result = await markDuplicateInBase({ base: h.base, fields, webBaseUrl: "https://work.example/app" }, {
    recordId: "rec-1", decision: "duplicate", canonicalRequirementId: "req-canonical", canonicalPlatformRequirementId: "RQ-000001",
  });
  assert.deepEqual(result, { outcome: "marked" });
  assert.deepEqual(h.updates[0]!.payload, {
    "RQ重复标记": "重复（主记录 RQ-000001）",
    "RQ主记录链接": "https://work.example/app?requirement=req-canonical",
  });
});

test("clears both fields when the decision is revoked or confirmed unique", async () => {
  const h = harness();
  assert.deepEqual(await markDuplicateInBase({ base: h.base, fields }, { recordId: "rec-1", decision: null }), { outcome: "cleared" });
  assert.deepEqual(h.updates[0]!.payload, { "RQ重复标记": "", "RQ主记录链接": "" });
  assert.deepEqual(await markDuplicateInBase({ base: h.base, fields }, { recordId: "rec-1", decision: "ignored" }), { outcome: "marked" });
  assert.equal(h.updates[1]!.payload["RQ重复标记"], "已忽略");
  assert.equal(h.updates[1]!.payload["RQ主记录链接"], "");
});

test("skips when the mapping is absent or the requirement was never pushed", async () => {
  const h = harness();
  const { duplicate: _unused, ...withoutDuplicate } = fields as unknown as { duplicate?: unknown } & BaseFieldMap;
  assert.deepEqual(await markDuplicateInBase({ base: h.base, fields: withoutDuplicate as BaseFieldMap }, { recordId: "rec-1", decision: "duplicate" }), { outcome: "skipped" });
  assert.deepEqual(await markDuplicateInBase({ base: h.base, fields }, { recordId: null, decision: "duplicate" }), { outcome: "skipped" });
  assert.equal(h.updates.length, 0);
});

test("reports a missing Base field and other failures without throwing", async () => {
  const h = harness();
  h.setError(new FeishuApiError("http", "record update", 400, 1254045));
  assert.deepEqual(await markDuplicateInBase({ base: h.base, fields }, { recordId: "rec-1", decision: "duplicate" }), { outcome: "field_missing" });
  h.setError(new FeishuApiError("http", "record update", 503));
  assert.deepEqual(await markDuplicateInBase({ base: h.base, fields }, { recordId: "rec-1", decision: "duplicate" }), { outcome: "failed", errorCode: "FEISHU_RECORD_UPDATE" });
  h.setError(new Error("network down"));
  assert.deepEqual(await markDuplicateInBase({ base: h.base, fields }, { recordId: "rec-1", decision: "duplicate" }), { outcome: "failed", errorCode: "BASE_DUPLICATE_MARK_FAILED" });
});
