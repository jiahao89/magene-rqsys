import type { SyncPersistence } from "../../sync/service.js";
import type { PostgresRepositories, RequirementRowWrite } from "./repositories.js";

export interface PostgresSyncPersistence extends SyncPersistence {
  // 本次批次中新建或实质变更的需求（unchanged 不入列）——用于同步完成后链式创建分析任务
  touchedRequirements(): Array<{ id: string; sourceVersion: number }>;
}

export function createPostgresSyncPersistence(
  repositories: PostgresRepositories,
  sourceConfigId: string,
): PostgresSyncPersistence {
  const touched: Array<{ id: string; sourceVersion: number }> = [];
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
        proposerUserId: input.sourceCreatorId,
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
      };
      const upserted = await repositories.requirements.upsertRequirement(sourceConfigId, input.sourceRequirementId, write);
      // 编排器只对新建/哈希变化的需求调用 upsert——全部记入 touched 供链式分析
      touched.push({ id: upserted.id, sourceVersion: upserted.sourceVersion });
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
      await repositories.batches.complete(batchId, result);
    },
    touchedRequirements() {
      return touched;
    },
  };
}
