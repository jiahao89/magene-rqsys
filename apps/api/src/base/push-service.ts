// Base 推送服务：HTTP handler 与 worker 共用的推送执行核心。
// 语义（工单 07/14 + AGENTS.md）：
// - 幂等：同 Idempotency-Key 重放返回既有推送结果。
// - 推送状态合法推进：pending/failed → running → pushed/failed。
// - 负责人规则（工单 14）：TB 无负责人 → 空负责人推送且不改写 Base 已有人工值；
//   TB 无负责人但 Web 为该需求指定了负责人 → 写入该负责人一次，之后不再覆盖 Base 人员字段；
//   TB 有负责人且解析唯一 → 推送该负责人；有负责人但未匹配 → 等待人工映射（conflict，不推送、不误报）。
// - AI 字段：最新已分析版本映射 module/priority/analysisVersion；P0–P3 原样传递（不丢弃 P3），
//   priority 为 null 时不写该字段（不制造伪优先级，也不清空 Base 已有建议）。
// - 被 Base 单选项拒绝的取值不伪造降级值，但也不静默丢弃：记入推送结果的 omittedFields 与审计。
// - PM 快照仅在源版本新于上次推送时读取保存（实质变化协议）。
// - 通知收件人（PM 最终确认）：first_push → PM Leader；负责人事件 → 新负责人；
//   substantive_update / ai_retry_success → Base 当前负责人 / 应用当前负责人，均无时 PM Leader；提出人不通知。

import { randomUUID } from "node:crypto";
import type { RequirementQueryRepository, PersonMappingRepository, BasePushRunRepository, AuditEventRepository, AnalysisRunRepository, SourceSnapshotRepository } from "../application/repositories.js";
import type { AnalysisRunRecord, FeishuIdType, PersonMappingRecord, RequirementRecord, SourceSnapshotRecord } from "../domain/persistence.js";
import type { FeishuBasePushAdapter, OmittedField } from "./client.js";
import { FeishuApiError } from "./transport.js";
import { normalizeOwnerName } from "../owner/mapping.js";
import { isIntakeComplete } from "../domain/workflow.js";

export interface BasePushServiceDeps {
  requirements: RequirementQueryRepository;
  people: PersonMappingRepository;
  basePushes: BasePushRunRepository;
  audit: AuditEventRepository;
  analyses?: AnalysisRunRepository;
  sourceSnapshots: SourceSnapshotRepository;
  base: FeishuBasePushAdapter;
  sourceProjectId: string;
  baseFields: { projectId?: string; requirementId: string; platformRequirementId?: string; owner: string; source: Record<string, string>; ai: Record<string, string>; pm: string[] };
  actorId: string | null;
  /** PM Leader 的飞书 user_id（32 位十六进制）：first_push 的固定收件人，也是其它事件无负责人时的兜底收件人；缺省读 RQSYS_PM_LEADER_USER_ID。 */
  pmLeaderUserId?: string | null;
  /** Web 工作台基地址（需求深链的 base）；缺省读 RQSYS_WEB_BASE_URL，再缺省用正式工作台地址。 */
  webBaseUrl?: string | null;
  now?: () => Date;
}

/** 4 类通知事件（负责人分配/变更同属负责人事件）。 */
export type NotificationEventType = "first_push" | "substantive_update" | "owner_assigned" | "owner_changed" | "ai_retry_success";
// 写入 Base 的是给干系人看的文案；机器码仍用于事件ID，保证同一事件幂等。
const EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  first_push: "首次推送",
  substantive_update: "需求内容变更",
  owner_assigned: "已分配负责人",
  owner_changed: "负责人变更",
  ai_retry_success: "AI 重试成功",
};

/**
 * 一次推送要写入的通知系统字段载荷。
 * 产品确认不存在「一条通知发多人」场景，因此只有单个收件人；不记录送达、不读回送达。
 */
export interface PushNotification {
  eventType: NotificationEventType;
  /** 写给 Base 的中文文案；机器码 eventType 只用于事件ID。 */
  eventTypeLabel: string;
  eventId: string;
  recipientUserId: string;
  /**
   * 收件人的飞书 ID 类型。由服务层显式给出，client 不再按「有 owner 就用 owner 类型」猜：
   * 收件人是 PM Leader 时固定 user_id；是当前负责人时用该负责人映射的类型。
   * 这样 client 才能把「负责人归并值」与「收件人」拆进两次类型一致的请求。
   */
  recipientIdType: FeishuIdType;
  /** 本次实际写入的负责人；无负责人时为 null（该人员字段不写）。 */
  ownerMergeUserId: string | null;
}

