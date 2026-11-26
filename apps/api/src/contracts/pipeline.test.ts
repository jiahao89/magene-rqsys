import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditListQuerySchema,
  BatchListQuerySchema,
  HttpUrlSchema,
  KanoEvidenceImportSchema,
  OwnerMappingUpdateSchema,
  RequirementIntakeEditSchema,
  RequirementIntakeSchema,
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

test("需求池优先级分诊参数：priority 枚举与 sort 分诊模式", () => {
  assert.ok(RequirementListQuerySchema.safeParse({ priority: "P0" }).success);
  assert.ok(RequirementListQuerySchema.safeParse({ priority: "P3", sort: "priority_asc" }).success);
  assert.ok(RequirementListQuerySchema.safeParse({ sort: "created_desc" }).success);
  assert.ok(!RequirementListQuerySchema.safeParse({ priority: "P4" }).success);
  assert.ok(!RequirementListQuerySchema.safeParse({ sort: "priority_desc" }).success);
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
  assert.ok(BatchListQuerySchema.safeParse({ since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00+08:00" }).success);
  assert.ok(!BatchListQuerySchema.safeParse({ since: "yesterday" }).success);
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
  assert.ok(RequirementListQuerySchema.safeParse({ batchId: "33333333-3333-4333-8333-333333333333", since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" }).success);
  assert.ok(!RequirementListQuerySchema.safeParse({ batchId: "" }).success);
  assert.ok(!RequirementListQuerySchema.safeParse({ until: "not-a-date" }).success);
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

test("HttpUrlSchema 及 supplementUrl/sourceUrl 只接受不带凭据的 http(s) 链接", () => {
  assert.ok(HttpUrlSchema.safeParse("https://docs.example.com/prd/1?tab=2").success);
  assert.ok(HttpUrlSchema.safeParse("  http://internal.magene.cn:8080/doc  ").success);
  for (const unsafe of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:pass@example.com/doc",
    "https://token@example.com/doc",
    "https://:secret@example.com/doc",
    "",
    "not-a-url",
    `https://example.com/${"a".repeat(500)}`,
  ]) {
    assert.equal(HttpUrlSchema.safeParse(unsafe).success, false, `must reject unsafe URL: ${unsafe}`);
    assert.equal(
      RequirementIntakeSchema.safeParse({ title: "T", description: "D", sourceChannel: "销售", supplementUrl: unsafe }).success,
      false,
    );
    assert.equal(
      RequirementIntakeEditSchema.safeParse({ expectedSourceVersion: 1, supplementUrl: unsafe }).success,
      false,
    );
    assert.equal(
      KanoEvidenceImportSchema.safeParse({ title: "T", summary: "S", evidenceFragments: [], sourceUrl: unsafe }).success,
      false,
    );
  }
  assert.ok(RequirementIntakeSchema.safeParse({ title: "T", description: "D", sourceChannel: "销售", supplementUrl: null }).success);
  assert.ok(RequirementIntakeEditSchema.safeParse({ expectedSourceVersion: 1, supplementUrl: "https://example.com/a" }).success);
  assert.ok(KanoEvidenceImportSchema.safeParse({ title: "T", summary: "S", evidenceFragments: [], sourceUrl: "https://example.com/b" }).success);
});
