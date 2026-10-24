// 持久化 repository 端口：为 13 张 DDL 表定义应用层接口。
// 目标 PostgreSQL 适配器在 Ticket 00 验证后接入；接口只声明各纵向切片
// （05 手动同步、06 AI 分析、07 负责人与 Base 推送、08 调度重试审计）实际需要的操作。
// 唯一性约束由 DDL 保证（见 domain/persistence.ts 注释），端口语义与之对齐。

import type { AuditEventRecord, BasePushRunRecord, BatchState, AnalysisRunRecord, FunctionModuleEntry, ModuleDictionaryVersionRecord, PersonMappingRecord, PmSnapshotRecord, PipelineJobRecord, PipelineJobType, PriorityLevel, PriorityRuleVersionRecord, SourceConfigRecord, SourceSnapshotRecord, SyncBatchRecord, SyncItemAction, SyncItemRecord, SyncTrigger, FeishuIdType, AudienceLevel } from "../domain/persistence.js";
import type { AnalysisState, OwnerState, PullState, PushState } from "../domain/workflow.js";
import type { ResolvedSourceConfigUpdate } from "../contracts/source.js";
import type { RequirementManualOwner, RequirementRecord } from "../domain/persistence.js";
import type { TeamPersonBindingInput, TeamPersonRecord } from "../domain/team-directory.js";

export type AuditEventInput = Omit<AuditEventRecord, "entityId">;

// source_configs
export interface SourceConfigRepository {
  list(): Promise<SourceConfigRecord[]>;
  get(id: string): Promise<SourceConfigRecord | null>;
  update(id: string, update: ResolvedSourceConfigUpdate, auditEvent?: AuditEventInput): Promise<SourceConfigRecord | null>;
  // 受控初始化：MVP 只允许一个产品组来源；唯一性由调用方（HTTP 层）与部署流程共同保证。
  create(input: ResolvedSourceConfigUpdate & { auditEvent?: AuditEventInput }): Promise<SourceConfigRecord>;
}

// sync_batches
export interface SyncBatchRepository {
  create(params: {
    sourceConfigId: string;
    triggerType: SyncTrigger;
    actorId: string | null;
    idempotencyKey: string;
    startedAt: string;
  }): Promise<SyncBatchRecord>;
  get(id: string): Promise<SyncBatchRecord | null>;
  findByIdempotencyKey(sourceConfigId: string, key: string): Promise<SyncBatchRecord | null>;
  list(query: {
    status?: BatchState;
    since?: string;
    until?: string;
    limit: number;
    cursor?: SyncBatchSearchCursor;
  }): Promise<{ items: SyncBatchRecord[]; nextCursor: string | null }>;
  complete(
    id: string,
    result: {
      status: BatchState;
      totalCount: number;
      succeededCount: number;
      failedCount: number;
      errorSummary: string | null;
      completedAt: string;
    },
  ): Promise<SyncBatchRecord | null>;
}

export interface SyncBatchSearchCursor {
  startedAt: string;
  id: string;
}

// sync_items
export interface SyncItemRepository {
  upsert(params: {
    batchId: string;
    requirementId: string | null;
    teambitionRequirementId: string;
    action: SyncItemAction;
    status: "succeeded" | "failed";
    errorCode?: string;
    errorDetail?: string;
    startedAt: string;
    completedAt: string;
  }): Promise<SyncItemRecord>;
  get(id: string): Promise<SyncItemRecord | null>;
  listByBatch(batchId: string): Promise<SyncItemRecord[]>;
}

// source_snapshots（只追加）
export interface SourceSnapshotRepository {
  append(params: {
    requirementId: string;
    sourceVersion: number;
    sourceHash: string;
    substantiveHash: string;
    payload: Record<string, unknown>;
    isSubstantiveChange: boolean;
    capturedAt: string;
  }): Promise<SourceSnapshotRecord>;
  latest(requirementId: string): Promise<SourceSnapshotRecord | null>;
  getAtVersion(requirementId: string, sourceVersion: number): Promise<SourceSnapshotRecord | null>;
}

// analysis_runs（只追加新版本，不覆盖旧版本）
export interface AnalysisRunRepository {
  append(params: {
    requirementId: string;
    sourceVersion: number;
    analysisVersion: number;
    startedAt: string;
  }): Promise<AnalysisRunRecord>;
  complete(
    id: string,
    result: {
      status: "analyzed" | "failed_retryable";
      moduleSuggestion?: string;
      confidence?: "high" | "medium" | "low";
      confidenceReason?: string;
      priority?: PriorityLevel;
      structuredResult?: Record<string, unknown>;
      provider?: string;
      model?: string;
      promptVersion?: string;
      moduleDictionaryVersion?: number;
      priorityRuleVersionId?: string;
      safeErrorCode?: string;
      safeErrorSummary?: string;
      completedAt: string;
    },
  ): Promise<AnalysisRunRecord | null>;
  latest(requirementId: string): Promise<AnalysisRunRecord | null>;
  listByRequirement(requirementId: string): Promise<AnalysisRunRecord[]>;
}

