// Base 推送服务：HTTP handler 与 worker 共用的推送执行核心。
// 语义（工单 07 + AGENTS.md）：
// - 幂等：同 Idempotency-Key 重放返回既有推送结果。
// - 推送状态合法推进：pending/failed → running → pushed/failed。
// - 负责人：TB user ID 优先 → 姓名唯一匹配；解析到则推进 owner 状态；
//   未解析推送空负责人（adapter 不清空 Base 已有人工负责人）。
// - PM 快照仅在实质变化时读取保存（FeishuBasePushAdapter 内）。

import { randomUUID } from "node:crypto";
import type { RequirementQueryRepository, PersonMappingRepository, BasePushRunRepository, AuditEventRepository } from "../application/repositories.js";
import type { FeishuBasePushAdapter } from "./client.js";
import { normalizeOwnerName } from "../owner/mapping.js";

export interface BasePushServiceDeps {
  requirements: RequirementQueryRepository;
  people: PersonMappingRepository;
  basePushes: BasePushRunRepository;
  audit: AuditEventRepository;
  base: FeishuBasePushAdapter;
  baseProjectId: string;
  baseFields: { projectId: string; requirementId: string; owner: string; source: Record<string, string>; ai: Record<string, string>; pm: string[] };
  actorId: string | null;
  now?: () => Date;
}

export type PushOutcome =
  | { kind: "pushed"; status: string; baseRecordId: string | null; created: boolean }
  | { kind: "not_found" }
  | { kind: "conflict" } // pull 未同步，不具备推送资格
  | { kind: "error" }; // 推送失败（safe error 已记录，可重试）

export function createBasePushService(deps: BasePushServiceDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    async pushRequirement(requirementId: string, idempotencyKey: string): Promise<PushOutcome> {
      const req = await deps.requirements.get(requirementId);
      if (!req) return { kind: "not_found" };
      if (req.pipeline.pull !== "synced") return { kind: "conflict" };

      const previous = await deps.basePushes.findByIdempotencyKey(idempotencyKey);
      if (previous) return { kind: "pushed", status: previous.status, baseRecordId: previous.baseRecordId, created: false };

      const run = await deps.basePushes.append({
        requirementId: req.id, sourceVersion: req.sourceVersion, pushVersion: req.sourceVersion,
        idempotencyKey, startedAt: now().toISOString(),
      });
      const ownerLookup = req.executorUserId
        ? { tbUserId: req.executorUserId }
        : (req.executorName ? { normalizedName: normalizeOwnerName(req.executorName) } : {});
      const mapping = await deps.people.resolveActive(req.sourceConfigId, ownerLookup);

      // 推送状态合法推进：pending/failed → running（pending → pushed 是非法迁移）
      await deps.requirements.setPushState(req.id, "running");
      try {
        const pushed = await deps.base.push({
          projectId: deps.baseProjectId, requirementId: req.teambitionRequirementId,
          title: req.title, description: req.description,
          owner: mapping ? { userId: mapping.feishuUserId, idType: mapping.feishuIdType } : null,
          sourceVersion: req.sourceVersion, substantiveChanged: Boolean(req.baseRecordId),
          idempotencyKey,
          sourceValues: { scope: req.scope, acceptanceCriteria: req.acceptanceCriteria, sourceStatusId: req.sourceStatusId, sourceUrl: req.sourceUrl },
          aiValues: {},
        });
        await deps.basePushes.updateResult(run.id, { status: "pushed", baseRecordId: pushed.recordId, completedAt: now().toISOString() });
        await deps.requirements.setPushState(req.id, "pushed");
        // 推送时解析到负责人则推进 owner 状态（已达目标状态时跳过，避免非法迁移）
        if (mapping) {
          const targetOwnerState = mapping.matchMethod === "manual" ? "manually_mapped" : "auto_mapped";
          if (req.pipeline.owner !== targetOwnerState) await deps.requirements.setOwner(req.id, mapping.feishuUserId, targetOwnerState);
        } else if (!req.executorUserId && req.pipeline.owner === "pending_mapping") {
          await deps.requirements.setOwner(req.id, null, "not_required");
        }
        await deps.audit.append({
          id: randomUUID(), actorId: deps.actorId, eventType: "base.push",
          entityType: "requirement", entityId: req.id, result: "succeeded",
          safeDetails: { created: pushed.created, sourceVersion: req.sourceVersion }, occurredAt: now().toISOString(),
        });
        return { kind: "pushed", status: "pushed", baseRecordId: pushed.recordId, created: pushed.created };
      } catch {
        await deps.basePushes.updateResult(run.id, { status: "failed", safeErrorCode: "BASE_PUSH_FAILED", safeErrorSummary: "Base update failed; retry is available.", completedAt: now().toISOString() });
        await deps.requirements.setPushState(req.id, "failed");
        return { kind: "error" };
      }
    },
  };
}
