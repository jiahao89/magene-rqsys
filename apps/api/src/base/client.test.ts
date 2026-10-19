import assert from "node:assert/strict";
import test from "node:test";
import { FeishuBasePushAdapter, type BaseClient } from "./client.js";
import { FeishuApiError } from "./transport.js";

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
  const result = await adapter.push({ projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title", description: "Desc", owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1" });
  assert.equal(result.recordId, "record-new");
  assert.equal(fake.row()?.fields["执行人"], null);
  assert.equal(fake.row()?.fields["PM状态"], "待处理");
  assert.equal(fake.calls.join(","), "find,create");
  await fake.client.update(result.recordId, { "PM状态": "已采纳" });
  await adapter.push({ projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title", description: "Desc", owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1" });
  assert.equal(fake.calls.filter((call) => call === "create").length, 1);
  assert.equal(fake.row()?.fields["PM状态"], "已采纳");
});

test("snapshots before substantive update and only then resets PM status", async () => {
  const fake = fakeBase({ recordId: "existing", fields: { "TB项目ID": "p", "TB需求ID": "r", "标题": "Old", "PM状态": "已采纳", "PM确认模块": "M", "结构化备注": "Note" } });
  const snapshots: unknown[] = [];
  const adapter = new FeishuBasePushAdapter(fake.client, { projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人", source: { title: "标题", description: "需求说明" }, ai: {}, pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"] }, { savePmSnapshot: async (snapshot) => { snapshots.push(snapshot); } });
  await adapter.push({ projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "New", owner: null, sourceVersion: 2, substantiveChanged: true, idempotencyKey: "p:r:v2" });
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
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title", owner: null, sourceVersion: 3,
    pushedAt: "2026-10-11T01:00:00.000Z", substantiveChanged: false, idempotencyKey: "p:r:v3",
    aiValues: { module: "无法识别", priority: "P2", analysisVersion: 4 },
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
  await assert.rejects(() => adapter.push({ projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "New", owner: null, sourceVersion: 2, substantiveChanged: true, idempotencyKey: "p:r:v2" }));
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
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title", owner: null, sourceVersion: 1,
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

test("distinguishes the deliberate 无法识别 omission from a rejected value", async () => {
  const fake = fakeBase();
  const adapter = new FeishuBasePushAdapter(fake.client, {
    projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
    source: { title: "标题" }, ai: { module: "AI模块建议" }, pm: [],
    selectOptions: { module: ["需求澄清", "其他"] },
  });
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title", owner: null, sourceVersion: 1,
    substantiveChanged: false, idempotencyKey: "p:r:v1", aiValues: { module: "无法识别" },
  });
  assert.deepEqual(result.omittedFields, [
    { field: "AI模块建议", value: "无法识别", reason: "category_omitted_by_policy" },
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
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title", owner: null, sourceVersion: 1,
    substantiveChanged: false, idempotencyKey: "p:r:v1", aiValues: { module: "其他", priority: "P1" },
  });
  assert.deepEqual(result.omittedFields, []);
  assert.equal(fake.row()!.fields["AI优先级建议"], "P1");
});

// ---- 通知四字段写入 ----

const notificationFields = {
  projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
  source: { title: "标题" }, ai: {}, pm: [],
  notification: { eventId: "系统通知事件ID", eventType: "系统通知类型", recipient: "系统通知收件人", ownerMergeValue: "系统负责人通知归并值" },
};

test("writes the four notification system fields with one recipient and the merge value", async () => {
  const writes: { fields: Record<string, unknown>; options?: { userIdType?: "open_id" | "user_id" | "union_id" } | undefined }[] = [];
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields, options) { writes.push(options === undefined ? { fields } : { fields, options }); return { recordId: "record-new", fields }; },
    async update() { throw new Error("unexpected update"); },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: { eventId: "first_push:r:sv1", eventType: "first_push", recipientUserId: "ou-owner", ownerMergeUserId: "ou-owner" },
  });

  assert.equal(result.created, true);
  assert.deepEqual(result.omittedFields, []);
  const fields = writes[0]!.fields;
  assert.equal(fields["系统通知事件ID"], "first_push:r:sv1");
  assert.equal(fields["系统通知类型"], "first_push");
  assert.deepEqual(fields["系统通知收件人"], [{ id: "ou-owner" }]);
  assert.deepEqual(fields["系统负责人通知归并值"], [{ id: "ou-owner" }]);
  // 无负责人但写人员字段时必须显式 user_id_type
  assert.deepEqual(writes[0]!.options, { userIdType: "user_id" });
});

