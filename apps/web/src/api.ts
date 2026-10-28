export interface HealthResponse {
  status: string;
  service: string;
}

export interface OverviewMetrics {
  total: number;
  pullSynced: number;
  analysisAnalyzed: number;
  ownerResolved: number;
  pushPushed: number;
  pushFailed: number;
  pushPending: number;
  failed: number;
  /** 总览分级统计：当前评分优先；无评分时使用最近一次已分析优先级（legacy）。 */
  priority?: { P0: number; P1: number; P2: number; P3: number; scored: number; legacy: number; unscored: number } | null;
  /** 当前已发布评分规则；规则未发布时为 null。 */
  priorityRule?: { version: number; thresholds: { p0: number; p1: number; p2: number } | null; formulaText: string } | null;
}

export interface SourceConfig {
  id: string;
  projectName: string;
  enabled: boolean;
  schedule: { enabled: boolean; weekday: number | null; weekdays?: number[] | null; time: string | null; timezone: string | null };
}

export interface SyncRunResponse {
  batchId: string;
  status: "running" | "succeeded" | "partial_failure" | "failed";
}
export type SyncExecutionMode = "full_pipeline" | "source_only";

export interface FeishuUserCandidate {
  openId: string;
  name: string;
  enName?: string;
}

export type PublishStatus = "draft" | "published" | "retired";