// person_mappings（有歧义时 resolveActive 返回 null，不自动匹配）
// upsertManual 在目标飞书账号已绑定其他人员时抛 PersonMappingConflict（HTTP 层 409）。
export interface PersonMappingRepository {
  upsertManual(params: {
    sourceConfigId: string;
    teambitionUserId: string | null;
    teambitionDisplayName: string | null;
    feishuUserId: string;
    feishuIdType: "open_id" | "user_id" | "union_id";
    createdBy: string | null;
    now: string;
  }): Promise<PersonMappingRecord>;
  resolveActive(
    sourceConfigId: string,
    by: { tbUserId?: string; normalizedName?: string },
  ): Promise<PersonMappingRecord | null>;
  // 活跃映射列表（工单 17 工作台展示）：按来源过滤、最近更新优先
  listActive(sourceConfigId: string): Promise<PersonMappingRecord[]>;
}

// pm_snapshots（只追加；推送前保存，读取失败时不覆盖 Base 行）
export interface PmSnapshotRepository {
  append(params: {
    requirementId: string;
    sourceVersion: number;
    baseRecordId: string;
    pmValues: Record<string, unknown>;
    capturedAt: string;
  }): Promise<PmSnapshotRecord>;
  latest(requirementId: string): Promise<PmSnapshotRecord | null>;
}

// base_push_runs（版本化推送尝试）
export interface BasePushRunRepository {
  append(params: {
    requirementId: string;
    sourceVersion: number;
    pushVersion: number;
    idempotencyKey: string;
    startedAt: string;
  }): Promise<BasePushRunRecord>;
  updateResult(
    id: string,
    result: {
      status: "pushed" | "failed";
      baseRecordId?: string;
      safeErrorCode?: string;
      safeErrorSummary?: string;
      completedAt: string;
    },
  ): Promise<BasePushRunRecord | null>;
  restart(id: string, startedAt: string): Promise<BasePushRunRecord | null>;
  findByIdempotencyKey(key: string): Promise<BasePushRunRecord | null>;
  // 需求最近一次推送尝试（含失败）——用于实质变化判断：仅当本次源版本新于上次推送版本时读 PM 快照
  latest(requirementId: string): Promise<BasePushRunRecord | null>;
  latestSuccessful(requirementId: string): Promise<BasePushRunRecord | null>;
}

// pipeline_jobs（dedupe_key 唯一；claim 用租约语义，与 jobs/ 模块决策逻辑配合）
export interface PipelineJobRepository {
  enqueue(params: {
    jobType: PipelineJobType;
    dedupeKey: string;
    payload: Record<string, unknown>;
    availableAt: string;
    maxAttempts?: number;
  }): Promise<PipelineJobRecord>;
  findByDedupeKey?(key: string): Promise<PipelineJobRecord | null>;
  claimNext(workerId: string, leaseMs: number, now: string): Promise<PipelineJobRecord | null>;
  /**
   * 续约：仅当作业仍是本次认领的那次（status='running' 且 attempt_count 匹配）才延长租约。
   * 返回 false 表示租约已被他人接管，调用方应停止续约（fencing 会拒绝最终结果）。
   * 可选：内存实现可不提供，worker 会退化为"不续约"。
   */
  renewLease?(id: string, params: { expectedAttempt: number; leaseMs: number; now: string }): Promise<boolean>;
  // 失败重排：状态回到 queued，available_at 按退避推迟；超出最大尝试由 worker 判定终态。
  // expectedAttempt 是 fencing 令牌：仅当 attempt_count 仍等于认领时的值才允许更新（工单 15）。
  reschedule(id: string, params: {
    expectedAttempt: number;
    backoffMs: number;
    errorCode?: string;
    errorSummary?: string;
    now: string;
  }): Promise<PipelineJobRecord | null>;
  // expectedAttempt：仅当 attempt_count 匹配认领时的值且仍在 running 才接受结果；
  // 返回 null 表示租约已被其他 worker 重新认领，迟到的结果被拒绝且不覆盖新状态。
  complete(
    id: string,
    result: {
      expectedAttempt: number;
      status: "succeeded" | "failed" | "cancelled";
      errorCode?: string;
      errorSummary?: string;
      now: string;
      /** 同一条原子 SQL 内，在有效 claim 成功终结后收敛 sync 批次。 */
      settleSyncBatch?: boolean;
    },
  ): Promise<PipelineJobRecord | null>;
}

