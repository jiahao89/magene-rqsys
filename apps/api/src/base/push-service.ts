// Base 推送服务：HTTP handler 与 worker 共用的推送执行核心。
// 语义（工单 07/14 + AGENTS.md）：
// - 幂等：同 Idempotency-Key 重放返回既有推送结果。
// - 推送状态合法推进：pending/failed → running → pushed/failed。
// - 负责人规则（工单 14）：TB 无负责人 → 空负责人推送且不改写 Base 已有人工值；
//   TB 有负责人且解析唯一 → 推送该负责人；有负责人但未匹配 → 等待人工映射（conflict，不推送、不误报）。
// - AI 字段：最新已分析版本映射 module/priority/analysisVersion；P0–P3 原样传递（不丢弃 P3），
//   priority 为 null 时不写该字段（不制造伪优先级，也不清空 Base 已有建议）。
// - PM 快照仅在源版本新于上次推送时读取保存（实质变化协议）。

import { randomUUID } from "node:crypto";
import type { RequirementQueryRepository, PersonMappingRepository, BasePushRunRepository, AuditEventRepository, AnalysisRunRepository, SourceSnapshotRepository } from "../application/repositories.js";
import type { FeishuBasePushAdapter } from "./client.js";
import { normalizeOwnerName } from "../owner/mapping.js";

export interface BasePushServiceDeps {
  requirements: RequirementQueryRepository;
  people: PersonMappingRepository;
  basePushes: BasePushRunRepository;
  audit: AuditEventRepository;
  analyses?: AnalysisRunRepository;
  sourceSnapshots: SourceSnapshotRepository;
  base: FeishuBasePushAdapter;
  sourceProjectId: string;
  baseFields: { projectId: string; requirementId: string; owner: string; source: Record<string, string>; ai: Record<string, string>; pm: string[] };
  actorId: string | null;
  now?: () => Date;
}

export type PushOutcome =
  | { kind: "pushed"; status: string; baseRecordId: string | null; created: boolean }
  | { kind: "not_found" }
  | { kind: "conflict" } // pull 未同步，或 TB 负责人未匹配等待人工映射
  | { kind: "error" }; // 推送失败（safe error 已记录，可重试）

