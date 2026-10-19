import { FeishuApiError } from "./transport.js";

export interface BaseRequirementKey { projectId: string; requirementId: string }
export interface BaseRecord { recordId: string; fields: Record<string, unknown> }

// External Base access is isolated behind this transport interface.
export interface BaseClient {
  // Production transport resolves the target schema; legacy injected test clients use text metadata.
  readFieldType?(fieldName: string): Promise<number>;
  findByRequirementKey(key: BaseRequirementKey): Promise<BaseRecord | null>;
  create(fields: Record<string, unknown>, options?: BaseWriteOptions): Promise<BaseRecord>;
  update(recordId: string, fields: Record<string, unknown>, options?: BaseWriteOptions): Promise<BaseRecord>;
  readPmFields(recordId: string): Promise<Record<string, unknown>>;
}

export interface BaseWriteOptions {
  userIdType?: "open_id" | "user_id" | "union_id";
}

/**
 * 通知四字段的 Base 列名映射。飞书多维表格由自动化规则读取这四个「系统字段」发通知，
 * 应用只负责在推送时把事件写入正确值；这里不实现任何发送逻辑。
 * 整段未配置时回落 DEFAULT_BASE_FIELDS（见 server.ts 的 parseBaseFields）。
 */
export interface BaseNotificationFieldMap {
  eventId: string;
  eventType: string;
  recipient: string;
  ownerMergeValue: string;
}

/**
 * 一次推送要写入的通知事件载荷。产品已确认不存在「一条通知发多人」场景，
 * 因此收件人是单个 user id；不记录送达结果，也不读回送达。
 * 两个人员字段值为 null 时不写该字段（见 FeishuBasePushAdapter.push）。
 */
export interface BaseNotificationPush {
  eventId: string;
  eventType: string;
  recipientUserId: string | null;
  ownerMergeUserId: string | null;
}

export interface BaseFieldMap {
  projectId: string;
  requirementId: string;
  owner: string;
  source: Record<string, string>;
  ai: Record<string, string>;
  pm: string[];
  metadata?: Record<string, string>;
  notification?: BaseNotificationFieldMap;
  /// 字段名 → 该字段是否为「多选」。
  /// 单选（含 PM 状态、推送状态、AI 模块/优先级建议）在飞书 API 中必须写字符串：真实环境实测
  /// bitable v1 对单选的 PUT 会以 1254062 拒绝数组，读回时也返回字符串。
  /// 未列出的字段按单选处理——这是更严格且与飞书存储一致的形态。
  multiSelect?: Record<string, boolean>;
  selectOptions?: Record<string, string[]>;
}

export interface BasePushInput {
  projectId: string;
  /** Teambition 需求 ID（24 位字符串）。写入 Base 的「需求 ID」字段，用于跨系统对账。 */
  requirementId: string;
  /**
   * 应用数据库中的 requirements.id（uuid）。PM 快照的外键指向它。
   * 与 requirementId 是两个不同的标识：Base 字段要 TB ID，pm_snapshots.requirement_id 是 uuid。
   * 早期实现把 TB ID 传给了 pm_snapshots（uuid 列），导致 PG 22P02、实质变更后的推送永远失败。
   */
  requirementDbId: string;
  title: string;
  description?: string | null;
  owner: { userId: string; idType: "open_id" | "user_id" | "union_id" } | null;
  sourceVersion: number;
  pushedAt?: string;
  substantiveChanged: boolean;
  idempotencyKey: string;
  sourceValues?: Record<string, unknown>;
  aiValues?: Record<string, unknown>;
  /**
   * 可选的通知事件载荷：仅当本次推送命中事件且解析到唯一收件人时传入。
   * 未传时不写四个通知系统字段（重复同步无变化、同键重放等静默场景）。
   */
  notification?: BaseNotificationPush;
}

export interface PmSnapshotWriter {
  savePmSnapshot(input: { requirementId: string; sourceVersion: number; baseRecordId: string; pmValues: Record<string, unknown> }): Promise<void>;
}

