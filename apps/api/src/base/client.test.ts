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

// ---- 通知四字段写入：两次请求保证每次请求内人员字段同类型 ----

const notificationFields = {
  projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
  source: { title: "标题" }, ai: {}, pm: [],
  notification: { eventId: "系统通知事件ID", eventType: "系统通知类型", recipient: "系统通知收件人", ownerMergeValue: "系统负责人通知归并值", requirementLink: "系统需求链接" },
};

const REQUIREMENT_DB_ID = "11111111-2222-4333-8444-555555555555";
/** 通知按钮指向的稳定深链；测试只关心它是否被原样写入业务字段。 */
const REQUIREMENT_LINK = `https://workbench.example/app?requirement=${REQUIREMENT_DB_ID}`;
/** 线上 RQSYS_PM_LEADER_USER_ID 的形态：32 位十六进制 user_id（不是 ou_ 开头的 open_id）。 */
const PM_LEADER_USER_ID = "0123456789abcdef0123456789abcdef";

type RecordedWrite = {
  op: "create" | "update";
  recordId: string | null;
  fields: Record<string, unknown>;
  options?: { userIdType?: "open_id" | "user_id" | "union_id" };
};

/** 记录每次写入的字段与请求级 user_id_type；飞书一次请求只有一个 user_id_type。 */
function recordingBase(initial?: { recordId: string; fields: Record<string, unknown> }) {
  const writes: RecordedWrite[] = [];
  let row = initial ?? null;
  const client: BaseClient = {
    async findByRequirementKey() { return row; },
    async create(fields, options) {
      writes.push({ op: "create", recordId: null, fields, ...(options ? { options } : {}) });
      row = { recordId: "record-new", fields: { ...fields } };
      return row;
    },
    async update(recordId, fields, options) {
      writes.push({ op: "update", recordId, fields, ...(options ? { options } : {}) });
      assert.equal(recordId, row?.recordId);
      row = { recordId, fields: { ...row!.fields, ...fields } };
      return row;
    },
    async readPmFields() { return {}; },
  };
  return { client, writes, row: () => row };
}

test("splits the owner merge value and the recipient into two requests when their id types differ", async () => {
  const fake = recordingBase();
  const adapter = new FeishuBasePushAdapter(fake.client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    requirementLink: REQUIREMENT_LINK,
    owner: { userId: "ou-owner", idType: "open_id" }, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "first_push:r:sv1", eventType: "first_push",
      recipientUserId: PM_LEADER_USER_ID, recipientIdType: "user_id", ownerMergeUserId: "ou-owner",
    },
  });

  assert.equal(result.created, true);
  assert.deepEqual(result.omittedFields, []);
  assert.equal(fake.writes.length, 2, "负责人(open_id)与收件人(user_id)不能出现在同一次请求里");
  const first = fake.writes[0]!;
  const second = fake.writes[1]!;
  // 第一次：业务字段 + 负责人归并值 + 需求深链，请求类型是负责人映射的类型。
  assert.equal(first.op, "create");
  assert.deepEqual(first.options, { userIdType: "open_id" });
  assert.deepEqual(first.fields["执行人"], [{ id: "ou-owner" }]);
  assert.deepEqual(first.fields["系统负责人通知归并值"], [{ id: "ou-owner" }]);
  assert.equal(first.fields["系统需求链接"], REQUIREMENT_LINK);
  assert.equal(first.fields["系统通知事件ID"], undefined);
  assert.equal(first.fields["系统通知收件人"], undefined);
  // 第二次：三个纯通知字段，请求类型是服务层声明的收件人类型。
  assert.equal(second.op, "update");
  assert.equal(second.recordId, "record-new");
  assert.deepEqual(second.options, { userIdType: "user_id" });
  assert.equal(second.fields["系统通知事件ID"], "first_push:r:sv1");
  assert.equal(second.fields["系统通知类型"], "first_push");
  assert.deepEqual(second.fields["系统通知收件人"], [{ id: PM_LEADER_USER_ID }]);
  assert.equal(second.fields["系统负责人通知归并值"], undefined);
  assert.equal(second.fields["执行人"], undefined);
  // 两次写入后四个字段都在同一行上。
  const row = fake.row()!.fields;
  assert.deepEqual(row["系统通知收件人"], [{ id: PM_LEADER_USER_ID }]);
  assert.deepEqual(row["系统负责人通知归并值"], [{ id: "ou-owner" }]);
  assert.equal(row["标题"], "Title");
});

