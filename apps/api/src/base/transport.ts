// Feishu bitable v1 transport：BaseClient 的生产实现。
// 凭据（FEISHU_APP_ID/FEISHU_APP_SECRET）与目标表（BASE_APP_TOKEN/BASE_TABLE_ID）
// 由服务端环境注入；tenant_access_token 缓存至过期前 60 秒。
// 测试用注入 fetch 的假实现；真实调用需部署环境凭证（工单 00/W7）。

import type { BaseClient, BaseRecord, BaseRequirementKey } from "./client.js";

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface FeishuBitableConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  tableId: string;
  // 复合键字段名（Base schema 专属，来自字段映射配置）
  keyFields: { projectId: string; requirementId: string };
  baseUrl?: string;
  fetch?: FetchLike;
}

interface FeishuEnvelope {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
  data?: {
    items?: Array<{ record_id: string; fields?: Record<string, unknown> }>;
    record?: { record_id: string; fields?: Record<string, unknown> };
  };
}

export class FeishuBitableClient implements BaseClient {
  private cachedToken: { value: string; expiresAtMs: number } | null = null;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(private readonly config: FeishuBitableConfig) {
    this.baseUrl = (config.baseUrl ?? "https://open.feishu.cn").replace(/\/+$/, "");
    this.fetcher = config.fetch ?? globalThis.fetch;
  }

  private async tenantToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs) return this.cachedToken.value;
    const res = await this.fetcher(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    if (!res.ok) throw new Error(`Feishu token endpoint returned HTTP ${res.status}`);
    const payload = (await res.json()) as FeishuEnvelope;
    if (payload.code !== 0 || !payload.tenant_access_token) throw new Error(`Feishu token request failed (code ${payload.code})`);
    const expireMs = (payload.expire ?? 3600) * 1000;
    this.cachedToken = { value: payload.tenant_access_token, expiresAtMs: Date.now() + expireMs - 60_000 };
    return payload.tenant_access_token;
  }

  private async authed(url: string, init: RequestInit): Promise<Response> {
    const token = await this.tenantToken();
    const headers = { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" };
    return this.fetcher(url, { ...init, headers });
  }

  private assertOk(payload: FeishuEnvelope, action: string): void {
    if (payload.code !== 0) throw new Error(`Feishu ${action} failed (code ${payload.code})`);
  }

  async findByRequirementKey(key: BaseRequirementKey): Promise<BaseRecord | null> {
    // 复合键查询走 base/v3（Ticket 02 POC 验证过的格式）：
    // bitable v1 records/search 在非 advanced 表上不支持该过滤（条件被忽略或校验拒绝，2026-10-09 真实冒烟发现）。
    const filter = JSON.stringify({
      conditions: [
        [this.config.keyFields.projectId, "==", key.projectId],
        [this.config.keyFields.requirementId, "==", key.requirementId],
      ],
      logic: "and",
    });
    const query = new URLSearchParams({ filter, limit: "100" });
    const res = await this.authed(
      `${this.baseUrl}/open-apis/base/v3/bases/${this.config.appToken}/tables/${this.config.tableId}/records?${query.toString()}`,
      { method: "GET" },
    );
    if (!res.ok) throw new Error(`Feishu records filter returned HTTP ${res.status}`);
    const payload = (await res.json()) as FeishuEnvelope & { data?: { record_id_list?: string[] } };
    this.assertOk(payload, "records filter");
    const recordId = payload.data?.record_id_list?.[0];
    if (!recordId) return null;
    // 命名字段读取走 bitable v1 GET
    return this.readRecord(recordId);
  }

  async create(fields: Record<string, unknown>): Promise<BaseRecord> {
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`,
      { method: "POST", body: JSON.stringify({ fields }) },
    );
    if (!res.ok) throw new Error(`Feishu record create returned HTTP ${res.status}`);
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "record create");
    if (!payload.data?.record) throw new Error("Feishu record create returned no record");
    return { recordId: payload.data.record.record_id, fields: payload.data.record.fields ?? {} };
  }

  async update(recordId: string, fields: Record<string, unknown>): Promise<BaseRecord> {
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/${recordId}`,
      { method: "PUT", body: JSON.stringify({ fields }) },
    );
    if (!res.ok) throw new Error(`Feishu record update returned HTTP ${res.status}`);
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "record update");
    if (!payload.data?.record) throw new Error("Feishu record update returned no record");
    return { recordId: payload.data.record.record_id, fields: payload.data.record.fields ?? {} };
  }

  async readPmFields(recordId: string): Promise<Record<string, unknown>> {
    return (await this.readRecord(recordId)).fields;
  }

  private async readRecord(recordId: string): Promise<BaseRecord> {
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/${recordId}`,
      { method: "GET" },
    );
    if (!res.ok) throw new Error(`Feishu record read returned HTTP ${res.status}`);
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "record read");
    if (!payload.data?.record) throw new Error("Feishu record read returned no record");
    return { recordId: payload.data.record.record_id, fields: payload.data.record.fields ?? {} };
  }
}
