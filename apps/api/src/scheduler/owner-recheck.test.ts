import assert from "node:assert/strict";
import test from "node:test";
import { redactSafeDetails } from "../audit/event.js";
import { canTransition } from "../domain/transitions.js";
import { basePushIdempotencyKey } from "../jobs/idempotency.js";
import type { AuditEventRecord, PersonMappingRecord, RequirementRecord } from "../domain/persistence.js";
import type { RequirementQueryRepository } from "../application/repositories.js";
import {
  OWNER_RECHECK_AUDIT_EVENT,
  OWNER_RECHECK_SCAN_LIMIT,
  recheckOwnerMappings,
} from "./owner-recheck.js";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

type SearchQuery = Parameters<RequirementQueryRepository["search"]>[0];
type ResolveArgs = { sourceConfigId: string; by: { tbUserId?: string; normalizedName?: string } };
type SetOwnerCall = { id: string; feishuUserId: string | null; state: string };
type EnqueueCall = { jobType: string; dedupeKey: string; payload: Record<string, unknown>; availableAt: string };

function requirement(overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  return {
    id: "req-1", platformRequirementId: "RQ-000001", sourceType: "teambition", sourceChannel: null, productModel: null, requirementType: null, constraintNotes: null, supplementUrl: null, sourceConfigId: "src-1", teambitionRequirementId: "tb-req-1", teambitionUniqueId: 1,
    title: "需求", description: null, scope: null, acceptanceCriteria: null,
    proposerUserId: null, proposerName: null, executorUserId: "tb-user-1", executorName: "张三",
    sourceStatusId: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceUrl: null,
    attachmentRefs: [], sourceCustomFields: [], sourcePayload: {},
    sourceHash: "source-hash", substantiveHash: "substantive-hash", sourceVersion: 3,
    latestBatchId: "batch-1", baseRecordId: null, lastPushedAt: null,
    pipeline: { pull: "synced", analysis: "analyzed", owner: "pending_mapping", push: "pending" },
    firstSeenAt: "2026-10-20T10:00:00.000Z", lastSeenAt: "2026-10-20T10:00:00.000Z",
    createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

function mapping(overrides: Partial<PersonMappingRecord> = {}): PersonMappingRecord {
  return {
    id: "map-1", sourceConfigId: "src-1", teambitionUserId: "tb-user-1",
    teambitionDisplayName: "张三", normalizedName: "张三", feishuUserId: "ou-1",
    feishuIdType: "open_id", matchMethod: "tb_user_id", active: true,
    createdBy: null, createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-20T09:00:00.000Z",
    ...overrides,
  };
}

function harness(input: {
  candidates?: RequirementRecord[];
  /** 以 tbUserId 或 normalizedName 为键；缺失表示没有活跃映射。 */
  mappings?: Record<string, PersonMappingRecord | null>;
  latestAnalysisVersion?: Record<string, number>;
  enqueueErrors?: Set<string>;
  searchError?: Error;
}) {
  const candidates = input.candidates ?? [];
  const state = {
    searchQueries: [] as SearchQuery[],
    resolveCalls: [] as ResolveArgs[],
    setOwnerCalls: [] as SetOwnerCall[],
    enqueueCalls: [] as EnqueueCall[],
    events: [] as AuditEventRecord[],
  };

  const deps = {
    requirements: {
      async search(query: SearchQuery) {
        state.searchQueries.push(query);
        if (input.searchError) throw input.searchError;
        const items = candidates.filter((item) =>
          item.pipeline.pull === query.pullState &&
          item.pipeline.analysis === query.analysisState &&
          item.pipeline.push === query.pushState
        );
        return { items: items.slice(0, query.limit), nextCursor: null };
      },
      async setOwner(requirementId: string, feishuUserId: string | null, ownerState: string) {
        state.setOwnerCalls.push({ id: requirementId, feishuUserId, state: ownerState });
      },
    },
    people: {
      async resolveActive(sourceConfigId: string, by: ResolveArgs["by"]) {
        state.resolveCalls.push({ sourceConfigId, by });
        const key = by.tbUserId ?? by.normalizedName ?? "";
        return input.mappings?.[key] ?? null;
      },
    },
    analyses: {
      async latest(requirementId: string) {
        const version = input.latestAnalysisVersion?.[requirementId];
        return version === undefined ? null : { analysisVersion: version };
      },
    },
    jobs: {
      async enqueue(jobInput: EnqueueCall) {
        state.enqueueCalls.push(jobInput);
        const requirementId = jobInput.payload["requirementId"];
        if (typeof requirementId === "string" && input.enqueueErrors?.has(requirementId)) {
          throw new Error("enqueue unavailable");
        }
        return jobInput as never;
      },
    },
    audit: {
      async append(event: AuditEventRecord) {
        state.events.push(event);
      },
    },
  };

  async function run(overrides: { limit?: number } = {}) {
    return recheckOwnerMappings({ ...deps, now: NOW, ...overrides } as never);
  }

  return { state, deps: deps as never, run };
}

test("解析到映射的需求会入队 base_push 并写 recheck 审计", async () => {
  const h = harness({
    candidates: [requirement()],
    mappings: { "tb-user-1": mapping() },
    latestAnalysisVersion: { "req-1": 4 },
  });

  const report = await h.run();

  assert.equal(report.scanned, 1);
  assert.equal(report.enqueued, 1);
  assert.equal(report.skipped, 0);
  assert.deepEqual(report.errors, []);
  // 候选查询：三个状态过滤 + 本轮上限
  assert.deepEqual(h.state.searchQueries[0], {
    pullState: "synced", analysisState: "analyzed", pushState: "pending", limit: OWNER_RECHECK_SCAN_LIMIT,
  });
  // 先按状态机允许的迁移落 owner，再按正常链路同款 key/payload 入队
  assert.deepEqual(h.state.setOwnerCalls, [{ id: "req-1", feishuUserId: "ou-1", state: "auto_mapped" }]);
  assert.equal(h.state.enqueueCalls.length, 1);
  assert.equal(h.state.enqueueCalls[0]?.jobType, "base_push");
  assert.equal(h.state.enqueueCalls[0]?.dedupeKey, "base-push:req-1:sv3:av4");
  assert.equal(h.state.enqueueCalls[0]?.dedupeKey, basePushIdempotencyKey("req-1", 3, 4));
  assert.deepEqual(h.state.enqueueCalls[0]?.payload, {
    requirementId: "req-1", actorId: null, sourceVersion: 3, analysisVersion: 4,
  });
  assert.equal(h.state.enqueueCalls[0]?.availableAt, NOW_ISO);

  const event = h.state.events.find((row) => row.eventType === OWNER_RECHECK_AUDIT_EVENT);
  assert.ok(event);
  assert.equal(event.actorId, null);
  assert.equal(event.result, "succeeded");
  assert.equal(event.entityType, "requirement");
  assert.equal(event.entityId, "req-1");
  assert.equal(event.occurredAt, NOW_ISO);
  assert.deepEqual(event.safeDetails, { source: "scheduler", sourceVersion: 3, analysisVersion: 4 });
  // 审计仓储会过 redactSafeDetails：新事件用到的键必须全部在白名单内
  assert.deepEqual(redactSafeDetails(event.safeDetails), event.safeDetails);
});

test("解析不到映射时跳过且不写审计", async () => {
  const h = harness({ candidates: [requirement()], mappings: {} });

  const report = await h.run();

  assert.equal(report.scanned, 1);
  assert.equal(report.skipped, 1);
  assert.equal(report.enqueued, 0);
  assert.deepEqual(report.errors, []);
  assert.equal(h.state.resolveCalls.length, 1);
  assert.equal(h.state.setOwnerCalls.length, 0);
  assert.equal(h.state.enqueueCalls.length, 0);
  // 避免每轮扫描都留下噪音审计
  assert.equal(h.state.events.length, 0);
});

test("analysisVersion 取最新分析版本，缺失版本时用 0", async () => {
  const h = harness({
    candidates: [
      requirement({ id: "req-1", teambitionRequirementId: "tb-1" }),
      requirement({ id: "req-2", teambitionRequirementId: "tb-2", executorUserId: "tb-user-2" }),
    ],
    mappings: {
      "tb-user-1": mapping(),
      "tb-user-2": mapping({ id: "map-2", teambitionUserId: "tb-user-2", feishuUserId: "ou-2" }),
    },
    latestAnalysisVersion: { "req-1": 4 },
  });

  const report = await h.run();

  assert.equal(report.enqueued, 2);
  assert.equal(h.state.enqueueCalls[0]?.dedupeKey, "base-push:req-1:sv3:av4");
  assert.equal(h.state.enqueueCalls[0]?.payload["analysisVersion"], 4);
  assert.equal(h.state.enqueueCalls[1]?.dedupeKey, "base-push:req-2:sv3:av0");
  assert.equal(h.state.enqueueCalls[1]?.payload["analysisVersion"], 0);
  assert.deepEqual(
    h.state.events.map((row) => row.safeDetails["analysisVersion"]),
    [4, 0],
  );
});

test("单条需求的异常只进 errors，后续需求继续入队", async () => {
  const h = harness({
    candidates: [requirement(), requirement({ id: "req-2", teambitionRequirementId: "tb-2", executorUserId: "tb-user-2" })],
    mappings: {
      "tb-user-1": mapping(),
      "tb-user-2": mapping({ id: "map-2", teambitionUserId: "tb-user-2", feishuUserId: "ou-2" }),
    },
    latestAnalysisVersion: { "req-1": 1, "req-2": 1 },
    enqueueErrors: new Set(["req-1"]),
  });

  const report = await h.run();

  assert.equal(report.scanned, 2);
  assert.equal(report.enqueued, 1);
  assert.deepEqual(report.errors, ["requirement req-1: recheck owner mapping: Error: enqueue unavailable"]);
  assert.deepEqual(h.state.enqueueCalls.map((row) => row.payload["requirementId"]), ["req-1", "req-2"]);
  // 入队失败的需求不会写“已入队”审计
  assert.deepEqual(h.state.events.map((row) => row.entityId), ["req-2"]);
});

test("limit 默认 100 且可覆盖，单轮不会全量入队", async () => {
  assert.equal(OWNER_RECHECK_SCAN_LIMIT, 100);
  const candidates = Array.from({ length: 30 }, (_, index) =>
    requirement({
      id: `req-${index + 1}`,
      teambitionRequirementId: `tb-${index + 1}`,
      executorUserId: "tb-user-1",
    })
  );
  const h = harness({ candidates, mappings: { "tb-user-1": mapping() } });

  const defaultRun = await h.run();
  // 查询上限是 100，但本轮只有 30 条候选，因此实际处理 30 条（不会凭空放大）
  assert.equal(h.state.searchQueries[0]?.limit, 100);
  assert.equal(defaultRun.scanned, 30);
  assert.equal(defaultRun.enqueued, 30);

  const limitedRun = await h.run({ limit: 5 });
  assert.equal(h.state.searchQueries[1]?.limit, 5);
  assert.equal(limitedRun.scanned, 5);
  assert.equal(limitedRun.enqueued, 5);
});

test("owner_state 迁移不被状态机允许时不写状态，但仍入队", async () => {
  // not_required 只能迁移到 pending_mapping；本阶段不伪造中间态，保持原状态只入队。
  assert.equal(canTransition("owner", "not_required", "auto_mapped"), false);
  const h = harness({
    candidates: [requirement({ pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pending" } })],
    mappings: { "tb-user-1": mapping() },
  });

  const report = await h.run();

  assert.deepEqual(report.errors, []);
  assert.equal(report.enqueued, 1);
  assert.equal(h.state.setOwnerCalls.length, 0);
  assert.equal(h.state.enqueueCalls[0]?.dedupeKey, "base-push:req-1:sv3:av0");
});

test("已映射状态不被自动改写，尤其人工映射结果", async () => {
  const h = harness({
    candidates: [
      requirement({ id: "req-auto", pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pending" } }),
      requirement({ id: "req-manual", executorUserId: "tb-user-2", pipeline: { pull: "synced", analysis: "analyzed", owner: "manually_mapped", push: "pending" } }),
    ],
    mappings: {
      "tb-user-1": mapping(),
      "tb-user-2": mapping({ id: "map-2", teambitionUserId: "tb-user-2", feishuUserId: "ou-2", matchMethod: "manual" }),
    },
  });

  const report = await h.run();

  assert.equal(report.enqueued, 2);
  assert.equal(h.state.setOwnerCalls.length, 0);
});

test("manual 匹配的映射落 manually_mapped，而不是 auto_mapped", async () => {
  const h = harness({
    candidates: [requirement()],
    mappings: { "tb-user-1": mapping({ matchMethod: "manual" }) },
  });

  const report = await h.run();

  assert.equal(report.enqueued, 1);
  assert.deepEqual(h.state.setOwnerCalls, [{ id: "req-1", feishuUserId: "ou-1", state: "manually_mapped" }]);
});

test("无 tbUserId 时按规范化姓名解析映射；无执行人的需求跳过", async () => {
  const h = harness({
    candidates: [
      requirement({ id: "req-name", executorUserId: null, executorName: " 张三 " }),
      requirement({ id: "req-none", executorUserId: null, executorName: null }),
    ],
    mappings: { "张三": mapping({ teambitionUserId: null, matchMethod: "unique_name" }) },
  });

  const report = await h.run();

  assert.deepEqual(h.state.resolveCalls[0], {
    sourceConfigId: "src-1", by: { normalizedName: "张三" },
  });
  assert.equal(report.enqueued, 1);
  assert.equal(report.skipped, 1);
  assert.equal(h.state.enqueueCalls[0]?.payload["requirementId"], "req-name");
});

test("候选查询失败不抛出，只记录 errors", async () => {
  const h = harness({ candidates: [requirement()], searchError: new Error("database unavailable") });

  const report = await h.run();

  assert.equal(report.scanned, 0);
  assert.equal(report.enqueued, 0);
  assert.deepEqual(report.errors, ["search candidates: Error: database unavailable"]);
  assert.equal(h.state.enqueueCalls.length, 0);
});
