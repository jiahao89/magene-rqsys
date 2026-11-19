// 5b：需求收集表（Base 多维表格）→ 需求池同步。
//
// 安全边界：
// - 只读收集表、只写回四个系统字段；不读 PM 表、不写 PM 字段、不发通知。
// - 审计只记原因码/错误类/状态码，不记表单正文或提出人；写回说明只写原因码与简短中文。
// - 幂等：来源身份是 Base record_id；同一行重复读取只建一次，写回失败下一轮补写。
// - 一期只收录一次：已写回「系统需求 ID」的行不再处理，收集表后续修改不同步（PRD-26 §5 第 2 项）。

import { randomUUID } from "node:crypto";
import type { AuditEventRecord, BaseFormRequirementInput } from "../domain/persistence.js";
import type { AuditEventRepository, SystemFlagRepository } from "../application/repositories.js";
import type { BaseClient } from "./client.js";
import { REQUIREMENT_INTAKE_CHANNELS, REQUIREMENT_INTAKE_TYPES } from "../contracts/pipeline.js";

/** 运维可见的同步状态（system_flags），由 tick 每次运行后覆盖。 */
export const BASE_FORM_SYNC_STATE_FLAG = "base_form_sync_state";
export const BASE_FORM_STATUS_RECORDED = "已收录";
export const BASE_FORM_STATUS_REJECTED = "校验失败";

export interface BaseFormFieldNames {
  title: string; description: string; sourceChannel: string; requirementType: string; productModel: string;
  intakeModule: string; constraintNotes: string; supplementUrl: string; proposerName: string;
  systemRequirementId: string; syncStatus: string; syncNote: string; syncTime: string;
}

/** 与 Chief 2026-11-19 建的收集表逐字一致；可用 BASE_INTAKE_FIELDS_JSON 覆盖单个字段名。 */
export const DEFAULT_BASE_FORM_FIELDS: BaseFormFieldNames = {
  title: "标题", description: "描述", sourceChannel: "来源渠道", requirementType: "需求类型", productModel: "产品型号",
  intakeModule: "功能模块", constraintNotes: "约束说明", supplementUrl: "补充链接", proposerName: "提出人",
  systemRequirementId: "系统需求 ID", syncStatus: "同步状态", syncNote: "同步说明", syncTime: "同步时间",
};

/** 字段映射配置错误必须显式关闭同步，不能静默回退到默认值把数据写到错误字段。 */
export function parseBaseFormFields(raw: string | undefined): { fields: BaseFormFieldNames; error: null } | { fields: null; error: string } {
  if (raw === undefined || raw.trim() === "") return { fields: { ...DEFAULT_BASE_FORM_FIELDS }, error: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { fields: null, error: "BASE_INTAKE_FIELDS_JSON must be an object" };
    const fields = { ...DEFAULT_BASE_FORM_FIELDS };
    for (const key of Object.keys(DEFAULT_BASE_FORM_FIELDS) as Array<keyof BaseFormFieldNames>) {
      const value = parsed[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.trim() === "" || value.length > 100) return { fields: null, error: `BASE_INTAKE_FIELDS_JSON.${key} must be a non-empty string up to 100 chars` };
      fields[key] = value.trim();
    }
    const names = Object.values(fields);
    if (new Set(names).size !== names.length) return { fields: null, error: "BASE_INTAKE_FIELDS_JSON maps two roles to the same field" };
    return { fields, error: null };
  } catch {
    return { fields: null, error: "BASE_INTAKE_FIELDS_JSON is not valid JSON" };
  }
}

/** Base 单元格 → 文本。文本字段可能返回纯字符串，也可能是富文本片段数组；空值一律 null。 */
export function cellText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (Array.isArray(value)) {
    const joined = value.map((segment) => {
      if (typeof segment === "string") return segment;
      if (segment !== null && typeof segment === "object" && typeof (segment as { text?: unknown }).text === "string") return (segment as { text: string }).text;
      return "";
    }).join("").trim();
    return joined === "" ? null : joined;
  }
  if (value !== null && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") {
    const text = (value as { text: string }).text.trim();
    return text === "" ? null : text;
  }
  return null;
}

