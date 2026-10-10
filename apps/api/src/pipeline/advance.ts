// 分析终态推进（工单 14）：首次分析成功/失败进入可见终态后，按负责人规则继续 Base 推送。
// - AI 不是推送门槛：分析失败/低置信度/优先级为空都继续推进。
// - TB 无负责人 → not_required（可空负责人推送）；
//   TB 有负责人且映射唯一 → auto_mapped；有负责人但未匹配 → 等待人工映射（不入队）。
// - 推送入队按需求源版本幂等（dedupeKey = base-push:{id}:v{version}，与 owner PUT 共享）。

import { randomUUID } from "node:crypto";
import type { RequirementQueryRepository, PersonMappingRepository, PipelineJobRepository, AuditEventRepository } from "../application/repositories.js";
import { normalizeOwnerName } from "../owner/mapping.js";
import { basePushIdempotencyKey } from "../application/idempotency-keys.js";

export interface AdvanceDeps {
  requirements: RequirementQueryRepository;
  people: PersonMappingRepository;
  jobs: PipelineJobRepository;
  audit: AuditEventRepository;
  now?: () => Date;
}

export type AdvanceOutcome = "queued" | "waiting_mapping" | "not_eligible";

export function createAnalysisAdvancer(deps: AdvanceDeps) {
  const now = deps.now ?? (() => new Date());
  return async function advanceAfterAnalysisTerminal(requirementId: string, analysisStatus: "analyzed" | "failed_retryable", actorId: string | null, analysisVersion: number): Promise<AdvanceOutcome> {
    const req = await deps.requirements.get(requirementId);
    if (!req || req.pipeline.pull !== "synced") return "not_eligible";
    if (req.pipeline.push === "running" || (req.pipeline.push === "pushed" && analysisStatus !== "analyzed")) return "not_eligible";

    const hasTbOwner = Boolean(req.executorUserId || req.executorName);
    let waitingMapping = false;
    if (!hasTbOwner) {
      if (req.pipeline.owner === "pending_mapping") await deps.requirements.setOwner(req.id, null, "not_required");
    } else {
      const ownerLookup = req.executorUserId ? { tbUserId: req.executorUserId } : { normalizedName: normalizeOwnerName(req.executorName!) };
      const mapping = await deps.people.resolveActive(req.sourceConfigId, ownerLookup);
      if (mapping) {
        if (req.pipeline.owner === "pending_mapping") await deps.requirements.setOwner(req.id, mapping.feishuUserId, "auto_mapped");
      } else {
        // TB 有负责人但未匹配：等待人工映射；owner PUT 持久化成功后会入队推送
        waitingMapping = true;
      }
    }

    const occurredAt = now().toISOString();
    if (waitingMapping) {
      await deps.audit.append({
        id: randomUUID(), actorId, eventType: "analysis.terminal", entityType: "requirement", entityId: req.id,
        result: analysisStatus === "analyzed" ? "succeeded" : "failed",
        safeDetails: { analysisStatus, analysisVersion, push: "waiting_owner_mapping", sourceVersion: req.sourceVersion }, occurredAt,
      });
      return "waiting_mapping";
    }
    await deps.jobs.enqueue({
      jobType: "base_push", dedupeKey: basePushIdempotencyKey(req.id, req.sourceVersion, analysisVersion),
      payload: { requirementId: req.id, actorId, sourceVersion: req.sourceVersion, analysisVersion }, availableAt: occurredAt,
    });
    await deps.audit.append({
      id: randomUUID(), actorId, eventType: "analysis.terminal", entityType: "requirement", entityId: req.id,
      result: analysisStatus === "analyzed" ? "succeeded" : "failed",
      safeDetails: { analysisStatus, analysisVersion, push: "queued", sourceVersion: req.sourceVersion }, occurredAt,
    });
    return "queued";
  };
}
