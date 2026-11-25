import test from "node:test";
import assert from "node:assert/strict";
import { PostgresRepositories, PostgresAuditEventRepository } from "./repositories.js";
import { substantiveHash } from "../../sync/hashes.js";
import { DEFAULT_TEAM_MEMBERS } from "../../domain/team-directory.js";

test("team directory CRUD survives a transport that cannot serialize PostgreSQL void", async () => {
  let people = ["Temporary PM"];
  let modules: Array<{ name: string; personName: string | null }> = [{ name: "地图", personName: "Temporary PM" }];
  let version = 1;
  const query = async (sql: string, values: unknown[] = []) => {
    // The target Miaoda driver fails to decode a bare void result. Model that
    // external transport constraint while driving the public repository API.
    if (sql.includes("pg_advisory_xact_lock")) {
      if (!sql.includes("IS NULL")) throw new SyntaxError("Unexpected end of JSON input");
      return { rows: [{ lock_acquired: false }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT") && sql.includes("source_configs")) return { rows: [{ id: "source", owner_names: people, has_dictionary: true }], rowCount: 1 };
    if (sql.startsWith("SELECT") && sql.includes("module_dictionary_versions")) return { rows: [{ version, entries: modules, has_dictionary: true }], rowCount: 1 };
    if (sql.startsWith("UPDATE source_configs")) people = JSON.parse(String(values[1]));
    if (sql.startsWith("INSERT INTO module_dictionary_versions")) {
      modules = JSON.parse(String(values[0]));
      version += 1;
      return { rows: [{ version }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const store = new PostgresRepositories({ query, connect: async () => ({ query, release() {} }) } as never).directory;
  const event = { id: "event", actorId: "test-actor", eventType: "directory.test", entityType: "person", entityId: "Temporary PM", result: "succeeded" as const, safeDetails: {}, occurredAt: "2026-10-15T00:00:00.000Z" };
  assert.deepEqual(await store.renamePerson("Temporary PM", "Renamed PM", event), [{ name: "Renamed PM", binding: null, bindingConflict: false }]);
  assert.deepEqual((await store.listModules()).items, [{ name: "地图", personName: "Renamed PM" }]);
  assert.deepEqual(await store.deletePerson("Renamed PM", event), []);
  assert.deepEqual((await store.listModules()).items, [{ name: "地图", personName: null }]);
  const saved = await store.saveModules(3, [{ name: "导航", personName: null }], "test-actor", event.occurredAt, event);
  assert.equal(saved.version, 4);
  assert.deepEqual(saved.items, [{ name: "导航", personName: null }]);
});

test("audit intake counts avoid array parameters and FILTER so the target transport can bind them", async () => {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  const pool = {
    // 妙搭 Drizzle 传输层会把数组参数展开成元组（ANY(($2,$3)::text[]) 报 42809），所以这里断言 SQL 形状。
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes("AS today")) return { rows: [{ today: 2 }], rowCount: 1 };
      if (text.includes("LIMIT 1")) return { rows: [{ event_type: "intake.draft_failed", occurred_at: "2026-11-18T09:00:00.000Z" }], rowCount: 1 };
      return { rows: [{ total: 5 }], rowCount: 1 };
    },
  };
  const repository = new PostgresAuditEventRepository(pool as never);
  const stats = await repository.countByEntityType({ entityType: "intake", eventTypes: ["intake.draft_extracted", "intake.draft_failed"], since: "2026-11-17T16:00:00.000Z" });
  assert.deepEqual(stats, { total: 5, today: 2, lastAt: "2026-11-18T09:00:00.000Z", lastEventType: "intake.draft_failed" });
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.equal(query.text.includes("ANY("), false, query.text);
    assert.equal(query.text.includes("FILTER"), false, query.text);
    assert.match(query.text, /entity_type=\$1/);
  }
  assert.deepEqual(queries[0]!.values, ["intake", "intake.draft_extracted", "intake.draft_failed"]);
  assert.match(queries[1]!.text, /occurred_at>=\$4::timestamptz/);
  assert.deepEqual(queries[1]!.values, ["intake", "intake.draft_extracted", "intake.draft_failed", "2026-11-17T16:00:00.000Z"]);
  assert.match(queries[2]!.text, /ORDER BY occurred_at DESC,id DESC LIMIT 1/);
});

test("base form intake inserts source_type base_form with a record-id identity guard", async () => {
  const statements: Array<{ text: string; values: unknown[] | undefined }> = [];
  let existing: Array<Record<string, unknown>> = [];
  const query = async (text: string, values?: unknown[]) => {
    statements.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes("pg_advisory_xact_lock")) return { rows: [{ lock_acquired: true }], rowCount: 1 };
    if (text.includes("FROM requirements WHERE source_type='base_form' AND source_external_id=$1")) return { rows: existing, rowCount: existing.length };
    if (text.includes("next_number")) return { rows: [{ next_number: "42" }], rowCount: 1 };
    if (text.startsWith("INSERT INTO requirements")) return { rows: [{ id: "req-uuid" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const store = new PostgresRepositories({ query, connect: async () => ({ query, release() {} }) } as never).requirements;
  const input = {
    sourceExternalId: "rec-1", title: "表盘自定义", description: "希望自定义表盘数据项", sourceChannel: "终端用户",
    requirementType: null, productModel: null, constraintNotes: null, supplementUrl: null, intakeModule: null,
    proposerName: "张骑", sourcePayload: { sourceType: "base_form" }, capturedAt: "2026-11-19T00:00:00.000Z",
  };
  assert.equal(await store.findBaseFormRequirement!("rec-1"), null);
  const created = await store.createBaseFormRequirement!(input);
  assert.deepEqual(created, { requirementId: "req-uuid", platformRequirementId: "RQ-000042", created: true });
  const insert = statements.find((statement) => statement.text.startsWith("INSERT INTO requirements"))!;
  assert.match(insert.text, /'base_form'/);
  assert.match(insert.text, /ON CONFLICT \(source_external_id\) WHERE source_external_id IS NOT NULL DO NOTHING/);
  assert.ok(insert.values?.includes("rec-1"));
  assert.equal(statements.filter((statement) => statement.text.startsWith("INSERT INTO audit_events")).length, 1);
  // 并发/重复读取：同一外部 ID 已存在时直接返回 replay，不再插入快照与作业。
  existing = [{ id: "req-existing", platform_requirement_id: "RQ-000007" }];
  const replay = await store.createBaseFormRequirement!(input);
  assert.deepEqual(replay, { requirementId: "req-existing", platformRequirementId: "RQ-000007", created: false });
  assert.equal(statements.filter((statement) => statement.text.startsWith("INSERT INTO requirements")).length, 1);
});

type DirectoryMapping = { normalized_name: string | null; teambition_user_id: string | null; display_name: string | null; feishu_user_id: string; feishu_id_type: string; updated_at: string; active: boolean; match_method?: string };
function directoryPool(people: string[], mappings: DirectoryMapping[]) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [{ lock_acquired: false }], rowCount: 1 };
    if (sql.startsWith("SELECT id,owner_names,EXISTS")) return { rows: [{ id: "source-1", owner_names: people, has_dictionary: true }], rowCount: 1 };
    if (sql.startsWith("SELECT id,owner_names FROM source_configs")) return { rows: [{ id: "source-1", owner_names: people }], rowCount: 1 };
    if (sql.startsWith("SELECT EXISTS(SELECT 1 FROM module_dictionary_versions")) return { rows: [{ has_dictionary: true }], rowCount: 1 };
    if (sql.startsWith("SELECT teambition_user_id,feishu_user_id,feishu_id_type FROM person_mappings")) {
      const normalized = String(values[1]);
      const rows = mappings.filter((row) => row.active && row.normalized_name === normalized);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id,normalized_name,teambition_display_name FROM person_mappings")) {
      const feishu = String(values[1]);
      const type = String(values[2]);
      const rows = mappings
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.active && row.feishu_user_id === feishu && row.feishu_id_type === type)
        .map(({ row, index }) => ({ id: `m-${index}`, normalized_name: row.normalized_name, teambition_display_name: row.display_name }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE person_mappings SET teambition_display_name=$2,normalized_name=$3,updated_at=$4")) {
      const index = Number(String(values[0]).replace("m-", ""));
      const row = mappings[index];
      if (row) { row.display_name = String(values[1]); row.normalized_name = String(values[2]); row.updated_at = String(values[3]); }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT teambition_display_name FROM person_mappings")) {
      const feishu = String(values[1]);
      const type = String(values[2]);
      const normalized = String(values[3]);
      const taken = mappings.find((row) => row.active && row.feishu_user_id === feishu && row.feishu_id_type === type && row.normalized_name !== normalized);
      return { rows: taken ? [{ teambition_display_name: taken.display_name }] : [], rowCount: taken ? 1 : 0 };
    }
    if (sql.startsWith("SELECT normalized_name,feishu_user_id,feishu_id_type,updated_at FROM person_mappings")) {
      const rows = mappings.filter((row) => row.active && row.normalized_name !== null);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE person_mappings SET feishu_user_id=")) {
      const feishu = String(values[2]);
      const type = String(values[3]);
      const now = String(values[4]);
      const normalized = String(values[1]);
      for (const row of mappings) if (row.active && row.normalized_name === normalized) { row.feishu_user_id = feishu; row.feishu_id_type = type; row.updated_at = now; }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("INSERT INTO person_mappings")) {
      const matchMethod = /'([a-z_]+)'/.exec(sql)?.[1] ?? "manual";
      mappings.push({ normalized_name: String(values[3]), teambition_user_id: null, display_name: String(values[2]), feishu_user_id: String(values[4]), feishu_id_type: String(values[5]), updated_at: String(values[7]), active: true, match_method: matchMethod });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT normalized_name,feishu_user_id,feishu_id_type FROM person_mappings")) {
      const targets = [String(values[1]), String(values[2])];
      const rows = mappings.filter((row) => row.active && targets.includes(String(row.normalized_name)));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE person_mappings SET teambition_display_name=$3,normalized_name=")) {
      const from = String(values[1]);
      const to = String(values[2]);
      const toNormalized = String(values[3]);
      const now = String(values[4]);
      for (const row of mappings) if (row.active && row.normalized_name === from) { row.normalized_name = toNormalized; row.display_name = to; row.updated_at = now; }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("UPDATE person_mappings SET teambition_display_name=$3,updated_at=")) {
      const from = String(values[1]);
      const to = String(values[2]);
      const now = String(values[3]);
      for (const row of mappings) if (row.active && row.normalized_name === from) { row.display_name = to; row.updated_at = now; }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("UPDATE person_mappings SET active=false")) {
      const normalized = String(values[1]);
      const now = String(values[2]);
      let count = 0;
      for (const row of mappings) if (row.active && row.normalized_name === normalized) { row.active = false; row.updated_at = now; count += 1; }
      return { rows: Array.from({ length: count }, (_, index) => ({ id: `deactivated-${index}` })), rowCount: count };
    }
    if (sql.startsWith("UPDATE source_configs")) { people = JSON.parse(String(values[1])) as string[]; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith("SELECT version,entries FROM module_dictionary_versions")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("UPDATE module_dictionary_versions")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("INSERT INTO module_dictionary_versions")) return { rows: [{ version: 2 }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  return { pool: pool as never, calls, mappings };
}

test("team directory reports roster bindings and flags same-name multi-account conflicts", async () => {
  const mappings: DirectoryMapping[] = [
    { normalized_name: "贾浩", teambition_user_id: null, display_name: "贾浩", feishu_user_id: "ou-jia", feishu_id_type: "open_id", updated_at: "2026-10-20T00:00:00.000Z", active: true },
    { normalized_name: "刘媛媛", teambition_user_id: "tb-1", display_name: "刘媛媛", feishu_user_id: "ou-liu-a", feishu_id_type: "open_id", updated_at: "2026-10-19T00:00:00.000Z", active: true },
    { normalized_name: "刘媛媛", teambition_user_id: "tb-2", display_name: "刘媛媛", feishu_user_id: "ou-liu-b", feishu_id_type: "open_id", updated_at: "2026-10-21T00:00:00.000Z", active: true },
    { normalized_name: "李晨璐", teambition_user_id: null, display_name: "李晨璐", feishu_user_id: "ou-old", feishu_id_type: "open_id", updated_at: "2026-10-18T00:00:00.000Z", active: false },
  ];
  const { pool } = directoryPool(["贾浩", "刘媛媛", "李晨璐"], mappings);
  const store = new PostgresRepositories(pool).directory;
  assert.deepEqual(await store.listPeople(), [
    { name: "贾浩", binding: { feishuUserId: "ou-jia", feishuIdType: "open_id", boundAt: "2026-10-20T00:00:00.000Z" }, bindingConflict: false },
    { name: "刘媛媛", binding: null, bindingConflict: true },
    { name: "李晨璐", binding: null, bindingConflict: false },
  ]);
});

test("binding a person inserts one roster mapping and rejects an account already bound elsewhere", async () => {
  const people = ["贾浩", "刘媛媛", "盛永帮"];
  const mappings: DirectoryMapping[] = [
    // 需求详情里已有人工映射（带 TB user ID）：人员页改绑应原地更新，而不是再插入一条同姓名映射。
    { normalized_name: "盛永帮", teambition_user_id: "tb-9", display_name: "盛永帮", feishu_user_id: "ou-sheng-old", feishu_id_type: "open_id", updated_at: "2026-10-20T00:00:00.000Z", active: true },
  ];
  const { pool, calls } = directoryPool(people, mappings);
  const store = new PostgresRepositories(pool).directory;
  const event = (id: string) => ({ id, actorId: "test-actor", eventType: "team_person.feishu_bound", entityType: "team_person", result: "succeeded" as const, safeDetails: {}, occurredAt: "2026-10-22T00:00:00.000Z" });

  const bound = await store.bindPersonFeishu("贾浩", { feishuUserId: "ou-jia", feishuIdType: "open_id" }, event("event-1"));
  assert.deepEqual(bound[0], { name: "贾浩", binding: { feishuUserId: "ou-jia", feishuIdType: "open_id", boundAt: "2026-10-22T00:00:00.000Z" }, bindingConflict: false });
  const insert = calls.find((call) => call.sql.startsWith("INSERT INTO person_mappings"));
  assert.ok(insert);
  // 人员页绑定按姓名唯一匹配生效：首推静默、owner 状态 auto_mapped（D-12）。
  assert.match(insert.sql, /'unique_name'/);
  assert.equal(mappings.find((row) => row.active && row.normalized_name === "贾浩")?.match_method, "unique_name");
  assert.ok(calls.some((call) => call.sql.startsWith("INSERT INTO audit_events")));

  // 同一飞书账号不能再绑定给另一位人员
  await assert.rejects(() => store.bindPersonFeishu("刘媛媛", { feishuUserId: "ou-jia", feishuIdType: "open_id" }, event("event-2")), { name: "TeamDirectoryConflict" });

  // 换一个账号时原地改绑，不新增同姓名映射（避免自动匹配歧义）
  const rebound = await store.bindPersonFeishu("贾浩", { feishuUserId: "ou-jia-2", feishuIdType: "open_id" }, event("event-3"));
  assert.equal(rebound[0]?.binding?.feishuUserId, "ou-jia-2");
  assert.equal(mappings.filter((row) => row.active && row.normalized_name === "贾浩").length, 1);

  // TB user 维度的既有映射被原地改绑：保留 TB user ID，仍然只有一条活跃映射。
  const adopted = await store.bindPersonFeishu("盛永帮", { feishuUserId: "ou-sheng-new", feishuIdType: "open_id" }, event("event-4"));
  assert.equal(adopted.find((person) => person.name === "盛永帮")?.binding?.feishuUserId, "ou-sheng-new");
  const shengRows = mappings.filter((row) => row.active && row.normalized_name === "盛永帮");
  assert.equal(shengRows.length, 1);
  assert.equal(shengRows[0]?.teambition_user_id, "tb-9");
});

test("binding a person adopts an existing unnamed TB-scoped mapping for the same Feishu account", async () => {
  // 回归：历史需求级映射可能只有 TB user ID + 飞书账号、没有姓名（执行人姓名当时没取到）。
  // 人员页绑定时应补全姓名并复用该行，而不是报“已绑定到其他人员”把人挡死。
  const people = ["刘媛媛", "贾浩"];
  const mappings: DirectoryMapping[] = [
    { normalized_name: null, teambition_user_id: "tb-liu", display_name: null, feishu_user_id: "ou-liu", feishu_id_type: "open_id", updated_at: "2026-10-18T00:00:00.000Z", active: true, match_method: "manual" },
    // 只有显示名、且明确属于另一位人员的无姓名行：仍然拒绝，避免悄悄改归属。
    { normalized_name: null, teambition_user_id: "tb-wang", display_name: "王五", feishu_user_id: "ou-jia", feishu_id_type: "open_id", updated_at: "2026-10-18T00:00:00.000Z", active: true, match_method: "manual" },
  ];
  const { pool, calls } = directoryPool(people, mappings);
  const store = new PostgresRepositories(pool).directory;
  const event = (id: string) => ({ id, actorId: "test-actor", eventType: "team_person.feishu_bound", entityType: "team_person", result: "succeeded" as const, safeDetails: {}, occurredAt: "2026-10-22T00:00:00.000Z" });

  const bound = await store.bindPersonFeishu("刘媛媛", { feishuUserId: "ou-liu", feishuIdType: "open_id" }, event("event-1"));
  assert.equal(bound.find((person) => person.name === "刘媛媛")?.binding?.feishuUserId, "ou-liu");
  assert.equal(mappings[0]?.normalized_name, "刘媛媛");
  assert.equal(mappings[0]?.display_name, "刘媛媛");
  assert.equal(mappings[0]?.teambition_user_id, "tb-liu");
  assert.equal(calls.some((call) => call.sql.startsWith("INSERT INTO person_mappings")), false, "复用已有行时不应再插入一条同账号映射");

  await assert.rejects(() => store.bindPersonFeishu("贾浩", { feishuUserId: "ou-jia", feishuIdType: "open_id" }, event("event-2")), { name: "TeamDirectoryConflict" });
});

test("renaming a person carries the binding and refuses a target name bound to another account", async () => {
  const people = ["贾浩", "刘媛媛"];
  const mappings: DirectoryMapping[] = [
    { normalized_name: "贾浩", teambition_user_id: null, display_name: "贾浩", feishu_user_id: "ou-jia", feishu_id_type: "open_id", updated_at: "2026-10-20T00:00:00.000Z", active: true, match_method: "unique_name" },
    { normalized_name: "刘媛媛", teambition_user_id: "tb-liu", display_name: "刘媛媛", feishu_user_id: "ou-liu", feishu_id_type: "open_id", updated_at: "2026-10-20T00:00:00.000Z", active: true },
    // 目标姓名已有另一飞书身份：改名必须拒绝，否则同一姓名会出现两条不同账号的活跃映射。
    { normalized_name: "王五", teambition_user_id: "tb-wang", display_name: "王五", feishu_user_id: "ou-wang", feishu_id_type: "open_id", updated_at: "2026-10-20T00:00:00.000Z", active: true },
  ];
  const { pool } = directoryPool(people, mappings);
  const store = new PostgresRepositories(pool).directory;
  const event = { id: "event", actorId: "test-actor", eventType: "team_person.renamed", entityType: "team_person", result: "succeeded" as const, safeDetails: {}, occurredAt: "2026-10-22T00:00:00.000Z" };

  const renamed = await store.renamePerson("贾浩", "贾浩改", event);
  assert.equal(renamed.find((person) => person.name === "贾浩改")?.binding?.feishuUserId, "ou-jia");
  assert.equal(mappings.some((row) => row.active && row.normalized_name === "贾浩"), false);
  assert.equal(mappings.find((row) => row.active && row.normalized_name === "贾浩改")?.display_name, "贾浩改");

  await assert.rejects(() => store.renamePerson("刘媛媛", "王五", event), { name: "TeamDirectoryConflict" });
  assert.equal(mappings.filter((row) => row.active && row.normalized_name === "王五").length, 1);
});

test("requirement-level manual mapping replaces only that person's name-scoped mapping", async () => {
  // 回归：旧实现按 (source, tb_user_id IS NULL) 停用所有人员维度映射；
  // 人员页绑定也是人员维度行，一次需求人工分配会把全组绑定一起清掉。
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const now = "2026-10-22T00:00:00.000Z";
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT * FROM person_mappings")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT teambition_display_name FROM person_mappings")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("INSERT INTO person_mappings")) return { rows: [{ id: "map-1", source_config_id: "s", teambition_user_id: null, teambition_display_name: "贾浩", normalized_name: "贾浩", feishu_user_id: "ou-new", feishu_id_type: "open_id", match_method: "manual", active: true, created_by: "u", created_at: new Date(now), updated_at: new Date(now) }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const store = new PostgresRepositories({ query, connect: async () => ({ query, release() {} }) } as never);
  const saved = await store.people.upsertManual({ sourceConfigId: "s", teambitionUserId: null, teambitionDisplayName: "贾浩", feishuUserId: "ou-new", feishuIdType: "open_id", createdBy: "u", now });
  assert.equal(saved.feishuUserId, "ou-new");
  const deactivate = calls.find((call) => call.sql.startsWith("UPDATE person_mappings SET active=false"));
  assert.ok(deactivate);
  // 只停用同名行；其他人员的绑定不受影响。
  assert.match(deactivate.sql, /normalized_name IS NOT DISTINCT FROM \$4/);
  // Drizzle 传输层会把重复占位符拆成独立参数；没有 ::text 时 PostgreSQL 无法推断 $3 IS NOT NULL 的类型。
  assert.match(deactivate.sql, /\(\$3::text IS NOT NULL/);
  assert.deepEqual(deactivate.values, ["s", now, null, "贾浩"]);
  const guard = calls.find((call) => call.sql.startsWith("SELECT teambition_display_name FROM person_mappings"));
  assert.ok(guard, "插入前必须检查账号是否已属于另一位人员");
});

test("deleting a person deactivates every active mapping for that name", async () => {
  const people = ["贾浩", "刘媛媛"];
  const mappings: DirectoryMapping[] = [
    { normalized_name: "贾浩", teambition_user_id: null, display_name: "贾浩", feishu_user_id: "ou-jia", feishu_id_type: "open_id", updated_at: "2026-10-20T00:00:00.000Z", active: true, match_method: "unique_name" },
    { normalized_name: "刘媛媛", teambition_user_id: null, display_name: "刘媛媛", feishu_user_id: "ou-liu", feishu_id_type: "open_id", updated_at: "2026-10-20T00:00:00.000Z", active: true, match_method: "unique_name" },
  ];
  const { pool } = directoryPool(people, mappings);
  const store = new PostgresRepositories(pool).directory;
  const event = { id: "event", actorId: "test-actor", eventType: "team_person.deleted", entityType: "team_person", result: "succeeded" as const, safeDetails: {}, occurredAt: "2026-10-22T00:00:00.000Z" };

  const remaining = await store.deletePerson("贾浩", event);
  assert.deepEqual(remaining.map((person) => person.name), ["刘媛媛"]);
  assert.equal(mappings.some((row) => row.active && row.normalized_name === "贾浩"), false);
  assert.equal(mappings.find((row) => row.active && row.normalized_name === "刘媛媛")?.feishu_user_id, "ou-liu");
});

function recordingPool() {
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  // 0031：需求的搜索/批次列表会 LEFT JOIN source_configs（或带 EXISTS 子查询）做池过滤，
  // 所以来源行只在语句本身针对 source_configs 时返回，避免把来源行当成需求/作业行映射。
  const isSourceQuery = (sql:string) => ["UPDATE source_configs","INSERT INTO source_configs","FROM source_configs WHERE id=$1","FROM source_configs ORDER BY","SELECT id,owner_names FROM source_configs"].some((needle)=>sql.includes(needle));
  const resultFor = (sql:string, values?:unknown[]) => sql.includes("pipeline_jobs")
    ? { rows: [{ id:"job-1",job_type:"analysis",dedupe_key:values?.[2],payload:{requirementId:"req-1"},status:"queued",attempt_count:0,max_attempts:5,available_at:new Date(0),locked_until:null,last_error_code:null,last_error_summary:null,created_at:new Date(0),updated_at:new Date(0)}], rowCount:1 }
    : isSourceQuery(sql)
      ? { rows: [{ id:"sid",provider:"teambition",pool:"product",executor_allowlist:[],external_project_id:"p",external_project_name:"P",requirement_type_id:"t",enabled:false,schedule_enabled:false,schedule_weekday:null,schedule_local_time:null,schedule_timezone:null,owner_names:[],field_map:{},created_at:new Date(0),updated_at:new Date(0)}], rowCount:1 }
    : sql.includes("base_push_runs") && sql.includes("idempotency_key")
      ? { rows: [{ id:"push-1",requirement_id:"req-1",source_version:2,push_version:3,status:"pushed",idempotency_key:values?.[0],base_record_id:"base-1",safe_error_code:null,safe_error_summary:null,started_at:new Date(0),completed_at:new Date(1)}], rowCount:1 }
      : { rows: [], rowCount:0 };
  const pool = { query: async (sql:string,values?:unknown[]) => { calls.push({sql,values}); return resultFor(sql,values); }, connect: async () => ({ query: async (sql:string,values?:unknown[]) => { calls.push({sql,values}); return resultFor(sql,values); }, release(){} }) };
  return { pool: pool as never, calls };
}

test("source config repository maps persisted snake_case fields", async()=>{
  const {pool}=recordingPool();const store=new PostgresRepositories(pool);const rows=await store.sources.list();
  assert.equal(rows[0]?.externalProjectId,"p");assert.equal(rows[0]?.scheduleTimezone,null);
});

test("overview aggregation excludes synthetic fixtures and maps database counts", async()=>{
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [{ total: "311", pull_synced: "311", analysis_analyzed: "0", owner_resolved: "0", push_pushed: "0", failed: "0", push_failed: "0", push_pending: "0", priority_p0: "2", priority_p1: "3", priority_p2: "4", priority_p3: "5", priority_scored: "6", priority_legacy: "7", priority_unscored: "298", suppressed: "9" }], rowCount: 1 };
    },
    connect: async () => { throw new Error("not used"); },
  } as never;
  const store = new PostgresRepositories(pool);
  assert.deepEqual(await store.requirements.getPipelineCounts(), {
    total: 311, pullSynced: 311, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 0, suppressed: 9,
    priority: { P0: 2, P1: 3, P2: 4, P3: 5, scored: 6, legacy: 7, unscored: 298 },
  });
  assert.match(calls[0]!.sql, /GROUP BY|FILTER/);
  assert.match(calls[0]!.sql, /teambition_requirement_id NOT LIKE \$1/);
  assert.deepEqual(calls[0]!.values, ["rqsys-fixture-%", "product"]);
});

test("source config JSON fields are passed as JSON, not PostgreSQL array literals", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.sources.create({projectId:"p",projectName:"P",requirementTypeId:"t",enabled:true,schedule:{enabled:false,weekday:null,time:null,timezone:null},ownerNames:["PM Owner"],fieldMap:{description:"cf-1"}});
  const insert=calls.find((call)=>call.sql.includes("INSERT INTO source_configs"));
  // 0031：pool 成为第 2 个参数，ownerNames/fieldMap/executorAllowlist 顺延到 11/12/13。
  assert.equal(insert?.values?.[1],"product");
  assert.equal(insert?.values?.[11],JSON.stringify(["PM Owner"]));
  assert.equal(insert?.values?.[12],JSON.stringify({description:"cf-1"}));
  assert.equal(insert?.values?.[13],"[]");
});

test("audit search uses parameterized filters and limit", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.audit.search({entityId:"e1",since:"2026-01-01T00:00:00Z",limit:10});
  assert.match(calls[0]!.sql,/WHERE \(\$1::text IS NULL/);assert.deepEqual(calls[0]!.values,["e1","2026-01-01T00:00:00Z",null,10,null]);
  await store.audit.search({eventType:"analysis.retry_requested",limit:10});
  assert.match(calls[1]!.sql,/event_type=\$5/);assert.deepEqual(calls[1]!.values,[null,null,null,10,"analysis.retry_requested"]);
});

test("manual metadata edit enqueues a deterministic base-push key and requeues a finished job", async()=>{
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  const sub = substantiveHash({ title: "t", description: "d", scope: null, acceptanceCriteria: null, attachmentRefs: [] });
  const row = { id:"req-1",source_type:"web_manual",source_version:1,title:"t",description:"d",source_channel:"售后",product_model:null,requirement_type:null,constraint_notes:null,supplement_url:null,intake_module:null,source_payload:{},proposer_name:"小王",source_hash:"h1",substantive_hash:sub };
  const pool = { query: async()=>({rows:[],rowCount:0}), connect: async()=>({ query: async(sql:string,values:unknown[])=>{ calls.push({sql,values}); if(sql.startsWith("SELECT id,source_type")) return {rows:[row],rowCount:1}; if(sql.startsWith("SELECT requirement_id,request_hash")) return {rows:[],rowCount:0}; if(sql.startsWith("SELECT COALESCE(MAX(analysis_version)")) return {rows:[{v:2}],rowCount:1}; return {rows:[],rowCount:0}; }, release(){} }) } as never;
  const store = new PostgresRepositories(pool);
  const requestHash = "a".repeat(64);
  const result = await store.requirements.updateManualRequirement({ requirementId:"req-1",expectedSourceVersion:1,idempotencyKey:"edit-key-0001",actorId:"operator",requestHash,sourceChannel:"销售" });
  assert.equal(result.outcome,"updated");
  const job = calls.find((call)=>call.sql.includes("INSERT INTO pipeline_jobs"));
  assert.ok(job,"metadata edit must enqueue a base_push job");
  assert.equal(job!.values![1],`base-push:req-1:sv1:av2:meta:${"a".repeat(16)}`);
  // 确定性键必须能重新排队已结束的同键作业，否则 X→Y→X 的第三次推送会被去重吞掉。
  assert.match(job!.sql,/ON CONFLICT\(dedupe_key\) DO UPDATE/);
  assert.match(job!.sql,/WHERE pipeline_jobs\.status IN \('succeeded','failed','cancelled'\)/);
});

test("RICE draft save returns unchanged without a new version when merged inputs equal the stored ones", async()=>{
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  const existing = { requirement_id:"req-1",reach_input:"1000",impact_input:"2",confidence_input:"80",effort_input:"5",notes:"n",source_version:3,edit_version:4,updated_by:"u",updated_at:new Date(0) };
  const pool = { query: async()=>({rows:[],rowCount:0}), connect: async()=>({ query: async(sql:string,values:unknown[])=>{ calls.push({sql,values}); return sql.includes("SELECT * FROM rice_drafts")?{rows:[existing],rowCount:1}:{rows:[],rowCount:0}; }, release(){} }) } as never;
  const store = new PostgresRepositories(pool);
  const result = await store.requirements.saveRiceDraft({ requirementId:"req-1",expectedEditVersion:4,actorId:"u",sourceVersion:3,reachInput:"1000",impactInput:"2",confidenceInput:"80",effortInput:"5",notes:"n" });
  assert.deepEqual(result,{outcome:"unchanged",editVersion:4});
  assert.equal(calls.some((call)=>call.sql.startsWith("UPDATE rice_drafts")),false);
  assert.equal(calls.some((call)=>call.sql.includes("INSERT INTO rice_draft_history")),false);
});

test("RICE draft save rejects a stale source baseline instead of editing over a newer requirement", async()=>{
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  // 草稿上次基于源版本 3 保存；需求已被同步推进到源版本 5，编辑者仍拿旧基线的编辑版本提交。
  const existing = { requirement_id:"req-1",reach_input:"1000",impact_input:"2",confidence_input:"80",effort_input:"5",notes:"n",source_version:3,edit_version:4,updated_by:"u",updated_at:new Date(0) };
  const pool = { query: async()=>({rows:[],rowCount:0}), connect: async()=>({ query: async(sql:string,values:unknown[])=>{ calls.push({sql,values}); return sql.includes("SELECT * FROM rice_drafts")?{rows:[existing],rowCount:1}:{rows:[],rowCount:0}; }, release(){} }) } as never;
  const store = new PostgresRepositories(pool);
  // expectedEditVersion 匹配（4==4）但请求的 sourceVersion 是 5，与草稿基线 3 不符。
  const result = await store.requirements.saveRiceDraft({ requirementId:"req-1",expectedEditVersion:4,actorId:"u",sourceVersion:5,reachInput:"2000",impactInput:"2",confidenceInput:"80",effortInput:"5",notes:"n" });
  assert.deepEqual(result,{outcome:"source_version_conflict",currentSourceVersion:3});
  assert.equal(calls.some((call)=>call.sql.startsWith("UPDATE rice_drafts")),false);
  assert.equal(calls.some((call)=>call.sql.includes("INSERT INTO rice_draft_history")),false);
});

test("audit persistence strips fields outside the safe details allowlist", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.audit.append({id:"00000000-0000-4000-8000-000000000123",actorId:"actor-1",eventType:"source.updated",entityType:"source_config",entityId:"source-1",result:"succeeded",safeDetails:{sourceVersion:2,apiKey:"secret",unreviewedField:"private"},occurredAt:"2026-10-10T00:00:00Z"});
  const insert=calls.find((call)=>call.sql.includes("INSERT INTO audit_events"));
  assert.deepEqual(insert?.values?.[6],{sourceVersion:2});
});

test("batch search applies inclusive time bounds and a stable composite cursor", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  const cursor={startedAt:"2026-01-02T00:00:00.000Z",id:"33333333-3333-4333-8333-333333333333"};
  await store.batches.list({status:"failed",since:"2026-01-01T00:00:00Z",until:"2026-01-03T00:00:00Z",cursor,limit:10});
  assert.match(calls[0]!.sql,/b\.started_at >= \$2/);assert.match(calls[0]!.sql,/b\.started_at <= \$3/);assert.match(calls[0]!.sql,/\(b\.started_at,b\.id\)<\(\$4::timestamptz,\$5::uuid\)/);
  // 0031：批次列表按池过滤，pool 作为第 7 个参数追加（缺省 product）。
  assert.match(calls[0]!.sql,/sc\.pool=\$7::text/);
  assert.deepEqual(calls[0]!.values,["failed","2026-01-01T00:00:00Z","2026-01-03T00:00:00Z",cursor.startedAt,cursor.id,11,"product"]);
});

test("requirement search filters by latest batch and last-seen time on the server", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.requirements.search({batchId:"33333333-3333-4333-8333-333333333333",since:"2026-01-01T00:00:00Z",until:"2026-01-02T00:00:00Z",limit:25});
  assert.match(calls[0]!.sql,/latest_batch_id=\$7/);assert.match(calls[0]!.sql,/last_seen_at >= \$8/);assert.match(calls[0]!.sql,/last_seen_at <= \$9/);
  // 末两个参数是 0034 回收站的 (deleted_at,id) 游标；普通列表传 null，不改变过滤语义。
  assert.deepEqual(calls[0]!.values,[null,null,null,null,null,null,"33333333-3333-4333-8333-333333333333","2026-01-01T00:00:00Z","2026-01-02T00:00:00Z",null,null,26,null,null,null,"product",false,null,null,null]);
});

test("recycle-bin aggregate search drops the pool filter, orders by deleted_at and keeps parameters aligned", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.requirements.search({deleted:true,deletedBy:"actor-1",pool:"all",limit:10,deletedCursor:{deletedAt:"2026-01-02T00:00:00.000Z",id:"55555555-5555-4555-8555-555555555555"}});
  const sql=calls[0]!.sql as string, values=calls[0]!.values as unknown[];
  // 聚合两池：不带任何池过滤，按删除时间倒序。
  assert.doesNotMatch(sql,/sc\.pool=/);
  assert.match(sql,/ORDER BY r\.deleted_at DESC,r\.id DESC/);
  assert.match(sql,/\(r\.deleted_at,r\.id\)<\(\$\d+::timestamptz,\$\d+::uuid\)/);
  // 关键回归：参数个数必须等于 SQL 里最大的占位符；多传一个未引用的参数会让 PostgreSQL 报
  // "could not determine data type of parameter $N"。
  const maxPlaceholder=Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((match)=>Number(match[1])));
  assert.equal(values.length,maxPlaceholder);
  assert.equal(values[11],11);
});

