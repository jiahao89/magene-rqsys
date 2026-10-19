#!/usr/bin/env node
// 外部边界契约矩阵：一次运行检查「代码假设」与「真实外部契约」是否一致。
//
// 为什么需要它：此前的验收是"跑一轮 → 发现一个边界违约 → 修 → 再跑一轮"。
// 近 60 次提交里有 11 个 fix 都是边界契约不匹配（飞书 1254061/1254062/1254066、
// 用户搜索 503、源版本 number/text、日期 ms、user_id_type…）。单元测试里 15/18 个文件
// 用桩，结构上不可能发现这类问题，所以验收永远收敛不了。这个脚本把五个边界一次性跑完。
//
// 用法：
//   node scripts/contract-matrix.mjs                  # 只读检查（默认，安全）
//   node scripts/contract-matrix.mjs --json           # 机器可读
//   node scripts/contract-matrix.mjs --only base,db   # 只跑指定边界
//   node scripts/contract-matrix.mjs --write          # 额外做一次 POC 表写入往返（会写飞书）
//   node scripts/contract-matrix.mjs --ai             # 额外做一次 DeepSeek 极小调用（会产生费用）
//
// 安全边界：
//   - 默认只读；写入仅 --write，且只针对隔离 POC 表，写完立即删除并核对。
//   - 绝不对正式 Base（TB需求池）、Teambition 写操作、通知发送发起任何调用。
//   - 凭据缺失时该边界记为 SKIP 并说明缺哪个变量，不伪装成通过。
//
// 退出码：任何 FAIL → 1；仅 SKIP/WARN → 0。

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const onlyArg = (() => {
  const i = args.indexOf("--only");
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(",").map((s) => s.trim())) : null;
})();
const JSON_OUT = hasFlag("--json");
const ALLOW_WRITE = hasFlag("--write");
const ALLOW_AI = hasFlag("--ai");

// ---- 隔离 POC Base（正式 TB需求池 绝不可出现在这里）----
const POC_BASE_TOKEN = process.env.POC_BASE_TOKEN ?? "OddqbqBeOamFjFsR5IXcJdjknmd";
const POC_TABLE_ID = process.env.POC_TABLE_ID ?? "tblxbyvbdLGVnLaO";
const FORMAL_TABLE_ID = "tbl6Gfi0KJ2a1llK"; // 仅用于断言"我们没指向它"

// 代码侧默认字段映射（apps/api/src/server.ts 的 DEFAULT_BASE_FIELDS）
const DEFAULT_FIELDS = {
  projectId: "TB项目ID",
  requirementId: "TB需求ID",
  owner: "执行人",
  source: { title: "标题", description: "需求说明", scope: "范围说明", acceptanceCriteria: "验收标准", attachmentRefs: "附件引用", createdAt: "TB创建时间", updatedAt: "TB更新时间", sourceUrl: "TB链接", sourceStatusId: "TB状态" },
  ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" },
  pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"],
  metadata: { sourceVersion: "源版本", pushState: "推送状态", lastPushedAt: "最后推送时间" },
};

const results = [];
function record(boundary, name, status, detail) {
  results.push({ boundary, name, status, detail: detail ?? "" });
}
const pass = (b, n, d) => record(b, n, "pass", d);
const fail = (b, n, d) => record(b, n, "fail", d);
const skip = (b, n, d) => record(b, n, "skip", d);
const warn = (b, n, d) => record(b, n, "warn", d);

