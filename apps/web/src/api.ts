export interface HealthResponse {
  status: string;
  service: string;
}

export interface SourceConfig {
  id: string;
  projectId: string;
  projectName: string;
  requirementTypeId: string;
  enabled: boolean;
  schedule: { enabled: boolean; weekday: number | null; time: string | null; timezone: string | null };
  ownerNames: string[];
  fieldMap: Record<string, string>;
}

export interface SyncRunResponse {
  batchId: string;
  status: "running" | "succeeded" | "partial_failure" | "failed";
}

export type PublishStatus = "draft" | "published" | "retired";

export interface DictionaryVersion {
  version: number;
  status: PublishStatus;
  entries: string[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface PriorityRuleVersion {
  id: string;
  version: number;
  status: PublishStatus;
  rules: { thresholds?: { p0?: number; p1?: number; p2?: number } };
  validationEvidence: unknown[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const detail = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
    throw new ApiError(detail.message ?? `Request failed (${response.status})`, response.status, detail.code ?? "REQUEST_FAILED");
  }
  return body as T;
}

async function requestJson<T>(path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(path, { headers: { accept: "application/json" } });
  return parseJsonResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown, fetcher: typeof fetch, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetcher(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...headers },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  return parseJsonResponse<T>(response);
}

export function getHealth(fetcher: typeof fetch = fetch): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/api/health", fetcher);
}

export async function runSync(
  source: SourceConfig,
  fetcher: typeof fetch = fetch,
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
): Promise<SyncRunResponse> {
  if (!source.enabled) {
    throw new ApiError("Configure and enable a source before starting synchronization.", 400, "SOURCE_NOT_ENABLED");
  }
  return postJson<SyncRunResponse>("/api/sync/run", { sourceId: source.id }, fetcher, { "Idempotency-Key": createIdempotencyKey() });
}

export async function listSources(fetcher: typeof fetch = fetch): Promise<SourceConfig[]> {
  const result = await requestJson<{ items: SourceConfig[] }>("/api/sources", fetcher);
  return result.items;
}

export async function listDictionaryVersions(fetcher: typeof fetch = fetch): Promise<DictionaryVersion[]> {
  const result = await requestJson<{ items: DictionaryVersion[] }>("/api/rules/dictionary", fetcher);
  return result.items;
}

export function createDictionaryDraft(entries: string[], fetcher: typeof fetch = fetch): Promise<DictionaryVersion> {
  return postJson<DictionaryVersion>("/api/rules/dictionary", { entries }, fetcher);
}

export function publishDictionaryVersion(version: number, fetcher: typeof fetch = fetch): Promise<DictionaryVersion> {
  return postJson<DictionaryVersion>(`/api/rules/dictionary/${version}/publish`, null, fetcher);
}

export async function listPriorityRules(fetcher: typeof fetch = fetch): Promise<PriorityRuleVersion[]> {
  const result = await requestJson<{ items: PriorityRuleVersion[] }>("/api/rules/priority", fetcher);
  return result.items;
}

export function createPriorityRuleDraft(
  rules: { thresholds: { p0: number; p1: number; p2: number } },
  fetcher: typeof fetch = fetch,
): Promise<PriorityRuleVersion> {
  return postJson<PriorityRuleVersion>("/api/rules/priority", { rules }, fetcher);
}

export function publishPriorityRule(id: string, fetcher: typeof fetch = fetch): Promise<PriorityRuleVersion> {
  return postJson<PriorityRuleVersion>(`/api/rules/priority/${id}/publish`, null, fetcher);
}