test("priority triage search filters effective priority and disables cursor pagination", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  const page=await store.requirements.search({priority:"P2",sort:"priority_asc",limit:25,cursor:{createdAt:"2026-01-01T00:00:00.000Z",id:"55555555-5555-4555-8555-555555555555"}});
  assert.match(calls[0]!.sql,/COALESCE\(r\.priority_override, sv\.priority\)=\$14/);
  assert.match(calls[0]!.sql,/CASE WHEN \$15::text='priority_asc'/);
  // priority_asc 忽略游标：$10/$11 为 null，单页最多 100 条，nextCursor 必须为 null。
  assert.equal(calls[0]!.values![9],null);
  assert.equal(calls[0]!.values![10],null);
  assert.equal(calls[0]!.values![13],"P2");
  assert.equal(calls[0]!.values![14],"priority_asc");
  assert.equal(calls[0]!.values![15],"product");
  assert.equal(page.nextCursor,null);
});

test("requirement search escapes LIKE wildcards and uses the indexed UTC keyset expression", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  const cursor={createdAt:"2026-01-01T00:00:00.000Z",id:"55555555-5555-4555-8555-555555555555"};
  await store.requirements.search({q:"100%_done\\",limit:20,cursor});
  assert.match(calls[0]!.sql,/AT TIME ZONE 'UTC'/);
  assert.equal(calls[0]!.values![0],"100\\%\\_done\\\\");
  assert.equal(calls[0]!.values![9],"2026-01-01T00:00:00.000Z");
});

