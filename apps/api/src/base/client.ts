import { BaseKeyConflictError, FeishuApiError } from "./transport.js";
export { BaseKeyConflictError };

export interface BaseRequirementKey { requirementId: string; /** Legacy callers may still provide this; Base lookup ignores it. */ projectId?: string }
export interface BaseRecord { recordId: string; fields: Record<string, unknown> }

// External Base access is isolated behind this transport interface.
export interface BaseClient {
  // Production transport resolves the target schema; legacy injected test clients use text metadata.
  readFieldType?(fieldName: string): Promise<number>;
  findByRequirementKey(key: BaseRequirementKey): Promise<BaseRecord | null>;
  /** V02-T03：按需求平台 ID 查找（跨来源首选键）。旧注入客户端未实现时适配器退回 TB 键兼容路径。 */
  findByPlatformKey?(platformRequirementId: string): Promise<BaseRecord | null>;
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
 * requirementLink 是可选的第五个字段：给 PM 点击的需求深链，每次推送都写，不属于通知事件。
 * 整段未配置时回落 DEFAULT_BASE_FIELDS（见 server.ts 的 parseBaseFields）。
 */
export interface BaseNotificationFieldMap {
  eventId: string;
  eventType: string;
  recipient: string;
  ownerMergeValue: string;
  /** 需求深链文本字段；目标 Base 尚未建该字段时可省略。 */
  requirementLink?: string;
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
  /**
   * 收件人的 ID 类型（服务层显式给出，不由 client 猜）。
   * 飞书 `user_id_type` 是整个请求级参数：一次请求里所有人员字段必须同类型。
   * 负责人映射可能是 open_id 而 PM Leader 是 user_id，二者混在一次请求里会被
   * 1254066 UserFieldConvFail 拒绝，因此适配器把通知字段拆成两次写入。
   */
  recipientIdType: "open_id" | "user_id" | "union_id";
  ownerMergeUserId: string | null;
}

export interface BaseFieldMap {
  /** Legacy configuration property retained for compatibility; no longer required by the Base schema. */
  projectId?: string;
  requirementId: string;
  platformRequirementId?: string;
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
  /**
   * Teambition 需求 ID（24 位字符串）。写入 Base 的「需求 ID」字段，用于跨系统对账。
   * V02-T03 起手工来源为 null：不写 TB 专属字段、不做 TB 兼容查找。
   */
  requirementId: string | null;
  /** RQ-Sys display ID (for example RQ-000001), stored separately from the Teambition ID. */
  platformRequirementId?: string;
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
  /**
   * 稳定的 Web 需求深链（`<工作台地址>?requirement=<requirements.id>`）。
   * 独立于 notification：每次推送都写，首推静默时也要写——它是给 PM 点击的入口，不是通知事件。
   * 目标 Base 无对应字段（1254045）时记入 omittedFields，不阻断推送。
   */
  requirementLink?: string;
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

/** 从 Base 人员字段值解析出可用于通知的飞书用户 ID 与类型；无法识别时返回 null。 */
function baseUserFieldValue(value: unknown): { userId: string; idType: "open_id" | "user_id" | "union_id" } | null {
  const first = Array.isArray(value) ? value[0] : value;
  const rawId = first && typeof first === "object"
    ? (first as { id?: unknown }).id
    : first;
  if (typeof rawId !== "string") return null;
  const id = rawId.trim();
  if (!id) return null;
  const idType = id.startsWith("ou_") ? "open_id" as const
    : id.startsWith("on_") ? "union_id" as const
      : /^[0-9a-f]{32}$/i.test(id) ? "user_id" as const
        : null;
  return idType ? { userId: id, idType } : null;
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

  /**
   * 只读当前 Base 行的人员字段，用于通知收件人判定。
   * 不用于覆盖写入：应用仍按自身负责人规则决定是否改 Base；读取失败由调用方兜底。
   */
  async findCurrentOwner(key: { platformRequirementId?: string; requirementId: string | null }): Promise<{ userId: string; idType: "open_id" | "user_id" | "union_id" } | null> {
    const record = await this.resolveExisting(key);
    if (!record) return null;
    const fields = await this.client.readPmFields(record.recordId);
    return baseUserFieldValue(fields[this.fields.owner]);
  }

  /**
   * V02-T03 双键解析（AC01/AC02）：
   * 1) 平台键优先——命中即用；命中行的 TB 字段与本次 TB ID 不一致时是键冲突；
   * 2) 兼容窗口：仅 TB 来源（requirementId 非空）允许按旧 TB ID 查唯一旧行；
   *    行上平台字段为空 → 本次写入自然回填；已存且与本次平台 ID 不同 → 键冲突；
   * 3) 冲突向上抛 BaseKeyConflictError：停该条并审计，不自动合并、不另建行。
   * 多行命中由传输层抛同一错误。
   */
  private async resolveExisting(input: { platformRequirementId?: string | null; requirementId: string | null }): Promise<BaseRecord | null> {
    const platformField = this.fields.platformRequirementId;
    if (platformField && input.platformRequirementId && this.client.findByPlatformKey) {
      const byPlatform = await this.client.findByPlatformKey(input.platformRequirementId);
      if (byPlatform) {
        if (input.requirementId !== null) {
          const rowTbId = byPlatform.fields[this.fields.requirementId];
          if (typeof rowTbId === "string" && rowTbId.trim() && rowTbId !== input.requirementId) {
            throw new BaseKeyConflictError(`Base row for platform ${input.platformRequirementId} holds TB id ${rowTbId}, expected ${input.requirementId}`);
          }
        }
        return byPlatform;
      }
    }
    if (input.requirementId === null) return null;
    const legacy = await this.client.findByRequirementKey({ requirementId: input.requirementId });
    if (!legacy) return null;
    if (platformField && input.platformRequirementId) {
      const rowPlatform = legacy.fields[platformField];
      if (typeof rowPlatform === "string" && rowPlatform.trim() && rowPlatform !== input.platformRequirementId) {
        throw new BaseKeyConflictError(`Base row for TB id ${input.requirementId} holds platform ${rowPlatform}, expected ${input.platformRequirementId}`);
      }
    }
    return legacy;
  }

  async push(input: BasePushInput): Promise<BasePushResult> {
    const omittedFields: OmittedField[] = [];
    const existing = await this.resolveExisting(input);
    const delta: Record<string, unknown> = {
      // TB 需求 ID 仅 TB 来源写入；手工行为空不得伪造 TB 专属字段（V02-T03-AC05）。
      ...(input.requirementId === null ? {} : { [this.fields.requirementId]: input.requirementId }),
      [this.fields.owner]: input.owner ? [{ id: input.owner.userId }] : null,
    };
    if (this.fields.platformRequirementId) {
      if (!input.platformRequirementId) throw new Error("RQ-Sys platform requirement ID is missing");
      delta[this.fields.platformRequirementId] = input.platformRequirementId;
    }
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
    // 需求深链是纯文本业务字段：与通知是否静默无关，每次都进第一次写入的 delta。
    // 不涉及 user_id_type；目标 Base 缺该字段时在 writeRecord 里按 1254045 记录省略后重试。
    const requirementLinkField = this.fields.notification?.requirementLink;
    if (requirementLinkField && input.requirementLink) delta[requirementLinkField] = input.requirementLink;
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
   * 写 Base 行。通知字段是「附加」写入，但飞书的 `user_id_type` 是请求级参数：
   * 一次请求里所有人员字段必须是同一类型。负责人映射可能是 open_id，而 PM Leader 收件人是
   * user_id；把二者写进同一次请求会被 1254066 UserFieldConvFail 拒绝（上一版 1254045 重试
   * 掩盖了这条路径）。因此有通知载荷时拆成两次写入：
   *   1. 业务字段 + 需求深链 + `系统负责人通知归并值`（人员字段只有负责人，用 input.owner.idType）；
   *   2. `系统通知事件ID/类型/收件人`（收件人类型由服务层显式给出）；create 时用第一次返回的 recordId update。
   * 静默场景（没有 notification）只写第一次，不多发请求——但需求深链仍会写（它不属于通知事件）。
   * 目标 Base 缺少某个可选字段（需求链接 / 负责人归并值 / 三个通知字段）时飞书返回 1254045
   * FieldNameNotFound：第一次写入按「先单独去掉链接、再单独去掉归并值、最后都去掉」的顺序重试，
   * 把实际去掉的字段记入 omittedFields 后继续；第二次写入同理。
   * 业务推送不得因为可选字段缺失而失败。其它错误原样抛出。
   */
  private async writeRecord(recordId: string | null, delta: Record<string, unknown>, input: BasePushInput, omittedFields: OmittedField[]): Promise<BaseRecord> {
    const fields = this.fields.notification;
    const notification = input.notification;
    // 第一次写入的人员字段只有负责人（或其归并值），请求类型固定取负责人映射的类型。
    // 静默场景同样要带上它：否则真实环境不会按 owner 的 id 类型解释「执行人」字段。
    const ownerOptions: BaseWriteOptions | undefined = input.owner ? { userIdType: input.owner.idType } : undefined;
    // 无 owner 或静默场景时不写归并值（不能凭空造一个没有身份类型的人员值）。
    const ownerMergeUserId = fields && notification && input.owner ? notification.ownerMergeUserId : null;
    const ownerMerge = fields?.ownerMergeValue && ownerMergeUserId
      ? { field: fields.ownerMergeValue, userId: ownerMergeUserId }
      : null;
    const requirementLinkField = fields?.requirementLink;
    const requirementLink = requirementLinkField && input.requirementLink && Object.hasOwn(delta, requirementLinkField)
      ? input.requirementLink
      : null;

    let record: BaseRecord | null = null;
    const attempts = businessWriteAttempts(Boolean(ownerMerge), requirementLink !== null);
    for (const [index, attempt] of attempts.entries()) {
      try {
        const payload = businessWritePayload(delta, requirementLinkField, ownerMerge, attempt);
        record = recordId ? await this.client.update(recordId, payload, ownerOptions) : await this.client.create(payload, ownerOptions);
      } catch (error) {
        // 只有「字段不存在」允许去掉可选字段重试；最后一次尝试失败时原样抛出。
        if (!isFieldNotFound(error) || index === attempts.length - 1) throw error;
        continue;
      }
      if (ownerMerge && !attempt.ownerMerge) omittedFields.push({ field: ownerMerge.field, value: ownerMerge.userId, reason: "field_not_in_base" });
      if (requirementLink && requirementLinkField && !attempt.requirementLink) omittedFields.push({ field: requirementLinkField, value: requirementLink, reason: "field_not_in_base" });
      break;
    }
    // 每次尝试要么成功并置 record，要么抛出；这里只用于让类型收窄。
    if (!record) throw new Error("Base business write did not complete");
    if (!fields || !notification) return record;

    // 第二次写入只有通知字段，人员字段只剩收件人：整个请求用它显式声明的类型。
    const notificationDelta: Record<string, unknown> = {};
    if (fields.eventId) notificationDelta[fields.eventId] = notification.eventId;
    if (fields.eventType) notificationDelta[fields.eventType] = notification.eventType;
    if (fields.recipient && notification.recipientUserId) notificationDelta[fields.recipient] = [{ id: notification.recipientUserId }];
    if (Object.keys(notificationDelta).length === 0) return record;
    try {
      return await this.client.update(record.recordId, notificationDelta, { userIdType: notification.recipientIdType });
    } catch (error) {
      if (!isFieldNotFound(error)) throw error;
      for (const [field, value] of Object.entries(notificationDelta)) {
        omittedFields.push({ field, value: omittedNotificationValue(value), reason: "field_not_in_base" });
      }
      return record;
    }
  }
}

interface BusinessWriteAttempt { ownerMerge: boolean; requirementLink: boolean }

/**
 * 第一次业务写入的尝试顺序（只在 1254045 时推进）：
 * 全量 → 去掉链接保留归并值 → 去掉归并值保留链接 → 都去掉。
 * 先单独试两个可选字段，能区分到底缺哪一个，避免误删目标 Base 仍然存在的系统字段。
 */
function businessWriteAttempts(hasOwnerMerge: boolean, hasRequirementLink: boolean): BusinessWriteAttempt[] {
  if (hasOwnerMerge && hasRequirementLink) {
    return [
      { ownerMerge: true, requirementLink: true },
      { ownerMerge: true, requirementLink: false },
      { ownerMerge: false, requirementLink: true },
      { ownerMerge: false, requirementLink: false },
    ];
  }
  if (hasOwnerMerge) return [{ ownerMerge: true, requirementLink: false }, { ownerMerge: false, requirementLink: false }];
  if (hasRequirementLink) return [{ ownerMerge: false, requirementLink: true }, { ownerMerge: false, requirementLink: false }];
  return [{ ownerMerge: false, requirementLink: false }];
}

function businessWritePayload(
  delta: Record<string, unknown>,
  requirementLinkField: string | undefined,
  ownerMerge: { field: string; userId: string } | null,
  attempt: BusinessWriteAttempt,
): Record<string, unknown> {
  const payload = { ...delta };
  if (requirementLinkField && !attempt.requirementLink) delete payload[requirementLinkField];
  if (ownerMerge && attempt.ownerMerge) payload[ownerMerge.field] = [{ id: ownerMerge.userId }];
  return payload;
}

/** 飞书 1254045 FieldNameNotFound：目标 Base 缺少某个字段。 */
function isFieldNotFound(error: unknown): boolean {
  return error instanceof FeishuApiError && error.apiCode === 1254045;
}

/** 省略记录里只保留可读的字符串值：人员字段取 user id，其余取原文。 */
function omittedNotificationValue(value: unknown): string {
  if (Array.isArray(value)) {
    const id = (value[0] as { id?: unknown } | undefined)?.id;
    return typeof id === "string" ? id : "";
  }
  return String(value);
}
