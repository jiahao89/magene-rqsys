#!/usr/bin/env node
// RQ-Sys 运维兜底：当定时触发器投递不稳定时，用这个脚本手工推进系统自愈。
//
// 背景：线上触发器配置为每 30 分钟投递一次，实测可能存在投递延迟。
// 所有依赖定时器的自愈（失败作业重排、负责人映射重新评估、卡死分析恢复）
// 因此可能延迟。这个脚本用应用侧生成的 UUID 与安全 SQL 做同样的事，不依赖触发器。
//
// 用法：
//   node scripts/rqsys-maintenance.mjs status --env=dev|online
//   node scripts/rqsys-maintenance.mjs requeue-failed --env=dev|online [--yes]
//   node scripts/rqsys-maintenance.mjs requeue-pending --env=dev|online [--yes]
//   node scripts/rqsys-maintenance.mjs all --env=dev|online [--yes]
//
// 安全边界：
//   - 必须显式指定 --env=dev 或 --env=online（不再默认 online）。
//   - 写操作默认 dry-run；只有显式传入 --yes 才会执行 UPDATE / INSERT。
//   - 严格排除已逻辑删除（deleted_at IS NOT NULL）与已压制（processing_state <> 'active'）需求。
//   - 与 Q1（PRD-21）一致：允许未映射/无负责人需求以空负责人首次推送。
//   - UUID 由应用侧 crypto.randomUUID() 生成，不依赖数据库扩展函数。

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const APP_ID = process.env.RQSYS_APP_ID ?? "app_17fqkjwyx1u";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEnv(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--env=")) return token.slice("--env=".length);
    if (token === "--env" && argv[i + 1]) return argv[i + 1];
  }
  return null;
}

const argv = process.argv.slice(2);
const command = argv.find((arg) => !arg.startsWith("--")) ?? "status";
const ENV = parseEnv(argv);
const CONFIRMED = argv.includes("--yes") && !argv.includes("--dry-run");

if (ENV !== "dev" && ENV !== "online") {
  console.error("错误：必须显式指定 --env=dev 或 --env=online（安全门禁：不允许默认指向 online）。");
  console.error("用法：node scripts/rqsys-maintenance.mjs <status|requeue-failed|requeue-pending|all> --env=<dev|online> [--yes]");
  process.exit(2);
}

