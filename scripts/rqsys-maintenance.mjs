#!/usr/bin/env node
// RQ-Sys 运维兜底：当定时触发器投递不稳定时，用这个脚本手工推进系统自愈。
//
// 背景：线上触发器配置为每 30 分钟投递一次，实测 3 小时内只投递 1 次。
// 所有依赖定时器的自愈（失败作业重排、负责人映射重新评估、卡死分析恢复）
// 因此可能延迟数小时。这个脚本用同一批 SQL 做同样的事，不依赖触发器。
//
// 用法：
//   node scripts/rqsys-maintenance.mjs status          # 只看状态，不写任何东西
//   node scripts/rqsys-maintenance.mjs requeue-failed  # 把失败的 base_push 作业重置为待执行
//   node scripts/rqsys-maintenance.mjs requeue-pending # 给"已映射但未推送"的需求补入队
//   node scripts/rqsys-maintenance.mjs all             # 上面两步都做
//
// 安全边界：只操作应用数据库；不碰 Base、不发消息、不调 TB/模型。
// 每次写操作前都会先打印将要影响的行数。

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const APP_ID = process.env.RQSYS_APP_ID ?? "app_17fqkjwyx1u";
const ENV = process.env.RQSYS_ENV ?? "online";
const DRY = process.argv.includes("--dry-run");

async function sql(statement) {
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

async function status() {
  console.log("== 当前状态 ==");
  report("概览", await sql(`select
    (select count(*) from requirements) reqs,
    (select count(*) from requirements where analysis_state='analyzed') analyzed,
    (select count(*) from requirements where push_state='pushed') pushed,
    (select count(*) from requirements where push_state='pending') pending,
    (select count(*) from requirements where owner_state='pending_mapping') unmapped,
    (select count(*) from pipeline_jobs where status='queued') queued,
    (select count(*) from pipeline_jobs where status='failed') failed`));
}

const FAILED_PUSH_SCOPE = `
  job_type='base_push' and status='failed'
  and dedupe_key in (
    select 'base-push:'||r.id||':sv'||r.source_version||':av'||
      coalesce((select max(analysis_version) from analysis_runs a where a.requirement_id=r.id),0)
    from requirements r
    join person_mappings p on p.teambition_user_id=r.executor_user_id and p.active
    where r.push_state='pending' and r.analysis_state='analyzed' and r.pull_state='synced')`;

async function requeueFailed() {
  const [{ n } = { n: "?" }] = await sql(`select count(*) n from pipeline_jobs where ${FAILED_PUSH_SCOPE}`);
  console.log(`== 重置失败的推送作业：影响 ${n} 行 ==`);
  if (DRY) return console.log("  （dry-run，未写入）");
  report("已重置", await sql(`update pipeline_jobs
    set status='queued', attempt_count=0, available_at=now(), locked_until=null,
        last_error_code=null, last_error_summary=null, updated_at=now()
    where ${FAILED_PUSH_SCOPE}`));
}

const REQUEUE_PENDING_SQL = `
  insert into pipeline_jobs (id, job_type, dedupe_key, payload, status, attempt_count, max_attempts, available_at, created_at, updated_at)
  select gen_random_uuid(), 'base_push',
    'base-push:'||r.id||':sv'||r.source_version||':av'||coalesce(a.v,0),
    jsonb_build_object('requirementId', r.id::text, 'actorId', null, 'sourceVersion', r.source_version, 'analysisVersion', coalesce(a.v,0)),
    'queued', 0, 5, now(), now(), now()
  from requirements r
  join person_mappings p on p.teambition_user_id = r.executor_user_id and p.active
  left join lateral (select max(analysis_version) v from analysis_runs where requirement_id = r.id) a on true
  where r.push_state='pending' and r.analysis_state='analyzed' and r.pull_state='synced'
    and not exists (select 1 from pipeline_jobs j where j.dedupe_key = 'base-push:'||r.id||':sv'||r.source_version||':av'||coalesce(a.v,0))
  on conflict (dedupe_key) do update
    set status='queued', attempt_count=0, available_at=now(), locked_until=null,
        last_error_code=null, last_error_summary=null, updated_at=now()
    where pipeline_jobs.status in ('failed','cancelled')`;

async function requeuePending() {
  const [{ n } = { n: "?" }] = await sql(`select count(*) n from requirements r
    join person_mappings p on p.teambition_user_id=r.executor_user_id and p.active
    where r.push_state='pending' and r.analysis_state='analyzed' and r.pull_state='synced'`);
  console.log(`== 为可推送但未推送的需求补入队：候选 ${n} 条 ==`);
  if (DRY) return console.log("  （dry-run，未写入）");
  report("已入队/复用", await sql(REQUEUE_PENDING_SQL));
}

const command = process.argv[2] ?? "status";
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