/** 单选/多选单元格 → 第一个非空字符串。 */
export function cellChoice(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const choice = cellChoice(item);
      if (choice) return choice;
    }
    return null;
  }
  if (value !== null && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
    const name = (value as { name: string }).name.trim();
    return name === "" ? null : name;
  }
  return null;
}

/** URL 单元格 → http(s) 链接；bitable 返回 { link, text }。 */
export function cellUrl(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = cellUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (value !== null && typeof value === "object" && typeof (value as { link?: unknown }).link === "string") {
    const link = (value as { link: string }).link.trim();
    return link === "" ? null : link;
  }
  return null;
}

/** 人员单元格 → 展示名（只用于 proposerName；不参与负责人匹配、不落飞书 ID）。 */
export function cellPersonName(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = cellPersonName(item);
      if (name) return name;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    const candidate = value as { name?: unknown; en_name?: unknown; text?: unknown };
    for (const key of ["name", "en_name", "text"] as const) {
      const text = candidate[key];
      if (typeof text === "string" && text.trim() !== "") return text.trim();
    }
  }
  return null;
}

/** 日期单元格 → 毫秒时间戳（bitable 返回 number）；非法值返回 null。 */
export function cellDateMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export type BaseFormParseResult =
  | { ok: true; intake: Omit<BaseFormRequirementInput, "sourceExternalId" | "capturedAt"> }
  | { ok: false; reasonCode: string; reasonText: string };

function reject(reasonCode: string, reasonText: string): BaseFormParseResult {
  return { ok: false, reasonCode, reasonText };
}

/** 逐字段校验：必填缺失、枚举越界、链接非法直接拒绝（不建需求，只写回原因）。 */
export function parseBaseFormRecord(fields: Record<string, unknown>, names: BaseFormFieldNames): BaseFormParseResult {
  const title = cellText(fields[names.title]);
  if (title === null) return reject("title_missing", "标题为空");
  if (title.length > 200) return reject("title_too_long", "标题超过 200 字");
  const description = cellText(fields[names.description]);
  if (description === null) return reject("description_missing", "描述为空");
  if (description.length > 20_000) return reject("description_too_long", "描述超过 20000 字");
  const channel = cellChoice(fields[names.sourceChannel]);
  if (channel === null) return reject("channel_missing", "来源渠道为空");
  if (!(REQUIREMENT_INTAKE_CHANNELS as readonly string[]).includes(channel)) return reject("channel_invalid", "来源渠道不在允许的 6 项内");
  const requirementType = cellChoice(fields[names.requirementType]);
  if (requirementType !== null && !(REQUIREMENT_INTAKE_TYPES as readonly string[]).includes(requirementType)) {
    return reject("type_invalid", "需求类型不在允许的 8 项内");
  }
  const productModel = cellText(fields[names.productModel]);
  if (productModel !== null && productModel.length > 100) return reject("product_model_too_long", "产品型号超过 100 字");
  const intakeModule = cellText(fields[names.intakeModule]);
  if (intakeModule !== null && intakeModule.length > 100) return reject("module_too_long", "功能模块超过 100 字");
  const constraintNotes = cellText(fields[names.constraintNotes]);
  if (constraintNotes !== null && constraintNotes.length > 2_000) return reject("constraint_notes_too_long", "约束说明超过 2000 字");
  const proposerName = cellPersonName(fields[names.proposerName]);
  if (proposerName !== null && proposerName.length > 100) return reject("proposer_too_long", "提出人超过 100 字");
  const rawUrl = cellUrl(fields[names.supplementUrl]);
  let supplementUrl: string | null = null;
  if (rawUrl !== null) {
    if (rawUrl.length > 500) return reject("supplement_url_invalid", "补充链接超过 500 字");
    try {
      const parsed = new URL(rawUrl);
      // 只接受 http(s)，且不带凭据形态（用户名/密码），避免把 token 写进审计或页面。
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") {
        return reject("supplement_url_invalid", "补充链接必须是 http(s) 地址且不带账号信息");
      }
      supplementUrl = parsed.toString();
    } catch {
      return reject("supplement_url_invalid", "补充链接不是有效地址");
    }
  }
  return {
    ok: true,
    intake: {
      title,
      description,
      sourceChannel: channel,
      requirementType,
      productModel,
      constraintNotes,
      supplementUrl,
      intakeModule,
      proposerName,
      sourcePayload: {
        sourceType: "base_form",
        title, description, sourceChannel: channel,
        requirementType, productModel, constraintNotes, supplementUrl, intakeModule,
        ...(proposerName === null ? {} : { proposerName }),
      },
    },
  };
}