async function loadEnv() {
  try {
    const text = await readFile(resolve(root, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 没有 .env 就靠真实环境变量 */
  }
}

// lark-cli 需要清掉 Leapting 专用的凭据覆盖，否则身份不对
async function lark(argsList) {
  const env = { ...process.env };
  for (const key of ["LARKSUITE_CLI_APP_ID", "LARKSUITE_CLI_USER_ACCESS_TOKEN", "LARKSUITE_CLI_BRAND"]) delete env[key];
  try {
    const { stdout } = await exec("lark-cli", argsList, { env, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
    const parsed = JSON.parse(stdout);
    if (parsed.ok === false) return { ok: false, error: parsed.error?.message ?? "lark-cli failed" };
    return { ok: true, data: parsed.data ?? {} };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 200) };
  }
}

// ============ 边界 1：飞书 Base 表结构 ============
async function checkBase() {
  const B = "base";
  const r = await lark(["base", "+field-list", "--base-token", POC_BASE_TOKEN, "--table-id", POC_TABLE_ID, "--json"]);
  if (!r.ok) return skip(B, "读取 Base 字段结构", `无法读取（${r.error}）；需要已登录的 lark-cli 用户身份`);
  const fields = r.data.fields ?? [];
  if (!fields.length) return fail(B, "读取 Base 字段结构", "返回 0 个字段");
  pass(B, "读取 Base 字段结构", `${fields.length} 个字段`);

  const byName = new Map(fields.map((f) => [f.name, f]));
  const typeOf = (name) => byName.get(name)?.type;

  // 1) 代码用的每个字段都必须真实存在
  const required = [
    DEFAULT_FIELDS.projectId, DEFAULT_FIELDS.requirementId, DEFAULT_FIELDS.owner,
    ...Object.values(DEFAULT_FIELDS.source), ...Object.values(DEFAULT_FIELDS.ai),
    ...DEFAULT_FIELDS.pm, ...Object.values(DEFAULT_FIELDS.metadata),
  ];
  const missing = required.filter((name) => !byName.has(name));
  if (missing.length) fail(B, "默认字段映射全部存在", `缺少 ${missing.length} 个：${missing.join("、")}`);
  else pass(B, "默认字段映射全部存在", `${required.length} 个字段齐全`);

  // 2) 单选必须是 multiple=false —— 数组写进单选会被 1254062 拒绝
  const selectFields = ["AI模块建议", "AI优先级建议", "PM状态", "PM确认模块", "PM确认优先级", "推送状态"];
  const badMultiple = selectFields.filter((name) => byName.has(name) && byName.get(name).multiple === true);
  if (badMultiple.length) fail(B, "单选字段一律 multiple=false", `以下字段是多选，代码按字符串写会被 1254062 拒绝：${badMultiple.join("、")}`);
  else pass(B, "单选字段一律 multiple=false", "代码以字符串写入是安全的");

  // 3) 源版本类型：代码支持 text/number，其它类型必挂 1254061
  const versionType = typeOf("源版本");
  if (versionType !== "text" && versionType !== "number") fail(B, "源版本字段类型", `实际 ${versionType}，代码只支持 text/number`);
  else pass(B, "源版本字段类型", `${versionType}（代码按字段类型写 string/number）`);

  // 4) 日期必须是 datetime（写 epoch ms）；写进 text 会变成毫秒数字字符串
  const datetimeFields = ["TB创建时间", "TB更新时间", "最后推送时间", "处理时间"];
  const wrongDateType = datetimeFields.filter((name) => byName.has(name) && typeOf(name) !== "datetime");
  if (wrongDateType.length) fail(B, "日期字段为 datetime", `以下字段不是 datetime：${wrongDateType.join("、")}`);
  else pass(B, "日期字段为 datetime", "写入 epoch ms 是正确形态");

  // 5) 人员字段必须是 user，且需要 user_id_type
  const userFields = ["执行人", "处理人", "系统通知收件人"];
  const wrongUserType = userFields.filter((name) => byName.has(name) && typeOf(name) !== "user");
  if (wrongUserType.length) fail(B, "人员字段为 user 类型", `以下字段不是 user：${wrongUserType.join("、")}`);
  else pass(B, "人员字段为 user 类型", "需要 user_id_type=user_id（跨应用 open_id 会 1254066）");

  // 6) 代码会写入的选项必须在真实选项里
  const optionNames = (name) => (byName.get(name)?.options ?? []).map((o) => o.name);
  const pmStatus = optionNames("PM状态");
  if (!pmStatus.includes("待处理")) fail(B, "PM状态选项含「待处理」", `实际：${pmStatus.join("/") || "无"}`);
  else pass(B, "PM状态选项含「待处理」", "新建记录与被重置记录都能写入");
  const pushState = optionNames("推送状态");
  if (!pushState.includes("已推送")) fail(B, "推送状态选项含「已推送」", `实际：${pushState.join("/") || "无"}`);
  else pass(B, "推送状态选项含「已推送」", "");
  const priority = optionNames("AI优先级建议");
  const missingPriority = ["P0", "P1", "P2"].filter((p) => !priority.includes(p));
  if (missingPriority.length) fail(B, "AI优先级建议含 P0/P1/P2", `缺少 ${missingPriority.join("/")}`);
  else pass(B, "AI优先级建议含 P0/P1/P2", "");
  const moduleCount = optionNames("AI模块建议").length;
  if (moduleCount < 50) warn(B, "AI模块建议选项数", `${moduleCount} 个；字典模块超出部分会被记录为省略而不是写非法值`);
  else pass(B, "AI模块建议选项数", `${moduleCount} 个`);

  // 7) 我们指向的必须不是正式表
  if (POC_TABLE_ID === FORMAL_TABLE_ID) fail(B, "指向隔离 POC 表而非正式表", "当前配置指向正式 TB需求池，必须停止");
  else pass(B, "指向隔离 POC 表而非正式表", `${POC_TABLE_ID}`);

  // 8) 可选：写入往返（select 字符串 / user / datetime ms）
  if (!ALLOW_WRITE) {
    skip(B, "写入往返（平台侧字段可写性 + 读回形态）", "未加 --write；只能证明字段名/类型没错，app 线格式仍需目标环境验证");
    return;
  }
  const stamp = `rqsys-contract-${Date.now()}`;
  // 说明：这里经 CLI 写入，验证的是「平台侧该字段可写 + 读回形态」，
  // 不能替代 app 的 tenant_access_token 线格式（那需要 FEISHU_APP_ID/SECRET，本地没有）。
  const write = await lark(["base", "+record-upsert", "--base-token", POC_BASE_TOKEN, "--table-id", POC_TABLE_ID,
    "--json", JSON.stringify({
      [DEFAULT_FIELDS.requirementId]: stamp,
      [DEFAULT_FIELDS.projectId]: "contract-matrix",
      [DEFAULT_FIELDS.source.title]: "contract matrix probe",
      [DEFAULT_FIELDS.metadata.sourceVersion]: "1",
      [DEFAULT_FIELDS.metadata.pushState]: ["已推送"],
      [DEFAULT_FIELDS.pm[0]]: ["待处理"],
      [DEFAULT_FIELDS.ai.priority]: ["P1"],
    })]);
  if (!write.ok) return fail(B, "写入往返（平台侧字段可写性）", `写入失败：${write.error}`);
  const created = write.data.record?.record_id_list?.[0] ?? write.data.record?.record_id ?? write.data.record_id;
  if (!created) return fail(B, "写入往返", "写入成功但未返回 record id");
  // 读回：record-list 的 ndjson 形态才带字段名（record-get 返回的是列矩阵，无字段名）
  const ndjsonPath = resolve(tmpdir(), `rqsys-contract-probe-${process.pid}.ndjson`);
  const listed = await lark(["base", "+record-list", "--base-token", POC_BASE_TOKEN, "--table-id", POC_TABLE_ID,
    "--field-id", DEFAULT_FIELDS.requirementId, "--field-id", DEFAULT_FIELDS.metadata.pushState,
    "--field-id", DEFAULT_FIELDS.metadata.sourceVersion, "--field-id", DEFAULT_FIELDS.pm[0],
    "--format", "ndjson", "--output", ndjsonPath, "--overwrite", "--limit", "200"]);
  let row = null;
  if (listed.ok) {
    try {
      const text = await readFile(ndjsonPath, "utf8");
      row = text.trim().split("\n").map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .find((r) => r && r[DEFAULT_FIELDS.requirementId] === stamp) ?? null;
    } catch { /* 文件不可读按读回失败处理 */ }
  }
  const cleanup = await lark(["base", "+record-delete", "--base-token", POC_BASE_TOKEN, "--table-id", POC_TABLE_ID,
    "--record-id", created, "--yes", "--format", "json"]);
  const pushStateValue = row?.[DEFAULT_FIELDS.metadata.pushState];
  const versionValue = row?.[DEFAULT_FIELDS.metadata.sourceVersion];
  const pmValue = row?.[DEFAULT_FIELDS.pm[0]];
  const selectOk = pushStateValue !== undefined && pushStateValue !== null && String(JSON.stringify(pushStateValue)).includes("已推送");
  const versionOk = versionValue === "1" || versionValue === 1;
  const pmOk = pmValue !== undefined && String(JSON.stringify(pmValue)).includes("待处理");
  if (selectOk && versionOk && pmOk) {
    pass(B, "写入往返（单选 + 文本源版本 + PM 状态）", `读回正确；探针已删除=${cleanup.ok}`);
  } else {
    fail(B, "写入往返（单选 + 文本源版本 + PM 状态）",
      `读回不符 pushState=${JSON.stringify(pushStateValue)} version=${JSON.stringify(versionValue)} pm=${JSON.stringify(pmValue)} row=${row ? "有" : "未找到"}`);
  }
}

// ============ 边界 2：飞书通讯录 ============
async function checkContact() {
  const B = "contact";
  const r = await lark(["contact", "+search-user", "--query", "贾浩", "--json"]);
  if (!r.ok) return skip(B, "用户搜索返回 open_id 与 user_id", `无法调用（${r.error}）`);
  const users = r.data.users ?? r.data.items ?? [];
  if (!users.length) return fail(B, "用户搜索返回结果", "搜索「贾浩」返回 0 个用户");
  const first = users[0];
  const hasOpen = Boolean(first.open_id);
  const hasUserId = Boolean(first.user_id);
  if (!hasOpen) { fail(B, "用户搜索返回 open_id", "结果里没有 open_id"); return; }
  if (hasUserId) pass(B, "用户搜索同时返回 open_id 与 user_id", `${users.length} 个结果`);
  // 官方 SearchUser 只在授予 employee-id 权限时返回 user_id；缺失不等于应用写错，
  // 但必须走 /resolve 换出经过校验的 user_id，否则写 user 字段会 1254066。
  else warn(B, "用户搜索缺少 user_id", "当前身份无 employee-id 权限；部署路径必须经 /resolve 换 user_id，不能直接写 open_id");
}

// ============ 边界 3：数据库 schema 契约 ============
async function checkDb() {
  const B = "db";
  const url = process.env.DATABASE_URL;
  if (!url) return skip(B, "数据库 schema 契约", "缺少 DATABASE_URL");
  let pg;
  try { pg = await import("pg"); } catch { return skip(B, "数据库 schema 契约", "未安装 pg"); }
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  try {
    const tables = (await q("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).map((r) => r.table_name);
    const expected = ["requirements", "source_configs", "source_snapshots", "analysis_runs", "person_mappings", "base_push_runs", "pm_snapshots", "sync_batches", "sync_items", "pipeline_jobs", "audit_events", "module_dictionary_versions", "priority_rule_versions"];
    const missing = expected.filter((t) => !tables.includes(t));
    if (missing.length) fail(B, "必需表存在", `缺少 ${missing.join("、")}`);
    else pass(B, "必需表存在", `${expected.length} 张`);

    // B1 的契约：PM 快照外键必须是 uuid（代码必须传 requirements.id）
    const pmType = (await q("SELECT data_type FROM information_schema.columns WHERE table_name='pm_snapshots' AND column_name='requirement_id'"))[0]?.data_type;
    if (pmType === "uuid") pass(B, "pm_snapshots.requirement_id 为 uuid", "代码必须传 DB uuid（B1 已修）");
    else fail(B, "pm_snapshots.requirement_id 为 uuid", `实际 ${pmType}`);

    // 作业 dedupe_key 唯一：重放不会产生重复作业
    const uniqueSql = await q(`SELECT indexdef FROM pg_indexes WHERE tablename='pipeline_jobs'`);
    const hasUniqueDedupe = uniqueSql.some((r) => /unique/i.test(r.indexdef) && /dedupe_key/.test(r.indexdef));
    if (hasUniqueDedupe) pass(B, "pipeline_jobs.dedupe_key 唯一", "重放会复用同一作业");
    else fail(B, "pipeline_jobs.dedupe_key 唯一", "缺少唯一约束，重放会产生重复作业");

    // 批次状态允许 failed（崩溃收敛依赖它）
    const batchCheck = (await q("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='sync_batches'::regclass AND contype='c'")).map((r) => r.def).join(" ");
    if (/'failed'/.test(batchCheck)) pass(B, "sync_batches.status 允许 failed", "崩溃收敛有合法终态");
    else fail(B, "sync_batches.status 允许 failed", `约束：${batchCheck.slice(0, 120)}`);

    // 需求身份唯一键
    const reqIdx = (await q("SELECT indexdef FROM pg_indexes WHERE tablename='requirements'")).map((r) => r.indexdef).join(" ");
    if (/source_config_id/.test(reqIdx) && /teambition_requirement_id/.test(reqIdx)) pass(B, "需求身份唯一键 (source_config_id, teambition_requirement_id)", "重复同步不会产生重复需求");
    else fail(B, "需求身份唯一键", `索引：${reqIdx.slice(0, 160)}`);

    // 来源配置单例
    const sources = (await q("SELECT count(*)::int AS n FROM source_configs"))[0]?.n ?? 0;
    if (sources <= 1) pass(B, "source_configs 单例", `${sources} 行`);
    else warn(B, "source_configs 单例", `${sources} 行（代码假定单例）`);
  } finally {
    await pool.end();
  }
}

// ============ 边界 4：Teambition ============
async function checkTeambition() {
  const B = "teambition";
  const gateway = process.env.TEAMBITION_GATEWAY_URL;
  const key = process.env.GATEWAY_API_KEY;
  if (!gateway || !key) return skip(B, "项目/任务列表契约", "缺少 TEAMBITION_GATEWAY_URL 或 GATEWAY_API_KEY（目标环境有，本地无）");
  const project = process.env.TB_PROJECT_ID ?? "6960a3187384fa11aa07d7e6";
  try {
    const { stdout } = await exec("python3", [resolve(root, "skills/teambition/scripts/teambition_api.py"), "get_project", project], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (!stdout.trim()) return fail(B, "项目可读取", "返回空");
    pass(B, "项目可读取", `project=${project.slice(0, 8)}…`);
  } catch (error) {
    return fail(B, "项目可读取", String(error?.message ?? error).slice(0, 160));
  }
  warn(B, "零行/截断检测", "拉取必须校验 getProject + 返回数量/ID 集合，不能让空数组冒充成功（当前代码未做）");
}

// ============ 边界 5：AI 供应商 ============
async function checkAi() {
  const B = "ai";
  const key = process.env.AI_API_KEY;
  if (!key) return skip(B, "结构化输出契约", "缺少 AI_API_KEY");
  if (!ALLOW_AI) return skip(B, "结构化输出契约", "未加 --ai（会产生一次极小模型调用费用）");
  const started = Date.now();
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? "deepseek-chat",
        messages: [
          { role: "system", content: '只输出 JSON：{"module":"A","priority":"P2","confidence":0.5}。不要解释。' },
          { role: "user", content: "测试" },
        ],
        max_tokens: 60,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    // 401/403 说明本机 key 无效，不是产品契约问题：目标环境用另一把 key，需在那里验证。
    if (res.status === 401 || res.status === 403) return skip(B, "结构化输出契约", `本机 AI_API_KEY 被拒（HTTP ${res.status}）；目标环境 key 需单独验证`);
    if (!res.ok) return fail(B, "结构化输出契约", `HTTP ${res.status}`);
    const payload = await res.json();
    const text = payload.choices?.[0]?.message?.content ?? "";
    let parsed;
    try { parsed = JSON.parse(text); } catch { return fail(B, "结构化输出契约", `返回不是合法 JSON：${String(text).slice(0, 80)}`); }
    if (typeof parsed.module !== "string" || typeof parsed.priority !== "string") return fail(B, "结构化输出契约", `缺字段：${Object.keys(parsed).join(",")}`);
    pass(B, "结构化输出契约", `model=${payload.model} 延迟 ${Date.now() - started}ms`);
  } catch (error) {
    fail(B, "结构化输出契约", String(error?.message ?? error).slice(0, 160));
  }
}

// ============ 边界 6：妙搭平台配置 ============
async function checkPlatform() {
  const B = "platform";
  const required = ["AI_API_KEY", "BASE_APP_TOKEN", "BASE_FIELDS_JSON", "BASE_TABLE_ID", "FEISHU_APP_ID", "FEISHU_APP_SECRET", "GATEWAY_API_KEY", "TEAMBITION_GATEWAY_URL"];
  for (const envName of ["dev", "online"]) {
    const r = await lark(["apps", "+env-list", "--app-id", "app_17fqkjwyx1u", "--environment", envName, "--json"]);
    if (!r.ok) { skip(B, `[${envName}] 必需环境变量齐全`, `无法读取（${r.error}）`); continue; }
    const keys = new Set((r.data.items ?? []).map((item) => item.key));
    const missing = required.filter((k) => !keys.has(k));
    if (missing.length) fail(B, `[${envName}] 必需环境变量齐全`, `缺少 ${missing.join("、")}`);
    else pass(B, `[${envName}] 必需环境变量齐全`, `${required.length} 个`);
  }
  // 触发器状态：只报告，不判定（开/关取决于当前验收阶段）
  const t = await lark(["apps", "+automation-list", "--app-id", "app_17fqkjwyx1u", "--all", "--json"]);
  if (t.ok) {
    const trigger = (t.data.items ?? []).find((a) => a.name === "rqsysWeeklySyncRecovery");
    if (!trigger) warn(B, "定时恢复触发器存在", "未找到 rqsysWeeklySyncRecovery");
    else pass(B, "定时恢复触发器存在", `status=${trigger.status}（发布验收时须为 disabled）`);
  }
}

// ---- 运行 ----
async function main() {
  await loadEnv();
  const boundaries = [
    ["base", checkBase], ["contact", checkContact], ["db", checkDb],
    ["teambition", checkTeambition], ["ai", checkAi], ["platform", checkPlatform],
  ];
  for (const [name, fn] of boundaries) {
    if (onlyArg && !onlyArg.has(name)) continue;
    try { await fn(); } catch (error) { fail(name, "未预期异常", String(error?.message ?? error).slice(0, 200)); }
  }

  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  if (JSON_OUT) {
    console.log(JSON.stringify({ counts, results }, null, 2));
  } else {
    let current = "";
    for (const r of results) {
      if (r.boundary !== current) { current = r.boundary; console.log(`\n=== ${current} ===`); }
      const mark = { pass: "✔", fail: "✖", skip: "–", warn: "!" }[r.status];
      console.log(`  ${mark} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    console.log(`\n汇总: ${counts.pass ?? 0} 通过 / ${counts.fail ?? 0} 失败 / ${counts.warn ?? 0} 警告 / ${counts.skip ?? 0} 跳过`);
    if (counts.fail) console.log("存在契约不匹配：先修 FAIL，再谈验收。");
  }
  process.exit(counts.fail ? 1 : 0);
}

await main();
