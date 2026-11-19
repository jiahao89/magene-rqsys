import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BASE_FORM_FIELDS, normalizeModuleName, parseBaseFormFields, parseBaseFormRecord, syncBaseFormIntake } from "./form-sync.js";
import type { AuditEventRecord, BaseFormRequirementInput } from "../domain/persistence.js";

type Row = { recordId: string; fields: Record<string, unknown> };

function validRow(recordId: string, overrides: Record<string, unknown> = {}): Row {
  return {
    recordId,
    fields: {
      标题: "表盘自定义字段太少",
      描述: "希望表盘能自定义显示哪些数据项，比如只显示速度和心率。",
      来源渠道: "终端用户",
      需求类型: "新增功能",
      产品型号: "C706",
      功能模块: "场景/表盘/场景设置（海思新平台）",
      约束说明: "不能影响续航",
      补充链接: { link: "https://example.com/feedback/1", text: "反馈贴" },
      提出人: [{ id: "ou_probe", name: "张骑" }],
      "系统需求 ID": "",
      同步状态: "待处理",
      同步说明: "",
      同步时间: 0,
      ...overrides,
    },
  };
}

function harness(pages: Row[][], options: { listError?: Error; failUpdate?: () => boolean } = {}) {
  const updates: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
  const audits: AuditEventRecord[] = [];
  const created: BaseFormRequirementInput[] = [];
  const existing = new Map<string, { requirementId: string; platformRequirementId: string }>();
  const flagWrites: Array<{ name: string; value: Record<string, unknown> }> = [];
  let pageIndex = 0;
  let nextNumber = 1;
  const client = {
    async listRecords() {
      if (options.listError) throw options.listError;
      // 一个同步轮次读完所有页后回到第一页，模拟下一次 tick 重新读表。
      if (pageIndex >= pages.length) pageIndex = 0;
      const items = pages[pageIndex] ?? [];
      const hasMore = pageIndex < pages.length - 1;
      pageIndex += 1;
      return { items, hasMore, nextPageToken: hasMore ? `page-${pageIndex}` : null };
    },
    async update(recordId: string, fields: Record<string, unknown>) {
      if (options.failUpdate?.()) throw Object.assign(new Error("feishu permission denied"), { name: "FeishuApiError", kind: "api", httpStatus: 403, apiCode: 1254303 });
      updates.push({ recordId, fields });
      const row = pages.flat().find((candidate) => candidate.recordId === recordId);
      if (row) Object.assign(row.fields, fields);
      return { recordId, fields };
    },
  };
  const requirements = {
    async findBaseFormRequirement(externalId: string) {
      const hit = existing.get(externalId);
      return hit ? { id: hit.requirementId, platformRequirementId: hit.platformRequirementId } : null;
    },
    async createBaseFormRequirement(input: BaseFormRequirementInput) {
      const hit = existing.get(input.sourceExternalId);
      if (hit) return { ...hit, created: false };
      const record = { requirementId: `req-${nextNumber}`, platformRequirementId: `RQ-${String(nextNumber).padStart(6, "0")}` };
      nextNumber += 1;
      existing.set(input.sourceExternalId, record);
      created.push(input);
      return { ...record, created: true };
    },
  };
  const audit = { async append(event: AuditEventRecord) { audits.push(event); } };
  const flags = { async set(name: string, value: Record<string, unknown>) { flagWrites.push({ name, value }); } };
  return { client, requirements, audit, flags, pages, updates, audits, created, existing, flagWrites };
}

const fields = DEFAULT_BASE_FORM_FIELDS;
const now = new Date("2026-11-19T02:00:00.000Z");