export interface BaseFormSyncRequirements {
  findBaseFormRequirement?(sourceExternalId: string): Promise<{ id: string; platformRequirementId: string } | null>;
  createBaseFormRequirement?(input: BaseFormRequirementInput): Promise<{ requirementId: string; platformRequirementId: string; created: boolean }>;
}

export interface BaseFormSyncParams {
  client: Pick<BaseClient, "listRecords" | "update">;
  requirements: BaseFormSyncRequirements;
  audit: Pick<AuditEventRepository, "append">;
  fields: BaseFormFieldNames;
  now: Date;
  tableId: string;
  flags?: Pick<SystemFlagRepository, "set">;
  pageSize?: number;
  maxPages?: number;
}

export interface BaseFormSyncReport {
  tableId: string;
  pages: number;
  scanned: number;
  skipped: number;
  created: number;
  recorded: number;
  rejected: number;
  writeBackFailed: number;
  readFailed: boolean;
  errors: string[];
}

function errorMeta(error: unknown): Record<string, unknown> {
  const candidate = error !== null && typeof error === "object" ? error as { name?: unknown; httpStatus?: unknown; apiCode?: unknown; kind?: unknown } : {};
  const safe: Record<string, unknown> = { errorClass: typeof candidate.name === "string" ? candidate.name : "Error" };
  if (typeof candidate.httpStatus === "number" && Number.isSafeInteger(candidate.httpStatus)) safe.httpStatus = candidate.httpStatus;
  if (typeof candidate.apiCode === "number" && Number.isSafeInteger(candidate.apiCode)) safe.apiCode = candidate.apiCode;
  if (typeof candidate.kind === "string") safe.kind = candidate.kind;
  return safe;
}

function sameText(left: unknown, right: string): boolean {
  return typeof left === "string" ? left.trim() === right.trim() : false;
}

