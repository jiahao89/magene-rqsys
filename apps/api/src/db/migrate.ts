import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../database/migrations");

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsPath))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  // 两个文件共用同一个序号前缀不会改变执行顺序（ordering 与已应用记录都以完整文件名为准），
  // 但会掩盖“谁先谁后”的意图，所以只告警不阻断——已应用的迁移文件名绝不能被改写。
  const byPrefix = new Map<string, string[]>();
  for (const filename of files) {
    const prefix = filename.match(/^(\d+)_/)?.[1];
    if (!prefix) continue;
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), filename]);
  }
  const collisions = [...byPrefix.entries()].filter(([, names]) => names.length > 1);
  for (const [prefix, names] of collisions) {
    process.stdout.write(
      `Warning: migration prefix ${prefix} is shared by ${names.join(", ")}; ordering follows the full filename. Number the next migration ${String(Number(prefix) + 1).padStart(4, "0")}_ and never rename an applied file.\n`,
    );
  }

  for (const filename of files) {
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename],
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(resolve(migrationsPath, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${filename}\n`);
    } catch (error) {
      // ROLLBACK 自身失败（如连接已断）时保留原始迁移错误
      try {
        await client.query("ROLLBACK");
      } catch {
        // 忽略回滚失败，抛出原始错误
      }
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}

