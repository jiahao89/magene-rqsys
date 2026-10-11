// 一次性验收辅助脚本：为「无负责人」的需求入队分析任务，走仓储的 enqueue（不手写 SQL）。
// 用途：完整流程验收时，这些需求是唯一能走到 Base 推送的样本（有负责人的需求按不变量等待人工映射）。
import { Pool } from "pg";
import { PostgresRepositories } from "../src/adapters/postgres/repositories.js";

const connectionString = process.env.DATABASE_URL
  ?? `postgresql://postgres@/rq_sys?host=${process.env.HOME}/.local/share/rq-sys/postgres`;
const pool = new Pool({ connectionString, max: 2 });
const repositories = new PostgresRepositories(pool as never);

const rows = (await pool.query(
  "select id, source_version, substantive_hash from requirements where executor_user_id is null and analysis_state <> 'analyzed'",
)).rows as { id: string; source_version: number; substantive_hash: string }[];

for (const row of rows) {
  const job = await repositories.jobs.enqueue({
    jobType: "analysis",
    dedupeKey: `analysis:${row.id}:v${row.source_version}`,
    payload: {
      requirementId: row.id,
      sourceVersion: row.source_version,
      substantiveHash: row.substantive_hash,
      actorId: null,
    },
    availableAt: new Date().toISOString(),
  });
  process.stdout.write(`queued analysis ${job.id} for ${row.id}\n`);
}
process.stdout.write(`no-owner requirements queued: ${rows.length}\n`);
await pool.end();
