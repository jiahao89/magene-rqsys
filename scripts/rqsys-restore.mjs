#!/usr/bin/env node
// RQ-Sys 备份恢复演练（I3-6 / PR-12）。
//
// 把 rqsys-backup.mjs 导出的快照恢复到**隔离 schema**，用于验证备份可用与 RTO/RPO。
// 安全边界：
//   - 必须显式 --schema，且只接受 rq_restore_* 名称（防止误写 public / 生产 schema）；
//   - 只连接 --database-url 指向的库，先执行全部迁移建结构，再按外键拓扑顺序插入数据；
//   - 默认不需要超级用户权限：按父表优先顺序插入，并将 requirements 的自引用/循环外键
//     （current_score_version_id、duplicate_of_requirement_id）延后至子表落库后再 UPDATE 回填；
//     如需兼容旧的本地超级用户模式，可显式传 --use-replica-role。
//   - 不会删除或覆盖已有 schema，除非显式 --force-drop。
//
// 用法：
//   node scripts/rqsys-restore.mjs --in /tmp/rq-backup --database-url postgres://... --schema rq_restore_drill
//   node scripts/rqsys-restore.mjs --in ... --database-url ... --schema rq_restore_drill --force-drop [--use-replica-role]
//
// 演练完成后人工核对输出报告，再删除演练 schema：
//   DROP SCHEMA rq_restore_drill CASCADE;

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = resolve(rootDir, "database/migrations");
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/** FK 安全的父表优先插入顺序；反向即为安全的子表优先删除顺序。 */
const RESTORE_ORDER = [
  "source_configs",
  "priority_rule_versions",
  "module_dictionary_versions",
  "sync_batches",
  "requirements",
  "source_snapshots",
  "requirement_resolutions",
  "analysis_runs",
  "requirement_score_versions",
  "requirement_assessments",
  "requirement_prd_prompts",
  "kano_evidence_versions",
  "kano_runs",
  "person_mappings",
  "rice_drafts",
  "rice_draft_history",
  "requirement_intake_receipts",
  "requirement_edit_receipts",
  "pm_snapshots",
  "base_push_runs",
  "sync_items",
  "pipeline_jobs",
  "system_flags",
  "audit_events",
];

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function stripTransactionWrapper(sql) {
  return sql.replace(/^\s*(?:--[^\n]*\n\s*)*BEGIN\s*;\s*/i, "").replace(/\s*COMMIT\s*;\s*$/i, "\n");
}