/**
 * 一次推送中被有意跳过的字段。
 * 设计取舍：绝不为了写成功而伪造取值（例如把 P3 降级成 P2，或把未知模块写成「其他」），
 * 但也绝不允许静默丢失——跳过的字段必须显式返回，供推送运行记录与审计使用。
 */
export interface OmittedField {
  field: string;
  value: string;
  reason: "not_in_base_select_options" | "category_omitted_by_policy" | "field_not_in_base";
}

export interface BasePushResult {
  recordId: string;
  created: boolean;
  omittedFields: OmittedField[];
}

export class FeishuBasePushAdapter {
  constructor(private readonly client: BaseClient, private readonly fields: BaseFieldMap, private readonly snapshots?: PmSnapshotWriter) {}

  /**
   * 单选字段写字符串，多选字段写字符串数组。
   * 历史实现一律写数组，导致单选字段的 PUT 被飞书以 1254062 拒绝——即"推送成功但 PM 状态从未重置"。
   */
  private selectValue(fieldName: string, value: string): string | string[] {
    return this.fields.multiSelect?.[fieldName] === true ? [value] : value;
  }

  async push(input: BasePushInput): Promise<BasePushResult> {
    const omittedFields: OmittedField[] = [];
    const key = { projectId: input.projectId, requirementId: input.requirementId };
    const existing = await this.client.findByRequirementKey(key);
    const delta: Record<string, unknown> = {
      [this.fields.projectId]: input.projectId,
      [this.fields.requirementId]: input.requirementId,
      [this.fields.owner]: input.owner ? [{ id: input.owner.userId }] : null,
    };
    const sourceValues = { title: input.title, ...(input.description === undefined ? {} : { description: input.description }), ...input.sourceValues };
    for (const [name, value] of Object.entries(sourceValues)) {
      const field = this.fields.source[name];
      if (field) delta[field] = value;
    }
    for (const [name, value] of Object.entries(input.aiValues ?? {})) {
      const field = this.fields.ai[name];
      if (!field || value === null || value === undefined) continue;
      const text = String(value);
      const allowed = this.fields.selectOptions?.[name];
      // 「无法识别」在 Web 中保留为分析结果；目标 Base 单选不一定包含该选项，因此不写入非法值。
      if (name === "module" && value === "无法识别") {
        omittedFields.push({ field, value: text, reason: "category_omitted_by_policy" });
        continue;
      }
      // 取值不在 Base 单选项内（例如规则产出 P3 而目标字段只有 P0–P2）：跳过但必须记录，
      // 不伪造降级值，也不让调用方误以为该字段已写入。
      if (allowed && !allowed.includes(text)) {
        omittedFields.push({ field, value: text, reason: "not_in_base_select_options" });
        continue;
      }
      if (name === "module" || name === "priority") delta[field] = this.selectValue(field, text);
      else if (name === "analysisVersion") delta[field] = text;
      else delta[field] = value;
    }
    const metadata = this.fields.metadata ?? {};
    if (metadata.sourceVersion) {
      const type = this.client.readFieldType ? await this.client.readFieldType(metadata.sourceVersion) : 1;
      if (type !== 1 && type !== 2) throw new Error("Base source-version field must be text or number");
      if (!Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1) throw new Error("Invalid Base source version");
      delta[metadata.sourceVersion] = type === 2 ? input.sourceVersion : String(input.sourceVersion);
    }
    if (metadata.pushState) delta[metadata.pushState] = this.selectValue(metadata.pushState, "已推送");
    if (metadata.lastPushedAt && input.pushedAt) {
      const timestamp = Date.parse(input.pushedAt);
      if (!Number.isFinite(timestamp)) throw new Error("Invalid Base push timestamp");
      delta[metadata.lastPushedAt] = timestamp;
    }
    if (!existing) {
      const pmStatusField = this.fields.pm[0];
      if (pmStatusField) delta[pmStatusField] = this.selectValue(pmStatusField, "待处理");
      const created = await this.writeRecord(null, delta, input, omittedFields);
      return { recordId: created.recordId, created: true, omittedFields };
    }

    if (input.substantiveChanged) {
      if (!this.snapshots) throw new Error("PM snapshot writer is unavailable");
      const pmValues = await this.client.readPmFields(existing.recordId);
      await this.snapshots.savePmSnapshot({ requirementId: input.requirementDbId, sourceVersion: input.sourceVersion, baseRecordId: existing.recordId, pmValues });
      // PM 状态字段来自配置映射（pm 数组首项），不硬编码字段名
      const pmStatusField = this.fields.pm[0];
      if (pmStatusField) delta[pmStatusField] = this.selectValue(pmStatusField, "待处理");
    }
    // Unmapped and empty TB ownership never erases a human-assigned Base owner.
    if (input.owner === null) delete delta[this.fields.owner];
    const updated = await this.writeRecord(existing.recordId, delta, input, omittedFields);
    return { recordId: updated.recordId, created: false, omittedFields };
  }