/** 本次推送解析出的当前负责人：来自人员映射（TB 执行人），或 TB 无执行人时 Web 逐条指定的负责人。 */
interface CurrentOwner {
  feishuUserId: string;
  feishuIdType: FeishuIdType;
  matchMethod: PersonMappingRecord["matchMethod"];
  perRequirement: boolean;
}

export type PushOutcome =
  | { kind: "pushed"; status: string; baseRecordId: string | null; created: boolean; omittedFields: OmittedField[] }
  // Base 行已写成功，但本地记账失败。绝不能当成外部写失败重推（会重复写 Base 并误报状态）。
  | { kind: "pushed_unrecorded"; baseRecordId: string; detail: string }
  | { kind: "not_found" }
  | { kind: "conflict" } // pull 未同步，或 TB 负责人未匹配等待人工映射
  | { kind: "error" }; // 推送失败（safe error 已记录，可重试）

function safeBaseFailure(error: unknown): { code: string; summary: string } {
  if (error instanceof FeishuApiError) {
    const action = error.action.replace(/\s+/g, "_").toUpperCase();
    const detail = error.apiCode !== undefined
      ? `CODE_${error.apiCode}`
      : error.httpStatus !== undefined
        ? `HTTP_${error.httpStatus}`
        : error.kind.toUpperCase();
    const reason = [error.httpStatus !== undefined ? `HTTP ${error.httpStatus}` : null, error.apiCode !== undefined ? `code ${error.apiCode}` : null]
      .filter(Boolean).join(", ") || error.kind.replaceAll("_", " ");
    return { code: `FEISHU_${action}_${detail}`, summary: `Feishu ${error.action} failed (${reason}); retry is available.` };
  }
  if (error instanceof SyntaxError) {
    return { code: "FEISHU_INVALID_RESPONSE", summary: "Feishu returned an invalid record response; retry is available." };
  }
  if (error instanceof TypeError) {
    return { code: "FEISHU_NETWORK_ERROR", summary: "Feishu API connection failed; retry is available." };
  }
  return { code: "BASE_PUSH_FAILED", summary: "Base update failed; retry is available." };
}

/**
 * 从「上一次成功推送时」的源快照里取旧负责人身份。
 * 快照 payload 是 allowlist JSON：sourceExecutorId 是 TB 执行人 ID，mappedFields.executorName 是获批映射的姓名。
 * answered=false 表示快照里根本没有负责人信息（历史数据），此时不能断言「旧负责人为空」。
 */
interface SnapshotOwnerLookup {
  answered: boolean;
  lookup: { tbUserId?: string; normalizedName?: string } | null;
}

function snapshotOwnerLookup(payload: Record<string, unknown> | null | undefined): SnapshotOwnerLookup {
  if (!payload || typeof payload !== "object") return { answered: false, lookup: null };
  const mapped = payload.mappedFields;
  const mappedRecord = mapped && typeof mapped === "object" ? mapped as Record<string, unknown> : null;
  const hasExecutorIdField = "sourceExecutorId" in payload;
  const hasExecutorNameField = Boolean(mappedRecord && "executorName" in mappedRecord);
  if (!hasExecutorIdField && !hasExecutorNameField) return { answered: false, lookup: null };
  const rawId = payload.sourceExecutorId;
  const rawName = mappedRecord?.executorName;
  const tbUserId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
  const executorName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
  if (tbUserId) return { answered: true, lookup: { tbUserId } };
  if (executorName) return { answered: true, lookup: { normalizedName: normalizeOwnerName(executorName) } };
  return { answered: true, lookup: null };
}

/** 正式 Web 工作台地址：通知按钮需求深链的默认 base。 */
const DEFAULT_WEB_BASE_URL = "https://ecn8egz1lhkq.feishu.link/app/app_17fqkjwyx1u";