test("base push repository looks up a run by idempotency key", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  const run=await store.basePushes.findByIdempotencyKey("push:key");
  assert.equal(run?.id,"push-1");assert.equal(run?.requirementId,"req-1");assert.equal(run?.baseRecordId,"base-1");
  assert.match(calls[0]!.sql,/FROM base_push_runs WHERE idempotency_key=\$1/);assert.deepEqual(calls[0]!.values,["push:key"]);
});

test("ops metrics query uses the computed window and returns a stable shape on empty data", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  const metrics=await store.ops.getOpsMetrics({days:7,now:"2026-11-10T00:00:00.000Z"});
  assert.equal(calls.length,2);
  assert.equal(calls[0]!.values![0],"2026-11-03T00:00:00.000Z");
  assert.match(calls[0]!.sql,/sync_batches/);
  assert.match(calls[1]!.sql,/safe_error_code/);
  assert.deepEqual(metrics.sync,{total:0,succeeded:0,partialFailure:0,failed:0,successRate:null,avgDurationSeconds:null,lastCompletedAt:null});
  assert.deepEqual(metrics.analysis.failureCodes,[]);
  assert.equal(metrics.scoring.adoptionRate,null);
});

test("ops metrics scope every section by pool and count pushes per requirement by the last attempt", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.ops.getOpsMetrics({days:7,now:"2026-11-10T00:00:00.000Z",pool:"group"});
  // 池作用域：缺省 product，集团视图必须显式带上。
  assert.match(calls[0]!.sql,/scoped_source AS \(SELECT id FROM source_configs WHERE pool=\$2::text\)/);
  assert.match(calls[0]!.sql,/scoped_req AS/);
  // 推送口径：先按需求取窗口内最后一次尝试，再按该状态计数（attempt 口径会把历史失败计入）。
  assert.match(calls[0]!.sql,/DISTINCT ON \(r\.requirement_id\)/);
  assert.match(calls[0]!.sql,/FROM last_push WHERE status='pushed'/);
  assert.match(calls[0]!.sql,/FROM last_push WHERE status='failed'/);
  assert.deepEqual(calls[0]!.values,["2026-11-03T00:00:00.000Z","group"]);
  assert.deepEqual(calls[1]!.values,["2026-11-03T00:00:00.000Z","group"]);
});

