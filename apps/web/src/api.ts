/** 需求池作用域：product=现有产品池，group=集团需求池。 */
export type RequirementPool = "product" | "group";

export interface HealthResponse {
  status: string;
  service?: string;
  database?: string;
  reason?: string;
}

/** 总览 AI 状态块（GET /api/overview/metrics 的 ai）：调用次数按 Asia/Shanghai 自然日统计，不含 token。 */
export interface OverviewAiStatus {
  status: "ok" | "paused" | "unconfigured" | "unavailable";
  /** 统计聚合失败时为 false：计数归零、详情为 null，界面只降级 AI 卡片。 */
  statsAvailable: boolean;
  pausedUntil: string | null;
  pauseReason: string | null;
  analysis: { total: number; today: number };
  chatIntake: { total: number; today: number };
  lastCall: { at: string | null; kind: "analysis" | "chat_intake" | null; result: "succeeded" | "failed" | null };
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
  /** 已压制（重复/忽略）数量；不计入上面的阶段与优先级统计（验收 #27）。 */
  suppressed: number;
  /** 总览分级统计：人工优先级覆盖 > 当前评分；无评分时使用最近一次已分析优先级（legacy）。 */
  priority?: { P0: number; P1: number; P2: number; P3: number; scored: number; legacy: number; unscored: number } | null;
  /** 当前已发布评分规则；规则未发布时为 null。 */
  priorityRule?: { version: number; thresholds: { p0: number; p1: number; p2: number } | null; formulaText: string } | null;
  /** AI 状态与调用次数；缺失或格式异常时只降级总览的 AI 卡片，不影响其他指标。 */
  ai?: OverviewAiStatus | null;
}

export interface SourceConfig {
  id: string;
  projectName: string;
  enabled: boolean;
  schedule: { enabled: boolean; weekday: number | null; weekdays?: number[] | null; time: string | null; timezone: string | null };
  /** 池作用域；旧响应缺字段按 product 处理。 */
  pool?: RequirementPool;
  /** 集团池执行人名单（展示名；userId 留在服务端）。产品池为空数组。 */
  executorAllowlist?: string[];
}

export interface SyncRunResponse {
  batchId: string;
  status: "running" | "succeeded" | "partial_failure" | "failed";
}
export type SyncExecutionMode = "full_pipeline" | "source_only";

