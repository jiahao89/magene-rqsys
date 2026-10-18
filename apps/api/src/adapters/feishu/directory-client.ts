// Official Feishu search: user identity only. Never substitute a tenant token.
import { FeishuDirectoryFailure, type FeishuUserCandidate, type FeishuUserDirectory } from "../../application/ports.js";
export interface FetchLike { (input: string | URL, init?: RequestInit): Promise<Response>; }
interface FeishuDirectoryConfig {
  userAccessToken: () => Promise<string>;
  baseUrl?: string;
  fetch?: FetchLike;
}
interface SearchEnvelope { code?: number; data?: { users?: Array<Record<string, unknown>> }; }
export class FeishuUserDirectoryClient implements FeishuUserDirectory {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  constructor(private readonly config: FeishuDirectoryConfig) {
    this.baseUrl = (config.baseUrl ?? "https://open.feishu.cn").replace(/\/+$/, "");
    this.fetcher = config.fetch ?? globalThis.fetch;
  }
  async search(query: string): Promise<FeishuUserCandidate[]> {
    const normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 100) throw new Error("Feishu user search query is invalid");
    const token = await this.config.userAccessToken();
    if (!token) throw new FeishuDirectoryFailure("user_search", "invalid_response");
    const url = new URL(`${this.baseUrl}/open-apis/search/v1/user`);
    url.searchParams.set("query", normalized);
    url.searchParams.set("page_size", "20");
    let response: Response;
    try { response = await this.fetcher(url, { method: "GET", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }); }
    catch { throw new FeishuDirectoryFailure("user_search", "network_error"); }
    let payload: SearchEnvelope;
    try { payload = await response.json() as SearchEnvelope; }
    catch { throw new FeishuDirectoryFailure("user_search", "invalid_response", response.status); }
    const providerCode = typeof payload?.code === "number" && Number.isSafeInteger(payload.code) ? payload.code : undefined;
    if (!response.ok) throw new FeishuDirectoryFailure("user_search", "http_error", response.status, providerCode);
    if (payload?.code !== 0) throw new FeishuDirectoryFailure("user_search", "provider_error", response.status, providerCode);
    if (!Array.isArray(payload.data?.users)) throw new FeishuDirectoryFailure("user_search", "invalid_response");
    // The documented API excludes external and departed users. It does not return is_cross_tenant.
    return payload.data.users.slice(0, 20).flatMap((user): FeishuUserCandidate[] =>
      typeof user?.open_id === "string" && user.open_id && typeof user.name === "string" && user.name
        ? [{ openId: user.open_id, name: user.name }] : []);
  }
}