test("ops view lists failed jobs with a bounded parameterized query", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.jobs.listFailed(25);
  assert.match(calls[0]!.sql,/j\.status='failed'/);
  assert.match(calls[0]!.sql,/ORDER BY j\.updated_at DESC, j\.id DESC LIMIT \$1/);
  // 0031：作业按池作用域过滤（按 payload 的 sourceId / requirementId 归属），pool 追加在 limit 之后。
  assert.match(calls[0]!.sql,/sc\.pool=\$2::text/);
  assert.deepEqual(calls[0]!.values,[25,"product"]);
});

test("job claim uses SKIP LOCKED and expires old leases", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.jobs.claimNext("worker-1",30000,"2026-01-01T00:00:00Z");
  assert.match(calls[0]!.sql,/^BEGIN$/);assert.match(calls[1]!.sql,/FOR UPDATE SKIP LOCKED/);assert.match(calls[1]!.sql,/locked_until <= \$1/);
});

test("first module dictionary save persists the built-in roster", async()=>{
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  const query = async (sql:string,values?:unknown[]) => {
    calls.push({sql,values});
    if (sql.includes("SELECT id,owner_names FROM source_configs")) return {rows:[{id:"source-1",owner_names:[]}],rowCount:1};
    if (sql.includes("SELECT version FROM module_dictionary_versions")) return {rows:[],rowCount:0};
    if (sql.includes("SELECT EXISTS(SELECT 1 FROM module_dictionary_versions")) return {rows:[{has_dictionary:false}],rowCount:1};
    if (sql.includes("INSERT INTO module_dictionary_versions")) return {rows:[{version:1}],rowCount:1};
    return {rows:[],rowCount:0};
  };
  const pool = {query,connect:async()=>({query,release(){}})} as never;
  const store = new PostgresRepositories(pool);
  await store.directory.saveModules(0,[{name:"爬坡",personName:null}],"user-1","2026-10-13T00:00:00.000Z",{
    id:"00000000-0000-4000-8000-000000000123",actorId:"user-1",eventType:"module_dictionary.published",entityType:"module_dictionary",result:"succeeded",safeDetails:{entryCount:1},occurredAt:"2026-10-13T00:00:00.000Z",
  });
  const rosterWrite = calls.find((call)=>call.sql.includes("UPDATE source_configs SET owner_names"));
  assert.ok(rosterWrite);
  assert.deepEqual(JSON.parse(String(rosterWrite.values?.[1])),DEFAULT_TEAM_MEMBERS);
});

