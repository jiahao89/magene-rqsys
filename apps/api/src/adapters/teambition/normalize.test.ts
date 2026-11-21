import assert from "node:assert/strict";
import test from "node:test";
import { GROUP_POOL_DEFAULT_FIELD_MAP, normalizeTeambitionTask, resolveFieldMap } from "./normalize.js";
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
  assert.equal(normalized.mappedFields.description, "new");
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

test("rtf fields become readable text and lookup fields retain proposer identity separately", () => {
  const normalized = normalizeTeambitionTask("project-1", task([
    { _customfieldid: "description", type: "rtf", value: [{ meta: { html: "<p>第一段</p><p>第二段 &amp; 结果</p>" } }] },
    { _customfieldid: "proposer", type: "lookup", value: [{ _id: "record-id", title: "张三", meta: { userid: "tb-user-1" } }] },
  ]), { description: "description", proposerName: "proposer" });
  assert.equal(normalized.mappedFields.description, "第一段\n第二段 & 结果");
  assert.equal(normalized.mappedFields.proposerName, "张三");
  assert.equal(normalized.mappedFields.proposerUserId, "tb-user-1");
  assert.equal(JSON.stringify(normalized.mappedFields).includes("record-id"), false);
});

// 0031：集团池来源配置没有 field_map 时，同步用 P0 核对的三字段默认映射。
test("group pool falls back to the approved three-field map and normalizes description, proposer and product model", () => {
  const fieldMap = resolveFieldMap("group", {});
  assert.deepEqual(fieldMap, {
    description: "674e7c2ceed2e651764a0d6f",
    proposerName: "68be4f5f4f5b7255e6fda8d6",
    productModel: "6755a2581f580fe19bfaf70f",
  });
  // 返回值是可改副本，避免调用方改到共享常量。
  (fieldMap as Record<string, string>).description = "mutated";
  assert.equal(GROUP_POOL_DEFAULT_FIELD_MAP.description, "674e7c2ceed2e651764a0d6f");

  const normalized = normalizeTeambitionTask("project-group", task([
    { _customfieldid: "674e7c2ceed2e651764a0d6f", type: "rtf", value: [{ meta: { html: "<p>集团需求描述</p>" } }] },
    { _customfieldid: "68be4f5f4f5b7255e6fda8d6", type: "lookup", value: [{ _id: "record-1", title: "刘媛媛", meta: { userid: "tb-user-1" } }] },
    { _customfieldid: "6755a2581f580fe19bfaf70f", value: "MG-100" },
  ]), resolveFieldMap("group", {}));
  assert.equal(normalized.mappedFields.description, "集团需求描述");
  assert.equal(normalized.mappedFields.proposerName, "刘媛媛");
  assert.equal(normalized.mappedFields.proposerUserId, "tb-user-1");
  assert.equal(normalized.mappedFields.productModel, "MG-100");
  // 未映射的原始字段仍留在 source_payload，便于溯源（类型/模块/约束保持 null 不猜）。
  const payloadFields = normalized.sourcePayload.custom_fields as Array<{ id: string }>;
  assert.deepEqual(payloadFields.map((field) => field.id).sort(), [
    "674e7c2ceed2e651764a0d6f",
    "6755a2581f580fe19bfaf70f",
    "68be4f5f4f5b7255e6fda8d6",
  ]);
});

test("product pool keeps an empty map and an explicitly configured group map wins over the default", () => {
  assert.deepEqual(resolveFieldMap("product", {}), {});
  assert.deepEqual(resolveFieldMap(undefined, {}), {});
  assert.deepEqual(resolveFieldMap("group", { description: "custom-description-field" }), { description: "custom-description-field" });
  const normalized = normalizeTeambitionTask("project-1", task([
    { _customfieldid: "674e7c2ceed2e651764a0d6f", value: "product-pool-has-no-map" },
  ]), resolveFieldMap("product", {}));
  assert.deepEqual(normalized.mappedFields, {});
});

// 0031：TB text/select 字段的值是对象数组（[{title}] / [{name}]），必须取可读文本才会落库。
test("non-rtf text and select values are normalized to readable text", () => {
  const normalized = normalizeTeambitionTask("project-group", task([
    { _customfieldid: "product-model", value: [{ title: "MageneC706" }] },
    { _customfieldid: "select-type", value: [{ name: "P1" }] },
    { _customfieldid: "plain-url", value: "  https://teambition.example/task/1  " },
    { _customfieldid: "multi", value: [{ title: "A" }, { name: "B" }] },
    { _customfieldid: "unrecognized", value: 42 },
  ]), { productModel: "product-model", requirementType: "select-type", sourceUrl: "plain-url", scope: "multi", acceptanceCriteria: "unrecognized" });
  assert.equal(normalized.mappedFields.productModel, "MageneC706");
  assert.equal(normalized.mappedFields.requirementType, "P1");
  assert.equal(normalized.mappedFields.sourceUrl, "https://teambition.example/task/1");
  assert.equal(normalized.mappedFields.scope, "A、B");
  assert.equal(normalized.mappedFields.acceptanceCriteria, null);
});

test("rtf, user and array-shaped fields keep their previous projections", () => {
  const normalized = normalizeTeambitionTask("project-1", task([
    { _customfieldid: "description", type: "rtf", value: [{ meta: { html: "<p>正文</p>" } }] },
    { _customfieldid: "proposer", type: "lookup", value: [{ _id: "record-1", title: "张三", meta: { userid: "tb-user-1" } }] },
    { _customfieldid: "attachments", value: [{ title: "a.pdf" }] },
    { _customfieldid: "customs", value: [{ title: "raw" }] },
  ]), { description: "description", proposerName: "proposer", attachmentRefs: "attachments", customFields: "customs" });
  assert.equal(normalized.mappedFields.description, "正文");
  assert.equal(normalized.mappedFields.proposerName, "张三");
  assert.equal(normalized.mappedFields.proposerUserId, "tb-user-1");
  // 附件引用与自定义字段保持数组，不参与文本归一化（下游按数组消费）。
  assert.deepEqual(normalized.mappedFields.attachmentRefs, [{ title: "a.pdf" }]);
  assert.deepEqual(normalized.mappedFields.customFields, [{ title: "raw" }]);
});
