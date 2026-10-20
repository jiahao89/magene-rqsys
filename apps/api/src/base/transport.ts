// Feishu bitable v1 transport：BaseClient 的生产实现。
// 凭据（FEISHU_APP_ID/FEISHU_APP_SECRET）与目标表（BASE_APP_TOKEN/BASE_TABLE_ID）
// 由服务端环境注入；tenant_access_token 缓存至过期前 60 秒。
// 测试用注入 fetch 的假实现；真实调用需部署环境凭证（工单 00/W7）。

import type { BaseClient, BaseRecord, BaseRequirementKey, BaseWriteOptions } from "./client.js";

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface FeishuBitableConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  tableId: string;
  // Teambition ID is unique within the single configured source project and is the Base upsert key.
  keyFields: { requirementId: string; projectId?: string };
  baseUrl?: string;
  fetch?: FetchLike;
  /** 单次 Base 请求超时（毫秒）。默认 15s；设为 0 关闭。 */
  timeoutMs?: number;
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

export type FeishuAction = "token endpoint" | "token request" | "field schema" | "records filter" | "record read" | "record create" | "record update";
export type FeishuFailureKind = "http" | "api" | "invalid_response" | "ambiguous_response";

/** Structured safe error metadata; callers should use fields, never parse message text. */
export class FeishuApiError extends Error {
  constructor(
    readonly kind: FeishuFailureKind,
    readonly action: FeishuAction,
    readonly httpStatus?: number,
    readonly apiCode?: number,
  ) {
    const detail = apiCode === undefined ? (httpStatus === undefined ? kind : `HTTP ${httpStatus}`) : `code ${apiCode}`;
    const message = kind === "http"
      ? `Feishu ${action} returned HTTP ${httpStatus}${apiCode === undefined ? "" : ` (code ${apiCode})`}`
      : kind === "ambiguous_response"
      ? "Feishu records filter returned multiple records for the configured requirement key"
      : kind === "invalid_response"
        ? `Feishu ${action} returned an invalid response`
        : `Feishu ${action} failed (${detail})`;
    super(message);
    this.name = "FeishuApiError";
  }
}

async function feishuHttpFailure(response: Response, action: FeishuAction): Promise<FeishuApiError> {
  let code: number | undefined;
  try {
    const payload = await response.json() as { code?: unknown };
    if (typeof payload.code === "number" && Number.isSafeInteger(payload.code)) code = payload.code;
  } catch { /* response bodies are deliberately not surfaced or logged */ }
  return new FeishuApiError("http", action, response.status, code);
}

export class FeishuBitableClient implements BaseClient {
  private cachedToken: { value: string; expiresAtMs: number } | null = null;
  private cachedFieldTypes: { types: Map<string, number>; expiresAtMs: number } | null = null;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  private readonly timeoutMs: number;

