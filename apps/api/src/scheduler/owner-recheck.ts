// 负责人映射重新评估：人员映射补齐后，已分析完成、等待推送的需求不会自己往前走。
//
// 背景：生产上 254 条需求停在 push_state='pending'、owner_state='pending_mapping'。
// 分析终态推进只在分析完成那一刻发生一次，负责人 PUT 又只处理单条；因此后来补上的
// person_mappings（约 151 条）没有任何阶段会重新评估，这些需求永远不会被推送。
// 手工往 pipeline_jobs 插作业不是正路：payload、幂等键与批量节奏只有应用自己的入队逻辑清楚。
//
// 本模块每个调度轮扫描候选需求（pull=synced、analysis=analyzed、push=pending，limit 25）：
//   - 能解析出活跃人员映射 → 按状态机允许的迁移落 owner 状态，并用与正常链路相同的
//     base_push 幂等键入队，写一条 base.push.recheck_queued 审计（actorId=null）；
//   - 解析不到 → 跳过且不写审计（否则每一轮都会刷噪音）；
//   - 单条异常只进 report.errors，绝不向调用方抛出。
//
// 不手写作业、不清理历史失败作业：enqueue 的 Postgres 实现为
//   ON CONFLICT(dedupe_key) DO UPDATE ... WHERE status IN ('failed','cancelled')
// 同键的终态失败作业会被重置回 queued、attempt_count=0，所以历史失败作业会被本轮
// 的同键入队自然复用。也不改状态机、不改数据库、不调用任何外部接口。
//
// owner 状态迁移选择：只处理“尚未映射”的两种状态（pending_mapping / not_required）。
//   - pending_mapping → auto_mapped / manually_mapped 均被状态机允许；
//   - not_required → 任何映射状态都不被允许，此时保持原状态、只入队；本阶段不伪造
//     pending_mapping 中间态，重新映射仍由既有的同步/分析推进路径负责；
//   - 已处于 auto_mapped / manually_mapped 的状态一律不改写（人工映射不能被自动覆盖）。

import { randomUUID } from "node:crypto";
import type {
  AnalysisRunRepository, AuditEventRepository, PersonMappingRepository,
  PipelineJobRepository, RequirementQueryRepository,
} from "../application/repositories.js";
import type { PersonMappingRecord, RequirementRecord } from "../domain/persistence.js";
import type { OwnerState } from "../domain/workflow.js";
import { canTransition } from "../domain/transitions.js";
import { normalizeOwnerName } from "../owner/mapping.js";
import { basePushIdempotencyKey } from "../jobs/idempotency.js";

/** 单轮扫描上限：避免一次 tick 把 254 条候选全量入队。 */
export const OWNER_RECHECK_SCAN_LIMIT = 25;
/** 调度重新入队审计事件；与正常推送链路（analysis.terminal / base.push）区分。 */
export const OWNER_RECHECK_AUDIT_EVENT = "base.push.recheck_queued";

/** 重新评估只依赖的仓储切片，便于用内存桩做纯服务测试。 */
export type OwnerRecheckRepositories = {
  requirements: Pick<RequirementQueryRepository, "search" | "setOwner">;
  people: Pick<PersonMappingRepository, "resolveActive">;
  analyses: Pick<AnalysisRunRepository, "latest">;
  jobs: Pick<PipelineJobRepository, "enqueue">;
  audit: Pick<AuditEventRepository, "append">;
};

export interface OwnerRecheckReport {
  /** 本轮扫描到的候选需求数。 */
  scanned: number;
  /** 成功入队（并写审计）的需求数。 */
  enqueued: number;
  /** 无执行人 / 解析不到映射，按设计跳过的需求数。 */
  skipped: number;
  /** 单条需求/查询阶段的异常。调用方只记录，不因此让整轮 poll 失败。 */
  errors: string[];
}