export interface FeishuUserCandidate {
  openId: string;
  userId?: string;
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
  /** umsc_weighted_v2 为已确认的固定公式；缺省表示 v1 四维求和规则。 */
  rules: { formulaType?: string; thresholds?: { p0?: number; p1?: number; p2?: number } };
  validationEvidence: unknown[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export class ApiError extends Error {
  /** 429 时服务端给出的等待秒数（Retry-After）；没有该头时为 null。 */
  constructor(message: string, readonly status: number, readonly code: string, readonly retryAfterSeconds: number | null = null, /** 服务端 error.details；页面只读已知字段。 */ readonly details: unknown = null) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const detail = error && typeof error === "object" ? error as { code?: string; message?: string; details?: unknown } : {};
    // Retry-After 可能是秒数或 HTTP 日期；契约里只发秒数，其他格式按未知处理。
    const retryHeader = response.headers.get("retry-after");
    const retrySeconds = retryHeader && /^\d+$/.test(retryHeader.trim()) ? Math.max(1, Number(retryHeader)) : null;
    throw new ApiError(detail.message ?? `Request failed (${response.status})`, response.status, detail.code ?? "REQUEST_FAILED", retrySeconds, detail.details ?? null);
  }
  return body as T;
}

async function requestJson<T>(path: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<T> {
  const response = await fetcher(path, { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
  return parseJsonResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown, fetcher: typeof fetch, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetcher(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...headers },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
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

async function deleteJsonWithBody<T>(path: string, body: unknown, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(path, {
    method: "DELETE",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

export function getHealth(fetcher: typeof fetch = fetch): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/api/health/ready", fetcher);
}

export async function getOverviewMetrics(fetcher: typeof fetch = fetch): Promise<OverviewMetrics> {
  // 契约：GET /api/overview/metrics 返回 { counts, ai }；ai 在顶层，不在 counts 里。
  // 这里把它合并进返回对象；ai 缺失或格式异常不影响计数校验（总览卡片自行降级）。
  const result = await requestJson<{ counts: OverviewMetrics; ai?: OverviewAiStatus | null }>("/api/overview/metrics", fetcher);
  const keys = ["total", "pullSynced", "analysisAnalyzed", "ownerResolved", "pushPushed", "failed"] as const;
  const rawCounts = result.counts as unknown as Record<string, unknown> | undefined;
  if (!result.counts || !rawCounts || keys.some((key) => !Number.isInteger(rawCounts[key]) || Number(rawCounts[key]) < 0)) {
    throw new ApiError("Overview metrics response is invalid", 502, "INVALID_METRICS_RESPONSE");
  }
  return { ...result.counts, ai: result.ai ?? result.counts.ai ?? null };
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

/** 飞书 Base 地址（只读展示）：两个池各自承载需求推送与消息通知。 */
export interface BaseLinks {
  product: { url: string } | null;
  group: { url: string } | null;
}

export async function getBaseLinks(fetcher: typeof fetch = fetch): Promise<BaseLinks> {
  return requestJson<BaseLinks>("/api/base-links", fetcher);
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
  /** 仅创建时提交；更新时不改池。 */
  pool?: RequirementPool;
  /** 仅集团池：执行人展示名（1–20 个，服务端 trim/去重并解析TB user_id）。 */
  executorAllowlist?: string[];
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
  pool?: RequirementPool;
  filteredCount?: number;
  items: SyncItem[];
}

export function getBatch(id: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<BatchDetail> {
  return requestJson<BatchDetail>(`/api/batches/${id}`, fetcher, signal);
}

export function retrySyncItem(id: string, fetcher: typeof fetch = fetch, idempotencyKey: string = crypto.randomUUID()): Promise<{ batchId: string; status: string }> {
  return postJson<{ batchId: string; status: string }>(`/api/items/${id}/retry`, null, fetcher, { "Idempotency-Key": idempotencyKey });
}

export function getRequirement(id: string, fetcher: typeof fetch = fetch): Promise<RequirementDetail> {
  return requestJson<RequirementDetail>(`/api/requirements/${id}`, fetcher);
}


// ---------- PRD-28：需求评估（独立表 requirement_assessments；不改需求本体、不写 Base） ----------

export interface RequirementAssessmentInputs {
  background: string;
  goal: string;
  scenario: string;
}

export type AssessmentVerdict = "advance" | "hold" | "investigate";
export type AssessmentConfidence = "high" | "medium" | "low";

/** 评估输出契约 v0：一次模型调用同时产出结论与 Investigation 提示词。 */
export interface RequirementAssessmentOutput {
  background: string;
  goal: string;
  scope: { in: string[]; out: string[] };
  value: string;
  feasibility: { technical: string; cost: string; dependency: string; risk: string };
  verdict: AssessmentVerdict;
  verdictReason: string;
  confidence: AssessmentConfidence;
  assumptions: string[];
  openQuestions: string[];
  investigationPrompt: string;
}

export interface RequirementAssessment {
  id: string;
  requirementId: string;
  version: number;
  status: "succeeded" | "failed" | string;
  promptVersion: string | null;
  model: string | null;
  inputs: RequirementAssessmentInputs;
  output: RequirementAssessmentOutput | null;
  errorCode: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** 评估历史：服务端可能返回 `{items}` 或裸数组，两种都接受。 */
export async function listRequirementAssessments(id: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<RequirementAssessment[]> {
  const result = await requestJson<{ items?: RequirementAssessment[] } | RequirementAssessment[]>(`/api/requirements/${id}/assessments`, fetcher, signal);
  const items = Array.isArray(result) ? result : result?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * 按需生成一条新评估版本。body 用扁平三段补充内容（background / goal / scenario），
 * 服务端落到 inputs jsonb；失败沿用现有口径（429 / 503 / 500）。
 */
export async function createRequirementAssessment(
  id: string,
  inputs: RequirementAssessmentInputs,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<RequirementAssessment> {
  const body = await postJson<RequirementAssessment | { assessment?: RequirementAssessment }>(
    `/api/requirements/${id}/assessments`,
    { background: inputs.background, goal: inputs.goal, scenario: inputs.scenario },
    fetcher,
    {},
    signal,
  );
  const assessment = (body as { assessment?: RequirementAssessment })?.assessment ?? (body as RequirementAssessment);
  if (!assessment || typeof assessment.version !== "number") throw new ApiError("评估接口返回了无法识别的结果。", 502, "INVALID_ASSESSMENT_RESPONSE");
  return assessment;
}

// ---------- PRD 提示词（rq-prd-prompt-v1）：按需生成、版本化、不写 Base ----------

/** 模型输出契约：一段中文 Markdown 提示词 + 假设 + 开放问题。 */
export interface PrdPromptOutput {
  prompt: string;
  assumptions: string[];
  openQuestions: string[];
}

export interface PrdPromptInputs {
  assessmentId?: string;
  assessmentVersion?: number;
  investigationNotes?: string;
}

/** 一条 PRD 提示词版本；失败版本 output 为 null 且保留 errorCode。 */
export interface PrdPromptVersion {
  id: string;
  version: number;
  status: "running" | "succeeded" | "failed";
  output: PrdPromptOutput | null;
  /** 服务端返回的本次调研结论与评估版本（顶层字段）；inputs 为兼容旧形状。 */
  investigationNotes?: string | null;
  assessmentVersion?: number | null;
  inputs?: PrdPromptInputs;
  errorCode: string | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** 版本历史：服务端返回 `{items}` 或裸数组都接受；按 version DESC 排序。 */
export async function listPrdPrompts(id: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<PrdPromptVersion[]> {
  const result = await requestJson<{ items?: PrdPromptVersion[] } | PrdPromptVersion[]>(`/api/requirements/${id}/prd-prompts`, fetcher, signal);
  const items = Array.isArray(result) ? result : result?.items;
  return Array.isArray(items) ? [...items].sort((a, b) => b.version - a.version) : [];
}

/**
 * 按需生成一条 PRD 提示词版本。assessmentId 缺省时由服务端取最新成功评估；
 * 服务端最长 90s，调用方负责超时提示（前端 95s）。
 */
export async function createPrdPrompt(
  id: string,
  input: { assessmentId?: string; investigationNotes: string },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PrdPromptVersion> {
  const body = await postJson<PrdPromptVersion | { item?: PrdPromptVersion }>(
    `/api/requirements/${id}/prd-prompts`,
    input,
    fetcher,
    {},
    signal,
  );
  const item = (body as { item?: PrdPromptVersion })?.item ?? (body as PrdPromptVersion);
  if (!item || typeof item.version !== "number") throw new ApiError("PRD 提示词接口返回了无法识别的结果。", 502, "INVALID_PRD_PROMPT_RESPONSE");
  return item;
}

export function retryAnalysis(id: string, options: { force?: boolean } = {}, fetcher: typeof fetch = fetch): Promise<{ requirementId: string; status: string }> {
  return postJson<{ requirementId: string; status: string }>(`/api/analysis/${id}/retry`, options.force ? { force: true } : null, fetcher);
}

/** V02-T26：设置/清除人工优先级。priority=null 表示清除（reason 仍必填，用于审计留痕）。 */
export function setPriorityOverride(
  id: string,
  input: { priority: "P0" | "P1" | "P2" | "P3" | null; reason: string },
  fetcher: typeof fetch = fetch,
): Promise<{ requirementId: string; priorityOverride: PriorityOverrideState | null; effectivePriority: "P0" | "P1" | "P2" | "P3" | null }> {
  return putJson(`/api/requirements/${id}/priority-override`, input, fetcher);
}
/** V02-T26：保存/清除分析补充上下文（context=null 清除）。 */
export function saveAnalysisContext(
  id: string,
  context: string | null,
  fetcher: typeof fetch = fetch,
): Promise<{ requirementId: string; analysisContext: AnalysisContextState | null }> {
  return putJson(`/api/requirements/${id}/analysis-context`, { context }, fetcher);
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

export interface DuplicateDecisionInput {
  decision: DuplicateDecision;
  /** decision 为 duplicate 时必填：被选为重复项归属的主记录 id。 */
  canonicalRequirementId?: string | null;
  /** 判定理由，服务端要求非空。 */
  reason: string;
  /** 乐观并发 token：取 resolution.version，没有判定版本时为 0。 */
  expectedVersion: number;
}
export interface DuplicateDecisionResult {
  requirementId: string;
  processingState: RequirementProcessingState;
  version: number;
}

/**
 * 提交重复判定（确认重复 / 确认非重复 / 忽略），并由服务端重算处理闸口状态。
 * 撤销判定走 {@link revokeDuplicateDecision}（DELETE），不要复用本端点：
 * 用 confirmed_unique 冒充撤销会留下一条"已确认非重复"判定。
 * 409 表示判定版本冲突；400 表示校验失败（如理由为空、主记录无效）。
 */
export function setDuplicateDecision(id: string, input: DuplicateDecisionInput, fetcher: typeof fetch = fetch): Promise<DuplicateDecisionResult> {
  return putJson<DuplicateDecisionResult>(`/api/requirements/${id}/duplicate-decision`, input, fetcher);
}

/** 撤销重复判定，需求恢复 active；body 携带乐观并发 token（P1 契约）。 */
export function revokeDuplicateDecision(id: string, expectedVersion: number, fetcher: typeof fetch = fetch): Promise<DuplicateDecisionResult> {
  return deleteJsonWithBody<DuplicateDecisionResult>(`/api/requirements/${id}/duplicate-decision`, { expectedVersion }, fetcher);
}

export async function searchFeishuUsers(query: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<FeishuUserCandidate[]> {
  const params = new URLSearchParams({ q: query.trim() });
  const result = await requestJson<{ items: FeishuUserCandidate[] }>(`/api/feishu/users?${params.toString()}`, fetcher, signal);
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
 * 处理闸口状态：suppressed_* 表示人工判定为重复/忽略，需求不会进入 AI 分析、Base 推送与通知。
 * 后端 P1 落地前旧响应可能缺少该字段，展示层按 active 处理。
 */
export type RequirementProcessingState = "active" | "suppressed_duplicate" | "suppressed_ignored";
export type DuplicateDecision = "duplicate" | "ignored" | "confirmed_unique";
export type DuplicateReviewState = "suspected" | "confirmed";
export interface RequirementResolution {
  decision: DuplicateDecision;
  reviewState: DuplicateReviewState;
  canonicalRequirementId?: string | null;
  canonicalPlatformRequirementId?: string | null;
  reason?: string | null;
  /** 判定版本，作为 duplicate-decision 的乐观并发 token；后端未下发时按 0 处理。 */
  version?: number | null;
}

/**
 * 列表 DTO 实际包含 `source`（Teambition allowlist 快照）；`ownerName`/`updatedAt`
 * 是可选展示字段，只有服务端未来下发时才使用。缺失时由 UI 显示「—」。
 */
/** V02-T26：人工优先级覆盖（只影响应用内列表/详情/总览，不回写 Base）。 */
export type PriorityOverrideState = { priority: "P0" | "P1" | "P2" | "P3"; reason: string; actorId: string; at: string };
/** V02-T26：分析补充上下文（保存后可选强制重跑分析）。 */
export type AnalysisContextState = { note: string; updatedAt: string; updatedBy: string };

export interface RequirementSummary {
  id: string;
  /** RQ-Sys 展示编号（RQ-000001）；列表行优先显示它，缺失时才退回 TB 来源 ID。 */
  platformRequirementId?: string | null;
  sourceRequirementId: string | null;
  sourceType: "teambition" | "web_manual" | "base_form";
  sourceChannel: string | null;
  productModel: string | null;
  requirementType: string | null;
  constraintNotes: string | null;
  supplementUrl: string | null;
  intakeModule: string | null;
  audience: { tags: string[]; confirmed: boolean; version: number };
  title: string;
  /** PR-05：TB 执行人原始姓名；未映射时用于待匹配分组。 */
  executorName?: string | null;
  sourceVersion: number;
  pipeline: { pull: string; analysis: string; owner: RequirementOwnerState; push: string };
  /** 处理闸口状态；缺省视为 active（兼容后端未上线时的旧响应）。 */
  processingState?: RequirementProcessingState;
  /** Q4：上一次全量同步未再出现该需求的时间；只做提示。 */
  sourceMissingSince?: string | null;
  /** 人工/系统重复判定；未判定或旧响应为 null。 */
  resolution?: RequirementResolution | null;
  /** V02-T26：人工优先级覆盖与当前生效优先级（覆盖 > 当前评分版本）。 */
  priorityOverride?: PriorityOverrideState | null;
  effectivePriority?: "P0" | "P1" | "P2" | "P3" | null;
  analysisContext?: AnalysisContextState | null;
  source?: Record<string, unknown>;
  ownerName?: string | null;
  manualOwner?: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; name: string | null; assignedAt: string } | null;
  duplicateOf?: string | null;
  updatedAt?: string | null;
  /** 池归属（回收站/我的需求行需要；普通列表可缺省按 product 处理）。 */
  pool?: RequirementPool;
  /** PRD §4.13：生命周期；正常列表恒为 active，回收站为 deleted。 */
  lifecycleState?: "active" | "deleted";
  /** 逻辑删除时间（仅回收站/已删除详情返回）。 */
  deletedAt?: string | null;
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
  sourceType: "teambition" | "web_manual" | "base_form";
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
  /** 处理闸口状态；suppressed_* 不进入 AI 分析/Base 推送/通知。 */
  processingState?: RequirementProcessingState;
  /** 当前重复判定（含判定版本，用于乐观并发）。 */
  resolution?: RequirementResolution | null;
  /** V02-T26：人工优先级覆盖与当前生效优先级。 */
  priorityOverride?: PriorityOverrideState | null;
  effectivePriority?: "P0" | "P1" | "P2" | "P3" | null;
  /** Q4：上一次全量同步未再出现该需求的时间；只做提示。 */
  sourceMissingSince?: string | null;
  /** V02-T26：人工补充上下文（下一次分析作为独立段发送给模型）。 */
  analysisContext?: AnalysisContextState | null;
  source: Record<string, unknown>;
  analysis: Record<string, unknown> | null;
  analyses: AnalysisVersionSummary[];
  baseRecordId: string | null;
  /** 服务端按部署配置拼出的 Base 记录直达链接；未配置时为 null（只能复制记录 ID）。 */
  baseRecordUrl?: string | null;
  ownerName?: string | null;
  manualOwner?: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; name: string | null; assignedAt: string } | null;
  duplicateOf?: string | null;
  duplicates?: Array<{ id: string; title: string; teambitionRequirementId: string }>;
  /** 重复候选：同标题的其他 active 需求（排除自身与已压制）。旧响应没有该字段时回退 duplicates。 */
  duplicateCandidates?: Array<{ id: string; title: string; platformRequirementId?: string | null; teambitionRequirementId?: string | null }>;
  scoring?: ScoringData | null;
  /** 服务端创建时间（四种来源都返回）；非 TB 来源没有 payload 创建时间，必须读这里。 */
  createdAt?: string | null;
  updatedAt?: string | null;
  lastPushedAt?: string | null;
  /** 池归属（服务端按来源推导）；页面用于跨池守卫与「集团池」标签。 */
  pool?: RequirementPool;
  /** PRD §4.13：已删除详情只读；deletedAt 非空表示在回收站。 */
  lifecycleState?: "active" | "deleted";
  deletedAt?: string | null;
  /** 只对删除人本人返回；null 表示不是删除人（M16：不泄露原始用户 ID 给别人）。 */
  deletedBy?: string | null;
  /** 兼容服务端可选下发的权限布尔；缺省时按 deletedBy 是否为空判断还原权限。 */
  canDelete?: boolean;
  canRestore?: boolean;
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
  /** 池归属；旧响应缺字段按 product 处理。 */
  pool?: RequirementPool;
  /** 执行人名单外跳过数（仅集团池有意义）。 */
  filteredCount?: number;
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

/** I3-2：按当前筛选导出需求池 CSV（服务端上限 5000 条）。 */
export async function exportRequirementsCsv(params: { q?: string; executorName?: string; pullState?: string; ownerState?: string; analysisState?: string; pushState?: string; processingState?: "active" | "suppressed"; priority?: string; source?: string; sort?: string; batchId?: string; since?: string; until?: string; pool?: RequirementPool; fetcher?: typeof fetch } = {}): Promise<{ csv: string; truncated: boolean }> {
  const { fetcher = fetch, ...rest } = params;
  const response = await (fetcher as typeof fetch)(`/api/requirements/export${buildSearch(rest)}`);
  if (!response.ok) throw new ApiError("导出失败，请重试。", response.status, "EXPORT_FAILED");
  return { csv: await response.text(), truncated: response.headers.get("x-rq-truncated") === "true" };
}

export async function listRequirements(params: { q?: string; executorName?: string; pullState?: string; ownerState?: string; analysisState?: string; pushState?: string; processingState?: "active" | "suppressed"; priority?: "P0" | "P1" | "P2" | "P3"; source?: "teambition" | "web_manual" | "base_form" | "chat_paste"; sort?: "created_desc" | "priority_asc"; batchId?: string; since?: string; until?: string; pool?: RequirementPool; limit?: number; cursor?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<{ items: RequirementSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, q, executorName, pullState, ownerState, analysisState, pushState, processingState, priority, source, sort, batchId, since, until, pool, limit, cursor, signal } = params;
  return requestJson<{ items: RequirementSummary[]; nextCursor: string | null }>(`/api/requirements${buildSearch({ q, executorName, pullState, ownerState, analysisState, pushState, processingState, priority, source, sort, batchId, since, until, pool, limit, cursor })}`, fetcher, signal);
}

// ---------- PRD §4.13：我的需求与回收站 ----------

/** 首页「我的需求」卡与页面 Tab 计数；counts 缺失或为负时按接口异常处理，不用 0 冒充。 */
export interface MyRequirementCounts {
  identityResolved: boolean;
  total: number;
  product: number;
  group: number;
  suppressed: number;
}

export async function getMyRequirementCounts(fetcher: typeof fetch = fetch): Promise<MyRequirementCounts> {
  const result = await requestJson<{
    identityResolved?: unknown; total?: unknown; product?: unknown; group?: unknown; suppressed?: unknown;
    counts?: { identityResolved?: unknown; total?: unknown; product?: unknown; group?: unknown; suppressed?: unknown } | null;
  }>("/api/requirements/mine/counts", fetcher);
  const raw = result?.counts ?? result;
  const count = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);
  const product = count(raw?.product);
  const group = count(raw?.group);
  const total = count(raw?.total);
  if (typeof raw?.identityResolved !== "boolean" || product === null || group === null || total === null) {
    throw new ApiError("我的需求计数响应格式不正确。", 502, "INVALID_MY_REQUIREMENT_COUNTS");
  }
  return { identityResolved: raw.identityResolved, total, product, group, suppressed: count(raw?.suppressed) ?? 0 };
}

/** 我的需求列表：服务端按当前登录身份解析负责人；pool 区分产品池/集团池。 */
export async function listMyRequirements(params: { pool?: RequirementPool; limit?: number; cursor?: string; fetcher?: typeof fetch } = {}): Promise<{ items: RequirementSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, ...rest } = params;
  return requestJson<{ items: RequirementSummary[]; nextCursor: string | null }>(`/api/requirements/mine${buildSearch(rest)}`, fetcher);
}

/** 回收站：只返回当前用户删除的项，按删除时间倒序。 */
export async function listRecycleBinRequirements(params: { limit?: number; cursor?: string; fetcher?: typeof fetch } = {}): Promise<{ items: RequirementSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, limit, cursor } = params;
  return requestJson<{ items: RequirementSummary[]; nextCursor: string | null }>(`/api/requirements${buildSearch({ deleted: "true", limit, cursor })}`, fetcher);
}

export async function deleteRequirement(id: string, fetcher: typeof fetch = fetch): Promise<{ deletedAt?: string | null }> {
  return deleteJson<{ deletedAt?: string | null }>(`/api/requirements/${id}`, fetcher);
}

export async function restoreRequirement(id: string, fetcher: typeof fetch = fetch): Promise<{ lifecycleState?: string; processingState?: string }> {
  return postJson<{ lifecycleState?: string; processingState?: string }>(`/api/requirements/${id}/restore`, {}, fetcher);
}

/**
 * 5c-1：需求池来源 Tab 的计数（`GET /api/requirements/source-counts`）。
 * 口径与服务端列表默认范围一致（仅活跃）；计数不可用时返回 null，
 * Tab 照常可点、只是不显示数字，列表与分页不受影响。
 */
export interface RequirementSourceCounts {
  teambition: number;
  web_manual: number;
  base_form: number;
  chat_paste: number;
  all: number;
}

export async function getRequirementSourceCounts(params: { pool?: RequirementPool; fetcher?: typeof fetch } = {}): Promise<RequirementSourceCounts | null> {
  const { fetcher = fetch, pool } = params;
  try {
    const result = await requestJson<{ counts?: Partial<Record<keyof RequirementSourceCounts, unknown>> | null }>(`/api/requirements/source-counts${buildSearch({ pool })}`, fetcher);
    const counts = result?.counts;
    if (!counts || typeof counts !== "object") return null;
    const keys: Array<keyof RequirementSourceCounts> = ["teambition", "web_manual", "base_form", "chat_paste", "all"];
    const normalized = { teambition: 0, web_manual: 0, base_form: 0, chat_paste: 0, all: 0 } as RequirementSourceCounts;
    for (const key of keys) {
      const value = counts[key];
      // 集团池只消费 all：其余来源键即使缺省也不影响页头条数（集团池只有 TB 一个来源）。
      if (pool === "group" && key !== "all" && value === undefined) { normalized[key] = 0; continue; }
      // 缺字段或负数都按「计数不可用」降级：宁可不显示，也不显示假数字。
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      normalized[key] = Math.trunc(value);
    }
    return normalized;
  } catch {
    // 端点未部署、网络失败或非 2xx 都降级为不显示计数。
    return null;
  }
}

export async function listBatches(params: { status?: string; since?: string; until?: string; pool?: RequirementPool; limit?: number; cursor?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<{ items: BatchSummary[]; nextCursor: string | null }> {
  const { fetcher = fetch, status, since, until, pool, limit, cursor, signal } = params;
  return requestJson<{ items: BatchSummary[]; nextCursor: string | null }>(`/api/batches${buildSearch({ status, since, until, pool, limit, cursor })}`, fetcher, signal);
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

/** 审计面板默认取最近 N 条；与 API 的 AuditListQuerySchema 默认 limit 一致。 */
export const AUDIT_PAGE_LIMIT = 50;

export interface OpsJob {
  id: string;
  jobType: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  lockedUntil: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  createdAt: string;
  updatedAt: string;
  requirementId: string | null;
}

/** 只读运维视图：失败的作业 + 尝试次数用尽且租约过期的运行中作业。 */
export interface Readiness {
  status: string;
  database?: string;
  /** upToDate=null 表示目标环境不提供应用迁移记录（未知），不得当作“落后”处理。 */
  migrations?: { latest: string | null; expected: string; upToDate: boolean | null; error?: string };
}

/** 健康检查：数据库可用性与迁移对齐状态（不要求认证）。 */
export function getReadiness(fetcher: typeof fetch = fetch): Promise<Readiness> {
  return requestJson<Readiness>("/api/health/ready", fetcher);
}

export interface GateStatus {
  id: string;
  title: string;
  requirement: string;
  auto: { status: "pass" | "fail" | "na"; detail: string };
  manual: { required: boolean; confirmed: boolean; evidence?: string; by?: string; at?: string };
  status: "pass" | "fail" | "pending";
}

export interface GatesResponse { ready: boolean; gates: GateStatus[] }

/** PR-15：上线 Gate 当前状态（自动检查 + 人工确认）。 */
export function getGates(fetcher: typeof fetch = fetch): Promise<GatesResponse> {
  return requestJson<GatesResponse>("/api/ops/gates", fetcher as typeof fetch);
}

/** PR-15：人工确认/撤销某个 Gate（通过时必须提供证据）。 */
export function setGate(id: string, input: { confirmed: boolean; evidence?: string }, fetcher: typeof fetch = fetch): Promise<{ gateId: string; confirmed: boolean }> {
  return putJson(`/api/ops/gates/${id}`, input, fetcher as typeof fetch);
}

export interface OpsMetrics {
  window: { days: number; since: string };
  sync: { total: number; succeeded: number; partialFailure: number; failed: number; successRate: number | null; avgDurationSeconds: number | null; lastCompletedAt: string | null };
  analysis: { total: number; analyzed: number; failedRetryable: number; running: number; successRate: number | null; avgDurationSeconds: number | null; lowConfidence: number; lowConfidenceRate: number | null; failureCodes: Array<{ code: string; count: number }> };
  owner: { autoMapped: number; manuallyMapped: number; pendingMapping: number; notRequired: number };
  push: { total: number; pushed: number; failed: number; successRate: number | null; avgDurationSeconds: number | null };
  duplicate: { confirmedSuppressed: number; suspected: number };
  scoring: { aiSuggested: number; manual: number; aiApplied: number; adoptionRate: number | null };
  /** 5b：收集表同步的运维状态；未运行/未配置时为 null。 */
  baseForm?: { lastRunAt: string | null; pages: number; scanned: number; skipped: number; created: number; recorded: number; rejected: number; writeBackFailed: number; readFailed: boolean; lastError: string | null; /** 收集表分享地址（只读）；未配置时不返回。 */ shareUrl?: string | null } | null;
}

/** 运营指标（PRD §10）：窗口内成功率/耗时 + 当前快照。 */
export function getOpsMetrics(params: { days?: number; pool?: RequirementPool; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<OpsMetrics> {
  const { fetcher = fetch, days, pool, signal } = params;
  return requestJson<{ metrics: OpsMetrics }>(`/api/ops/metrics${buildSearch({ days, pool })}`, fetcher as typeof fetch, signal).then((result) => result.metrics);
}

export function getOpsJobs(params: { limit?: number; pool?: RequirementPool; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<{ now: string; items: { failed: OpsJob[]; stuck: OpsJob[] } }> {
  const { fetcher = fetch, limit, pool, signal } = params;
  return requestJson<{ now: string; items: { failed: OpsJob[]; stuck: OpsJob[] } }>(`/api/ops/jobs${buildSearch({ limit, pool })}`, fetcher, signal);
}

export function listAudit(params: { entityId?: string; eventType?: string; since?: string; until?: string; limit?: number; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<AuditEvent[]> {
  const { fetcher = fetch, entityId, eventType, since, until, limit, signal } = params;
  return requestJson<{ items: AuditEvent[] }>(`/api/audit${buildSearch({ entityId, eventType, since, until, limit })}`, fetcher, signal).then((result) => result.items);
}

export interface IntakeResult {
  requirementId: string;
  platformRequirementId?: string;
  sourceType: "web_manual";
  status: string;
}
export const REQUIREMENT_INTAKE_CHANNELS = ["销售", "售后", "电商", "运营/用研", "终端用户", "产品/研发/测试"] as const;
// 同一次提交（含失败重试）复用同一幂等键；成功后由表单重新生成（V02-T04-AC03）。
export function createRequirement(input: { title: string; description: string; sourceChannel: string; productModel?: string | null; requirementType?: string | null; constraintNotes?: string | null; supplementUrl?: string | null; intakeModule?: string | null; /** PRD-26：只有聊天粘贴路径传 "chat_paste"；落库仍是 web_manual。 */ intakeOrigin?: "chat_paste" | null; /** PRD-26：聊天中提到的提出人，仅展示，不进负责人匹配、不发通知。 */ proposerName?: string | null; owner?: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; tbDisplayName?: string | null } }, fetcher: typeof fetch = fetch, idempotencyKey: string = crypto.randomUUID()): Promise<IntakeResult> {
  return postJson<IntakeResult>("/api/requirements", input, fetcher, { "Idempotency-Key": idempotencyKey });
}
export const REQUIREMENT_INTAKE_TYPES = ["新增功能", "功能扩展", "体验优化", "性能优化", "质量修复", "安全合规", "成本效率", "技术治理"] as const;

// PRD-26 / 5a：聊天粘贴 → 需求草稿。草稿不入库，确认后仍走 createRequirement。
export interface ChatIntakeDraft {
  title: string;
  description: string;
  sourceChannel: (typeof REQUIREMENT_INTAKE_CHANNELS)[number] | null;
  requirementType: (typeof REQUIREMENT_INTAKE_TYPES)[number] | null;
  productModel: string | null;
  constraintNotes: string | null;
  intakeModule: string | null;
  proposer: string | null;
  aiFilled: string[];
}
export interface ChatIntakeSimilar { id: string; platformRequirementId: string; title: string; sourceType: string }
export interface ChatIntakeDraftResult {
  draft: ChatIntakeDraft;
  similar: ChatIntakeSimilar[];
  /** 模型输出不可用、标题/描述取自掩码原文时为 true：界面必须说明「未经 AI 整理」。 */
  fallback: boolean;
  /** 实际由 AI 填充的字段数；fallback 时应为 0。 */
  aiFilledCount: number;
}
export function extractIntakeDraft(text: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ChatIntakeDraftResult> {
  // 客户端 30 秒超时用 AbortSignal；中断后 fetch 以 AbortError 拒绝，由表单显示「整理超时」。
  return postJson("/api/requirements/intake-draft", { text }, fetcher, {}, signal);
}

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
export function getRiceDraft(id: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<RiceDraft> {
  return requestJson<RiceDraft>(`/api/requirements/${id}/rice-draft`, fetcher, signal);
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
export function listKanoEvidence(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<{ items: KanoEvidenceVersionDto[] }> {
  return requestJson<{ items: KanoEvidenceVersionDto[] }>("/api/kano/evidence", fetcher, signal);
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
export function listKanoRuns(id: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<{ items: KanoRunDto[] }> {
  return requestJson<{ items: KanoRunDto[] }>(`/api/requirements/${id}/kano-runs`, fetcher, signal);
}