async function sql(statement, { write = false } = {}) {
  if (write && !CONFIRMED) {
    throw new Error("内部安全守卫拦截：未显式传入 --yes，拒绝执行写 SQL。");
  }
  const env = { ...process.env };
  for (const key of ["LARKSUITE_CLI_APP_ID", "LARKSUITE_CLI_USER_ACCESS_TOKEN", "LARKSUITE_CLI_BRAND"]) delete env[key];
  const args = ["apps", "+db-execute", "--app-id", APP_ID, "--environment", ENV, "--yes", "--sql", statement];
  const { stdout } = await exec("lark-cli", args, { env, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  const parsed = JSON.parse(stdout);
  if (parsed.ok === false) throw new Error(parsed.error?.message ?? "db-execute failed");
  const data = parsed.data;
  return Array.isArray(data) ? data : (data?.rows ?? []);
}

const report = (label, rows) => {
  console.log(`  ${label}: ${JSON.stringify(rows)}`);
};

// 活跃可推送需求条件：排除已删除与已压制；与 Q1（PRD-21）和 owner-recheck 一致，
// AI 分析完成或可重试失败均不阻断推送，未映射/无负责人也允许空负责人首推。
const ELIGIBLE_REQUIREMENT_WHERE = `
  r.deleted_at IS NULL
  AND r.processing_state = 'active'
  AND r.push_state = 'pending'
  AND r.pull_state IN ('synced', 'collected')
  AND r.analysis_state IN ('analyzed', 'failed_retryable')`;

async function status() {
  console.log(`== 当前状态（env=${ENV}）==`);
  report("概览", await sql(`select
    (select count(*) from requirements where deleted_at is null) reqs_active_total,
    (select count(*) from requirements where deleted_at is null and processing_state='active') active,
    (select count(*) from requirements where deleted_at is null and processing_state<>'active') suppressed,
    (select count(*) from requirements where deleted_at is not null) deleted,
    (select count(*) from requirements where deleted_at is null and processing_state='active' and analysis_state='analyzed') analyzed,
    (select count(*) from requirements where deleted_at is null and processing_state='active' and push_state='pushed') pushed,
    (select count(*) from requirements where deleted_at is null and processing_state='active' and push_state='pending') pending,
    (select count(*) from requirements where deleted_at is null and processing_state='active' and owner_state='pending_mapping') unmapped,
    (select count(*) from pipeline_jobs where status='queued') queued,
    (select count(*) from pipeline_jobs where status='failed') failed`));
}

const FAILED_PUSH_SCOPE = `
  job_type='base_push' AND status='failed'
  AND dedupe_key IN (
    SELECT 'base-push:'||r.id||':sv'||r.source_version||':av'||
      coalesce((SELECT max(analysis_version) FROM analysis_runs a WHERE a.requirement_id=r.id), 0)
    FROM requirements r
    WHERE ${ELIGIBLE_REQUIREMENT_WHERE}
  )`;

async function requeueFailed() {
  const [{ n } = { n: "?" }] = await sql(`select count(*) n from pipeline_jobs where ${FAILED_PUSH_SCOPE}`);
  console.log(`== 重置失败的推送作业（env=${ENV}）：影响 ${n} 行 ==`);
  if (!CONFIRMED) return console.log("  （默认 dry-run，未写入；确认后请显式传 --yes）");
  report("已重置", await sql(`update pipeline_jobs
    set status='queued', attempt_count=0, available_at=now(), locked_until=null,
        last_error_code=null, last_error_summary=null, updated_at=now()
    where ${FAILED_PUSH_SCOPE}`, { write: true }));
}

const REQUEUE_PENDING_CANDIDATES_SQL = `
  SELECT r.id::text AS id,
         r.source_version::int AS source_version,
         coalesce(a.v, 0)::int AS analysis_version
  FROM requirements r
  LEFT JOIN LATERAL (SELECT max(analysis_version) v FROM analysis_runs WHERE requirement_id = r.id) a ON true
  WHERE ${ELIGIBLE_REQUIREMENT_WHERE}
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_jobs j
      WHERE j.dedupe_key = 'base-push:'||r.id||':sv'||r.source_version||':av'||coalesce(a.v, 0)
        AND j.status NOT IN ('failed', 'cancelled')
    )
  ORDER BY r.id`;

function buildEnqueueSql(candidates) {
  const valuesSql = candidates.map((row) => {
    const reqId = String(row.id);
    const sourceVersion = Number(row.source_version);
    const analysisVersion = Number(row.analysis_version);
    if (!UUID_RE.test(reqId)) throw new Error(`非法 requirement id：${reqId}`);
    if (!Number.isInteger(sourceVersion) || sourceVersion < 0) throw new Error(`非法 source_version：${sourceVersion}`);
    if (!Number.isInteger(analysisVersion) || analysisVersion < 0) throw new Error(`非法 analysis_version：${analysisVersion}`);
    const jobId = randomUUID();
    const dedupeKey = `base-push:${reqId}:sv${sourceVersion}:av${analysisVersion}`;
    const payload = JSON.stringify({
      requirementId: reqId,
      actorId: null,
      sourceVersion,
      analysisVersion,
    });
    return `('${jobId}'::uuid, 'base_push', '${dedupeKey}', '${payload}'::jsonb, 'queued', 0, 5, now(), now(), now())`;
  }).join(",\n    ");

  return `
  INSERT INTO pipeline_jobs (id, job_type, dedupe_key, payload, status, attempt_count, max_attempts, available_at, created_at, updated_at)
  VALUES
    ${valuesSql}
  ON CONFLICT (dedupe_key) DO UPDATE
    SET status='queued', attempt_count=0, available_at=now(), locked_until=null,
        last_error_code=null, last_error_summary=null, updated_at=now()
    WHERE pipeline_jobs.status IN ('failed', 'cancelled')`;
}

async function requeuePending() {
  const candidates = await sql(REQUEUE_PENDING_CANDIDATES_SQL);
  console.log(`== 为可推送但未推送的活跃需求补入队（env=${ENV}）：候选 ${candidates.length} 条 ==`);
  if (!CONFIRMED) return console.log("  （默认 dry-run，未写入；确认后请显式传 --yes）");
  if (candidates.length === 0) return console.log("  无需入队（0 条候选）。");
  const BATCH_SIZE = 50;
  let processed = 0;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    await sql(buildEnqueueSql(batch), { write: true });
    processed += batch.length;
  }
  console.log(`  已入队/复用：${processed} 条`);
}

try {
  if (command === "status") await status();
  else if (command === "requeue-failed") { await status(); await requeueFailed(); }
  else if (command === "requeue-pending") { await status(); await requeuePending(); }
  else if (command === "all") { await status(); await requeueFailed(); await requeuePending(); }
  else {
    console.error(`未知命令：${command}\n可用：status | requeue-failed | requeue-pending | all`);
    process.exit(2);
  }
  console.log("\n完成。作业会在下一次触发器投递时被消费；若触发器长时间不投递，重复执行本脚本即可重新排队。");
} catch (error) {
  console.error("失败：", error?.message ?? error);
  process.exit(1);
}