/** 需求执行人 → resolveActive 查询参数；无执行人时没有可解析的映射。 */
function ownerLookup(requirement: RequirementRecord): { tbUserId?: string; normalizedName?: string } | null {
  if (requirement.executorUserId) return { tbUserId: requirement.executorUserId };
  if (requirement.executorName) return { normalizedName: normalizeOwnerName(requirement.executorName) };
  return null;
}

/** 映射来源决定目标 owner 状态：人工映射保留 manually_mapped 语义，其余为 auto_mapped。 */
function mappedOwnerState(mapping: Pick<PersonMappingRecord, "matchMethod">): OwnerState {
  return mapping.matchMethod === "manual" ? "manually_mapped" : "auto_mapped";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * 重新评估负责人映射并把待推送需求入队。
 * 返回计数报告；任何单条异常都不会抛出，查询失败也只计入 errors。
 */
export async function recheckOwnerMappings(
  params: OwnerRecheckRepositories & { now: Date; limit?: number },
): Promise<OwnerRecheckReport> {
  const limit = params.limit ?? OWNER_RECHECK_SCAN_LIMIT;
  const nowIso = params.now.toISOString();
  const report: OwnerRecheckReport = { scanned: 0, enqueued: 0, skipped: 0, errors: [] };

  let candidates: RequirementRecord[];
  try {
    const page = await params.requirements.search({
      pullState: "synced", analysisState: "analyzed", pushState: "pending", limit,
    });
    candidates = page.items;
  } catch (error) {
    // 查询失败（数据库不可用等）只记录，后续轮次再试；不阻断同轮其它调度阶段。
    report.errors.push(`search candidates: ${safeErrorMessage(error)}`);
    return report;
  }
  report.scanned = candidates.length;

  for (const requirement of candidates) {
    try {
      const lookup = ownerLookup(requirement);
      if (!lookup) {
        report.skipped += 1;
        continue;
      }

      const mapping = await params.people.resolveActive(requirement.sourceConfigId, lookup);
      if (!mapping) {
        // 尚未补映射：等待下一轮或人工映射。不写审计，避免每轮重复刷噪音。
        report.skipped += 1;
        continue;
      }

      const currentState = requirement.pipeline.owner;
      if (currentState !== "auto_mapped" && currentState !== "manually_mapped") {
        const targetState = mappedOwnerState(mapping);
        // 状态机不允许的迁移（如 not_required → auto_mapped）不写状态，但仍入队：
        // 推送不应因历史 owner 状态滞后而多等一轮，状态收敛由后续同步/分析推进负责。
        if (canTransition("owner", currentState, targetState)) {
          await params.requirements.setOwner(requirement.id, mapping.feishuUserId, targetState);
        }
      }

      const latestAnalysis = await params.analyses.latest(requirement.id);
      const analysisVersion = latestAnalysis?.analysisVersion ?? 0;
      // 与正常推送链路相同的 dedupe key/payload：历史失败作业会由 enqueue 的同键 ON CONFLICT 复用。
      await params.jobs.enqueue({
        jobType: "base_push",
        dedupeKey: basePushIdempotencyKey(requirement.id, requirement.sourceVersion, analysisVersion),
        payload: {
          requirementId: requirement.id, actorId: null,
          sourceVersion: requirement.sourceVersion, analysisVersion,
        },
        availableAt: nowIso,
      });
      report.enqueued += 1;

      await params.audit.append({
        id: randomUUID(), actorId: null,
        eventType: OWNER_RECHECK_AUDIT_EVENT,
        entityType: "requirement", entityId: requirement.id,
        result: "succeeded",
        safeDetails: { source: "scheduler", sourceVersion: requirement.sourceVersion, analysisVersion },
        occurredAt: nowIso,
      });
    } catch (error) {
      // 单条失败不阻断整轮；状态/作业可能已被并发修改，交由下一轮重新判断。
      report.errors.push(`requirement ${requirement.id}: recheck owner mapping: ${safeErrorMessage(error)}`);
    }
  }

  return report;
}