/**
 * 需求深链：`<工作台 base>?requirement=<requirements.id>`。
 * 每次推送都写这个字段（不受通知静默影响）——它是给 PM 点击的稳定入口，不是通知事件；
 * 目标 Base 缺该字段时由 client 的 omittedFields 记录省略，不影响推送成功。
 */
function requirementDeepLink(baseUrl: string, requirementDbId: string): string {
  const base = (baseUrl.trim() || DEFAULT_WEB_BASE_URL).replace(/\/+$/, "");
  return `${base}?requirement=${encodeURIComponent(requirementDbId)}`;
}

export function createBasePushService(deps: BasePushServiceDeps) {
  const now = deps.now ?? (() => new Date());
  // 审计 safeDetails 只保留扁平原始类型（白名单 + 禁止嵌套），因此省略信息以字符串摘要写入既有
  // `reason` 键：既不改动脱敏契约，也让「推送成功但某字段未写入」可追溯。
  const omissionSummary = (omittedFields: OmittedField[]): string | null => omittedFields.length
    ? `omitted_fields:${omittedFields.map((item) => `${item.field}=${item.value}(${item.reason})`).join(",")}`
    : null;
  const auditPushSuccess = (requirementId: string, sourceVersion: number, created: boolean, replay: boolean, omittedFields: OmittedField[] = []) => {
    const reason = omissionSummary(omittedFields);
    return deps.audit.append({
      id: randomUUID(), actorId: deps.actorId, eventType: "base.push", entityType: "requirement", entityId: requirementId,
      result: "succeeded",
      safeDetails: { created, replay, sourceVersion, ...(reason ? { reason } : {}) },
      occurredAt: now().toISOString(),
    });
  };
  const pmLeaderUserId = deps.pmLeaderUserId ?? (process.env.RQSYS_PM_LEADER_USER_ID || null);
  const webBaseUrl = deps.webBaseUrl ?? process.env.RQSYS_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL;

  type PreviousPushOwner = { kind: "none" } | { kind: "known"; userId: string } | { kind: "unknown" };

  // 旧负责人只能从「上一次成功推送时」的源快照推导：应用库没有持久化 Base 负责人的历史 ID，
  // req.pipeline.owner 只是状态机（auto_mapped/manually_mapped），不记录具体人员。
  // 例外：逐条人工负责人记录了最近一次写进 Base 的人，直接用它。
  const resolvePreviousPushOwner = async (
    req: RequirementRecord,
    owner: CurrentOwner | null,
    previousSource: SourceSnapshotRecord | null,
    hadSuccessfulPush: boolean,
  ): Promise<PreviousPushOwner> => {
    if (!hadSuccessfulPush) return { kind: "none" };
    // 以"上一次成功推送实际写进 Base 的人"为准；不要用当前映射反推历史（映射可能已被改派/全局改绑）。
    if (req.lastPushedOwner?.feishuUserId) return { kind: "known", userId: req.lastPushedOwner.feishuUserId };
    const pushedManualOwner = owner?.perRequirement ? req.manualOwner?.pushedFeishuUserId ?? null : null;
    if (pushedManualOwner) return { kind: "known", userId: pushedManualOwner };
    if (!previousSource) return { kind: "unknown" };
    const snapshot = snapshotOwnerLookup(previousSource.payload);
    if (!snapshot.answered) return { kind: "unknown" };
    if (!snapshot.lookup) return { kind: "none" };
    // 手工来源没有 sourceConfigId；旧负责人快照推导仅对 TB 行有效（V02-T02 起可空）。
    const previousMapping = req.sourceConfigId ? await deps.people.resolveActive(req.sourceConfigId, snapshot.lookup) : null;
    // 旧负责人映射已不存在时得不到稳定的 fromUserId：不断言 A→B，避免发出错误事件。
    return previousMapping ? { kind: "known", userId: previousMapping.feishuUserId } : { kind: "unknown" };
  };

  /**
   * 计算本次推送的通知事件与唯一收件人。规则（分别计算，按固定优先级取一个）：
   *   1. first_push：latestSuccessful 为空（首次成功推送）
   *   2. substantive_update：实质变更且非首次
   *   3. owner_assigned：负责人空→有值
   *   4. owner_changed：负责人 A→B
   *   5. ai_retry_success：同一源版本的上一次分析失败、本次成功
   * 未命中任何事件（重复同步无变化、同键重放）时返回 undefined（不写通知字段，静默）。
   */
  const computeNotification = async (input: {
    req: RequirementRecord;
    owner: CurrentOwner | null;
    previousSource: SourceSnapshotRecord | null;
    hadSuccessfulPush: boolean;
    substantiveChanged: boolean;
    latestAnalysis: AnalysisRunRecord | null;
    /** 本次是否会写 Base 负责人；会写时以应用负责人为准，不读 Base 旧值。 */
    willWriteOwner: boolean;
    /** 惰性读取 Base 行当前保留的负责人；只在确实需要收件人判定时调用，避免每次推送多读两次 Base。 */
    resolveBaseOwner: () => Promise<{ userId: string; idType: FeishuIdType } | null>;
  }): Promise<PushNotification | undefined> => {
    const currentOwnerUserId = input.owner?.feishuUserId ?? null;
    const previousOwner = await resolvePreviousPushOwner(input.req, input.owner, input.previousSource, input.hadSuccessfulPush);

    // AI 重试成功只在同一源版本内比较：旧源版本失败、新源版本成功不算同一次重试。
    let aiRetrySuccess = false;
    const latestAnalysis = input.latestAnalysis;
    if (latestAnalysis?.status === "analyzed" && latestAnalysis.sourceVersion === input.req.sourceVersion && deps.analyses?.listByRequirement) {
      const history = (await deps.analyses.listByRequirement(input.req.id)) ?? [];
      const previousAnalysis = history
        .filter((run) => run.sourceVersion === latestAnalysis.sourceVersion && run.analysisVersion < latestAnalysis.analysisVersion)
        .sort((left, right) => right.analysisVersion - left.analysisVersion)[0] ?? null;
      aiRetrySuccess = previousAnalysis?.status === "failed_retryable";
    }

    let eventType: NotificationEventType | null = null;
    let fromUserId: string | null = null;
    // 首次推送默认静默（D-12）。只有"这一条需求被人为指定了负责人"才通知被指定人；
    // 自动匹配（哪怕底层映射是 manual）不算人工动作，否则某 TB 用户被分配过一次后，
    // 他未来每条新需求首推都会刷通知。
    const manuallyAssigned = Boolean(currentOwnerUserId) && Boolean(input.req.manualOwner?.feishuUserId);
    if (!input.hadSuccessfulPush && manuallyAssigned) {
      eventType = "owner_assigned";
    } else if (!input.hadSuccessfulPush) {
      eventType = "first_push";
    } else if (input.substantiveChanged) {
      eventType = "substantive_update";
    } else if (currentOwnerUserId) {
      if (previousOwner.kind === "none") {
        eventType = "owner_assigned";
      } else if (previousOwner.kind === "known" && previousOwner.userId !== currentOwnerUserId) {
        eventType = "owner_changed";
        fromUserId = previousOwner.userId;
      }
    }
    if (!eventType && aiRetrySuccess) eventType = "ai_retry_success";
    if (!eventType) return undefined;
    // 首次推送静默（产品确认）：新需求入场不逐条通知 PM Leader。
    // 151 条需求一起推时会变成 151 条消息，把真正需要动作的"分配后通知负责人"淹没；
    // Base 表格本身就是 PM Leader 的工作台。归属变化仍按下方规则逐条通知。
    if (eventType === "first_push") return undefined;

    const ownerEvent = eventType === "owner_assigned" || eventType === "owner_changed";
    // Base 行里的负责人可能是 PM 直接改的；读取失败不阻断推送，只回落到应用侧负责人/PM Leader。
    let baseOwner: { userId: string; idType: FeishuIdType } | null = null;
    // 只在本次不覆盖 Base 负责人时读取旧值；会覆盖时以应用负责人为准，避免通知一个即将被替换的人。
    if (!ownerEvent && !input.willWriteOwner) {
      try { baseOwner = await input.resolveBaseOwner(); } catch { baseOwner = null; }
    }
    // 产品最终确认的收件人规则：
    //   first_push → 静默（不写通知字段）；
    //   负责人事件 → 新的当前负责人；
    //   substantive_update / ai_retry_success → Base 保留的当前负责人，其次应用当前负责人，均无时回落 PM Leader。
    // 同时给出收件人的 ID 类型：负责人映射可能是 open_id，而 PM Leader 是 user_id；
    // 一次 Base 请求只能有一个 user_id_type，服务层必须显式声明，client 不能替它猜。
    const ownerIdType = input.owner?.feishuIdType ?? null;
    const ownerRecipient = currentOwnerUserId && ownerIdType ? { userId: currentOwnerUserId, idType: ownerIdType } : null;
    // Base 中 PM 手工保留下来的负责人优先于应用侧映射：内容变更/AI 重试成功时，
    // 通知必须发给 Base 当前负责人，而不是因为应用侧没有映射就回落 PM Leader。
    const baseRecipient = baseOwner ? { userId: baseOwner.userId, idType: baseOwner.idType } : null;
    const pmLeaderRecipient = pmLeaderUserId ? { userId: pmLeaderUserId, idType: "user_id" as const } : null;
    // first_push 已在上方静默返回，这里只剩负责人事件与"Base/应用负责人优先、PM Leader 兜底"两类。
    const recipient = ownerEvent ? ownerRecipient : (baseRecipient ?? ownerRecipient ?? pmLeaderRecipient);
    if (!recipient) return undefined;
    // 事件ID 确定性：同一事件重复推送得到同一个 ID，Base 自动化据此不重复发送。
    // 负责人事件追加 from/to，区分 A→B 与空→A 等不同事件。
    const eventId = ownerEvent
      ? `${eventType}:${input.req.id}:sv${input.req.sourceVersion}:${fromUserId ?? "none"}:${currentOwnerUserId}`
      : `${eventType}:${input.req.id}:sv${input.req.sourceVersion}`;
    return {
      eventType, eventTypeLabel: EVENT_TYPE_LABELS[eventType], eventId,
      recipientUserId: recipient.userId, recipientIdType: recipient.idType,
      ownerMergeUserId: currentOwnerUserId,
    };
  };

  async function pushRequirementUnlocked(requirementId: string, idempotencyKey: string): Promise<PushOutcome> {
    const req = await deps.requirements.get(requirementId);
    if (!req) return { kind: "not_found" };
    if (!isIntakeComplete(req.pipeline.pull)) return { kind: "conflict" };

    const previous = await deps.basePushes.findByIdempotencyKey(idempotencyKey);
    if (previous?.status === "pushed") {
      // 重放沿用既有结果；省略字段的说明来自本次审计记录，不在此处重新推断。
      await auditPushSuccess(req.id, req.sourceVersion, false, true, []);
      return { kind: "pushed", status: "pushed", baseRecordId: previous.baseRecordId, created: false, omittedFields: [] };
    }

    const ownerLookup = req.executorUserId
      ? { tbUserId: req.executorUserId }
      : (req.executorName ? { normalizedName: normalizeOwnerName(req.executorName) } : {});
    const hasTbOwner = Boolean(ownerLookup.tbUserId || ownerLookup.normalizedName);
    const mapping = hasTbOwner && req.sourceConfigId ? await deps.people.resolveActive(req.sourceConfigId, ownerLookup) : null;
    // 逐条人工负责人优先：单条改派只影响这一条，不影响同 TB 执行人的其他需求；
    // TB 执行人映射保留为"默认负责人"，供恢复时使用。
    const manualOwner = req.manualOwner ?? null;
    const owner: CurrentOwner | null = manualOwner
      ? { feishuUserId: manualOwner.feishuUserId, feishuIdType: manualOwner.feishuIdType, matchMethod: "manual", perRequirement: true }
      : mapping
        ? { feishuUserId: mapping.feishuUserId, feishuIdType: mapping.feishuIdType, matchMethod: mapping.matchMethod, perRequirement: false }
        : null;
    // 同一位人工负责人已写进 Base 时不再覆盖人员字段：PM 之后可能直接在 Base 里改过（Spec 03 AC5）。
    const baseOwner = owner && !(owner.perRequirement && manualOwner?.pushedFeishuUserId === owner.feishuUserId)
      ? { userId: owner.feishuUserId, idType: owner.feishuIdType }
      : null;

    // 工单 14：TB 有负责人但未匹配时等待人工映射——映射前不推送、不误报已推送。
    // 审计结果 denied（result 枚举含 denied），worker 视为终态跳过而非重试。
    if (!owner && (req.executorUserId || req.executorName)) {
      await deps.audit.append({
        id: randomUUID(), actorId: deps.actorId, eventType: "base.push", entityType: "requirement", entityId: req.id,
        result: "denied", safeDetails: { reason: "owner_pending_mapping", sourceVersion: req.sourceVersion }, occurredAt: now().toISOString(),
      });
      return { kind: "conflict" };
    }
    // TB 无负责人：先推进 owner 状态再推送（可空负责人推送，不改写 Base 已有人工值）
    if (!owner && !hasTbOwner && req.pipeline.owner === "pending_mapping") {
      await deps.requirements.setOwner(req.id, null, "not_required");
    }

    const startedAt = now().toISOString();
    const lastSuccessfulPush = await deps.basePushes.latestSuccessful(req.id);
    const previousSource = lastSuccessfulPush
      ? await deps.sourceSnapshots.getAtVersion(req.id, lastSuccessfulPush.sourceVersion)
      : null;
    // 比较实质字段 hash 而不是 sourceVersion：负责人/状态/时间等元数据更新不应重置 PM 状态。
    // 找不到既有快照时按实质变更处理，避免在不确定时覆盖 PM 工作。
    // 对账：上一次推送已把 Base 行写成功、但本地 base_record_id 没落地（记账失败或进程崩溃）时，
    // 先据此补写记录，再决定要不要做实质变更处理——否则重试会把同一需求再写一遍。
    let effectiveBaseRecordId = req.baseRecordId;
    if (!effectiveBaseRecordId && lastSuccessfulPush?.baseRecordId) {
      try {
        await deps.requirements.setBaseRecord(req.id, lastSuccessfulPush.baseRecordId, startedAt);
        effectiveBaseRecordId = lastSuccessfulPush.baseRecordId;
      } catch {
        // 补写失败不阻塞：本次仍按既有 Base 行处理，findByRequirementKey 会命中它而不是新建
        effectiveBaseRecordId = lastSuccessfulPush.baseRecordId;
      }
    }
    const substantiveChanged = Boolean(effectiveBaseRecordId) && (
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
        await auditPushSuccess(req.id, req.sourceVersion, false, true, []);
        return { kind: "pushed", status: "pushed", baseRecordId: current.baseRecordId, created: false, omittedFields: [] };
      }
      return { kind: "conflict" };
    }

    if (req.pipeline.push !== "running") await deps.requirements.setPushState(req.id, "running");
    let pushedResult: { recordId: string; created: boolean; omittedFields: OmittedField[] };
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
      // 通知事件在成败判定前计算：只有 Base 写成功，四个通知字段才会真正落库。
      const notification = await computeNotification({
        req, owner, previousSource,
        hadSuccessfulPush: Boolean(lastSuccessfulPush),
        substantiveChanged, latestAnalysis,
        willWriteOwner: Boolean(baseOwner),
        resolveBaseOwner: async () => lastSuccessfulPush
          ? (await deps.base.findCurrentOwner?.({ requirementId: req.teambitionRequirementId! })) ?? null
          : null,
      });
      const sourceCreatedAt = req.sourceCreatedAt ? Date.parse(req.sourceCreatedAt) : Number.NaN;
      pushedResult = await deps.base.push({
        projectId: deps.sourceProjectId, requirementId: req.teambitionRequirementId!, platformRequirementId: req.platformRequirementId, requirementDbId: req.id,
        // 每次推送都写深链（含首推静默）：PM 从通知按钮点进来能直接打开该需求详情。
        requirementLink: requirementDeepLink(webBaseUrl, req.id),
        title: req.title, description: req.description,
        owner: baseOwner,
        sourceVersion: req.sourceVersion, pushedAt: now().toISOString(), substantiveChanged,
        idempotencyKey,
        sourceValues: {
          ...(Number.isFinite(sourceCreatedAt) ? { createdAt: sourceCreatedAt } : {}),
        },
        aiValues: ai,
        // 静默场景（重复同步无变化、同键重放）不传 notification，即不写四个通知字段。
        ...(notification ? { notification: {
          eventId: notification.eventId,
          eventType: notification.eventTypeLabel,
          recipientUserId: notification.recipientUserId,
          recipientIdType: notification.recipientIdType,
          ownerMergeUserId: notification.ownerMergeUserId,
        } } : {}),
      });
    } catch (error) {
      const failure = safeBaseFailure(error);
      await deps.basePushes.updateResult(run.id, { status: "failed", safeErrorCode: failure.code, safeErrorSummary: failure.summary, completedAt: now().toISOString() });
      await deps.requirements.setPushState(req.id, "failed");
      await deps.audit.append({ id: randomUUID(), actorId: deps.actorId, eventType: "base.push", entityType: "requirement", entityId: req.id, result: "failed", safeDetails: { sourceVersion: req.sourceVersion, errorClass: "base_push_failed" }, occurredAt: now().toISOString() });
      return { kind: "error" };
    }
    // 外部写入已成功，以下只是本地记账。记账失败不能回退成"推送失败"：
    // Base 行已经存在，重推会在 findByRequirementKey 尚未可见时制造重复行，
    // 同时向 PM 误报"没推上去"。留一条可诊断的审计，并让上层把作业判为成功。
    try {
      await deps.basePushes.updateResult(run.id, { status: "pushed", baseRecordId: pushedResult.recordId, completedAt: now().toISOString() });
      await deps.requirements.setBaseRecord(req.id, pushedResult.recordId, now().toISOString());
      await deps.requirements.setPushState(req.id, "pushed");
      // 推送时解析到负责人则推进 owner 状态（已达目标状态时跳过，避免非法迁移）
      if (owner) {
        const targetOwnerState = owner.matchMethod === "manual" ? "manually_mapped" : "auto_mapped";
        if (req.pipeline.owner !== targetOwnerState) {
          // owner 状态是咨询性的、可由推进器恢复：Base 行已写成功，撞上非法迁移（如
          // not_required→auto_mapped）不能拖垮记账，否则推送被永久误报为"未记录"。
          try { await deps.requirements.setOwner(req.id, owner.feishuUserId, targetOwnerState); }
          catch (cause) { if ((cause as Error)?.name !== "InvalidTransitionError") throw cause; }
        }
      }
      if (owner?.perRequirement && baseOwner) await deps.requirements.markManualOwnerPushed(req.id, owner.feishuUserId);
      await deps.requirements.markLastPushedOwner(req.id, owner ? { feishuUserId: owner.feishuUserId, feishuIdType: owner.feishuIdType } : null);
    } catch (error) {
      const failure = safeBaseFailure(error);
      try {
        await deps.audit.append({
          id: randomUUID(), actorId: deps.actorId, eventType: "base.push", entityType: "requirement", entityId: req.id,
          result: "succeeded",
          // baseRecordId/code 不在 safeDetails 白名单里会被脱敏丢弃；折叠进 reason 才能留存，
          // 供"Base 行已写成功但本地未记账"的对账使用。
          safeDetails: { reason: `bookkeeping_failed:${failure.code}:${pushedResult.recordId}`, sourceVersion: req.sourceVersion },
          occurredAt: now().toISOString(),
        });
      } catch {
        // 审计也失败时不再尝试：结论仍是"外部写成功、本地未记账"
      }
      return { kind: "pushed_unrecorded", baseRecordId: pushedResult.recordId, detail: failure.code };
    }
    await auditPushSuccess(req.id, req.sourceVersion, pushedResult.created, false, pushedResult.omittedFields);
    return { kind: "pushed", status: "pushed", baseRecordId: pushedResult.recordId, created: pushedResult.created, omittedFields: pushedResult.omittedFields };
  }

  return {
    /**
     * 同一需求的并发推送用 repository 提供的 withRequirementLock 串行化：
     * Postgres 实现走「同一事务 + pg_advisory_xact_lock」，锁覆盖读 req → 建 run → 外部写 → 落库；
     * 内存/测试桩没有该能力时直接执行。没有锁实现的仓储保持原行为。
     */
    async pushRequirement(requirementId: string, idempotencyKey: string): Promise<PushOutcome> {
      const run = () => pushRequirementUnlocked(requirementId, idempotencyKey);
      return deps.requirements.withRequirementLock
        ? deps.requirements.withRequirementLock(requirementId, run)
        : run();
    },
  };
}
