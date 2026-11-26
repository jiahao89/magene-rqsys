#!/usr/bin/env node
// 一键发版（CD）：双仓同步检查 → 两仓对齐门禁 → CI 门禁 → 创建妙搭发布 → 轮询 → 线上核验。
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
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const miaodaDir = resolve(rootDir, "rq-sys-miaoda");
const APP_ID = "app_17fqkjwyx1u";
const BRANCH = "sprint/default";
const ONLINE_URL = "https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u";
const ONLINE_HEALTH_URL = `${ONLINE_URL}/api/health`;

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
// 见 deployment/EXTERNAL-BLOCKER-RUNBOOK.md：--apply-reason 含 ASCII 冒号曾触发妙搭 500000049 失败。
if (reason.includes(":")) fail("发版说明不能包含 ASCII 冒号 ':'（妙搭发布接口可能返回 500000049），请改用中文冒号或空格。");

step("前置检查（根仓）");
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: rootDir });
const dirty = run("git", ["status", "--porcelain"], { cwd: rootDir }).split("\n").filter((line) => line && !line.startsWith("?? .scratch/"));
if (dirty.length) fail(`根仓工作区有未提交改动：\n${dirty.join("\n")}`);
const ahead = Number(run("git", ["rev-list", "--count", `origin/${branch}..HEAD`], { cwd: rootDir }));
if (ahead !== 0) fail(`根仓本地领先远端 ${ahead} 个提交，先推送再发版。`);
process.stdout.write(`根仓分支 ${branch}，工作区干净，已与远端同步。\n`);

step("前置检查（妙搭运行时仓 rq-sys-miaoda/）");
if (!existsSync(resolve(miaodaDir, ".git"))) {
  fail("缺少 rq-sys-miaoda/ 独立 git 检出，无法核验妙搭发版分支与两仓对齐。");
}
const miaodaBranch = run("git", ["-C", miaodaDir, "rev-parse", "--abbrev-ref", "HEAD"]);
if (miaodaBranch !== BRANCH) {
  fail(`rq-sys-miaoda 当前在分支 ${miaodaBranch}，必须切回 ${BRANCH} 后再发版。`);
}
const miaodaDirty = run("git", ["-C", miaodaDir, "status", "--porcelain"]).split("\n").filter(Boolean);
if (miaodaDirty.length) {
  fail(`rq-sys-miaoda 工作区有未提交改动：\n${miaodaDirty.join("\n")}`);
}
const miaodaAhead = Number(run("git", ["-C", miaodaDir, "rev-list", "--count", `origin/${BRANCH}..HEAD`]));
if (miaodaAhead !== 0) {
  fail(`rq-sys-miaoda 本地领先 origin/${BRANCH} ${miaodaAhead} 个提交，先推送再发版。`);
}
const miaodaHead = run("git", ["-C", miaodaDir, "rev-parse", "HEAD"]);
process.stdout.write(`rq-sys-miaoda 分支 ${miaodaBranch}（${miaodaHead.slice(0, 7)}），工作区干净，已与远端同步。\n`);

if (!skipGates) {
  step("门禁：两仓对齐（npm run check:alignment）");
  try {
    run("npm", ["run", "check:alignment"], { cwd: rootDir, stdio: "inherit" });
  } catch {
    fail("两仓对齐检查未通过，禁止发版。");
  }

  // 门禁以 CI 为准：本地没有 PostgreSQL，API 用例会因 ENOENT 退出 1，
  // 那是环境缺失、不是失败；GitHub 上的 verify 带 PG 服务，才是这批契约用例的唯一真凭据。
  step("门禁：CI 结论");
  const sha = run("git", ["rev-parse", "HEAD"], { cwd: rootDir });
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
  process.stdout.write("\n[release] 警告：已跳过两仓对齐与 CI 门禁（--skip-gates），发版说明里必须写清紧急原因。\n");
}

if (dryRun) {
  process.stdout.write(`\n[release] dry-run：到此为止。发版说明为「${reason}」，目标妙搭提交 ${miaodaHead.slice(0, 7)}。\n`);
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
if (final.commit_id && final.commit_id !== miaodaHead) {
  process.stdout.write(`[release] 注意：线上构建提交 ${final.commit_id} 与本地 rq-sys-miaoda HEAD ${miaodaHead} 不一致，请核对远端分支。\n`);
}
process.stdout.write(`commit=${final.commit_id}\n`);

step("线上核验");
const shellCode = run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", ONLINE_URL]);
process.stdout.write(`应用入口 (${ONLINE_URL}): HTTP ${shellCode}\n`);
if (!["200", "302"].includes(shellCode)) fail(`线上入口返回 ${shellCode}`);

const healthCode = run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", ONLINE_HEALTH_URL]);
process.stdout.write(`健康检查 (${ONLINE_HEALTH_URL}): HTTP ${healthCode}（200=公开可达，302=需飞书登录跳转）\n`);
if (!["200", "302"].includes(healthCode)) fail(`健康检查端点返回异常状态 ${healthCode}`);

process.stdout.write(`\n[release] 完成。release_id=${releaseId} commit=${final.commit_id}\n`);
process.stdout.write("[release] 提醒：匿名 HTTP 探测仅证明入口可达，请按 AGENTS.md 在已登录会话中复核 @NeedLogin()、/api/health/ready 与业务只读页面。\n");