test("uses the written owner's id type for notification person fields", async () => {
  let written: Record<string, unknown> | null = null;
  let options: { userIdType?: string } | undefined;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields, createOptions) { written = fields; options = createOptions; return { recordId: "record-new", fields }; },
    async update() { throw new Error("unexpected update"); },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title",
    owner: { userId: "ou-owner", idType: "open_id" }, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: { eventId: "first_push:r:sv1", eventType: "first_push", recipientUserId: "ou-owner", ownerMergeUserId: "ou-owner" },
  });
  assert.deepEqual(options, { userIdType: "open_id" });
  assert.deepEqual(written!["系统通知收件人"], [{ id: "ou-owner" }]);
});

test("writes no notification fields without a notification payload, including null person values", async () => {
  let written: Record<string, unknown> | null = null;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) { written = fields; return { recordId: "record-new", fields }; },
    async update() { throw new Error("unexpected update"); },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
  });
  assert.equal(written!["系统通知事件ID"], undefined);

  await adapter.push({
    projectId: "p2", requirementId: "r2", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p2:r2:v1",
    notification: { eventId: "first_push:r2:sv1", eventType: "first_push", recipientUserId: null, ownerMergeUserId: null },
  });
  // 值为 null 的人员字段不写；事件ID/类型仍然写入。
  assert.equal(written!["系统通知事件ID"], "first_push:r2:sv1");
  assert.equal(written!["系统通知收件人"], undefined);
  assert.equal(written!["系统负责人通知归并值"], undefined);
});

test("a Base missing the notification fields records omissions and still writes the business fields", async () => {
  const payloads: Record<string, unknown>[] = [];
  let attempts = 0;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) {
      attempts += 1;
      payloads.push(fields);
      // 模拟目标 Base 缺少通知字段：飞书返回 1254045 FieldNameNotFound，整条写入被拒绝。
      if (attempts === 1) throw new FeishuApiError("api", "record create", undefined, 1254045);
      return { recordId: "record-new", fields };
    },
    async update() { throw new Error("unexpected update"); },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: { eventId: "first_push:r:sv1", eventType: "first_push", recipientUserId: "ou-owner", ownerMergeUserId: "ou-owner" },
  });

  assert.equal(attempts, 2, "必须用不含通知字段的载荷重试一次");
  assert.equal(result.created, true);
  assert.deepEqual(result.omittedFields, [
    { field: "系统通知事件ID", value: "first_push:r:sv1", reason: "field_not_in_base" },
    { field: "系统通知类型", value: "first_push", reason: "field_not_in_base" },
    { field: "系统通知收件人", value: "ou-owner", reason: "field_not_in_base" },
    { field: "系统负责人通知归并值", value: "ou-owner", reason: "field_not_in_base" },
  ]);
  // 业务字段仍写入成功，通知字段被省略而不是让整次推送失败。
  assert.equal(payloads[1]!["标题"], "Title");
  assert.equal(payloads[1]!["系统通知事件ID"], undefined);
  assert.equal(payloads[1]!["系统通知收件人"], undefined);
});

test("propagates non-field-not-found Base failures even when a notification payload is present", async () => {
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create() { throw new FeishuApiError("api", "record create", undefined, 1254061); },
    async update() { throw new Error("unexpected update"); },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  await assert.rejects(() => adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: { eventId: "first_push:r:sv1", eventType: "first_push", recipientUserId: "ou-owner", ownerMergeUserId: "ou-owner" },
  }), /1254061/);
});
