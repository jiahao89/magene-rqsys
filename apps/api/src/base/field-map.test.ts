import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BASE_FIELDS, DEFAULT_GROUP_BASE_FIELDS, parseBaseFields } from "./field-map.js";

test("product pool keeps the historical TB链接 → TB地址 rewrite", () => {
  assert.equal(DEFAULT_BASE_FIELDS.source.sourceUrl, "TB地址");
  const parsed = parseBaseFields(JSON.stringify({ source: { sourceUrl: "TB链接" } }));
  assert.equal(parsed.source.sourceUrl, "TB地址", "产品表列名是 TB地址；历史配置写 TB链接 时必须改写");
});

test("group pool maps the source link to TB链接 and never rewrites it", () => {
  // 集团 PM 表复制自产品表，但链接列实际叫「TB链接」。
  assert.equal(DEFAULT_GROUP_BASE_FIELDS.source.sourceUrl, "TB链接");
  assert.equal(parseBaseFields(undefined, { pool: "group" }).source.sourceUrl, "TB链接");
  assert.equal(parseBaseFields("{}", { pool: "group" }).source.sourceUrl, "TB链接");
  assert.equal(
    parseBaseFields(JSON.stringify({ source: { sourceUrl: "TB链接" } }), { pool: "group" }).source.sourceUrl,
    "TB链接",
    "集团池不得套用产品池的兼容改写，否则会写不存在的字段",
  );
  // 显式配置优先：确实叫 TB地址 时按配置写。
  assert.equal(
    parseBaseFields(JSON.stringify({ source: { sourceUrl: "TB地址" } }), { pool: "group" }).source.sourceUrl,
    "TB地址",
  );
  assert.equal(parseBaseFields(undefined, { pool: "group" }).owner, "执行人");
  assert.equal(parseBaseFields(undefined, { pool: "group" }).notification?.eventId, "系统通知事件ID");
});

test("base field parsing keeps selectOptions, priority order and sourceMethod", () => {
  const parsed = parseBaseFields(JSON.stringify({
    selectOptions: { module: ["甲", "乙"], priority: ["P3"] },
    sourceMethod: " 来源方式 ",
  }));
  assert.deepEqual(parsed.selectOptions?.module, ["甲", "乙"]);
  assert.deepEqual(parsed.selectOptions?.priority, ["P0", "P1", "P2", "P3"]);
  assert.equal(parsed.sourceMethod, "来源方式");
  // 非法 JSON 回落到默认，不影响推送（历史上 parse 失败会静默用默认值）。
  assert.equal(parseBaseFields("{not json").owner, "执行人");
});

test("parseBaseFields parses opt-in duplicate marker mapping when configured and omits it by default", () => {
  assert.equal(parseBaseFields(undefined).duplicate, undefined);
  assert.equal(parseBaseFields("{}").duplicate, undefined);
  assert.equal(parseBaseFields(JSON.stringify({ duplicate: { mark: "   " } })).duplicate, undefined);
  assert.equal(parseBaseFields(JSON.stringify({ duplicate: "invalid" })).duplicate, undefined);
  assert.deepEqual(
    parseBaseFields(JSON.stringify({ duplicate: { mark: " 重复标记 " } })).duplicate,
    { mark: "重复标记" },
  );
  assert.deepEqual(
    parseBaseFields(JSON.stringify({ duplicate: { mark: " 重复标记 ", canonicalLink: " 主记录链接 " } })).duplicate,
    { mark: "重复标记", canonicalLink: "主记录链接" },
  );
});
