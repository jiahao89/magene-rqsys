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
  rules: { scoring: Record<string, Record<string, number>>; thresholds: { p0: number; p1: number; p2: number } },
  fetcher: typeof fetch = fetch,
  validationEvidence: unknown[] = [],
): Promise<PriorityRuleVersion> {
  return postJson<PriorityRuleVersion>("/api/rules/priority", { rules, validationEvidence }, fetcher);
}

export function publishPriorityRule(id: string, fetcher: typeof fetch = fetch): Promise<PriorityRuleVersion> {
  return postJson<PriorityRuleVersion>(`/api/rules/priority/${id}/publish`, null, fetcher);
}

export interface SourceConfigUpdate {
  projectId: string;
  projectName: string;
  requirementTypeId: string;
  enabled: boolean;
  schedule: { enabled: boolean; weekday: number | null; time: string | null; timezone: string | null };
  ownerNames: string[];
  fieldMap: Record<string, string>;
}

export function createSource(update: SourceConfigUpdate, fetcher: typeof fetch = fetch): Promise<SourceConfig> {
  return postJson<SourceConfig>("/api/sources", update, fetcher);
}

async function putJson<T>(path: string, body: unknown, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(path, {
    method: "PUT",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

export function updateSource(id: string, update: SourceConfigUpdate, fetcher: typeof fetch = fetch): Promise<SourceConfig> {
  return putJson<SourceConfig>(`/api/sources/${id}`, update, fetcher);
}

export interface SyncItem {
  id: string;
  requirementId: string | null;
  teambitionRequirementId: string;
  action: "created" | "updated" | "unchanged";
  status: "succeeded" | "failed";
  errorCode: string | null;
  errorDetail: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface BatchDetail {
  batchId: string;
  status: string;
  triggerType?: string;
  actorId?: string | null;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  startedAt?: string;
  completedAt?: string;
  errorSummary?: string | null;
  items: SyncItem[];
}

export function getBatch(id: string, fetcher: typeof fetch = fetch): Promise<BatchDetail> {
  return requestJson<BatchDetail>(`/api/batches/${id}`, fetcher);
}

export function retrySyncItem(id: string, fetcher: typeof fetch = fetch): Promise<{ batchId: string; status: string }> {
  return postJson<{ batchId: string; status: string }>(`/api/items/${id}/retry`, null, fetcher);
}

export function getRequirement(id: string, fetcher: typeof fetch = fetch): Promise<RequirementDetail> {
  return requestJson<RequirementDetail>(`/api/requirements/${id}`, fetcher);
}

export function retryAnalysis(id: string, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; status: string }> {
  return postJson<{ requirementId: string; status: string }>(`/api/analysis/${id}/retry`, null, fetcher);
}

export function pushRequirement(id: string, fetcher: typeof fetch = fetch, idempotencyKey: string = crypto.randomUUID()): Promise<{ status: string; baseRecordId: string | null; created?: boolean }> {
  return postJson<{ status: string; baseRecordId: string | null; created?: boolean }>(`/api/requirements/${id}/push`, null, fetcher, { "Idempotency-Key": idempotencyKey });
}

export function setOwner(id: string, input: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id" }, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; ownerState: string; status: string }> {
  return putJson<{ requirementId: string; ownerState: string; status: string }>(`/api/requirements/${id}/owner`, input, fetcher);
}

export interface AuditEvent {
  id: string;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  result: "succeeded" | "failed" | "denied";
  safeDetails: Record<string, unknown>;
  occurredAt: string;
}

export interface RequirementSummary {
  id: string;
  sourceRequirementId: string;
  title: string;
  sourceVersion: number;
  pipeline: { pull: string; analysis: string; owner: string; push: string };
}

export interface AnalysisVersionSummary {
  analysisVersion: number;
  status: string;
  moduleSuggestion: string | null;
  confidence: string | null;
  priority: string | null;
  startedAt: string;
  completedAt: string | null;
  safeErrorSummary: string | null;
}

export interface RequirementDetail {
  id: string;
  sourceRequirementId: string;
  title: string;
  sourceVersion: number;
  pipeline: { pull: string; analysis: string; owner: string; push: string };
  source: Record<string, unknown>;
  analysis: Record<string, unknown> | null;
  analyses: AnalysisVersionSummary[];
  baseRecordId: string | null;
}

export interface BatchSummary {
  id: string;
  status: string;
  triggerType?: string;
  actorId?: string | null;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  startedAt?: string;
}

export async function listRequirements(params: { q?: string; ownerState?: string; analysisState?: string; limit?: number; cursor?: string; fetcher?: typeof fetch } = {}): Promise<{ items: RequirementSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, ...query } = params;
  const search = new URLSearchParams();
  if (query.q) search.set("q", query.q);
  if (query.ownerState) search.set("ownerState", query.ownerState);
  if (query.analysisState) search.set("analysisState", query.analysisState);
  if (query.limit !== undefined) search.set("limit", String(query.limit));
  if (query.cursor) search.set("cursor", query.cursor);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<{ items: RequirementSummary[]; nextCursor: string | null }>(`/api/requirements${suffix}`, fetcher);
}

export async function listBatches(params: { status?: string; limit?: number; cursor?: string; fetcher?: typeof fetch } = {}): Promise<{ items: BatchSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, ...query } = params;
  const search = new URLSearchParams();
  if (query.status) search.set("status", query.status);
  if (query.limit !== undefined) search.set("limit", String(query.limit));
  if (query.cursor) search.set("cursor", query.cursor);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<{ items: BatchSummary[]; nextCursor: string | null }>(`/api/batches${suffix}`, fetcher);
}

export interface PersonMapping {
  id: string;
  teambitionUserId: string | null;
  teambitionDisplayName: string | null;
  feishuUserId: string;
  feishuIdType: "open_id" | "user_id" | "union_id";
  matchMethod: "tb_user_id" | "unique_name" | "manual";
  createdBy: string | null;
  updatedAt: string;
}

export async function listMappings(fetcher: typeof fetch = fetch): Promise<PersonMapping[]> {
  const result = await requestJson<{ items: PersonMapping[] }>("/api/mappings", fetcher);
  return result.items;
}

export function listAudit(params: { entityId?: string; since?: string; until?: string; limit?: number; fetcher?: typeof fetch } = {}): Promise<AuditEvent[]> {
  const { fetcher = fetch, ...query } = params;
  const search = new URLSearchParams();
  if (query.entityId) search.set("entityId", query.entityId);
  if (query.since) search.set("since", query.since);
  if (query.until) search.set("until", query.until);
  if (query.limit !== undefined) search.set("limit", String(query.limit));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<{ items: AuditEvent[] }>(`/api/audit${suffix}`, fetcher).then((result) => result.items);
}