test("imports valid rows, rejects an invalid row with a reason, and stays idempotent on re-read", async () => {
  const h = harness([[validRow("rec-1"), validRow("rec-2", { 标题: "导航偏航提醒" }), validRow("rec-3", { 来源渠道: "微信" })]]);
  const moduleNames = ["场景/表盘/场景设置（海思新平台）"];
  const first = await syncBaseFormIntake({ client: h.client, requirements: h.requirements, audit: h.audit, fields, moduleNames, now, tableId: "tbl_test", flags: h.flags });
  assert.deepEqual({ scanned: first.scanned, created: first.created, rejected: first.rejected, writeBackFailed: first.writeBackFailed, readFailed: first.readFailed }, { scanned: 3, created: 2, rejected: 1, writeBackFailed: 0, readFailed: false });
  assert.equal(h.created.length, 2);
  assert.equal(h.updates.length, 3);
  const recorded = h.updates.filter((update) => update.fields[fields.syncStatus] === "已收录");
  assert.equal(recorded.length, 2);
  assert.match(String(recorded[0]!.fields[fields.systemRequirementId]), /^RQ-\d{6}$/);
  const rejected = h.updates.find((update) => update.fields[fields.syncStatus] === "校验失败");
  assert.match(String(rejected!.fields[fields.syncNote]), /来源渠道不在允许的 6 项内/);
  assert.equal(Object.prototype.hasOwnProperty.call(rejected!.fields, fields.systemRequirementId), false);
  assert.deepEqual(h.audits.map((event) => event.eventType), ["base_form.intake_rejected"]);
  assert.deepEqual(h.audits[0]!.safeDetails, { reason: "channel_invalid", sourceType: "base_form" });
  assert.equal(h.flagWrites.at(-1)?.name, "base_form_sync_state");
  assert.equal(h.flagWrites.at(-1)?.value.created, 2);

  // 第二轮：已写回系统需求 ID 的行直接跳过；校验失败行原因未变，不重复写回。
  const second = await syncBaseFormIntake({ client: h.client, requirements: h.requirements, audit: h.audit, fields, moduleNames, now, tableId: "tbl_test", flags: h.flags });
  assert.deepEqual({ scanned: second.scanned, skipped: second.skipped, created: second.created, rejected: second.rejected }, { scanned: 3, skipped: 2, created: 0, rejected: 1 });
  assert.equal(h.updates.length, 3);
  assert.equal(h.audits.length, 1);
});

test("walks every page and keeps the record id as the source identity", async () => {
  const h = harness([[validRow("rec-a")], [validRow("rec-b"), validRow("rec-c")]]);
  const report = await syncBaseFormIntake({ client: h.client, requirements: h.requirements, audit: h.audit, fields, now, tableId: "tbl_test" });
  assert.equal(report.pages, 2);
  assert.equal(report.scanned, 3);
  assert.equal(report.created, 3);
  assert.deepEqual(h.created.map((input) => input.sourceExternalId), ["rec-a", "rec-b", "rec-c"]);
});

test("a failed write-back is audited and self-heals on the next run", async () => {
  let failing = true;
  const h = harness([[validRow("rec-1")]], { failUpdate: () => failing });
  const first = await syncBaseFormIntake({ client: h.client, requirements: h.requirements, audit: h.audit, fields, now, tableId: "tbl_test", flags: h.flags });
  assert.equal(first.created, 1);
  assert.equal(first.writeBackFailed, 1);
  assert.equal(h.audits.at(-1)?.eventType, "base_form.write_back_failed");
  assert.deepEqual(h.audits.at(-1)?.safeDetails, { phase: "write_back", reason: "write_back_failed", errorClass: "FeishuApiError", httpStatus: 403, apiCode: 1254303, kind: "api" });
  assert.equal(h.updates.length, 0);

  failing = false;
  const second = await syncBaseFormIntake({ client: h.client, requirements: h.requirements, audit: h.audit, fields, now, tableId: "tbl_test", flags: h.flags });
  // 行尚未写回系统需求 ID：按 record_id 命中已建需求，只补写回，不重复建。
  assert.equal(second.created, 0);
  assert.equal(second.recorded, 1);
  assert.equal(h.created.length, 1);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0]!.fields[fields.syncStatus], "已收录");
});

test("a read failure is audited, reported, and recorded in the ops state", async () => {
  const h = harness([], { listError: Object.assign(new Error("base down"), { name: "FeishuApiError", kind: "http", httpStatus: 500 }) });
  const report = await syncBaseFormIntake({ client: h.client, requirements: h.requirements, audit: h.audit, fields, now, tableId: "tbl_test", flags: h.flags });
  assert.equal(report.readFailed, true);
  assert.equal(report.scanned, 0);
  assert.equal(h.audits[0]?.eventType, "base_form.read_failed");
  assert.deepEqual(h.audits[0]?.safeDetails, { phase: "read", reason: "read_page_failed", errorClass: "FeishuApiError", httpStatus: 500, kind: "http" });
  assert.equal(h.flagWrites.at(-1)?.value.readFailed, true);
  assert.match(String(h.flagWrites.at(-1)?.value.lastError), /read page 1/);
});