test("an existing row update also separates the owner and recipient id types", async () => {
  const fake = recordingBase({ recordId: "existing", fields: { "TB项目ID": "p", "TB需求ID": "r", "标题": "Old" } });
  const adapter = new FeishuBasePushAdapter(fake.client, notificationFields);
  await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "New",
    owner: { userId: "ou-owner", idType: "open_id" }, sourceVersion: 2, substantiveChanged: false, idempotencyKey: "p:r:v2",
    notification: {
      eventId: "owner_assigned:r:sv2:none:ou-owner", eventType: "owner_assigned",
      recipientUserId: "ou-owner", recipientIdType: "open_id", ownerMergeUserId: "ou-owner",
    },
  });
  assert.equal(fake.writes.length, 2);
  assert.deepEqual(fake.writes.map((write) => write.op), ["update", "update"]);
  assert.deepEqual(fake.writes[0]!.options, { userIdType: "open_id" });
  assert.deepEqual(fake.writes[1]!.options, { userIdType: "open_id" });
  assert.deepEqual(fake.writes[0]!.fields["系统负责人通知归并值"], [{ id: "ou-owner" }]);
  assert.deepEqual(fake.writes[1]!.fields["系统通知收件人"], [{ id: "ou-owner" }]);
});

test("writes a PM Leader recipient as user_id in the second request even when the row has no owner", async () => {
  const fake = recordingBase();
  const adapter = new FeishuBasePushAdapter(fake.client, notificationFields);
  await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "first_push:r:sv1", eventType: "first_push",
      recipientUserId: PM_LEADER_USER_ID, recipientIdType: "user_id", ownerMergeUserId: null,
    },
  });
  assert.equal(fake.writes.length, 2);
  const first = fake.writes[0]!;
  const second = fake.writes[1]!;
  // 第一次没有任何人员字段，因此不需要 user_id_type；也不写空的人员值。
  assert.equal(first.op, "create");
  assert.equal(first.options, undefined);
  assert.equal(first.fields["系统负责人通知归并值"], undefined);
  assert.equal(first.fields["系统通知收件人"], undefined);
  assert.deepEqual(second.options, { userIdType: "user_id" });
  assert.deepEqual(second.fields["系统通知收件人"], [{ id: PM_LEADER_USER_ID }]);
});

test("writes no notification fields and only one request without a notification payload", async () => {
  const fake = recordingBase();
  const adapter = new FeishuBasePushAdapter(fake.client, notificationFields);
  await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
  });
  assert.equal(fake.writes.length, 1, "静默场景必须保持单次写入，不得多一次请求");
  assert.equal(fake.writes[0]!.fields["系统通知事件ID"], undefined);
  assert.equal(fake.writes[0]!.options, undefined);
});

test("writes the event id and type without person fields when the event has no recipient", async () => {
  const fake = recordingBase();
  const adapter = new FeishuBasePushAdapter(fake.client, notificationFields);
  await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "first_push:r:sv1", eventType: "first_push",
      recipientUserId: null, recipientIdType: "user_id", ownerMergeUserId: null,
    },
  });
  assert.equal(fake.writes.length, 2);
  assert.equal(fake.writes[0]!.fields["系统通知事件ID"], undefined);
  assert.equal(fake.writes[1]!.fields["系统通知事件ID"], "first_push:r:sv1");
  assert.equal(fake.writes[1]!.fields["系统通知类型"], "first_push");
  assert.equal(fake.writes[1]!.fields["系统通知收件人"], undefined);
  assert.equal(fake.writes[1]!.fields["系统负责人通知归并值"], undefined);
});

