import assert from "node:assert/strict";
import test from "node:test";
import { FeishuBasePushAdapter, type BaseClient } from "./client.js";

function fakeBase(initial?: { recordId: string; fields: Record<string, unknown> }) {
  const calls: string[] = [];
  let row = initial ?? null;
  const client: BaseClient = {
    async findByRequirementKey(key) { calls.push("find"); return row && row.fields["TB项目ID"] === key.projectId && row.fields["TB需求ID"] === key.requirementId ? row : null; },
    async create(fields) { calls.push("create"); row = { recordId: "record-new", fields: { ...fields } }; return row; },
    async update(recordId, fields) { calls.push("update"); assert.equal(recordId, row?.recordId); row = { recordId, fields: { ...row!.fields, ...fields } }; return row; },
    async readPmFields(recordId) { calls.push("snapshot"); assert.equal(recordId, row?.recordId); return { "PM状态": row!.fields["PM状态"] ?? null, "PM确认模块": row!.fields["PM确认模块"] ?? null, "PM确认优先级": row!.fields["PM确认优先级"] ?? null, "处理人": row!.fields["处理人"] ?? null, "处理时间": row!.fields["处理时间"] ?? null, "结构化备注": row!.fields["结构化备注"] ?? null }; },
  };
  return { client, calls, row: () => row };
}