  constructor(private readonly config: FeishuBitableConfig) {
    this.baseUrl = (config.baseUrl ?? "https://open.feishu.cn").replace(/\/+$/, "");
    this.fetcher = config.fetch ?? globalThis.fetch;
    // 没有超时的话，一条挂死的连接会阻塞整个串行 Base 队列（RateLimitedBaseClient 串行化），
    // 所有推送一起卡住直到租约过期重试。TB / DeepSeek / 搜索适配器都有超时，Base 此前没有。
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  /** 给请求附加超时信号；调用方已自带 signal 时不覆盖。 */
  private withTimeout(init: RequestInit): RequestInit {
    if (this.timeoutMs <= 0 || init.signal !== undefined || init.signal !== null) return init;
    return { ...init, signal: AbortSignal.timeout(this.timeoutMs) };
  }

  private async tenantToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs) return this.cachedToken.value;
    const res = await this.fetcher(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, this.withTimeout({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    }));
    if (!res.ok) throw await feishuHttpFailure(res, "token endpoint");
    const payload = (await res.json()) as FeishuEnvelope;
    if (payload.code !== 0) throw new FeishuApiError("api", "token request", undefined, payload.code);
    if (!payload.tenant_access_token) throw new FeishuApiError("invalid_response", "token request");
    const expireMs = (payload.expire ?? 3600) * 1000;
    this.cachedToken = { value: payload.tenant_access_token, expiresAtMs: Date.now() + expireMs - 60_000 };
    return payload.tenant_access_token;
  }

  private async authed(url: string, init: RequestInit): Promise<Response> {
    const token = await this.tenantToken();
    const headers = { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" };
    return this.fetcher(url, this.withTimeout({ ...init, headers }));
  }

  private assertOk(payload: Pick<FeishuEnvelope, "code">, action: FeishuAction): void {
    if (payload.code !== 0) throw new FeishuApiError("api", action, undefined, payload.code);
  }

  async readFieldType(fieldName: string): Promise<number> {
    if (this.cachedFieldTypes && Date.now() < this.cachedFieldTypes.expiresAtMs) {
      const type = this.cachedFieldTypes.types.get(fieldName);
      if (type !== undefined) return type;
      throw new FeishuApiError("invalid_response", "field schema");
    }
    const types = new Map<string, number>();
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ page_size: "100", ...(pageToken ? { page_token: pageToken } : {}) });
      const res = await this.authed(`${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/fields?${query}`, { method: "GET" });
      if (!res.ok) throw await feishuHttpFailure(res, "field schema");
      const payload = await res.json() as { code?: number; data?: { items?: Array<{ field_name?: unknown; type?: unknown }>; has_more?: boolean; page_token?: unknown } };
      this.assertOk(payload, "field schema");
      if (!Array.isArray(payload.data?.items)) throw new FeishuApiError("invalid_response", "field schema");
      for (const field of payload.data.items) {
        if (typeof field.field_name !== "string" || typeof field.type !== "number" || !Number.isSafeInteger(field.type) || types.has(field.field_name)) {
          throw new FeishuApiError("invalid_response", "field schema");
        }
        types.set(field.field_name, field.type);
      }
      if (payload.data.has_more === false) {
        const type = types.get(fieldName);
        if (type === undefined) throw new FeishuApiError("invalid_response", "field schema");
        this.cachedFieldTypes = { types, expiresAtMs: Date.now() + 300_000 };
        return type;
      }
      if (payload.data.has_more !== true || typeof payload.data.page_token !== "string" || !payload.data.page_token || seenTokens.has(payload.data.page_token)) {
        throw new FeishuApiError("invalid_response", "field schema");
      }
      pageToken = payload.data.page_token;
      seenTokens.add(pageToken);
    }
    throw new FeishuApiError("invalid_response", "field schema");
  }

  async findByRequirementKey(key: BaseRequirementKey): Promise<BaseRecord | null> {
    // Use the public Bitable v1 records endpoint. base/v3 is a web-client route:
    // it can work under a user session but returns access denied with the app token.
    // Formula strings use exact equality and JSON string escaping for source IDs.
    const filter = `CurrentValue.[${this.config.keyFields.requirementId}] = ${JSON.stringify(key.requirementId)}`;
    const query = new URLSearchParams({
      filter,
      field_names: JSON.stringify([this.config.keyFields.requirementId]),
      page_size: "2",
    });
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records?${query.toString()}`,
      { method: "GET" },
    );
    if (!res.ok) throw await feishuHttpFailure(res, "records filter");
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "records filter");
    const items = payload.data?.items ?? [];
    if (items.length > 1) throw new FeishuApiError("ambiguous_response", "records filter");
    const record = items[0];
    return record ? { recordId: record.record_id, fields: record.fields ?? {} } : null;
  }

  async create(fields: Record<string, unknown>, options?: BaseWriteOptions): Promise<BaseRecord> {
    const query = new URLSearchParams();
    if (options?.userIdType) query.set("user_id_type", options.userIdType);
    const suffix = query.size ? `?${query.toString()}` : "";
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records${suffix}`,
      { method: "POST", body: JSON.stringify({ fields }) },
    );
    if (!res.ok) throw await feishuHttpFailure(res, "record create");
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "record create");
    if (!payload.data?.record) throw new FeishuApiError("invalid_response", "record create");
    return { recordId: payload.data.record.record_id, fields: payload.data.record.fields ?? {} };
  }

  async update(recordId: string, fields: Record<string, unknown>, options?: BaseWriteOptions): Promise<BaseRecord> {
    const query = new URLSearchParams();
    if (options?.userIdType) query.set("user_id_type", options.userIdType);
    const suffix = query.size ? `?${query.toString()}` : "";
    const res = await this.authed(
      `${this.baseUrl}/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/${recordId}${suffix}`,
      { method: "PUT", body: JSON.stringify({ fields }) },
    );
    if (!res.ok) throw await feishuHttpFailure(res, "record update");
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "record update");
    if (!payload.data?.record) throw new FeishuApiError("invalid_response", "record update");
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
    if (!res.ok) throw await feishuHttpFailure(res, "record read");
    const payload = (await res.json()) as FeishuEnvelope;
    this.assertOk(payload, "record read");
    if (!payload.data?.record) throw new FeishuApiError("invalid_response", "record read");
    return { recordId: payload.data.record.record_id, fields: payload.data.record.fields ?? {} };
  }
}