async function readJsonl(path) {
  const content = await readFile(path, "utf8");
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function sortByRestoreOrder(entries) {
  const rank = new Map(RESTORE_ORDER.map((name, index) => [name, index]));
  return [...entries].sort((left, right) => {
    const a = rank.has(left.table) ? rank.get(left.table) : Number.MAX_SAFE_INTEGER;
    const b = rank.has(right.table) ? rank.get(right.table) : Number.MAX_SAFE_INTEGER;
    return a - b;
  });
}

async function main() {
  const input = arg("--in");
  const databaseUrl = arg("--database-url") ?? process.env.RQ_BACKUP_DATABASE_URL;
  const schema = arg("--schema");
  const useReplicaRole = process.argv.includes("--use-replica-role");
  if (!input || !databaseUrl || !schema) {
    console.error("usage: rqsys-restore.mjs --in <dir> --database-url <url> --schema rq_restore_<name> [--force-drop] [--use-replica-role]");
    process.exit(1);
  }
  if (!/^rq_restore_[a-z0-9_]+$/.test(schema)) {
    console.error("refusing: --schema must match rq_restore_[a-z0-9_]+ (production/public schemas are not allowed)");
    process.exit(1);
  }
  const dir = resolve(input);
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
  for (const entry of manifest.tables ?? []) {
    if (!IDENT_RE.test(entry.table)) throw new Error(`unsafe table name in manifest: ${entry.table}`);
  }
  const orderedEntries = sortByRestoreOrder(manifest.tables ?? []);
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schema}` });
  const startedAt = Date.now();
  try {
    const exists = await admin.query("SELECT 1 FROM information_schema.schemata WHERE schema_name=$1", [schema]);
    if (exists.rowCount) {
      if (!process.argv.includes("--force-drop")) throw new Error(`schema ${schema} already exists; pass --force-drop to recreate it`);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await admin.query(`CREATE SCHEMA "${schema}"`);

    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = stripTransactionWrapper(await readFile(resolve(MIGRATIONS_DIR, file), "utf8"));
      await pool.query(sql);
    }
    console.log(`applied ${files.length} migrations into ${schema}`);

    // 迁移会预置种子行（默认词典、v1 规则）。演练库是新建的隔离 schema：
    // 先按子表优先逆序清空，让快照成为唯一事实源，避免种子行与快照主键冲突。
    const client = await pool.connect();
    const report = [];
    const deferredRequirementRefs = [];
    try {
      await client.query("BEGIN");
      if (useReplicaRole) {
        await client.query("SET LOCAL session_replication_role = replica");
      }

      for (const entry of [...orderedEntries].reverse()) {
        await client.query(`DELETE FROM "${entry.table}"`);
      }

      for (const entry of orderedEntries) {
        const rows = await readJsonl(resolve(dir, `${entry.table}.jsonl`));
        if (rows.length === 0) {
          report.push({ table: entry.table, expected: entry.rows, restored: 0 });
          continue;
        }
        // pg 驱动会把 JS 数组当成 PostgreSQL 数组字面量；jsonb 列必须先序列化为 JSON 字符串，
        // 否则 {"a","b"} 这种数组字面量会以 22P02 被拒绝。按目标列类型决定参数形态。
        const typeRows = await client.query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
          [schema, entry.table],
        );
        const types = new Map(typeRows.rows.map((row) => [row.column_name, row.data_type]));
        const columns = Object.keys(rows[0]).filter((column) => {
          if (!IDENT_RE.test(column)) throw new Error(`unsafe column name in ${entry.table}: ${column}`);
          return types.has(column);
        });
        const placeholders = columns.map((column, index) => {
          const type = types.get(column);
          return type === "jsonb" || type === "json" ? `$${index + 1}::jsonb` : `$${index + 1}`;
        }).join(", ");
        const insert = `INSERT INTO "${entry.table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        let restored = 0;
        for (const row of rows) {
          if (!useReplicaRole && entry.table === "requirements") {
            const scoreRef = row.current_score_version_id ?? null;
            const dupRef = row.duplicate_of_requirement_id ?? null;
            if (scoreRef !== null || dupRef !== null) {
              deferredRequirementRefs.push({ id: row.id, current_score_version_id: scoreRef, duplicate_of_requirement_id: dupRef });
            }
          }
          const values = columns.map((column) => {
            if (!useReplicaRole && entry.table === "requirements" && (column === "current_score_version_id" || column === "duplicate_of_requirement_id")) {
              return null;
            }
            const value = row[column];
            const type = types.get(column);
            if ((type === "jsonb" || type === "json") && value !== null && typeof value !== "string") return JSON.stringify(value);
            return value;
          });
          const result = await client.query(insert, values);
          restored += result.rowCount ?? 0;
        }
        report.push({ table: entry.table, expected: entry.rows, restored });
        console.log(`restored ${entry.table}: ${restored}/${entry.rows}`);
      }

      if (!useReplicaRole && deferredRequirementRefs.length > 0) {
        for (const ref of deferredRequirementRefs) {
          await client.query(
            `UPDATE "requirements" SET "current_score_version_id" = $2, "duplicate_of_requirement_id" = $3 WHERE "id" = $1`,
            [ref.id, ref.current_score_version_id, ref.duplicate_of_requirement_id],
          );
        }
        console.log(`patched ${deferredRequirementRefs.length} deferred requirement FK reference(s)`);
      }

      await client.query("COMMIT");

      const counts = await client.query(`SELECT
        (SELECT count(*)::int FROM requirements) AS requirements,
        (SELECT count(*)::int FROM requirements WHERE push_state='pushed') AS pushed,
        (SELECT count(*)::int FROM requirements WHERE analysis_state='analyzed') AS analyzed,
        (SELECT count(*)::int FROM pipeline_jobs) AS jobs`);
      const mismatches = report.filter((item) => item.expected !== item.restored);
      console.log(`\nrestore drill finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (mode=${useReplicaRole ? "replica-role" : "fk-topological"})`);
      console.log(`rows: ${report.reduce((sum, item) => sum + item.restored, 0)} restored; requirements summary ${JSON.stringify(counts.rows[0])}`);
      if (mismatches.length > 0) {
        console.error(`mismatched tables: ${mismatches.map((item) => `${item.table}(${item.restored}/${item.expected})`).join(", ")}`);
        process.exitCode = 1;
      } else {
        console.log("all table row counts match the snapshot manifest");
      }
      console.log(`cleanup: DROP SCHEMA "${schema}" CASCADE;`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

await main();