test("creates/upserts on the project + requirement key, permits empty owner, and filters fields", async () => {
  const fake = fakeBase();
  const adapter = new FeishuBasePushAdapter(fake.client, { projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人", source: { title: "标题", description: "需求说明" }, ai: { module: "AI模块建议" }, pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"] });
  const result = await adapter.push({ projectId: "p", requirementId: "r", title: "Title", description: "Desc", owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1" });
  assert.equal(result.recordId, "record-new");
  assert.equal(fake.row()?.fields["执行人"], null);
  assert.equal(fake.row()?.fields["PM状态"], undefined);
  assert.equal(fake.calls.join(","), "find,create");
  await adapter.push({ projectId: "p", requirementId: "r", title: "Title", description: "Desc", owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1" });
  assert.equal(fake.calls.filter((call) => call === "create").length, 1);
});

test("snapshots before substantive update and only then resets PM status", async () => {
  const fake = fakeBase({ recordId: "existing", fields: { "TB项目ID": "p", "TB需求ID": "r", "标题": "Old", "PM状态": "已采纳", "PM确认模块": "M", "结构化备注": "Note" } });
  const snapshots: unknown[] = [];
  const adapter = new FeishuBasePushAdapter(fake.client, { projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人", source: { title: "标题", description: "需求说明" }, ai: {}, pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"] }, { savePmSnapshot: async (snapshot) => { snapshots.push(snapshot); } });
  await adapter.push({ projectId: "p", requirementId: "r", title: "New", owner: null, sourceVersion: 2, substantiveChanged: true, idempotencyKey: "p:r:v2" });
  assert.deepEqual(fake.calls, ["find", "snapshot", "update"]);
  assert.deepEqual((snapshots[0] as { pmValues: unknown }).pmValues, { "PM状态": "已采纳", "PM确认模块": "M", "PM确认优先级": null, "处理人": null, "处理时间": null, "结构化备注": "Note" });
  // 单选字段必须写字符串：真实环境 PUT 数组会被飞书以 1254062 拒绝
  assert.equal(fake.row()?.fields["PM状态"], "待处理");
  assert.equal(fake.row()?.fields["PM确认模块"], "M");
});

test("serializes Base selects and text metadata, while an unavailable module option does not block push", async () => {
  const fake = fakeBase();
  const adapter = new FeishuBasePushAdapter(fake.client, {
    projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
    source: { title: "标题" }, ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" },
    pm: [], metadata: { sourceVersion: "源版本", pushState: "推送状态", lastPushedAt: "最后推送时间" },
    selectOptions: { module: ["其他"], priority: ["P0", "P1", "P2"] },
  });
  await adapter.push({
    projectId: "p", requirementId: "r", title: "Title", owner: null, sourceVersion: 3,
    pushedAt: "2026-10-11T01:00:00.000Z", substantiveChanged: false, idempotencyKey: "p:r:v3",
    aiValues: { module: "待分类", priority: "P2", analysisVersion: 4 },
  });
  const fields = fake.row()!.fields;
  assert.equal(fields["AI优先级建议"], "P2");
  assert.equal(fields["AI分析版本"], "4");
  assert.equal(fields["AI模块建议"], undefined);
  assert.equal(fields["源版本"], "3");
  assert.equal(fields["推送状态"], "已推送");
  assert.equal(fields["最后推送时间"], Date.parse("2026-10-11T01:00:00.000Z"));
});

test("snapshot failure leaves existing Base row untouched", async () => {
  const fake = fakeBase({ recordId: "existing", fields: { "TB项目ID": "p", "TB需求ID": "r", "标题": "Old", "PM状态": "已采纳" } });
  const before = structuredClone(fake.row());
  const adapter = new FeishuBasePushAdapter(fake.client, { projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人", source: { title: "标题" }, ai: {}, pm: ["PM状态"] }, { savePmSnapshot: async () => { throw new Error("db unavailable"); } });
  await assert.rejects(() => adapter.push({ projectId: "p", requirementId: "r", title: "New", owner: null, sourceVersion: 2, substantiveChanged: true, idempotencyKey: "p:r:v2" }));
  assert.deepEqual(fake.calls, ["find", "snapshot"]);
  assert.deepEqual(fake.row(), before);
});

test("reports an out-of-options select value instead of silently dropping it", async () => {
  const fake = fakeBase();
  const adapter = new FeishuBasePushAdapter(fake.client, {
    projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
    source: { title: "标题" }, ai: { module: "AI模块建议", priority: "AI优先级建议" },
    pm: [], selectOptions: { module: ["需求澄清", "其他"], priority: ["P0", "P1", "P2"] },
  });
  // P3 是合法 schema 取值，但目标 Base 字段只有 P0–P2。
  const result = await adapter.push({
    projectId: "p", requirementId: "r", title: "Title", owner: null, sourceVersion: 1,
    substantiveChanged: false, idempotencyKey: "p:r:v1",
    aiValues: { module: "全新模块", priority: "P3" },
  });
  // 两个字段都被跳过：不伪造降级值，也不写入。
  assert.equal(fake.row()!.fields["AI优先级建议"], undefined);
  assert.equal(fake.row()!.fields["AI模块建议"], undefined);
  // 但跳过必须可见，调用方不能误以为已写入。
  assert.deepEqual(result.omittedFields, [
    { field: "AI模块建议", value: "全新模块", reason: "not_in_base_select_options" },
    { field: "AI优先级建议", value: "P3", reason: "not_in_base_select_options" },
  ]);
});

test("distinguishes the deliberate 待分类 omission from a rejected value", async () => {
  const fake = fakeBase();
  const adapter = new FeishuBasePushAdapter(fake.client, {
    projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
    source: { title: "标题" }, ai: { module: "AI模块建议" }, pm: [],
    selectOptions: { module: ["需求澄清", "其他"] },
  });
  const result = await adapter.push({
    projectId: "p", requirementId: "r", title: "Title", owner: null, sourceVersion: 1,
    substantiveChanged: false, idempotencyKey: "p:r:v1", aiValues: { module: "待分类" },
  });
  assert.deepEqual(result.omittedFields, [
    { field: "AI模块建议", value: "待分类", reason: "category_omitted_by_policy" },
  ]);
});

test("reports no omissions when every value fits the Base options", async () => {
  const fake = fakeBase();
  const adapter = new FeishuBasePushAdapter(fake.client, {
    projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
    source: { title: "标题" }, ai: { module: "AI模块建议", priority: "AI优先级建议" }, pm: [],
    selectOptions: { module: ["其他"], priority: ["P0", "P1", "P2"] },
  });
  const result = await adapter.push({
    projectId: "p", requirementId: "r", title: "Title", owner: null, sourceVersion: 1,
    substantiveChanged: false, idempotencyKey: "p:r:v1", aiValues: { module: "其他", priority: "P1" },
  });
  assert.deepEqual(result.omittedFields, []);
  assert.equal(fake.row()!.fields["AI优先级建议"], "P1");
});