// audit_events（追加只读；safe_details 为白名单字段）
export interface AuditEventRepository {
  append(record: AuditEventRecord): Promise<void>;
  search(query: {
    entityId?: string;
    since?: string;
    until?: string;
    limit: number;
  }): Promise<AuditEventRecord[]>;
}

// module_dictionary_versions / priority_rule_versions（受控版本，发布状态留痕）
// 发布语义：仅 draft 可发布；发布时自动 retired 旧的 published 版本，保持单一生效版本。
export interface ModuleDictionaryRepository {
  list(): Promise<ModuleDictionaryVersionRecord[]>;
  get(version: number): Promise<ModuleDictionaryVersionRecord | null>;
  create(input: { entries: unknown[]; createdBy: string; now: string; auditEvent?: AuditEventInput }): Promise<ModuleDictionaryVersionRecord>;
  publish(version: number, publishedAt: string, auditEvent?: AuditEventInput): Promise<ModuleDictionaryVersionRecord>;
}

// 团队人员沿用单项目 source_configs.owner_names；模块责任人关系随词典版本快照保存。
// 人员改名/删除与模块责任人更新由适配器在同一事务内完成。
// 飞书账号绑定落 person_mappings（按规范化姓名匹配的活跃映射），与需求分配下拉共用同一份映射；
// 同一姓名只保留一条活跃映射，避免自动匹配出现歧义。
export interface TeamDirectoryRepository {
  listPeople(): Promise<TeamPersonRecord[]>;
  addPerson(name: string, auditEvent: AuditEventInput): Promise<TeamPersonRecord[]>;
  renamePerson(from: string, to: string, auditEvent: AuditEventInput): Promise<TeamPersonRecord[]>;
  deletePerson(name: string, auditEvent: AuditEventInput): Promise<TeamPersonRecord[]>;
  // 人员页的飞书账号绑定：幂等；同一飞书账号不能同时绑定两位人员。
  bindPersonFeishu(name: string, binding: TeamPersonBindingInput, auditEvent: AuditEventInput): Promise<TeamPersonRecord[]>;
  unbindPersonFeishu(name: string, auditEvent: AuditEventInput): Promise<TeamPersonRecord[]>;
  listModules(): Promise<{ version: number; items: FunctionModuleEntry[] }>;
  saveModules(expectedVersion: number, items: FunctionModuleEntry[], createdBy: string, now: string, auditEvent: AuditEventInput): Promise<{ version: number; items: FunctionModuleEntry[] }>;
}

export interface PriorityRuleRepository {
  get(id: string): Promise<PriorityRuleVersionRecord | null>;
  getPublished(): Promise<PriorityRuleVersionRecord | null>;
  list(): Promise<PriorityRuleVersionRecord[]>;
  create(input: { rules: Record<string, unknown>; validationEvidence: unknown[]; createdBy: string; now: string; auditEvent?: AuditEventInput }): Promise<PriorityRuleVersionRecord>;
  publish(id: string, publishedAt: string, auditEvent?: AuditEventInput): Promise<PriorityRuleVersionRecord>;
}

// requirements 查询与状态迁移（handlers 与 worker 共用）
export interface RequirementOwnerRepository {
  get(id: string): Promise<RequirementRecord | null>;
  updateOwnerState(requirementId: string, to: OwnerState): Promise<void>;
  updatePushState(requirementId: string, to: PushState, baseRecordId?: string): Promise<void>;
}

export interface RequirementSearchCursor {
  createdAt: string;
  id: string;
}

export interface RequirementQueryRepository {