export async function syncBaseFormIntake(params: BaseFormSyncParams): Promise<BaseFormSyncReport> {
  const report: BaseFormSyncReport = { tableId: params.tableId, pages: 0, scanned: 0, skipped: 0, created: 0, recorded: 0, rejected: 0, writeBackFailed: 0, readFailed: false, errors: [] };
  const nowIso = params.now.toISOString();
  const nowMs = params.now.getTime();
  const appendAudit = async (eventType: string, entityType: string, entityId: string, result: "succeeded" | "failed", safeDetails: Record<string, unknown>): Promise<void> => {
    try {
      const event: AuditEventRecord = { id: randomUUID(), actorId: null, eventType, entityType, entityId, result, safeDetails, occurredAt: nowIso };
      await params.audit.append(event);
    } catch { /* 审计失败不阻断同步；下一轮会重试同一行 */ }
  };
  const updateRow = async (recordId: string, fields: Record<string, unknown>): Promise<void> => {
    await params.client.update(recordId, fields);
  };

  if (!params.client.listRecords) {
    report.readFailed = true;
    report.errors.push("base client does not implement listRecords");
    await appendAudit("base_form.read_failed", "base_form_table", params.tableId, "failed", { phase: "read", reason: "list_records_unavailable", sourceType: "base_form" });
    await saveState();
    return report;
  }

  let pageToken: string | null = null;
  const maxPages = params.maxPages ?? 20;
  for (let page = 0; page < maxPages; page += 1) {
    let result;
    try {
      result = await params.client.listRecords({ pageSize: params.pageSize ?? 100, ...(pageToken === null ? {} : { pageToken }) });
    } catch (error) {
      report.readFailed = true;
      report.errors.push(`read page ${page + 1}: ${String((error as { name?: string }).name ?? "Error")}`);
      await appendAudit("base_form.read_failed", "base_form_table", params.tableId, "failed", { phase: "read", reason: "read_page_failed", ...errorMeta(error) });
      break;
    }
    report.pages += 1;
    for (const record of result.items) {
      report.scanned += 1;
      await handleRow(record.recordId, record.fields);
    }
    if (!result.hasMore) break;
    if (result.nextPageToken === null || result.nextPageToken === "") {
      report.readFailed = true;
      report.errors.push("records page reported hasMore without a next page token");
      await appendAudit("base_form.read_failed", "base_form_table", params.tableId, "failed", { phase: "read", reason: "missing_page_token", sourceType: "base_form" });
      break;
    }
    pageToken = result.nextPageToken;
  }

  async function saveState(): Promise<void> {
    if (!params.flags) return;
    try {
      await params.flags.set(BASE_FORM_SYNC_STATE_FLAG, {
        tableId: params.tableId,
        lastRunAt: nowIso,
        pages: report.pages,
        scanned: report.scanned,
        skipped: report.skipped,
        created: report.created,
        recorded: report.recorded,
        rejected: report.rejected,
        writeBackFailed: report.writeBackFailed,
        readFailed: report.readFailed,
        lastError: report.errors[0] ?? null,
      }, nowIso);
    } catch (error) {
      report.errors.push(`save sync state: ${String((error as { name?: string }).name ?? "Error")}`);
    }
  }

  async function handleRow(recordId: string, fields: Record<string, unknown>): Promise<void> {
    // 一期只收录一次：已经写回系统需求 ID 的行不再处理（收集表后续修改不同步）。
    if (cellText(fields[params.fields.systemRequirementId]) !== null) {
      report.skipped += 1;
      return;
    }
    const parsed = parseBaseFormRecord(fields, params.fields);
    if ("reasonCode" in parsed) {
      report.rejected += 1;
      const note = `${parsed.reasonText}（${parsed.reasonCode}）`;
      // 校验失败是稳定状态：状态与原因都没变时不再重写，避免每轮更新同步时间。
      if (sameText(fields[params.fields.syncStatus], BASE_FORM_STATUS_REJECTED) && sameText(fields[params.fields.syncNote], note)) return;
      try {
        // 校验失败只写状态/原因/时间：不碰「系统需求 ID」，避免对空文本字段做无意义的清空。
        await updateRow(recordId, {
          [params.fields.syncStatus]: BASE_FORM_STATUS_REJECTED,
          [params.fields.syncNote]: note,
          [params.fields.syncTime]: nowMs,
        });
        await appendAudit("base_form.intake_rejected", "base_form_row", recordId, "failed", { reason: parsed.reasonCode, sourceType: "base_form" });
      } catch (error) {
        report.writeBackFailed += 1;
        report.errors.push(`write back rejection for ${recordId}: ${String((error as { name?: string }).name ?? "Error")}`);
        await appendAudit("base_form.write_back_failed", "base_form_row", recordId, "failed", { phase: "write_back", reason: "write_back_failed", ...errorMeta(error) });
      }
      return;
    }

    const externalId = recordId;
    let platformRequirementId: string | null = null;
    try {
      const existing = await params.requirements.findBaseFormRequirement?.(externalId) ?? null;
      if (existing) {
        platformRequirementId = existing.platformRequirementId;
        report.recorded += 1;
      } else {
        if (!params.requirements.createBaseFormRequirement) throw new Error("createBaseFormRequirement is unavailable");
        const created = await params.requirements.createBaseFormRequirement({ ...parsed.intake, sourceExternalId: externalId, capturedAt: nowIso });
        platformRequirementId = created.platformRequirementId;
        if (created.created) report.created += 1; else report.recorded += 1;
      }
    } catch (error) {
      report.errors.push(`create requirement for ${recordId}: ${String((error as { name?: string }).name ?? "Error")}`);
      await appendAudit("base_form.create_failed", "base_form_row", recordId, "failed", { phase: "create", reason: "create_failed", ...errorMeta(error) });
      return;
    }

    try {
      await updateRow(recordId, {
        [params.fields.systemRequirementId]: platformRequirementId,
        [params.fields.syncStatus]: BASE_FORM_STATUS_RECORDED,
        [params.fields.syncNote]: "",
        [params.fields.syncTime]: nowMs,
      });
    } catch (error) {
      report.writeBackFailed += 1;
      report.errors.push(`write back record for ${recordId}: ${String((error as { name?: string }).name ?? "Error")}`);
      await appendAudit("base_form.write_back_failed", "base_form_row", recordId, "failed", { phase: "write_back", reason: "write_back_failed", ...errorMeta(error) });
    }
  }

  await saveState();
  return report;
}
