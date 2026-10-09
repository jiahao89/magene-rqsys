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
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/search`,
      {
        method: "POST",
        body: JSON.stringify({
          conjunction: "and",
          conditions: [
            { field_name: this.config.keyFields.projectId, op: "is", value: [key.projectId] },
            { field_name: this.config.keyFields.requirementId, op: "is", value: [key.requirementId] },
          ],
        }),
      },
    );
    if (!res.ok) throw new Error(`Feishu records search returned HTTP ${res.status}`);
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "records search");
    const item = payload.data?.items?.[0];
    return item ? { recordId: item.record_id, fields: item.fields ?? {} } : null;
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
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/${recordId}`,
      { method: "GET" },
    );
    if (!res.ok) throw new Error(`Feishu record read returned HTTP ${res.status}`);
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "record read");
    return payload.data?.record?.fields ?? {};
  }
}