export function createBasePushService(deps: BasePushServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const auditPushSuccess = (requirementId: string, sourceVersion: number, created: boolean, replay: boolean) => deps.audit.append({
    id: randomUUID(), actorId: deps.actorId, eventType: "base.push", entityType: "requirement", entityId: requirementId,
    result: "succeeded", safeDetails: { created, replay, sourceVersion }, occurredAt: now().toISOString(),
  });
  return {
    async pushRequirement(requirementId: string, idempotencyKey: string): Promise<PushOutcome> {
      const req = await deps.requirements.get(requirementId);
      if (!req) return { kind: "not_found" };
      if (req.pipeline.pull !== "synced") return { kind: "conflict" };

      const previous = await deps.basePushes.findByIdempotencyKey(idempotencyKey);
      if (previous?.status === "pushed") {
        await auditPushSuccess(req.id, req.sourceVersion, false, true);
        return { kind: "pushed", status: "pushed", baseRecordId: previous.baseRecordId, created: false };
      }

      const ownerLookup = req.executorUserId
        ? { tbUserId: req.executorUserId }
        : (req.executorName ? { normalizedName: normalizeOwnerName(req.executorName) } : {});
      const mapping = ownerLookup.tbUserId || ownerLookup.normalizedName
        ? await deps.people.resolveActive(req.sourceConfigId, ownerLookup)
        : null;

      // 工单 14：TB 有负责人但未匹配时等待人工映射——映射前不推送、不误报已推送。
      // 审计结果 denied（result 枚举含 denied），worker 视为终态跳过而非重试。
      if (!mapping && (req.executorUserId || req.executorName)) {
        await deps.audit.append({
          id: randomUUID(), actorId: deps.actorId, eventType: "base.push", entityType: "requirement", entityId: req.id,
          result: "denied", safeDetails: { reason: "owner_pending_mapping", sourceVersion: req.sourceVersion }, occurredAt: now().toISOString(),
        });
        return { kind: "conflict" };
      }
      // TB 无负责人：先推进 owner 状态再推送（可空负责人推送，不改写 Base 已有人工值）
      if (!mapping && !ownerLookup.tbUserId && !ownerLookup.normalizedName && req.pipeline.owner === "pending_mapping") {
        await deps.requirements.setOwner(req.id, null, "not_required");
      }

      const startedAt = now().toISOString();
      const lastSuccessfulPush = await deps.basePushes.latestSuccessful(req.id);
      const previousSource = lastSuccessfulPush
        ? await deps.sourceSnapshots.getAtVersion(req.id, lastSuccessfulPush.sourceVersion)
        : null;
      // 比较实质字段 hash 而不是 sourceVersion：负责人/状态/时间等元数据更新不应重置 PM 状态。
      // 找不到既有快照时按实质变更处理，避免在不确定时覆盖 PM 工作。
      const substantiveChanged = Boolean(req.baseRecordId) && (
        !lastSuccessfulPush || !previousSource || previousSource.substantiveHash !== req.substantiveHash
      );
      const latestPush = previous ? null : await deps.basePushes.latest(req.id);
      const run = previous
        ? await deps.basePushes.restart(previous.id, startedAt)
        : await deps.basePushes.append({
            requirementId: req.id, sourceVersion: req.sourceVersion, pushVersion: (latestPush?.pushVersion ?? 0) + 1,
            idempotencyKey, startedAt,
          });
      if (!run) {
        const current = await deps.basePushes.findByIdempotencyKey(idempotencyKey);
        if (current?.status === "pushed") {
          await auditPushSuccess(req.id, req.sourceVersion, false, true);
          return { kind: "pushed", status: "pushed", baseRecordId: current.baseRecordId, created: false };
        }
        return { kind: "conflict" };
      }

      if (req.pipeline.push !== "running") await deps.requirements.setPushState(req.id, "running");
      let pushedResult: { recordId: string; created: boolean };
      try {
        // 最新已分析版本映射 AI 字段：P0–P3 原样传递（不丢弃 P3）；无分析版本时不写 AI 字段
        const latestAnalysis = await deps.analyses?.latest(req.id) ?? null;
        const ai = latestAnalysis && latestAnalysis.status === "analyzed"
          ? {
              ...(latestAnalysis.moduleSuggestion ? { module: latestAnalysis.moduleSuggestion } : {}),
              ...(latestAnalysis.priority === null ? {} : { priority: latestAnalysis.priority }),
              analysisVersion: latestAnalysis.analysisVersion,
            }
          : {};
        const sourceCreatedAt = req.sourceCreatedAt ? Date.parse(req.sourceCreatedAt) : Number.NaN;
        pushedResult = await deps.base.push({
          projectId: deps.sourceProjectId, requirementId: req.teambitionRequirementId,
          title: req.title, description: req.description,
          owner: mapping ? { userId: mapping.feishuUserId, idType: mapping.feishuIdType } : null,
          sourceVersion: req.sourceVersion, pushedAt: now().toISOString(), substantiveChanged,
          idempotencyKey,
          sourceValues: {
            ...(Number.isFinite(sourceCreatedAt) ? { createdAt: sourceCreatedAt } : {}),
          },
          aiValues: ai,
        });
        await deps.basePushes.updateResult(run.id, { status: "pushed", baseRecordId: pushedResult.recordId, completedAt: now().toISOString() });
        await deps.requirements.setBaseRecord(req.id, pushedResult.recordId, now().toISOString());
        await deps.requirements.setPushState(req.id, "pushed");
        // 推送时解析到负责人则推进 owner 状态（已达目标状态时跳过，避免非法迁移）
        if (mapping) {
          const targetOwnerState = mapping.matchMethod === "manual" ? "manually_mapped" : "auto_mapped";
          if (req.pipeline.owner !== targetOwnerState) await deps.requirements.setOwner(req.id, mapping.feishuUserId, targetOwnerState);
        }
      } catch {
        await deps.basePushes.updateResult(run.id, { status: "failed", safeErrorCode: "BASE_PUSH_FAILED", safeErrorSummary: "Base update failed; retry is available.", completedAt: now().toISOString() });
        await deps.requirements.setPushState(req.id, "failed");
        await deps.audit.append({ id: randomUUID(), actorId: deps.actorId, eventType: "base.push", entityType: "requirement", entityId: req.id, result: "failed", safeDetails: { sourceVersion: req.sourceVersion, errorClass: "base_push_failed" }, occurredAt: now().toISOString() });
        return { kind: "error" };
      }
      await auditPushSuccess(req.id, req.sourceVersion, pushedResult.created, false);
      return { kind: "pushed", status: "pushed", baseRecordId: pushedResult.recordId, created: pushedResult.created };
    },
  };
}