test("parses bitable cell shapes and rejects missing or invalid required fields", () => {
  const accepted = parseBaseFormRecord(validRow("rec-1").fields, fields);
  assert.equal("reasonCode" in accepted, false);
  if (!("reasonCode" in accepted)) {
    assert.equal(accepted.intake.title, "表盘自定义字段太少");
    assert.equal(accepted.intake.proposerName, "张骑");
    assert.equal(accepted.intake.supplementUrl, "https://example.com/feedback/1");
    assert.equal(accepted.intake.sourcePayload.sourceType, "base_form");
    // 人员字段只取展示名，飞书 open_id 不落 payload/审计。
    assert.equal(JSON.stringify(accepted.intake.sourcePayload).includes("ou_probe"), false);
  }
  const richText = parseBaseFormRecord(validRow("rec-2", { 标题: [{ type: "text", text: "  " }, { type: "text", text: "离线地图包" }], 补充链接: null }).fields, fields);
  assert.equal("reasonCode" in richText, false);
  if (!("reasonCode" in richText)) assert.equal(richText.intake.title, "离线地图包");

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ 标题: null }, "title_missing"],
    [{ 描述: "   " }, "description_missing"],
    [{ 来源渠道: null }, "channel_missing"],
    [{ 需求类型: "拍脑袋" }, "type_invalid"],
    [{ 补充链接: { link: "javascript:alert(1)" } }, "supplement_url_invalid"],
    [{ 补充链接: "https://user:pass@example.com/x" }, "supplement_url_invalid"],
    [{ 标题: "长".repeat(201) }, "title_too_long"],
  ];
  for (const [overrides, code] of cases) {
    const parsed = parseBaseFormRecord(validRow("rec-x", overrides).fields, fields);
    assert.equal("reasonCode" in parsed, true, code);
    if ("reasonCode" in parsed) assert.equal(parsed.reasonCode, code);
  }
});

test("module mapping is exact after mechanical normalization and never writes free text", () => {
  const dictionary = ["导航（路线/离线/位置点）", "电池管理"];
  // 全半角括号差异 + 首尾空白：归一化后精确命中，写入词典里的名称。
  const mapped = parseBaseFormRecord(validRow("rec-1", { 功能模块: "  导航(路线/离线/位置点) " }).fields, fields, dictionary);
  assert.equal("reasonCode" in mapped, false);
  if (!("reasonCode" in mapped)) {
    assert.equal(mapped.intake.intakeModule, "导航（路线/离线/位置点）");
    assert.equal(mapped.moduleNotice, null);
    assert.equal(mapped.intake.sourcePayload.intakeModule, "导航（路线/离线/位置点）");
  }
  // 词典外文本：模块列留空、原文进 payload、同步说明标注；整行仍然有效。
  const unmapped = parseBaseFormRecord(validRow("rec-2", { 功能模块: "电池" }).fields, fields, dictionary);
  assert.equal("reasonCode" in unmapped, false);
  if (!("reasonCode" in unmapped)) {
    assert.equal(unmapped.intake.intakeModule, null);
    assert.equal(unmapped.moduleNotice, "模块未识别：电池");
    assert.equal(unmapped.intake.sourcePayload.intakeModuleRaw, "电池");
    assert.equal(unmapped.intake.sourcePayload.moduleUnrecognized, true);
  }
  // 不做模糊/同义词：多一个空格就不算命中。
  const spaced = parseBaseFormRecord(validRow("rec-3", { 功能模块: "导航 （路线/离线/位置点）" }).fields, fields, dictionary);
  assert.equal("reasonCode" in spaced, false);
  if (!("reasonCode" in spaced)) { assert.equal(spaced.intake.intakeModule, null); assert.match(String(spaced.moduleNotice), /模块未识别/); }
  // 超长自由文本：仍创建，说明截断到 100 字，原文完整保留在 payload。
  const longRaw = "电池".repeat(80);
  const longModule = parseBaseFormRecord(validRow("rec-4", { 功能模块: longRaw }).fields, fields, dictionary);
  assert.equal("reasonCode" in longModule, false);
  if (!("reasonCode" in longModule)) {
    assert.equal(longModule.intake.intakeModule, null);
    assert.match(String(longModule.moduleNotice), /…$/);
    assert.equal(longModule.intake.sourcePayload.intakeModuleRaw, longRaw);
  }
  // 归一化只做 NFKC + 空白合并，不做大小写/同义词。
  assert.equal(normalizeModuleName("  导航（路线/离线/位置点） "), "导航(路线/离线/位置点)");
});

test("field mapping overrides are validated and duplicate roles are rejected", () => {
  const custom = parseBaseFormFields(JSON.stringify({ title: "需求标题", syncStatus: "同步状态" }));
  assert.equal(custom.error, null);
  if (custom.fields) { assert.equal(custom.fields.title, "需求标题"); assert.equal(custom.fields.syncStatus, "同步状态"); }
  assert.match(String(parseBaseFormFields("{bad json").error), /not valid JSON/);
  assert.match(String(parseBaseFormFields(JSON.stringify({ title: "" })).error), /must be a non-empty string/);
  assert.match(String(parseBaseFormFields(JSON.stringify({ title: "重复", description: "重复" })).error), /same field/);
});
