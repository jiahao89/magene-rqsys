import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditListQuerySchema,
  BatchListQuerySchema,
  OwnerMappingUpdateSchema,
  RequirementListQuerySchema,
  SyncRunRequestSchema,
  SyncIdempotencyHeaderSchema,
} from "./pipeline.js";

test("SyncRunRequest 只接受 UUID sourceId", () => {
  assert.ok(SyncRunRequestSchema.safeParse({ sourceId: "3f2b8c9e-1234-4abc-9def-112233445566" }).success);
  assert.ok(!SyncRunRequestSchema.safeParse({ sourceId: "not-a-uuid" }).success);
  assert.ok(!SyncRunRequestSchema.safeParse({}).success);
});

test("OwnerMappingUpdate 与 openapi 对齐：tbUserId/tbDisplayName 可空可省略", () => {
  assert.ok(
    OwnerMappingUpdateSchema.safeParse({ feishuUserId: "ou_123", feishuIdType: "open_id" }).success,
  );
  assert.ok(
    OwnerMappingUpdateSchema.safeParse({
      feishuUserId: "ou_123",
      feishuIdType: "user_id",
      tbUserId: null,
      tbDisplayName: null,
    }).success,
  );
  assert.ok(!OwnerMappingUpdateSchema.safeParse({ feishuUserId: "", feishuIdType: "open_id" }).success);
  assert.ok(!OwnerMappingUpdateSchema.safeParse({ feishuUserId: "ou_123", feishuIdType: "bad_type" }).success);
  // 契约未定义 minLength：空字符串是契约合法输入，zod 不得更严
  assert.ok(
    OwnerMappingUpdateSchema.safeParse({ feishuUserId: "ou_123", feishuIdType: "open_id", tbUserId: "" }).success,
  );
});

test("分页查询默认 limit 与契约一致（batches 25 / audit 50）", () => {
  assert.equal(BatchListQuerySchema.parse({}).limit, 25);
  assert.equal(AuditListQuerySchema.parse({}).limit, 50);
  assert.ok(!BatchListQuerySchema.safeParse({ limit: 0 }).success);
  assert.ok(!BatchListQuerySchema.safeParse({ limit: 101 }).success);
  assert.ok(!AuditListQuerySchema.safeParse({ limit: 101 }).success);
});

test("BatchListQuery status 只接受契约枚举", () => {
  assert.ok(BatchListQuerySchema.safeParse({ status: "partial_failure" }).success);
  assert.ok(!BatchListQuerySchema.safeParse({ status: "unknown" }).success);
});

test("RequirementListQuery 四阶段状态枚举与契约一致，q 最长 200", () => {
  assert.ok(
    RequirementListQuerySchema.safeParse({
      pullState: "synced",
      analysisState: "failed_retryable",
      ownerState: "not_required",
      pushState: "pushed",
    }).success,
  );
  assert.ok(!RequirementListQuerySchema.safeParse({ ownerState: "bad" }).success);
  assert.ok(RequirementListQuerySchema.safeParse({ q: "a".repeat(200) }).success);
  assert.ok(!RequirementListQuerySchema.safeParse({ q: "a".repeat(201) }).success);
});

test("AuditListQuery since/until 接受 UTC 与偏移量时间戳（RFC 3339 date-time）", () => {
  assert.ok(AuditListQuerySchema.safeParse({ since: "2026-01-01T00:00:00Z" }).success);
  assert.ok(AuditListQuerySchema.safeParse({ since: "2026-01-01T08:00:00+08:00" }).success);
  assert.ok(AuditListQuerySchema.safeParse({ since: "2026-01-01T00:00:00.123Z", until: "2026-01-02T00:00:00-05:00" }).success);
  assert.ok(!AuditListQuerySchema.safeParse({ since: "2026-01-01 00:00:00" }).success);
  assert.ok(!AuditListQuerySchema.safeParse({ since: "not-a-date" }).success);
});

test("Idempotency-Key header 契约：8-128 字符", () => {
  assert.ok(SyncIdempotencyHeaderSchema.safeParse("sched:proj-1:req-1:window").success);
  assert.ok(!SyncIdempotencyHeaderSchema.safeParse("short").success);
  assert.ok(!SyncIdempotencyHeaderSchema.safeParse("a".repeat(129)).success);
});
