#!/usr/bin/env node
// 5c-2：Base「来源方式」历史回填 —— 只读 dry-run。
//
// 做什么：从应用 API 逐页读需求（sourceType + source.intakeOrigin），按「需求平台ID」到 PM「数据表」
// 定位对应行，比较该行当前「来源方式」与应有值，输出对照表与汇总。
//
// 安全边界：
// - 本脚本只发 GET 请求（API + Base），**不写 Base、不写数据库、不发通知**。
// - 只读「需求平台ID」「来源方式」两个字段；绝不读/写「系统通知事件ID」等通知字段。
// - 不打印 cookie / token / secret。
//
// 用法（目标环境，需要登录态 cookie）：
//   RQSYS_API_BASE="https://miaoda.feishu.cn/app/app_17fqkjwyx1u" \
//   RQSYS_COOKIE="<登录 cookie>" RQSYS_CSRF_TOKEN="<suda-csrf-token 解码值>" \
//   FEISHU_APP_ID=... FEISHU_APP_SECRET=... BASE_APP_TOKEN=... BASE_TABLE_ID=... \
//   node scripts/base-source-backfill.mjs --csv /tmp/source-backfill.csv
//
// 本地无登录态时，可用 --requirements-file 指定保存好的 API 响应（{"items":[...]} 或数组），
// 仍会真实读取 Base 对照（只读）。
//
// 参数：
//   --requirements-file <path>  不调 API，直接读保存的需求 JSON
//   --csv <path>                额外写一份 CSV
//   --limit <n>                 只处理前 n 条（便于抽查）
//   --delay-ms <n>              Base 请求间隔，默认 120ms
//   --allow-missing-field       目标表缺「来源方式」字段时仍继续（默认直接失败）

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_METHOD_FIELD_DEFAULT = "来源方式";
const PLATFORM_FIELD_DEFAULT = "需求平台ID";
const SOURCE_METHOD_VALUES = ["Teambition", "Web 手工", "多维表格", "聊天粘贴"];

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);

/** .env 值可能是 "..." 包裹（内部含 \" 转义，如 BASE_FIELDS_JSON）：按 JSON 字符串解包。 */
function envValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

async function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(resolve(root, file), "utf8");
      for (const line of text.split("\n")) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && process.env[match[1]] === undefined) process.env[match[1]] = envValue(match[2]);
      }
    } catch { /* 没有该文件就靠真实环境变量 */ }
  }
}

/** 与 base/client.ts 的 baseSourceMethodValue 同口径（脚本不依赖构建产物，保持 4 行同步）。 */
function expectedSourceMethod(sourceType, intakeOrigin) {
  if (sourceType === "teambition") return "Teambition";
  if (sourceType === "base_form") return "多维表格";
  if (sourceType === "web_manual") return intakeOrigin === "chat_paste" ? "聊天粘贴" : "Web 手工";
  return null;
}

function die(message) {
  console.error(`[source-backfill] ${message}`);
  process.exit(1);
}

async function fetchAllRequirements(baseUrl, headers, limit) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 500; page += 1) {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/requirements`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers });
    if (!response.ok) die(`GET ${url.pathname} -> HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.items)) die("需求列表响应缺少 items");
    items.push(...body.items);
    if (limit !== null && items.length >= limit) return items.slice(0, limit);
    if (!body.nextCursor) return items;
    cursor = body.nextCursor;
  }
  die("需求分页超过 500 页，疑似游标异常");
}

function readRequirementsFile(path) {
  return readFile(resolve(process.cwd(), path), "utf8").then((text) => {
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) die("--requirements-file 需要数组或 {items:[...]}");
    return items;
  });
}

