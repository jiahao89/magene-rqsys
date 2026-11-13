#!/usr/bin/env node
// RQ-Sys 应用级数据快照（I3-6 / PR-12）。
//
// 目标环境不支持数据库快照或平台备份时，用这个脚本导出业务表为 JSONL + 清单，
// 供离线保存与恢复演练。只读：不写应用库、不碰 Base、不发消息。
//
// 用法：
//   node scripts/rqsys-backup.mjs export --out backups/rq-sys-20261112
//       # 默认通过 lark-cli 读取目标环境（RQSYS_APP_ID / RQSYS_ENV）
//   node scripts/rqsys-backup.mjs export --database-url postgres://... --out /tmp/rq-backup
//       # 本地/dev 直连
//   node scripts/rqsys-backup.mjs verify --in backups/rq-sys-20261112
//
// 说明：
// - 审计表默认不导出（量大）；确需完整留痕时加 --include-audit。
// - 快照含业务数据（需求标题/描述等），保存位置按数据治理要求控制，不要提交仓库。
// - manifest.json 记录生成时间、来源（不含凭据）、每表行数与 SHA-256、已应用迁移。

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const exec = promisify(execFile);
const APP_ID = process.env.RQSYS_APP_ID ?? "app_17fqkjwyx1u";
const ENVIRONMENT = process.env.RQSYS_ENV ?? "online";
const PAGE_SIZE = 200;

/** 恢复顺序即外键依赖顺序；schema_migrations 只记录、不导出数据。 */
const TABLES = [
  "source_configs",
  "priority_rule_versions",
  "module_dictionary_versions",
  // requirements.latest_batch_id 指向 sync_batches，必须先恢复批次表。
  "sync_batches",
  "requirements",
  "source_snapshots",
  "requirement_resolutions",
  "analysis_runs",
  "requirement_score_versions",
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
];

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function shellSafe(statement) {
  return statement.replace(/\s+/g, " ").trim();
}

async function createReader() {
  const databaseUrl = arg("--database-url") ?? process.env.RQ_BACKUP_DATABASE_URL;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    return {
      source: "database-url",
      async rows(sql) {
        const result = await pool.query(sql);
        return result.rows;
      },
      async close() { await pool.end(); },
    };
  }
  return {
    source: `lark-cli:${APP_ID}/${ENVIRONMENT}`,
    async rows(sql) {
      const env = { ...process.env };
      for (const key of ["LARKSUITE_CLI_APP_ID", "LARKSUITE_CLI_USER_ACCESS_TOKEN", "LARKSUITE_CLI_BRAND"]) delete env[key];
      const { stdout } = await exec("lark-cli", ["apps", "+db-execute", "--app-id", APP_ID, "--environment", ENVIRONMENT, "--yes", "--sql", sql], { env, maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
      const parsed = JSON.parse(stdout);
      if (parsed.ok === false) throw new Error(parsed.error?.message ?? "db-execute failed");
      const data = parsed.data;
      return Array.isArray(data) ? data : (data?.rows ?? []);
    },
    async close() {},
  };
}

async function exportTable(reader, dir, table) {
  const hash = createHash("sha256");
  const chunks = [];
  let count = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await reader.rows(shellSafe(`SELECT * FROM ${table} ORDER BY 1 LIMIT ${PAGE_SIZE} OFFSET ${offset}`));
    for (const row of rows) {
      const line = `${JSON.stringify(row)}\n`;
      chunks.push(line);
      hash.update(line);
      count += 1;
    }
    if (rows.length < PAGE_SIZE) break;
  }
  const content = chunks.join("");
  await writeFile(resolve(dir, `${table}.jsonl`), content, "utf8");
  return { table, rows: count, sha256: hash.digest("hex") };
}

async function exportSnapshot() {
  const out = arg("--out");
  if (!out) throw new Error("--out is required");
  const dir = resolve(out);
  await mkdir(dir, { recursive: true });
  const reader = await createReader();
  const tables = [...TABLES];
  if (process.argv.includes("--include-audit")) tables.push("audit_events");
  const manifest = {
    format: "rq-sys-jsonl-v1",
    generatedAt: new Date().toISOString(),
    source: reader.source,
    tables: [],
    migrations: null,
  };
  try {
    // 目标平台（妙搭）由平台回放迁移，不创建应用自有的 schema_migrations；读取失败不等于备份失败。
    try {
      const migrationRows = await reader.rows("SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1");
      manifest.migrations = migrationRows[0]?.filename ?? null;
    } catch {
      manifest.migrations = null;
      manifest.migrationState = "unavailable";
    }
    for (const table of tables) {
      process.stdout.write(`exporting ${table}... `);
      const entry = await exportTable(reader, dir, table);
      manifest.tables.push(entry);
      process.stdout.write(`${entry.rows} rows\n`);
    }
    await writeFile(resolve(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`\nSnapshot written to ${basename(dir)}/ (${manifest.tables.reduce((sum, item) => sum + item.rows, 0)} rows, migrations ${manifest.migrations ?? "unknown"})\n`);
    process.stdout.write("WARNING: snapshot contains business data; store it under the data-governance policy and never commit it.\n");
  } finally {
    await reader.close();
  }
}

async function verifySnapshot() {
  const input = arg("--in");
  if (!input) throw new Error("--in is required");
  const dir = resolve(input);
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
  let failures = 0;
  for (const entry of manifest.tables) {
    const content = await readFile(resolve(dir, `${entry.table}.jsonl`), "utf8").catch(() => null);
    if (content === null) { console.error(`✗ ${entry.table}: file missing`); failures += 1; continue; }
    const rows = content === "" ? 0 : content.split("\n").filter(Boolean).length;
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (rows !== entry.rows) { console.error(`✗ ${entry.table}: rows ${rows} != ${entry.rows}`); failures += 1; }
    else if (sha256 !== entry.sha256) { console.error(`✗ ${entry.table}: sha256 mismatch`); failures += 1; }
    else process.stdout.write(`✓ ${entry.table}: ${rows} rows\n`);
  }
  if (failures > 0) {
    console.error(`\n${failures} table(s) failed verification.`);
    process.exit(1);
  }
  console.log(`\nSnapshot OK: ${manifest.tables.length} tables, migrations ${manifest.migrations ?? "unknown"}, generated ${manifest.generatedAt}.`);
}

const command = process.argv[2];
if (command === "export") await exportSnapshot();
else if (command === "verify") await verifySnapshot();
else {
  console.error("usage: rqsys-backup.mjs export --out <dir> [--database-url <url>] [--include-audit] | verify --in <dir>");
  process.exit(1);
}
