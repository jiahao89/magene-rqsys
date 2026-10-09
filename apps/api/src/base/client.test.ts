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
  assert.equal(fake.row()?.fields["PM状态"], "待处理");
  assert.equal(fake.row()?.fields["PM确认模块"], "M");
});

test("snapshot failure leaves existing Base row untouched", async () => {
  const fake = fakeBase({ recordId: "existing", fields: { "TB项目ID": "p", "TB需求ID": "r", "标题": "Old", "PM状态": "已采纳" } });
  const before = structuredClone(fake.row());
  const adapter = new FeishuBasePushAdapter(fake.client, { projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人", source: { title: "标题" }, ai: {}, pm: ["PM状态"] }, { savePmSnapshot: async () => { throw new Error("db unavailable"); } });
  await assert.rejects(() => adapter.push({ projectId: "p", requirementId: "r", title: "New", owner: null, sourceVersion: 2, substantiveChanged: true, idempotencyKey: "p:r:v2" }));
  assert.deepEqual(fake.calls, ["find", "snapshot"]);
  assert.deepEqual(fake.row(), before);
});
