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

export class FeishuBasePushAdapter {
  constructor(private readonly client: BaseClient, private readonly fields: BaseFieldMap, private readonly snapshots?: PmSnapshotWriter) {}

  async push(input: BasePushInput): Promise<{ recordId: string; created: boolean }> {
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
      const allowed = this.fields.selectOptions?.[name];
      if (allowed && !allowed.includes(String(value))) continue;
      if (name === "module" && value === "待分类" && !allowed?.includes("待分类")) continue;
      if (name === "module" || name === "priority") delta[field] = [String(value)];
      else if (name === "analysisVersion") delta[field] = String(value);
      else delta[field] = value;
    }
    const metadata = this.fields.metadata ?? {};
    if (metadata.sourceVersion) delta[metadata.sourceVersion] = String(input.sourceVersion);
    if (metadata.pushState) delta[metadata.pushState] = ["已推送"];
    if (metadata.lastPushedAt && input.pushedAt) {
      const timestamp = Date.parse(input.pushedAt);
      if (!Number.isFinite(timestamp)) throw new Error("Invalid Base push timestamp");
      delta[metadata.lastPushedAt] = timestamp;
    }
    if (!existing) {
      const created = await this.client.create(delta);
      return { recordId: created.recordId, created: true };
    }

    if (input.substantiveChanged) {
      if (!this.snapshots) throw new Error("PM snapshot writer is unavailable");
      const pmValues = await this.client.readPmFields(existing.recordId);
      await this.snapshots.savePmSnapshot({ requirementId: input.requirementId, sourceVersion: input.sourceVersion, baseRecordId: existing.recordId, pmValues });
      // PM 状态字段来自配置映射（pm 数组首项），不硬编码字段名
      const pmStatusField = this.fields.pm[0];
      if (pmStatusField) delta[pmStatusField] = ["待处理"];
    }
    // Unmapped and empty TB ownership never erases a human-assigned Base owner.
    if (input.owner === null) delete delta[this.fields.owner];
    const updated = await this.client.update(existing.recordId, delta);
    return { recordId: updated.recordId, created: false };
  }
}
