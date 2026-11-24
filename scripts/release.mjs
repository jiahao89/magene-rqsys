#!/usr/bin/env node
// 一键发版（CD）：门禁 → 推送检查 → 创建妙搭发布 → 轮询 → 线上核验。
//
// 用法：
//   npm run release -- "发版说明"
//   npm run release -- "发版说明" --dry-run     # 只跑到发版前，不真正发布
//   npm run release -- "发版说明" --skip-gates  # 紧急回滚时跳过门禁（需在说明里写原因）
//
// 为什么是脚本而不是 GitHub Actions 自托管 runner：
//   仓库当前是 public，在公开仓上挂自托管 runner 会让任意 PR 有机会在本机执行代码。
//   等仓库转私有后再接 runner 更安全；在那之前用这条命令，凭据不出本机。

import { execFileSync } from "node:child_process";
import process from "node:process";

const APP_ID = "app_17fqkjwyx1u";
const BRANCH = "sprint/default";
const ONLINE_URL = "https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const reason = args.filter((a) => !a.startsWith("--")).join(" ").trim();
const dryRun = flags.has("--dry-run");
const skipGates = flags.has("--skip-gates");

function step(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function run(cmd, cmdArgs, opts = {}) {
  const result = execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  // stdio: "inherit" 时 execFileSync 返回 null，不能直接 trim。
  return typeof result === "string" ? result.trim() : "";
}

function runJson(cmd, cmdArgs) {
  const out = run(cmd, cmdArgs);
  return JSON.parse(out);
}

function fail(message) {
  process.stderr.write(`\n[release] 失败：${message}\n`);
  process.exit(1);
}

if (!reason) fail('缺少发版说明。用法：npm run release -- "本次发版说明"');

step("前置检查");
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = run("git", ["status", "--porcelain"]).split("\n").filter((line) => line && !line.startsWith("?? .scratch/"));
if (dirty.length) fail(`工作区有未提交改动：\n${dirty.join("\n")}`);
const ahead = Number(run("git", ["rev-list", "--count", `origin/${branch}..HEAD`]));
if (ahead !== 0) fail(`本地领先远端 ${ahead} 个提交，先推送再发版。`);
process.stdout.write(`分支 ${branch}，工作区干净，已与远端同步。\n`);

if (!skipGates) {
  // 门禁以 CI 为准：本地没有 PostgreSQL，API 用例会因 ENOENT 退出 1，
  // 那是环境缺失、不是失败；GitHub 上的 verify 带 PG 服务，才是这 64 条契约用例的唯一真凭据。
  step("门禁：CI 结论");
  const sha = run("git", ["rev-parse", "HEAD"]);
  let runs = [];
  try {
    runs = JSON.parse(run("gh", ["api", `repos/jiahao89/magene-rqsys/actions/runs?head_sha=${sha}&per_page=10`]))?.workflow_runs ?? [];
  } catch (error) {
    fail(`读取 CI 状态失败：${error?.message ?? error}`);
  }
  const verify = runs.find((item) => item.name === "verify");
  if (!verify) fail(`提交 ${sha.slice(0, 7)} 还没有 CI 运行记录：等 verify 跑完再发版（或临时加 --skip-gates）。`);
  if (verify.status !== "completed") fail(`CI 仍在 ${verify.status}，等它跑完再发版。`);
  if (verify.conclusion !== "success") fail(`CI 结论是 ${verify.conclusion}（run ${verify.id}），先修再发。`);
  process.stdout.write(`CI verify #${verify.id} success（${sha.slice(0, 7)}）。\n`);
} else {
  process.stdout.write("\n[release] 已跳过门禁（--skip-gates），发版说明里必须写清原因。\n");
}

if (dryRun) {
  process.stdout.write(`\n[release] dry-run：到此为止。发版说明为「${reason}」。\n`);
  process.exit(0);
}

step("创建妙搭发布");
const created = runJson("lark-cli", ["apps", "+release-create", "--app-id", APP_ID, "--branch", BRANCH, "--apply-reason", reason]);
const releaseId = created?.data?.release_id;
if (!releaseId) fail(`发布创建失败：${JSON.stringify(created)}`);
process.stdout.write(`release_id=${releaseId}\n`);

step("轮询发布状态");
let final = null;
for (let i = 1; i <= 40; i += 1) {
  const current = runJson("lark-cli", ["apps", "+release-get", "--app-id", APP_ID, "--release-id", String(releaseId)]);
  const status = current?.data?.status ?? "unknown";
  process.stdout.write(`[${i}] ${status}\n`);
  if (status === "finished") { final = current.data; break; }
  if (status === "failed" || status === "cancelled") fail(`发布状态 ${status}：${JSON.stringify(current?.data?.error_logs ?? [])}`);
  execFileSync("sleep", ["15"]);
}
if (!final) fail("10 分钟内发布未完成，请到妙搭控制台确认。");
if ((final.error_logs ?? []).length) fail(`发布完成但存在错误日志：${JSON.stringify(final.error_logs)}`);
process.stdout.write(`commit=${final.commit_id}\n`);

step("线上核验");
const health = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", ONLINE_URL], { encoding: "utf8" }).trim();
process.stdout.write(`应用入口 HTTP ${health}\n`);
if (!["200", "302"].includes(health)) fail(`线上入口返回 ${health}`);

process.stdout.write(`\n[release] 完成。release_id=${releaseId} commit=${final.commit_id}\n`);
