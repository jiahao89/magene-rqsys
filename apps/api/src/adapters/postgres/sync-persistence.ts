import type { SyncPersistence } from "../../sync/service.js";
import type { PostgresRepositories, RequirementRowWrite } from "./repositories.js";

export interface PostgresSyncPersistence extends SyncPersistence {
  // 本次批次中有源版本变化的需求；analysisRequired=false 表示只需更新 Base 元数据。
  touchedRequirements(): Array<{ id: string; sourceVersion: number; substantiveHash: string; analysisRequired: boolean }>;
}

export function createPostgresSyncPersistence(
  repositories: PostgresRepositories,
  sourceConfigId: string,
): PostgresSyncPersistence {
  const touched: Array<{ id: string; sourceVersion: number; substantiveHash: string; analysisRequired: boolean }> = [];
  return {
    async findRequirement(sourceConfigId, sourceRequirementId) {
      return repositories.requirements.findForSync(sourceConfigId, sourceRequirementId);
    },
    async upsertRequirement(input) {
      const write: RequirementRowWrite = {
        sourceConfigId,
        teambitionRequirementId: input.sourceRequirementId,
        title: input.title,
        description: typeof input.mappedFields.description === "string" ? input.mappedFields.description : null,
        scope: typeof input.mappedFields.scope === "string" ? input.mappedFields.scope : null,
        acceptanceCriteria: typeof input.mappedFields.acceptanceCriteria === "string" ? input.mappedFields.acceptanceCriteria : null,
        // creator_id 是记录创建者，不等于业务提出人；提出人来自获批 lookup 字段的 meta.userid。
        proposerUserId: typeof input.mappedFields.proposerUserId === "string" ? input.mappedFields.proposerUserId : null,
        proposerName: typeof input.mappedFields.proposerName === "string" ? input.mappedFields.proposerName : null,
        executorUserId: input.sourceExecutorId,
        executorName: typeof input.mappedFields.executorName === "string" ? input.mappedFields.executorName : null,
        statusId: input.sourceStatusId,
        createdAt: input.sourceCreatedAt,
        updatedAt: input.sourceUpdatedAt,
        sourceUrl: typeof input.mappedFields.sourceUrl === "string" ? input.mappedFields.sourceUrl : null,
        uniqueId: input.sourceUniqueId,
        attachmentRefs: Array.isArray(input.mappedFields.attachmentRefs) ? input.mappedFields.attachmentRefs.filter((value): value is string => typeof value === "string") : [],
        customFields: Array.isArray(input.mappedFields.customFields) ? input.mappedFields.customFields : [],
        payload: input.sourcePayload,
        sourceHash: input.sourceHash,
        substantiveHash: input.substantiveHash,
        sourceVersion: input.sourceVersion,
        latestBatchId: input.latestBatchId,
        snapshot: input.snapshot,
      };
      const upserted = await repositories.requirements.upsertRequirement(sourceConfigId, input.sourceRequirementId, write);
      // 编排器只对新建/哈希变化的需求调用 upsert；元数据变化也要更新 Base，但不重跑 AI。
      touched.push({ id: upserted.id, sourceVersion: upserted.sourceVersion, substantiveHash: input.substantiveHash, analysisRequired: input.analysisRequired });
      return upserted;
    },
    async appendSourceSnapshot(input) {
      await repositories.sourceSnapshots.append(input);
    },
    async writeSyncItem(input) {
      await repositories.items.upsert({
        batchId: input.batchId,
        requirementId: input.requirementId,
        teambitionRequirementId: input.teambitionRequirementId,
        action: input.action,
        status: input.status,
        ...(input.errorCode === null ? {} : { errorCode: input.errorCode }),
        ...(input.errorDetail === null ? {} : { errorDetail: input.errorDetail }),
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      });
    },
    async completeBatch(batchId, result) {
      const completed = await repositories.batches.complete(batchId, result);
      if (!completed) throw new Error("Sync batch could not be completed");
      await repositories.audit.append({
        id: crypto.randomUUID(), actorId: completed.actorId, eventType: "sync.completed",
        entityType: "sync_batch", entityId: batchId,
        result: completed.status === "failed" || completed.failedCount > 0 ? "failed" : "succeeded",
        safeDetails: { trigger: completed.triggerType, reason: completed.status },
        occurredAt: result.completedAt,
      });
    },
    touchedRequirements() {
      return touched;
    },
  };
}