  /**
   * 通知四字段的写入值：事件ID/类型写字符串；两个人员字段写 `[{ id }]`，值为 null 时不写该字段。
   * 字段名全部来自配置映射；未配置通知字段映射时返回空对象（不写通知字段）。
   */
  private notificationDelta(input: BasePushInput): Record<string, unknown> {
    const fields = this.fields.notification;
    const notification = input.notification;
    if (!fields || !notification) return {};
    const delta: Record<string, unknown> = {};
    if (fields.eventId) delta[fields.eventId] = notification.eventId;
    if (fields.eventType) delta[fields.eventType] = notification.eventType;
    if (fields.recipient && notification.recipientUserId) delta[fields.recipient] = [{ id: notification.recipientUserId }];
    if (fields.ownerMergeValue && notification.ownerMergeUserId) delta[fields.ownerMergeValue] = [{ id: notification.ownerMergeUserId }];
    return delta;
  }

  private writeOptions(input: BasePushInput): BaseWriteOptions | undefined {
    if (input.owner) return { userIdType: input.owner.idType };
    // 无负责人但写通知人员字段时仍需显式 user_id_type；PM Leader 收件人按 user_id 处理。
    if (input.notification && (input.notification.recipientUserId || input.notification.ownerMergeUserId)) return { userIdType: "user_id" };
    return undefined;
  }

  /**
   * 写 Base 行。通知字段是「附加」写入：若目标 Base 不存在这四个字段（1254045 FieldNameNotFound），
   * 不允许把整次推送判失败——按既有 omittedFields 机制记录省略，再用不含通知字段的载荷重试一次，
   * 业务字段照常写入。其它错误原样抛出，由推送服务走既有安全失败路径。
   */
  private async writeRecord(recordId: string | null, delta: Record<string, unknown>, input: BasePushInput, omittedFields: OmittedField[]): Promise<BaseRecord> {
    const options = this.writeOptions(input);
    const notificationFields = this.notificationDelta(input);
    if (Object.keys(notificationFields).length === 0) {
      return recordId ? this.client.update(recordId, delta, options) : this.client.create(delta, options);
    }
    try {
      const withNotification = { ...delta, ...notificationFields };
      return recordId ? await this.client.update(recordId, withNotification, options) : await this.client.create(withNotification, options);
    } catch (error) {
      if (!(error instanceof FeishuApiError) || error.apiCode !== 1254045) throw error;
      for (const [field, value] of Object.entries(notificationFields)) {
        omittedFields.push({ field, value: omittedNotificationValue(value), reason: "field_not_in_base" });
      }
      return recordId ? this.client.update(recordId, delta, options) : this.client.create(delta, options);
    }
  }
}

/** 省略记录里只保留可读的字符串值：人员字段取 user id，其余取原文。 */
function omittedNotificationValue(value: unknown): string {
  if (Array.isArray(value)) {
    const id = (value[0] as { id?: unknown } | undefined)?.id;
    return typeof id === "string" ? id : "";
  }
  return String(value);
}
