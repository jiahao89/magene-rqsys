// 持久化 repository 端口：为 13 张 DDL 表定义应用层接口。
// 目标 PostgreSQL 适配器在 Ticket 00 验证后接入；接口只声明各纵向切片
// （05 手动同步、06 AI 分析、07 负责人与 Base 推送、08 调度重试审计）实际需要的操作。
// 唯一性约束由 DDL 保证（见 domain/persistence.ts 注释），端口语义与之对齐。

import type { AuditEventRecord, BasePushRunRecord, BatchState, AnalysisRunRecord, ModuleDictionaryVersionRecord, PersonMappingRecord, PmSnapshotRecord, PipelineJobRecord, PipelineJobType, PriorityLevel, PriorityRuleVersionRecord, SourceConfigRecord, SourceSnapshotRecord, SyncBatchRecord, SyncItemAction, SyncItemRecord, SyncTrigger } from "../domain/persistence.js";
import type { AnalysisState, OwnerState, PullState, PushState } from "../domain/workflow.js";
import type { SourceConfigUpdate } from "../contracts/source.js";
import type { RequirementRecord } from "../domain/persistence.js";

// source_configs
export interface SourceConfigRepository {
  list(): Promise<SourceConfigRecord[]>;
  get(id: string): Promise<SourceConfigRecord | null>;
  update(id: string, update: SourceConfigUpdate): Promise<SourceConfigRecord | null>;
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
    limit: number;
    cursor?: string;
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
  findByIdempotencyKey(key: string): Promise<BasePushRunRecord | null>;
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
  claimNext(workerId: string, leaseMs: number, now: string): Promise<PipelineJobRecord | null>;
  complete(
    id: string,
    result: {
      status: "succeeded" | "failed" | "cancelled";
      errorCode?: string;
      errorSummary?: string;
      now: string;
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
export interface ModuleDictionaryRepository {
  list(): Promise<ModuleDictionaryVersionRecord[]>;
  get(version: number): Promise<ModuleDictionaryVersionRecord | null>;
}

export interface PriorityRuleRepository {
  get(id: string): Promise<PriorityRuleVersionRecord | null>;
  getPublished(): Promise<PriorityRuleVersionRecord | null>;
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
  // 按 openapi /api/requirements 查询参数检索（q 匹配标题，游标按 created_at,id 倒序）
  search(query: {
    q?: string;
    pullState?: PullState;
    analysisState?: AnalysisState;
    ownerState?: OwnerState;
    pushState?: PushState;
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
  } | null>;
  // 状态迁移（内部走 domain/transitions 校验，非法迁移抛 InvalidTransitionError）
  updateAnalysisState(requirementId: string, to: AnalysisState): Promise<void>;
  // 负责人落库：feishuUserId 来自 person_mappings，本表只推进 owner 状态
  setOwner(requirementId: string, feishuUserId: string | null, state: OwnerState): Promise<void>;
  setBaseRecord(requirementId: string, baseRecordId: string, pushedAt: string): Promise<void>;
  setPushState(requirementId: string, state: PushState): Promise<void>;
}