test("a Base missing the notification fields records the omissions and still writes the business fields", async () => {
  const writes: Record<string, unknown>[] = [];
  let updates = 0;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) { writes.push(fields); return { recordId: "record-new", fields }; },
    async update(_recordId, fields) {
      updates += 1;
      // 模拟目标 Base 缺少三个纯通知字段：飞书返回 1254045 FieldNameNotFound。
      throw new FeishuApiError("api", "record update", undefined, 1254045);
    },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "first_push:r:sv1", eventType: "first_push",
      recipientUserId: PM_LEADER_USER_ID, recipientIdType: "user_id", ownerMergeUserId: null,
    },
  });

  assert.equal(updates, 1, "第二次写入失败后不再反复重试");
  assert.equal(result.created, true);
  assert.deepEqual(result.omittedFields, [
    { field: "系统通知事件ID", value: "first_push:r:sv1", reason: "field_not_in_base" },
    { field: "系统通知类型", value: "first_push", reason: "field_not_in_base" },
    { field: "系统通知收件人", value: PM_LEADER_USER_ID, reason: "field_not_in_base" },
  ]);
  // 业务字段仍然写入成功：通知字段缺失不能拖垮业务推送。
  assert.equal(writes[0]!["标题"], "Title");
  assert.equal(writes[0]!["系统通知事件ID"], undefined);
});

test("a Base missing only the owner merge field records that omission and still writes the notification", async () => {
  let creates = 0;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) {
      creates += 1;
      if (creates === 1) throw new FeishuApiError("api", "record create", undefined, 1254045);
      return { recordId: "record-new", fields };
    },
    async update(_recordId, fields) { return { recordId: "record-new", fields }; },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    owner: { userId: "ou-owner", idType: "open_id" }, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "owner_assigned:r:sv1:none:ou-owner", eventType: "owner_assigned",
      recipientUserId: "ou-owner", recipientIdType: "open_id", ownerMergeUserId: "ou-owner",
    },
  });
  assert.equal(creates, 2, "第一次写入被 1254045 拒绝后，必须去掉归并值重试");
  assert.deepEqual(result.omittedFields, [
    { field: "系统负责人通知归并值", value: "ou-owner", reason: "field_not_in_base" },
  ]);
  assert.equal(result.recordId, "record-new");
});

test("writes the requirement deep link for a silent push and records a missing link field instead of failing", async () => {
  const created: Record<string, unknown>[] = [];
  let creates = 0;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) {
      creates += 1;
      // 模拟目标 Base 缺少「系统需求链接」：第一次写入 1254045，去掉该字段后应成功。
      if (creates === 1) throw new FeishuApiError("api", "record create", undefined, 1254045);
      created.push(fields);
      return { recordId: "record-new", fields };
    },
    async update(_recordId, fields) { return { recordId: "record-new", fields }; },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    // 静默推送（没有 notification）也要写深链：它是给 PM 点击的入口，不是通知事件。
    requirementLink: REQUIREMENT_LINK, owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
  });
  assert.equal(creates, 2, "缺字段时只去掉需求链接重试，不得让业务推送失败");
  assert.equal(created[0]!["系统需求链接"], undefined);
  // 业务字段仍然写入成功。
  assert.equal(created[0]!["标题"], "Title");
  assert.deepEqual(result.omittedFields, [
    { field: "系统需求链接", value: REQUIREMENT_LINK, reason: "field_not_in_base" },
  ]);
  assert.equal(result.recordId, "record-new");
});

