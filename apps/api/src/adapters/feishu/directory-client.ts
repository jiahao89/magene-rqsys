// Server-side Feishu contact directory adapter. Only identity fields needed by the
// owner picker leave this boundary; contact details and raw provider payloads stay private.
import type { FeishuUserCandidate, FeishuUserDirectory } from "../../application/ports.js";

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

interface FeishuDirectoryConfig {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

interface FeishuEnvelope {
  code?: number;
  tenant_access_token?: string;
  expire?: number;
  data?: { items?: Array<Record<string, unknown>> };
}

export class FeishuUserDirectoryClient implements FeishuUserDirectory {
  private cachedToken: { value: string; expiresAtMs: number } | null = null;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(private readonly config: FeishuDirectoryConfig) {
    this.baseUrl = (config.baseUrl ?? "https://open.feishu.cn").replace(/\/+$/, "");
    this.fetcher = config.fetch ?? globalThis.fetch;
  }

  private async tenantToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs) return this.cachedToken.value;
    const response = await this.fetcher(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    if (!response.ok) throw new Error(`Feishu directory token endpoint returned HTTP ${response.status}`);
    const payload = await response.json() as FeishuEnvelope;
    if (payload.code !== 0 || !payload.tenant_access_token) throw new Error("Feishu directory token request failed");
    const expiresIn = payload.expire ?? 3600;
    this.cachedToken = { value: payload.tenant_access_token, expiresAtMs: Date.now() + expiresIn * 1000 - 60_000 };
    return payload.tenant_access_token;
  }

  async search(query: string): Promise<FeishuUserCandidate[]> {
    const normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 100) throw new Error("Feishu user search query is invalid");
    const token = await this.tenantToken();
    const url = new URL(`${this.baseUrl}/open-apis/contact/v3/users/search`);
    url.searchParams.set("user_id_type", "open_id");
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: normalized, page_size: 20 }),
    });
    if (!response.ok) throw new Error(`Feishu user search returned HTTP ${response.status}`);
    const payload = await response.json() as FeishuEnvelope;
    if (payload.code !== 0) throw new Error("Feishu user search failed");

    return (payload.data?.items ?? [])
      // The API contract promises same-tenant users only. Fail closed when
      // Feishu omits or changes the tenant marker instead of guessing.
      .filter((item) => item.is_cross_tenant === false)
      .flatMap((item): FeishuUserCandidate[] => {
        if (typeof item.open_id !== "string" || !item.open_id || typeof item.name !== "string" || !item.name) return [];
        return [{ openId: item.open_id, name: item.name, ...(typeof item.en_name === "string" && item.en_name ? { enName: item.en_name } : {}) }];
      });
  }
}