export interface DictionaryVersion {
  version: number;
  status: PublishStatus;
  entries: (string | FunctionModuleEntry)[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

// 人员页的飞书绑定：未绑定时三个字段为 null；bindingConflict 表示同名映射指向多个账号。
export interface TeamPerson {
  name: string;
  feishuUserId: string | null;
  feishuIdType: "open_id" | "user_id" | "union_id" | null;
  boundAt: string | null;
  bindingConflict: boolean;
}
export interface FunctionModuleEntry { name: string; personName: string | null }
export interface FunctionModuleDirectory { version: number; items: FunctionModuleEntry[] }

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

async function putJson<T>(path: string, body: unknown, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(path, { method: "PUT", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
  return parseJsonResponse<T>(response);
}

async function deleteJson<T>(path: string, fetcher: typeof fetch): Promise<T> {
  return parseJsonResponse<T>(await fetcher(path, { method: "DELETE", headers: { accept: "application/json" } }));
}

export function getHealth(fetcher: typeof fetch = fetch): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/api/health", fetcher);
}

export async function getOverviewMetrics(fetcher: typeof fetch = fetch): Promise<OverviewMetrics> {
  const result = await requestJson<{ counts: OverviewMetrics }>("/api/overview/metrics", fetcher);
  const keys = ["total", "pullSynced", "analysisAnalyzed", "ownerResolved", "pushPushed", "failed"] as const;
  const rawCounts = result.counts as unknown as Record<string, unknown> | undefined;
  if (!result.counts || !rawCounts || keys.some((key) => !Number.isInteger(rawCounts[key]) || Number(rawCounts[key]) < 0)) {
    throw new ApiError("Overview metrics response is invalid", 502, "INVALID_METRICS_RESPONSE");
  }
  return result.counts;
}

export async function runSync(
  source: SourceConfig,
  mode: SyncExecutionMode = "full_pipeline",
  fetcher: typeof fetch = fetch,
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
): Promise<SyncRunResponse> {
  if (!source.enabled) {
    throw new ApiError("Configure and enable a source before starting synchronization.", 400, "SOURCE_NOT_ENABLED");
  }
  return postJson<SyncRunResponse>("/api/sync/run", { sourceId: source.id, ...(mode === "source_only" ? { mode } : {}) }, fetcher, { "Idempotency-Key": createIdempotencyKey() });
}

export async function listSources(fetcher: typeof fetch = fetch): Promise<SourceConfig[]> {
  const result = await requestJson<{ items: SourceConfig[] }>("/api/sources", fetcher);
  return result.items;
}

export async function listTeamPeople(fetcher: typeof fetch = fetch): Promise<TeamPerson[]> {
  return (await requestJson<{ items: TeamPerson[] }>("/api/people", fetcher)).items;
}
export function addTeamPerson(name: string, fetcher: typeof fetch = fetch) { return postJson<{ items: TeamPerson[] }>("/api/people", { name }, fetcher); }
export function renameTeamPerson(oldName: string, name: string, fetcher: typeof fetch = fetch) { return putJson<{ items: TeamPerson[] }>(`/api/people/${encodeURIComponent(oldName)}`, { name }, fetcher); }
export function deleteTeamPerson(name: string, fetcher: typeof fetch = fetch) { return deleteJson<{ items: TeamPerson[] }>(`/api/people/${encodeURIComponent(name)}`, fetcher); }
export function bindTeamPersonFeishu(name: string, selection: FeishuUserSelection, fetcher: typeof fetch = fetch) {
  return putJson<{ items: TeamPerson[] }>(`/api/people/${encodeURIComponent(name)}/feishu`, { feishuUserId: selection.feishuUserId, feishuIdType: selection.feishuIdType }, fetcher);
}
export function unbindTeamPersonFeishu(name: string, fetcher: typeof fetch = fetch) {
  return deleteJson<{ items: TeamPerson[] }>(`/api/people/${encodeURIComponent(name)}/feishu`, fetcher);
}
export function getFunctionModules(fetcher: typeof fetch = fetch) { return requestJson<FunctionModuleDirectory>("/api/modules", fetcher); }
export function saveFunctionModules(version: number, items: FunctionModuleEntry[], fetcher: typeof fetch = fetch) { return putJson<FunctionModuleDirectory>("/api/modules", { version, items }, fetcher); }

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
  projectName: string;
  enabled: boolean;
  schedule: { enabled: boolean; weekday: number | null; weekdays?: number[] | null; time: string | null; timezone: string | null };
}

export function createSource(update: SourceConfigUpdate, fetcher: typeof fetch = fetch): Promise<SourceConfig> {
  return postJson<SourceConfig>("/api/sources", update, fetcher);
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
  id: string;
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

export function retrySyncItem(id: string, fetcher: typeof fetch = fetch, idempotencyKey: string = crypto.randomUUID()): Promise<{ batchId: string; status: string }> {
  return postJson<{ batchId: string; status: string }>(`/api/items/${id}/retry`, null, fetcher, { "Idempotency-Key": idempotencyKey });
}

export function getRequirement(id: string, fetcher: typeof fetch = fetch): Promise<RequirementDetail> {
  return requestJson<RequirementDetail>(`/api/requirements/${id}`, fetcher);
}

export function retryAnalysis(id: string, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; status: string }> {
  return postJson<{ requirementId: string; status: string }>(`/api/analysis/${id}/retry`, null, fetcher);
}

export function pushRequirement(id: string, fetcher: typeof fetch = fetch, idempotencyKey: string = crypto.randomUUID()): Promise<{ requirementId: string; status: string }> {
  return postJson<{ requirementId: string; status: string }>(`/api/requirements/${id}/push`, null, fetcher, { "Idempotency-Key": idempotencyKey });
}

export function setOwner(id: string, input: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; tbDisplayName?: string | null }, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; ownerState: string; status: string }> {
  return putJson<{ requirementId: string; ownerState: string; status: string }>(`/api/requirements/${id}/owner`, input, fetcher);
}

/** 清除本条需求的人工负责人，恢复为 TB 执行人默认负责人（无执行人时为空负责人）。 */
export function clearOwner(id: string, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; ownerState: RequirementOwnerState; status: string }> {
  return deleteJson<{ requirementId: string; ownerState: RequirementOwnerState; status: string }>(`/api/requirements/${id}/owner`, fetcher);
}

export async function searchFeishuUsers(query: string, fetcher: typeof fetch = fetch): Promise<FeishuUserCandidate[]> {
  const params = new URLSearchParams({ q: query.trim() });
  const result = await requestJson<{ items: FeishuUserCandidate[] }>(`/api/feishu/users?${params.toString()}`, fetcher);
  return result.items;
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

export type RequirementOwnerState = "pending_mapping" | "auto_mapped" | "manually_mapped" | "not_required";

/**
 * 列表 DTO 实际包含 `source`（Teambition allowlist 快照）；`ownerName`/`updatedAt`
 * 是可选展示字段，只有服务端未来下发时才使用。缺失时由 UI 显示「—」。
 */
export interface RequirementSummary {
  id: string;
  sourceRequirementId: string | null;
  sourceType: "teambition" | "web_manual";
  sourceChannel: string | null;
  productModel: string | null;
  requirementType: string | null;
  constraintNotes: string | null;
  supplementUrl: string | null;
  intakeModule: string | null;
  audience: { tags: string[]; confirmed: boolean; version: number };
  title: string;
  sourceVersion: number;
  pipeline: { pull: string; analysis: string; owner: RequirementOwnerState; push: string };
  source?: Record<string, unknown>;
  ownerName?: string | null;
  manualOwner?: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; name: string | null; assignedAt: string } | null;
  duplicateOf?: string | null;
  updatedAt?: string | null;
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

export interface ScoringInputs {
  user: { pain: number; frequency: number };
  market: { sellingPoint: number; competitor: number };
  strategy: { roadmap: number; dependency: number };
  cost: { workload: number; technicalRisk: number; resource: number };
}

export interface RequirementScoreVersion {
  id: string;
  requirementId: string;
  version: number;
  status: "ai_suggested" | "current" | "confirmed" | "superseded";
  origin: "ai" | "manual" | "ai_applied";
  sourceVersion: number;
  analysisVersion: number | null;
  ruleVersionId: string | null;
  inputs: ScoringInputs;
  alpha: number;
  score: number;
  priority: "P0" | "P1" | "P2" | "P3";
  scoreConfidence: "高" | "中" | "低" | null;
  scoreConfidenceReason: string | null;
  safetyFlag: boolean;
  basis: Record<string, { reason: string; evidence: string[]; assumption: boolean }>;
  rationale: string | null;
  actorId: string | null;
  changeReason: string | null;
  createdAt: string;
}

export interface ScoringData {
  current: RequirementScoreVersion | null;
  aiSuggestion: RequirementScoreVersion | null;
  history: RequirementScoreVersion[];
  formula: { text: string; thresholds: { p0: number; p1: number; p2: number } };
}

export interface RequirementDetail {
  /** RQ-Sys 展示编号，例如 RQ-000123。 */
  platformRequirementId?: string | null;
  /** 由需求 ID 推导的 Teambition 任务地址（原始 payload 通常不含该字段）。 */
  sourceUrl?: string | null;
  id: string;
  sourceRequirementId: string | null;
  sourceType: "teambition" | "web_manual";
  sourceChannel: string | null;
  productModel: string | null;
  requirementType: string | null;
  constraintNotes: string | null;
  supplementUrl: string | null;
  intakeModule: string | null;
  audience: { tags: string[]; confirmed: boolean; version: number };
  title: string;
  description: string | null;
  sourceVersion: number;
  pipeline: { pull: string; analysis: string; owner: RequirementOwnerState; push: string };
  source: Record<string, unknown>;
  analysis: Record<string, unknown> | null;
  analyses: AnalysisVersionSummary[];
  baseRecordId: string | null;
  ownerName?: string | null;
  manualOwner?: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; name: string | null; assignedAt: string } | null;
  duplicateOf?: string | null;
  duplicates?: Array<{ id: string; title: string; teambitionRequirementId: string }>;
  scoring?: ScoringData | null;
  updatedAt?: string | null;
  lastPushedAt?: string | null;
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

// 列表查询参数统一拼装（剔除空值）
function buildSearch(query: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}

export async function listRequirements(params: { q?: string; executorName?: string; pullState?: string; ownerState?: string; analysisState?: string; pushState?: string; batchId?: string; since?: string; until?: string; limit?: number; cursor?: string; fetcher?: typeof fetch } = {}): Promise<{ items: RequirementSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, q, executorName, pullState, ownerState, analysisState, pushState, batchId, since, until, limit, cursor } = params;
  return requestJson<{ items: RequirementSummary[]; nextCursor: string | null }>(`/api/requirements${buildSearch({ q, executorName, pullState, ownerState, analysisState, pushState, batchId, since, until, limit, cursor })}`, fetcher);
}

export async function listBatches(params: { status?: string; since?: string; until?: string; limit?: number; cursor?: string; fetcher?: typeof fetch } = {}): Promise<{ items: BatchSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, status, since, until, limit, cursor } = params;
  return requestJson<{ items: BatchSummary[]; nextCursor: string | null }>(`/api/batches${buildSearch({ status, since, until, limit, cursor })}`, fetcher);
}

export interface FeishuUserSelection {
  feishuUserId: string;
  feishuIdType: "open_id" | "user_id" | "union_id";
  name: string;
}

export async function resolveFeishuUser(platformUserId: string, fetcher: typeof fetch = fetch): Promise<FeishuUserSelection> {
  return requestJson<FeishuUserSelection>(`/api/feishu/users/resolve?platformUserId=${encodeURIComponent(platformUserId)}`, fetcher);
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
  const { fetcher = fetch, entityId, since, until, limit } = params;
  return requestJson<{ items: AuditEvent[] }>(`/api/audit${buildSearch({ entityId, since, until, limit })}`, fetcher).then((result) => result.items);
}

export interface IntakeResult {
  requirementId: string;
  platformRequirementId?: string;
  sourceType: "web_manual";
  status: string;
}
export const REQUIREMENT_INTAKE_CHANNELS = ["销售", "售后", "电商", "运营/用研", "终端用户", "产品/研发/测试"] as const;
// 同一次提交（含失败重试）复用同一幂等键；成功后由表单重新生成（V02-T04-AC03）。
export function createRequirement(input: { title: string; description: string; sourceChannel: string; productModel?: string | null; requirementType?: string | null; constraintNotes?: string | null; supplementUrl?: string | null; intakeModule?: string | null; owner?: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; tbDisplayName?: string | null } }, fetcher: typeof fetch = fetch, idempotencyKey: string = crypto.randomUUID()): Promise<IntakeResult> {
  return postJson<IntakeResult>("/api/requirements", input, fetcher, { "Idempotency-Key": idempotencyKey });
}
export const REQUIREMENT_INTAKE_TYPES = ["新增功能", "功能扩展", "体验优化", "性能优化", "质量修复", "安全合规", "成本效率", "技术治理"] as const;

