#!/usr/bin/env node
// RQ-Sys 备份恢复演练（I3-6 / PR-12）。
//
// 把 rqsys-backup.mjs 导出的快照恢复到**隔离 schema**，用于验证备份可用与 RTO/RPO。
// 安全边界：
//   - 必须显式 --schema，且只接受 rq_restore_* 名称（防止误写 public / 生产 schema）；
//   - 只连接 --database-url 指向的库，先执行全部迁移建结构，再按外键顺序插入数据；
//   - 不会删除或覆盖已有 schema，除非显式 --force-drop。
//
// 用法：
//   node scripts/rqsys-restore.mjs --in /tmp/rq-backup --database-url postgres://... --schema rq_restore_drill
//   node scripts/rqsys-restore.mjs --in ... --database-url ... --schema rq_restore_drill --force-drop
//
// 演练完成后人工核对输出报告，再删除演练 schema：
//   DROP SCHEMA rq_restore_drill CASCADE;

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = resolve(rootDir, "database/migrations");

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

async function main() {
  const input = arg("--in");
  const databaseUrl = arg("--database-url") ?? process.env.RQ_BACKUP_DATABASE_URL;
  const schema = arg("--schema");
  if (!input || !databaseUrl || !schema) {
    console.error("usage: rqsys-restore.mjs --in <dir> --database-url <url> --schema rq_restore_<name> [--force-drop]");
    process.exit(1);
  }
  if (!/^rq_restore_[a-z0-9_]+$/.test(schema)) {
    console.error("refusing: --schema must match rq_restore_[a-z0-9_]+ (production/public schemas are not allowed)");
    process.exit(1);
  }
  const dir = resolve(input);
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
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
    // 先清空所有目标表，让快照成为唯一事实源；否则种子行会与快照主键/唯一键冲突。
    const truncateTargets = manifest.tables.map((entry) => `"${entry.table}"`).join(", ");
    if (truncateTargets) await pool.query(`TRUNCATE TABLE ${truncateTargets} CASCADE`);

    // 需求表与评分版本表存在循环外键（requirements.current_score_version_id ↔
    // requirement_score_versions.requirement_id），按任何单表顺序插入都会触发 FK。
    // 演练恢复阶段关闭外键触发器（session_replication_role=replica），完成后恢复；
    // 该操作需要超级用户权限，仅用于本地隔离 schema 的恢复演练。
    const client = await pool.connect();
    const report = [];
    try {
      await client.query("SET session_replication_role = replica");
    for (const entry of manifest.tables) {
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
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((column, index) => {
        const type = types.get(column);
        return type === "jsonb" || type === "json" ? `$${index + 1}::jsonb` : `$${index + 1}`;
      }).join(", ");
      const conflict = "ON CONFLICT DO NOTHING";
      const insert = `INSERT INTO ${entry.table} (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders}) ${conflict}`;
      let restored = 0;
      for (const row of rows) {
        const values = columns.map((column) => {
          const value = row[column];
          const type = types.get(column);
          // 对象/数组 → JSON 文本；null 与已是字符串的值原样保留。
          if ((type === "jsonb" || type === "json") && value !== null && typeof value !== "string") return JSON.stringify(value);
          return value;
        });
        const result = await client.query(insert, values);
        restored += result.rowCount ?? 0;
      }
      report.push({ table: entry.table, expected: entry.rows, restored });
      console.log(`restored ${entry.table}: ${restored}/${entry.rows}`);
    }

    const counts = await client.query(`SELECT
      (SELECT count(*)::int FROM requirements) AS requirements,
      (SELECT count(*)::int FROM requirements WHERE push_state='pushed') AS pushed,
      (SELECT count(*)::int FROM requirements WHERE analysis_state='analyzed') AS analyzed,
      (SELECT count(*)::int FROM pipeline_jobs) AS jobs`);
    const mismatches = report.filter((item) => item.expected !== item.restored);
    console.log(`\nrestore drill finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log(`rows: ${report.reduce((sum, item) => sum + item.restored, 0)} restored; requirements summary ${JSON.stringify(counts.rows[0])}`);
    if (mismatches.length > 0) {
      console.error(`mismatched tables: ${mismatches.map((item) => `${item.table}(${item.restored}/${item.expected})`).join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("all table row counts match the snapshot manifest");
    }
    console.log(`cleanup: DROP SCHEMA "${schema}" CASCADE;`);
    } finally {
      await client.query("SET session_replication_role = origin").catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

await main();
