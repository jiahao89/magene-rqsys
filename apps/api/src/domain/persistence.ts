// 持久化领域模型：与 database/migrations/0001_initial.sql 的 13 张表一一对应。
// 约束（AGENTS.md）：需求唯一键为 (source_config_id, teambition_requirement_id)；
// 可空列统一用 `| null`（不用可选属性），外部 ID 一律 text；
// source_payload 是按字段映射生成的 allowlist JSON，不是 114 字段原始记录。

import type {
  AnalysisState,
  BatchState,
  OwnerState,
  PullState,
  PushState,
  RequirementPipelineState,
} from "./workflow.js";

export type SyncTrigger = "manual" | "scheduled";
export type SyncItemAction = "created" | "updated" | "unchanged";
export type FeishuIdType = "open_id" | "user_id" | "union_id";
export type PersonMatchMethod = "tb_user_id" | "unique_name" | "manual";
export type ConfidenceLevel = "high" | "medium" | "low";
export type PriorityLevel = "P0" | "P1" | "P2" | "P3";
export type PublishStatus = "draft" | "published" | "retired";
export type PipelineJobType = "sync" | "analysis" | "base_push";
export type PipelineJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

// source_configs：单项目来源、需求类型、周计划、负责人名单和字段映射。
// 凭据不落库，由服务端从环境读取。
export interface SourceConfigRecord {
  id: string;
  provider: "teambition";
  externalProjectId: string;
  externalProjectName: string;
  requirementTypeId: string;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleWeekday: number | null; // 1-7（周一=1）
  scheduleLocalTime: string | null; // "HH:MM"
  scheduleTimezone: string | null; // 显式时区；调度计算永不回退到机器本地时区
  ownerNames: string[];
  fieldMap: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// sync_batches：手动/定时批次、发起人、幂等键、汇总结果。
// 唯一约束：(source_config_id, idempotency_key)。
export interface SyncBatchRecord {
  id: string;
  sourceConfigId: string;
  triggerType: SyncTrigger;
  actorId: string | null;
  idempotencyKey: string;
  status: BatchState;
  startedAt: string;
  completedAt: string | null;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  errorSummary: string | null; // 安全摘要，不含 provider 原始错误
  createdAt: string;
}

// requirements：当前规范化需求和 pull/AI/owner/push 独立状态。
// 唯一约束：(source_config_id, teambition_requirement_id)。
// source_url 与 attachment_refs 在当前 Teambition 接口上未验证，保持可空、不推断。
export interface RequirementRecord {
  id: string;
  sourceConfigId: string;
  teambitionRequirementId: string;
  teambitionUniqueId: number | null; // 仅展示用，不参与去重
  title: string;
  description: string | null;
  scope: string | null;
  acceptanceCriteria: string | null;
  proposerUserId: string | null;
  proposerName: string | null;
  executorUserId: string | null;
  executorName: string | null;
  sourceStatusId: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceUrl: string | null;
  attachmentRefs: unknown[];
  sourceCustomFields: unknown[];
  sourcePayload: Record<string, unknown>; // allowlist JSON
  sourceHash: string; // char(64) 规范化 allowlist 哈希
  substantiveHash: string;
  sourceVersion: number;
  latestBatchId: string | null;
  baseRecordId: string | null;
  lastPushedAt: string | null;
  pipeline: RequirementPipelineState;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

// sync_items：批次内逐条结果及错误。
// 唯一约束：(batch_id, teambition_requirement_id)。
export interface SyncItemRecord {
  id: string;
  batchId: string;
  requirementId: string | null;
  teambitionRequirementId: string;
  action: SyncItemAction;
  status: "succeeded" | "failed";
  errorCode: string | null; // 安全错误码
  errorDetail: string | null; // 安全摘要
  startedAt: string;
  completedAt: string | null;
}

// source_snapshots：只追加的来源版本和 allowlist payload。
// 唯一约束：(requirement_id, source_version)；只有规范化哈希变化才建新版本。
export interface SourceSnapshotRecord {
  id: string;
  requirementId: string;
  sourceVersion: number;
  sourceHash: string;
  substantiveHash: string;
  payload: Record<string, unknown>;
  isSubstantiveChange: boolean;
  capturedAt: string;
}

// analysis_runs：版本化的结构化 AI 输出及 provenance。
// 唯一约束：(requirement_id, analysis_version)；AI 输出与 PM 确认字段分离。
// priority 在规则版本未发布时为空。
export interface AnalysisRunRecord {
  id: string;
  requirementId: string;
  sourceVersion: number;
  analysisVersion: number;
  status: "running" | "analyzed" | "failed_retryable";
  moduleSuggestion: string | null;
  confidence: ConfidenceLevel | null;
  confidenceReason: string | null;
  priority: PriorityLevel | null;
  structuredResult: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  moduleDictionaryVersion: number | null;
  priorityRuleVersionId: string | null;
  safeErrorCode: string | null;
  safeErrorSummary: string | null;
  startedAt: string;
  completedAt: string | null;
}

// person_mappings：TB user ID/规范化姓名到 Feishu identity 的映射。
// 名称不设唯一约束：有歧义时不得自动匹配。
export interface PersonMappingRecord {
  id: string;
  sourceConfigId: string;
  teambitionUserId: string | null;
  teambitionDisplayName: string | null;
  normalizedName: string | null;
  feishuUserId: string;
  feishuIdType: FeishuIdType;
  matchMethod: PersonMatchMethod;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// pm_snapshots：实质变化推送前保存的 Base PM 字段快照。
// 只追加；快照读取失败时不得覆盖 Base 行。
export interface PmSnapshotRecord {
  id: string;
  requirementId: string;
  sourceVersion: number;
  baseRecordId: string;
  pmValues: Record<string, unknown>;
  capturedAt: string;
}

// base_push_runs：每次 Base 新建/更新尝试及结果。
// 唯一约束：(requirement_id, push_version) 和幂等键。
export interface BasePushRunRecord {
  id: string;
  requirementId: string;
  sourceVersion: number;
  pushVersion: number;
  status: "running" | "pushed" | "failed";
  idempotencyKey: string;
  baseRecordId: string | null;
  safeErrorCode: string | null;
  safeErrorSummary: string | null;
  startedAt: string;
  completedAt: string | null;
}

// module_dictionary_versions：受控模块字典版本，发布状态留痕。
export interface ModuleDictionaryVersionRecord {
  version: number;
  status: PublishStatus;
  entries: unknown[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

// priority_rule_versions：历史案例校准后的规则版本；未发布时 priority 为空。
export interface PriorityRuleVersionRecord {
  id: string;
  version: number;
  status: PublishStatus;
  rules: Record<string, unknown>;
  validationEvidence: unknown[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

// pipeline_jobs：可恢复的同步/AI/推送后台任务。
// dedupe_key 唯一；租约与重试字段持久化（与 jobs/ 模块的决策逻辑配合）。
export interface PipelineJobRecord {
  id: string;
  jobType: PipelineJobType;
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: PipelineJobStatus;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  lockedUntil: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

// audit_events：操作和状态变化审计。
// safe_details 是白名单字段（见 audit/event.ts 的脱敏规则），
// 禁止凭据、个人联系方式或 provider 原始错误。
export interface AuditEventRecord {
  id: string;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  result: "succeeded" | "failed" | "denied";
  safeDetails: Record<string, unknown>;
  occurredAt: string;
}

// 导出状态联合别名，便于 repository 实现引用。
export type { AnalysisState, BatchState, OwnerState, PullState, PushState, RequirementPipelineState };