test("module dictionary save refuses an empty list without retiring the published version", async()=>{
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  const query = async (sql:string,values?:unknown[]) => {
    calls.push({sql,values});
    if (sql.includes("SELECT id,owner_names FROM source_configs")) return {rows:[{id:"source-1",owner_names:["毕梓浩"]}],rowCount:1};
    if (sql.includes("SELECT version FROM module_dictionary_versions")) return {rows:[{version:3}],rowCount:1};
    return {rows:[],rowCount:0};
  };
  const pool = {query,connect:async()=>({query,release(){}})} as never;
  const store = new PostgresRepositories(pool);
  await assert.rejects(()=>store.directory.saveModules(3,[],"user-1","2026-10-13T00:00:00.000Z",{
    id:"00000000-0000-4000-8000-000000000124",actorId:"user-1",eventType:"module_dictionary.published",entityType:"module_dictionary",result:"succeeded",safeDetails:{entryCount:0},occurredAt:"2026-10-13T00:00:00.000Z",
  }),{name:"TeamDirectoryConflict"});
  assert.ok(!calls.some((call)=>call.sql.includes("SET status='retired'")),"the published version must survive");
  assert.ok(!calls.some((call)=>call.sql.includes("INSERT INTO module_dictionary_versions")),"no empty version may be inserted");
});

