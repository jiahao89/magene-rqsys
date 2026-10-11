export interface BaseRequirementKey { projectId: string; requirementId: string }
export interface BaseRecord { recordId: string; fields: Record<string, unknown> }

// Only this injected interface can reach Feishu; production transport is intentionally absent.
export interface BaseClient {
  findByRequirementKey(key: BaseRequirementKey): Promise<BaseRecord | null>;
  create(fields: Record<string, unknown>): Promise<BaseRecord>;
  update(recordId: string, fields: Record<string, unknown>): Promise<BaseRecord>;
  readPmFields(recordId: string): Promise<Record<string, unknown>>;
}

export interface BaseFieldMap {
  projectId: string;
  requirementId: string;
  owner: string;
  source: Record<string, string>;
  ai: Record<string, string>;
  pm: string[];
  metadata?: Record<string, string>;
  /// 字段名 → 该字段是否为「多选」。
  /// 单选（含 PM 状态、推送状态、AI 模块/优先级建议）在飞书 API 中必须写字符串：真实环境实测
  /// bitable v1 对单选的 PUT 会以 1254062 拒绝数组，读回时也返回字符串。
  /// 未列出的字段按单选处理——这是更严格且与飞书存储一致的形态。
  multiSelect?: Record<string, boolean>;
  selectOptions?: Record<string, string[]>;
}

export interface BasePushInput {
  projectId: string;
  requirementId: string;
  title: string;
  description?: string | null;
  owner: { userId: string; idType: "open_id" | "user_id" | "union_id" } | null;
  sourceVersion: number;
  pushedAt?: string;
  substantiveChanged: boolean;
  idempotencyKey: string;
  sourceValues?: Record<string, unknown>;
  aiValues?: Record<string, unknown>;
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
  reason: "not_in_base_select_options" | "category_omitted_by_policy";
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
      // 「待分类」表示证据不足，按策略不写入 Base 单选；这是有意的分类省略，不是取值不合法。
      if (name === "module" && value === "待分类") {
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
    if (metadata.sourceVersion) delta[metadata.sourceVersion] = String(input.sourceVersion);
    if (metadata.pushState) delta[metadata.pushState] = this.selectValue(metadata.pushState, "已推送");
    if (metadata.lastPushedAt && input.pushedAt) {
      const timestamp = Date.parse(input.pushedAt);
      if (!Number.isFinite(timestamp)) throw new Error("Invalid Base push timestamp");
      delta[metadata.lastPushedAt] = timestamp;
    }
    if (!existing) {
      const created = await this.client.create(delta);
      return { recordId: created.recordId, created: true, omittedFields };
    }

    if (input.substantiveChanged) {
      if (!this.snapshots) throw new Error("PM snapshot writer is unavailable");
      const pmValues = await this.client.readPmFields(existing.recordId);
      await this.snapshots.savePmSnapshot({ requirementId: input.requirementId, sourceVersion: input.sourceVersion, baseRecordId: existing.recordId, pmValues });
      // PM 状态字段来自配置映射（pm 数组首项），不硬编码字段名
      const pmStatusField = this.fields.pm[0];
      if (pmStatusField) delta[pmStatusField] = this.selectValue(pmStatusField, "待处理");
    }
    // Unmapped and empty TB ownership never erases a human-assigned Base owner.
    if (input.owner === null) delete delta[this.fields.owner];
    const updated = await this.client.update(existing.recordId, delta);
    return { recordId: updated.recordId, created: false, omittedFields };
  }
}