async function patchJson<T>(path: string, body: unknown, fetcher: typeof fetch, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetcher(path, { method: "PATCH", headers: { accept: "application/json", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return parseJsonResponse<T>(response);
}

export interface ManualEditResult {
  requirementId: string;
  outcome: "updated" | "unchanged" | "replay";
  sourceVersion: number;
  substantiveChanged?: boolean;
}
// V02-T07：手工编辑。同一次保存（含失败重试）复用同一幂等键；expectedSourceVersion 做乐观并发。
export function updateRequirement(id: string, input: { expectedSourceVersion: number; title?: string; description?: string | null; sourceChannel?: string; productModel?: string | null; requirementType?: string | null; constraintNotes?: string | null; supplementUrl?: string | null }, fetcher: typeof fetch = fetch, idempotencyKey: string = crypto.randomUUID()): Promise<ManualEditResult> {
  return patchJson<ManualEditResult>(`/api/requirements/${id}`, input, fetcher, { "Idempotency-Key": idempotencyKey });
}
export const AUDIENCE_LEVELS = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
export const AUDIENCE_LEVEL_NAMES: Record<string, string> = { L1: "L1 职业级 Pro", L2: "L2 竞技级 Racing", L3: "L3 爱好者/专业入门", L4: "L4 健身锻炼", L5: "L5 休闲娱乐", L6: "L6 通勤代步" };

export function saveRequirementScore(id: string, input: { expectedVersion: number; inputs: ScoringInputs; alpha: number; safetyFlag?: boolean; reason: string }, fetcher: typeof fetch = fetch): Promise<{ scoring: unknown }> {
  return putJson(`/api/requirements/${id}/scoring`, input, fetcher);
}

export function applyRequirementAiScore(id: string, input: { expectedVersion: number; aiVersion: number; reason?: string | null }, fetcher: typeof fetch = fetch): Promise<{ scoring: unknown }> {
  return postJson(`/api/requirements/${id}/scoring/apply-ai`, input, fetcher);
}

export function setAudienceTags(id: string, input: { tags: string[]; expectedVersion: number }, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; audienceVersion: number; confirmed: boolean; tags: string[] }> {
  return putJson(`/api/requirements/${id}/audience`, input, fetcher);
}
export interface RiceDraft {
  requirementId: string;
  inputs: { reach: string | null; impact: string | null; confidence: string | null; effort: string | null };
  notes: string | null;
  sourceVersion: number;
  editVersion: number;
  updatedBy: string | null;
  updatedAt: string | null;
  status: string;
  score: number | null;
}
export function getRiceDraft(id: string, fetcher: typeof fetch = fetch): Promise<RiceDraft> {
  return requestJson<RiceDraft>(`/api/requirements/${id}/rice-draft`, fetcher);
}
export function saveRiceDraft(id: string, input: { reach?: string | null; impact?: string | null; confidence?: string | null; effort?: string | null; notes?: string | null; expectedEditVersion: number }, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; editVersion: number; status: string }> {
  return putJson(`/api/requirements/${id}/rice-draft`, input, fetcher);
}
export interface KanoEvidenceVersionDto {
  id: string; version: number; title: string; sourceUrl: string | null; sourceSection: string | null;
  summary: string; evidenceFragments: Array<{ ref: string; text: string }>; coverageNotes: string | null;
  knownAudiences: string[]; knownScenes: string | null; interviewDate: string | null;
  status: "draft" | "approved" | "retired"; piiFlagged: boolean; createdAt: string; approvedAt: string | null;
}
export function listKanoEvidence(fetcher: typeof fetch = fetch): Promise<{ items: KanoEvidenceVersionDto[] }> {
  return requestJson<{ items: KanoEvidenceVersionDto[] }>("/api/kano/evidence", fetcher);
}
export interface KanoCapability {
  capability: string; audience: string | null;
  positiveQuestion: string; negativeQuestion: string;
  simulatedLeaning: { option: string; rationale: string };
  candidateType: string; explanation: string; evidence: string[]; conflicts?: string[];
}
export interface KanoRunDto {
  id: string; requirementId: string; runVersion: number; status: "running" | "succeeded" | "failed";
  sourceVersion: number; audienceSnapshot: { tags: string[]; confirmed: boolean }; evidenceVersion: number;
  promptVersion: string; model: string | null;
  result: { capabilities: KanoCapability[]; gaps: string[]; confidence: string; confidenceReason: string; researchStatus?: string; evidenceVersion?: number } | null;
  safeErrorCode: string | null; safeErrorSummary: string | null;
  createdBy: string; createdAt: string; completedAt: string | null; staleInputs?: boolean;
}
export function triggerKanoRun(id: string, evidenceVersion: number, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; runVersion: number; status: string }> {
  return postJson(`/api/requirements/${id}/kano-runs`, { evidenceVersion }, fetcher);
}
export function listKanoRuns(id: string, fetcher: typeof fetch = fetch): Promise<{ items: KanoRunDto[] }> {
  return requestJson<{ items: KanoRunDto[] }>(`/api/requirements/${id}/kano-runs`, fetcher);
}