test("enqueue reopens a terminally failed job for an explicit same-key retry", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.jobs.enqueue({jobType:"analysis",dedupeKey:"analysis:req-1:sv1:after1",payload:{requirementId:"req-1"},availableAt:"2026-01-01T00:00:00Z"});
  assert.match(calls[0]!.sql,/ON CONFLICT\(dedupe_key\) DO UPDATE/);
  assert.match(calls[0]!.sql,/status IN \('failed','cancelled'\)/);
  assert.match(calls[0]!.sql,/attempt_count=0/);
});

// PRD-30：base_form 编辑只改平台侧；source_payload 保留 formRecordId 与原始表单投影。
type EditRow = Record<string, unknown>;
function editPool(row: EditRow) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const query = async (text: string, values: unknown[] = []) => {
    statements.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes("FROM requirements WHERE id=$1 FOR UPDATE")) return { rows: [row], rowCount: 1 };
    if (text.includes("FROM requirement_edit_receipts WHERE idempotency_key=$1")) return { rows: [], rowCount: 0 };
    if (text.includes("COALESCE(MAX(analysis_version)")) return { rows: [{ v: 2 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const store = new PostgresRepositories({ query, connect: async () => ({ query, release() {} }) } as never).requirements;
  return { store, statements };
}

function baseFormEditRow() {
  return {
    id: "req-1", source_type: "base_form", source_version: 1, title: "旧标题", description: "旧描述",
    source_channel: "售后", product_model: "C706", requirement_type: "新增功能", constraint_notes: null,
    supplement_url: null, intake_module: null, proposer_name: "张骑", source_hash: "old-source-hash",
    substantive_hash: substantiveHash({ title: "旧标题", description: "旧描述", scope: null, acceptanceCriteria: null, attachmentRefs: [] }),
    source_payload: { sourceType: "base_form", formRecordId: "rec-1", title: "旧标题", description: "旧描述", sourceChannel: "售后" },
  };
}

test("base_form substantive edit bumps the version, keeps formRecordId provenance and re-runs analysis", async () => {
  const { store, statements } = editPool(baseFormEditRow());
  const result = await store.updateManualRequirement({
    requirementId: "req-1", expectedSourceVersion: 1, idempotencyKey: "key-1", actorId: "actor-1", requestHash: "hash-1", title: "新标题",
  });
  assert.deepEqual(result, { outcome: "updated", sourceVersion: 2, substantiveChanged: true, replay: false });
  const snapshot = statements.find((statement) => statement.text.startsWith("INSERT INTO source_snapshots"))!;
  const snapshotPayload = JSON.parse(String(snapshot.values[5]));
  assert.equal(snapshotPayload.formRecordId, "rec-1");
  assert.equal(snapshotPayload.title, "旧标题", "source_payload 保留收集表原文，不改写成平台编辑值");
  const update = statements.find((statement) => statement.text.startsWith("UPDATE requirements SET title=$2"))!;
  assert.equal(update.values[10], 2);
  assert.equal(JSON.parse(String(update.values[11])).formRecordId, "rec-1");
  const analysis = statements.find((statement) => statement.text.includes("'analysis',$2"))!;
  assert.equal(analysis.values[1], "analysis:req-1:v2");
  assert.equal(statements.some((statement) => statement.text.includes("'base_push',$2")), false);
});

test("base_form metadata edit keeps the version and only enqueues a re-push with preserved provenance", async () => {
  const { store, statements } = editPool(baseFormEditRow());
  const result = await store.updateManualRequirement({
    requirementId: "req-1", expectedSourceVersion: 1, idempotencyKey: "key-2", actorId: "actor-1", requestHash: "hash-2", sourceChannel: "销售",
  });
  assert.deepEqual(result, { outcome: "updated", sourceVersion: 1, substantiveChanged: false, replay: false });
  const update = statements.find((statement) => statement.text.startsWith("UPDATE requirements SET source_channel=$2"))!;
  assert.equal(JSON.parse(String(update.values[5])).formRecordId, "rec-1");
  const push = statements.find((statement) => statement.text.includes("'base_push',$2"))!;
  assert.match(String(push.values[1]), /^base-push:req-1:sv1:av2:meta:/);
  assert.equal(statements.some((statement) => statement.text.includes("'analysis',$2")), false);
});

test("Teambition facts remain non-editable", async () => {
  const { store, statements } = editPool({ ...baseFormEditRow(), source_type: "teambition" });
  const result = await store.updateManualRequirement({
    requirementId: "req-1", expectedSourceVersion: 1, idempotencyKey: "key-3", actorId: "actor-1", requestHash: "hash-3", title: "新标题",
  });
  assert.deepEqual(result, { outcome: "not_manual" });
  assert.equal(statements.some((statement) => statement.text.startsWith("UPDATE requirements")), false);
});

test("疑似重复候选按「同来源 + active + 排除自身」查询，标题在调用方归一比对", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    return { rows: [{ id: "req-2", title: "低温掉电", platform_requirement_id: "RQ-000002", teambition_requirement_id: "tb-2" }], rowCount: 1 };
  };
  const repositories = new PostgresRepositories({ query, connect: async () => ({ query, release() {} }) } as never);
  const result = await repositories.requirements.listDuplicateCandidates({ requirementId: "req-1", sourceConfigId: "source-1" });
  assert.deepEqual(result, [{ id: "req-2", title: "低温掉电", platformRequirementId: "RQ-000002", teambitionRequirementId: "tb-2" }]);
  const sql = calls[0]!.sql;
  assert.match(sql, /id<>\$1/, "排除自身");
  assert.match(sql, /COALESCE\(processing_state,'active'\)='active'/, "排除已压制需求");
  assert.match(sql, /source_config_id=\$2::uuid/, "限定同一来源");
  assert.deepEqual(calls[0]!.values, ["req-1", "source-1"]);
  // 手工需求（无来源配置）：只在同为手工的范围内找候选。
  await repositories.requirements.listDuplicateCandidates({ requirementId: "req-1", sourceConfigId: null });
  assert.deepEqual(calls[1]!.values, ["req-1", null]);
  assert.match(calls[1]!.sql, /\$2::uuid IS NULL AND source_config_id IS NULL/);
});