const tokenCache = { value: null, expiresAt: 0 };
async function tenantToken(baseUrl, appId, appSecret) {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const response = await fetch(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const payload = await response.json();
  if (payload.code !== 0) die(`tenant token failed: code=${payload.code}`);
  tokenCache.value = payload.tenant_access_token;
  tokenCache.expiresAt = Date.now() + (Number(payload.expire) || 3600) * 1000 - 60_000;
  return tokenCache.value;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  await loadDotEnv();
  const apiBase = process.env.RQSYS_API_BASE ?? "http://127.0.0.1:8787";
  const cookie = process.env.RQSYS_COOKIE ?? process.env.INTAKE_COOKIE ?? "";
  const authorization = process.env.RQSYS_AUTHORIZATION ?? process.env.INTAKE_AUTHORIZATION ?? "";
  const requirementsFile = arg("--requirements-file");
  const limit = arg("--limit") === null ? null : Number(arg("--limit"));
  const delayMs = Number(arg("--delay-ms", "120"));
  const csvPath = arg("--csv");
  if (!Number.isFinite(delayMs) || delayMs < 0) die("--delay-ms 必须是 >=0 的数字");

  let requirements;
  if (requirementsFile) {
    requirements = await readRequirementsFile(requirementsFile);
  } else {
    if (!cookie && !authorization) die("需要 RQSYS_COOKIE 或 INTAKE_COOKIE（登录态），或改用 --requirements-file");
    // 妙搭平台网关要求 CSRF 头；值取自家 suda-csrf-token（需 URL 解码），见 @lark-apaas/dataloom 的 csrf 工具。
    const csrf = process.env.RQSYS_CSRF_TOKEN ?? process.env.SUDA_CSRF_TOKEN ?? "";
    const headers = { accept: "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}), ...(csrf ? { "x-suda-csrf-token": csrf } : {}) };
    requirements = await fetchAllRequirements(apiBase, headers, limit);
  }
  if (limit !== null) requirements = requirements.slice(0, limit);

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const appToken = process.env.BASE_APP_TOKEN;
  const tableId = process.env.BASE_TABLE_ID;
  if (!appId || !appSecret || !appToken || !tableId) die("需要 FEISHU_APP_ID / FEISHU_APP_SECRET / BASE_APP_TOKEN / BASE_TABLE_ID");

  let fieldMap = {};
  try { fieldMap = JSON.parse(process.env.BASE_FIELDS_JSON ?? "{}") ?? {}; } catch { die("BASE_FIELDS_JSON 不是合法 JSON"); }
  const platformField = typeof fieldMap.platformRequirementId === "string" && fieldMap.platformRequirementId.trim() ? fieldMap.platformRequirementId.trim() : PLATFORM_FIELD_DEFAULT;
  const sourceMethodField = typeof fieldMap.sourceMethod === "string" && fieldMap.sourceMethod.trim() ? fieldMap.sourceMethod.trim() : SOURCE_METHOD_FIELD_DEFAULT;

  const feishu = "https://open.feishu.cn";
  const token = await tenantToken(feishu, appId, appSecret);
  const baseGet = async (path) => {
    const response = await fetch(`${feishu}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (payload.code !== 0) die(`Base GET ${path.split("?")[0]} -> code=${payload.code}`);
    return payload.data;
  };

  // 先确认两个字段真实存在：缺字段时继续对照只会输出一列空值，没有意义。
  const fields = await baseGet(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`);
  const fieldNames = new Set((fields.items ?? []).map((field) => field.field_name));
  if (!fieldNames.has(platformField)) die(`目标表缺少平台 ID 字段「${platformField}」`);
  if (!fieldNames.has(sourceMethodField) && !flag("--allow-missing-field")) die(`目标表缺少「${sourceMethodField}」字段；如确认要空跑对照，加 --allow-missing-field`);

  const rows = [];
  const summary = { scanned: 0, wouldWrite: 0, alreadyCorrect: 0, baseRowMissing: 0, noPlatformId: 0, unknownSource: 0, errors: 0 };
  for (const requirement of requirements) {
    summary.scanned += 1;
    const platformId = typeof requirement.platformRequirementId === "string" ? requirement.platformRequirementId.trim() : "";
    if (!platformId) { summary.noPlatformId += 1; continue; }
    const intakeOrigin = requirement.source && typeof requirement.source === "object" ? requirement.source.intakeOrigin : undefined;
    const expected = expectedSourceMethod(requirement.sourceType, intakeOrigin);
    if (expected === null) {
      summary.unknownSource += 1;
      rows.push({ platformId, sourceType: String(requirement.sourceType), intakeOrigin: intakeOrigin ?? "", expected: "", recordId: "", current: "", action: "unknown_source" });
      continue;
    }
    if (delayMs > 0) await sleep(delayMs);
    let baseRow;
    try {
      const query = new URLSearchParams({
        filter: `CurrentValue.[${platformField}] = ${JSON.stringify(platformId)}`,
        field_names: JSON.stringify([platformField, sourceMethodField]),
        page_size: "2",
      });
      const data = await baseGet(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?${query}`);
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length > 1) {
        summary.errors += 1;
        rows.push({ platformId, sourceType: String(requirement.sourceType), intakeOrigin: intakeOrigin ?? "", expected, recordId: items.map((item) => item.record_id).join("|"), current: "", action: "key_conflict" });
        continue;
      }
      baseRow = items[0];
    } catch (error) {
      summary.errors += 1;
      rows.push({ platformId, sourceType: String(requirement.sourceType), intakeOrigin: intakeOrigin ?? "", expected, recordId: "", current: "", action: `error:${String(error.message ?? error).slice(0, 80)}` });
      continue;
    }
    if (!baseRow) {
      summary.baseRowMissing += 1;
      rows.push({ platformId, sourceType: String(requirement.sourceType), intakeOrigin: intakeOrigin ?? "", expected, recordId: "", current: "", action: "base_row_missing" });
      continue;
    }
    const current = baseRow.fields && typeof baseRow.fields[sourceMethodField] === "string" ? baseRow.fields[sourceMethodField] : "";
    const action = current === expected ? "already_correct" : "would_write";
    if (action === "already_correct") summary.alreadyCorrect += 1; else summary.wouldWrite += 1;
    rows.push({ platformId, sourceType: String(requirement.sourceType), intakeOrigin: intakeOrigin ?? "", expected, recordId: baseRow.record_id, current, action });
  }

  const header = ["platformRequirementId", "sourceType", "intakeOrigin", "expectedSourceMethod", "baseRecordId", "currentSourceMethod", "action"];
  const csv = [header.join(","), ...rows.map((row) => [row.platformId, row.sourceType, row.intakeOrigin, row.expected, row.recordId, row.current, row.action].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
  if (csvPath) {
    await writeFile(resolve(process.cwd(), csvPath), `${csv}\n`, "utf8");
    console.log(`[source-backfill] CSV 已写入 ${csvPath}`);
  } else {
    console.log(csv);
  }
  console.log(`[source-backfill] dry-run 汇总: ${JSON.stringify(summary)}`);
  console.log(`[source-backfill] 只读执行：未写入 Base、未写数据库、未触碰任何通知字段。`);
}

await main();