test("keeps the owner merge value when only the requirement link field is missing", async () => {
  const created: Record<string, unknown>[] = [];
  let creates = 0;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) {
      creates += 1;
      if (creates === 1) throw new FeishuApiError("api", "record create", undefined, 1254045);
      created.push(fields);
      return { recordId: "record-new", fields };
    },
    async update(_recordId, fields) { return { recordId: "record-new", fields }; },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    requirementLink: REQUIREMENT_LINK,
    owner: { userId: "ou-owner", idType: "open_id" }, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "owner_assigned:r:sv1:none:ou-owner", eventType: "owner_assigned",
      recipientUserId: "ou-owner", recipientIdType: "open_id", ownerMergeUserId: "ou-owner",
    },
  });
  assert.equal(creates, 2, "先单独去掉链接；归并值必须保留");
  assert.deepEqual(created[0]!["系统负责人通知归并值"], [{ id: "ou-owner" }]);
  assert.equal(created[0]!["系统需求链接"], undefined);
  assert.deepEqual(result.omittedFields, [
    { field: "系统需求链接", value: REQUIREMENT_LINK, reason: "field_not_in_base" },
  ]);
});

test("keeps the requirement link when only the owner merge field is missing", async () => {
  const created: Record<string, unknown>[] = [];
  let creates = 0;
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) {
      creates += 1;
      // 全量失败 → 去掉链接仍失败 → 去掉归并值保留链接成功。
      if (creates <= 2) throw new FeishuApiError("api", "record create", undefined, 1254045);
      created.push(fields);
      return { recordId: "record-new", fields };
    },
    async update(_recordId, fields) { return { recordId: "record-new", fields }; },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  const result = await adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    requirementLink: REQUIREMENT_LINK,
    owner: { userId: "ou-owner", idType: "open_id" }, sourceVersion: 2, substantiveChanged: false, idempotencyKey: "p:r:v2",
    notification: {
      eventId: "substantive_update:r:sv2", eventType: "substantive_update",
      recipientUserId: "ou-owner", recipientIdType: "open_id", ownerMergeUserId: "ou-owner",
    },
  });
  assert.equal(creates, 3, "单个字段试过之后才同时去掉两个可选字段");
  assert.equal(created[0]!["系统需求链接"], REQUIREMENT_LINK, "仍存在的链接字段不能被误删");
  assert.equal(created[0]!["系统负责人通知归并值"], undefined);
  assert.deepEqual(result.omittedFields, [
    { field: "系统负责人通知归并值", value: "ou-owner", reason: "field_not_in_base" },
  ]);
});

test("propagates a first-request failure that is not FieldNameNotFound", async () => {
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create() { throw new FeishuApiError("api", "record create", undefined, 1254061); },
    async update() { throw new Error("unexpected update"); },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  await assert.rejects(() => adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "first_push:r:sv1", eventType: "first_push",
      recipientUserId: PM_LEADER_USER_ID, recipientIdType: "user_id", ownerMergeUserId: null,
    },
  }), /1254061/);
});

test("propagates a second-request failure that is not FieldNameNotFound", async () => {
  const client: BaseClient = {
    async findByRequirementKey() { return null; },
    async create(fields) { return { recordId: "record-new", fields }; },
    async update() { throw new FeishuApiError("api", "record update", undefined, 1254061); },
    async readPmFields() { return {}; },
  };
  const adapter = new FeishuBasePushAdapter(client, notificationFields);
  // 通知字段写入失败且不是「字段不存在」时，必须按失败抛出；
  // 上层已有 pushed_unrecorded / 安全失败路径处理，不能在这里静默吞掉。
  await assert.rejects(() => adapter.push({
    projectId: "p", requirementId: "r", requirementDbId: REQUIREMENT_DB_ID, title: "Title",
    owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "p:r:v1",
    notification: {
      eventId: "first_push:r:sv1", eventType: "first_push",
      recipientUserId: PM_LEADER_USER_ID, recipientIdType: "user_id", ownerMergeUserId: null,
    },
  }), /1254061/);
});