  // V02-T09：人工人群标签（多选/空集，确认语义）。乐观版本；修改只落库与审计，不触发任何主流程。
  setAudienceTags(requirementId: string, input: { tags: AudienceLevel[]; expectedVersion: number; actorId: string }): Promise<
    | { outcome: "updated"; version: number }
    | { outcome: "version_conflict"; currentVersion: number }
    | { outcome: "not_found" }>;
  // V02-T02/T04：手工收录。同幂等键重放返回同一需求；hash 不一致视为冲突由调用方拒绝。
  findIntakeReceipt(key: string): Promise<{ requirementId: string; requestHash: string; actorId: string } | null>;
  createManualRequirement(input: {
    idempotencyKey: string;
    actorId: string;
    requestHash: string;
    title: string;
    description: string | null;
    sourceChannel: string;
    productModel?: string | null;
    requirementType?: string | null;
    constraintNotes?: string | null;
    supplementUrl?: string | null;
    intakeModule?: string | null;
    owner?: { feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; name?: string | null };
  }): Promise<{ requirementId: string; platformRequirementId: string; replay: boolean }>;
  // V02-T07：手工需求编辑（仅 web_manual）。期望源版本乐观并发；实质变更原子落新版本/快照/审计/分析任务；
  // 元数据变更仅更新投影并入队非实质推送；规范化后无变化不新建版本。编辑回执同事务写入。
  updateManualRequirement(input: {
    requirementId: string;
    expectedSourceVersion: number;
    idempotencyKey: string;
    actorId: string;
    requestHash: string;
    title?: string;
    description?: string | null;
    sourceChannel?: string;
    productModel?: string | null;
    requirementType?: string | null;
    constraintNotes?: string | null;
    supplementUrl?: string | null;
  }): Promise<
    | { outcome: "updated"; sourceVersion: number; substantiveChanged: boolean; replay: false }
    | { outcome: "unchanged"; sourceVersion: number; replay: false }
    | { outcome: "replay"; sourceVersion: number; substantiveChanged: boolean }
    | { outcome: "key_conflict" }
    | { outcome: "version_conflict"; currentSourceVersion: number }
    | { outcome: "not_manual" }
    | { outcome: "not_found" }>;
  getPipelineCounts(): Promise<{
    total: number;
    pullSynced: number;
    analysisAnalyzed: number;
    ownerResolved: number;
    pushPushed: number;
    failed: number;
    /** 仅推送失败，与总览「推送失败」卡片的筛选口径一致。 */
    pushFailed: number;
    /** 仅推送待处理，与「待推送」卡片的筛选口径一致。 */
    pushPending: number;
  }>;
  // 按 openapi /api/requirements 查询参数检索（q 匹配标题，游标按 created_at,id 倒序）
  search(query: {
    q?: string;
    executorName?: string;
    pullState?: PullState;
    analysisState?: AnalysisState;
    ownerState?: OwnerState;
    pushState?: PushState;
    batchId?: string;
    since?: string;
    until?: string;
    limit: number;
    cursor?: RequirementSearchCursor;
  }): Promise<{ items: RequirementRecord[]; nextCursor: string | null }>;
  get(id: string): Promise<RequirementRecord | null>;
  // 同步幂等查找：返回流水线推进所需的最小字段
  findForSync(sourceConfigId: string, teambitionRequirementId: string): Promise<{
    id: string;
    sourceVersion: number;
    sourceHash: string;
    substantiveHash: string;
    analysisState: AnalysisState;
  } | null>;
  // 状态迁移（内部走 domain/transitions 校验，非法迁移抛 InvalidTransitionError）
  updateAnalysisState(requirementId: string, to: AnalysisState): Promise<void>;
  // 负责人落库：feishuUserId 来自 person_mappings，本表只推进 owner 状态
  setOwner(requirementId: string, feishuUserId: string | null, state: OwnerState): Promise<void>;
  // 逐条人工负责人：写入需求本身并迁移到 manually_mapped（非法迁移抛 InvalidTransitionError）。
  // 适用于所有需求（无论 TB 是否有执行人）；绝不再写 person_mappings。
  assignManualOwner(requirementId: string, owner: Omit<RequirementManualOwner, "pushedFeishuUserId" | "assignmentVersion">): Promise<void>;
  // 推送成功写入了人工负责人后记账；只在仍是同一负责人时生效，避免覆盖推送期间发生的改派。
  markManualOwnerPushed(requirementId: string, feishuUserId: string): Promise<void>;
  // 清除逐条人工负责人（恢复 TB 默认负责人/空负责人）。
  clearManualOwner(requirementId: string): Promise<void>;
  // 记录最近一次成功推送写入 Base 的负责人，用于下一次"负责人变更"判断。
  markLastPushedOwner(requirementId: string, owner: { feishuUserId: string; feishuIdType: FeishuIdType } | null): Promise<void>;
  // 疑似重复：查询同标题链接（仅详情使用）。
  listDuplicates(requirementId: string): Promise<Array<{ id: string; title: string; teambitionRequirementId: string }>>;
  // 标题重复检测的输入：当前来源全部需求（含已标记重复项）。
  listTitleCandidates(sourceConfigId: string): Promise<Array<{ id: string; teambitionRequirementId: string; title: string; sourceCreatedAt: string | null; duplicateOfRequirementId: string | null }>>;
  setDuplicateOf(requirementId: string, canonicalRequirementId: string | null): Promise<void>;
  setBaseRecord(requirementId: string, baseRecordId: string, pushedAt: string): Promise<void>;
  setPushState(requirementId: string, state: PushState): Promise<void>;
  /**
   * 同一需求的推送关键区串行化（可选能力）。
   * Postgres 实现用「同一事务内的 pg_advisory_xact_lock」包住读 req → 建 run → 外部写 → 落库，
   * 锁随事务结束自动释放；内存/测试桩直接执行 fn。
   */
  withRequirementLock?<T>(requirementId: string, fn: () => Promise<T>): Promise<T>;
}
