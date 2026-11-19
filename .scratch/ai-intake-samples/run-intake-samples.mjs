#!/usr/bin/env node
// PRD-26 聊天抽取 20 段质量回归 harness。
//
// 默认 stub 模式：在 127.0.0.1 上起一个假的 intake-draft 服务，不调线上、不写库、不产生审计。
// live 模式必须显式加 --allow-live --ack-audit-writes，并自备登录 Cookie；每次成功/失败都会写一条
// intake.* 审计，没有清库工具前不要跑。
//
// 判分口径见 SAMPLES-20261119.md：渠道/类型/模块/提出人精确匹配；期望 null 的字段猜了就算错；
// S11、S20 是负向/混合样本，单列统计；fallback 样本不计入字段准确率；标题/描述/约束的语义质量
// 只做自动提示，最终仍需人工复核。

import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const DEFAULT_SAMPLES = join(HERE, "SAMPLES-20261119.md");
const RESULTS_DIR = join(HERE, "results");
const INTAKE_PATH = "/api/requirements/intake-draft";

// 与 apps/api/src/contracts/pipeline.ts 对齐；启动时会做一处源码包含检查，防止文档枚举漂移。
const CHANNELS = ["销售", "售后", "电商", "运营/用研", "终端用户", "产品/研发/测试"];
const TYPES = ["新增功能", "功能扩展", "体验优化", "性能优化", "质量修复", "安全合规", "成本效率", "技术治理"];
const NEGATIVE_IDS = new Set(["S11", "S20"]);
const FIELD_LABELS = { channel: "渠道", type: "类型", module: "模块", proposer: "提出人" };
const DRAFT_FIELDS = ["title", "description", "sourceChannel", "requirementType", "productModel", "constraintNotes", "intakeModule", "proposer"];

// stub 模式的已知答案：用来证明 harness 真能抓错，而不是只会打印通过。
const STUB_EXPECTATION = {
  total: 20,
  httpErrors: 0,
  fallbackIds: ["S09"],
  piiLeakIds: ["S16"],
  fieldFailureIds: ["S02", "S03", "S11", "S19", "S20"],
  positiveScoredSamples: 17,
  positiveFieldTotal: 68,
  positiveFieldMatched: 65,
  negativeTotal: 2,
  negativePassed: 0,
};

function die(message) {
  console.error(`\n[harness] ${message}`);
  process.exit(1);
}

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function strOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// 正文标注与总表里的「（补充说明）」不是字段值；模块名本身带括号，不能一并剥掉。
function expectedCell(raw, { module = false } = {}) {
  const value = String(raw ?? "").trim();
  if (/^null\b/i.test(value)) return null;
  if (module) return value;
  return value.replace(/[（(][^）)]*[）)]\s*$/, "").trim();
}

function parseSummary(markdown) {
  const rows = new Map();
  const start = markdown.indexOf("## 0.");
  const end = markdown.indexOf("## 1.");
  if (start === -1 || end === -1) throw new Error("找不到 §0 标注总表或 §1 样本正文的分界");
  const table = markdown.slice(start, end);
  for (const line of table.split("\n")) {
    if (!/^\|\s*S\d{2}\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 7) continue;
    rows.set(cells[0], {
      scene: cells[1],
      channel: cells[2],
      type: cells[3],
      module: cells[4],
      proposer: cells[5],
      constraints: cells[6],
    });
  }
  return rows;
}

function parseSections(markdown) {
  const samples = [];
  for (const chunk of markdown.split(/^### /m).slice(1)) {
    const head = /^(S\d{2})\s+([^\n]*)/.exec(chunk);
    if (!head) continue;
    const id = head[1];
    const textBlock = /```text\r?\n([\s\S]*?)\r?\n```/.exec(chunk);
    if (!textBlock) throw new Error(`${id} 缺少 text 正文代码块`);
    const annotations = {};
    for (const rawLine of chunk.split("\n")) {
      const match = /^- (标题|渠道|类型|模块|提出人|约束|陷阱)：(.*)$/.exec(rawLine.trim());
      if (!match) continue;
      if (annotations[match[1]] !== undefined) throw new Error(`${id} 标注字段重复：${match[1]}`);
      annotations[match[1]] = match[2].trim();
    }
    for (const key of ["标题", "渠道", "类型", "模块", "提出人", "约束"]) {
      if (annotations[key] === undefined) throw new Error(`${id} 缺少标注字段：${key}`);
    }
    samples.push({
      id,
      scene: head[2].trim(),
      text: textBlock[1].trim(),
      title: annotations.标题,
      channel: expectedCell(annotations.渠道),
      type: expectedCell(annotations.类型),
      module: expectedCell(annotations.模块, { module: true }),
      proposer: expectedCell(annotations.提出人),
      constraints: expectedCell(annotations.约束),
      traps: annotations.陷阱 ?? null,
      negative: NEGATIVE_IDS.has(id),
    });
  }
  return samples;
}

function validateSamples(samples, summary, markdown) {
  if (samples.length !== 20) throw new Error(`样本数应为 20，实际 ${samples.length}`);
  const ids = samples.map((sample) => sample.id);
  const expectedIds = Array.from({ length: 20 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`);
  if (ids.join(",") !== expectedIds.join(",")) throw new Error(`样本 ID 不是 S01–S20：${ids.join(",")}`);
  if (new Set(ids).size !== ids.length) throw new Error("样本 ID 有重复");
  const seenText = new Set();
  for (const sample of samples) {
    if (!sample.text) throw new Error(`${sample.id} 正文为空`);
    if (Array.from(sample.text).length > 20_000) throw new Error(`${sample.id} 正文超过 20000 字`);
    if (seenText.has(sample.text)) throw new Error(`${sample.id} 正文与其他样本重复`);
    seenText.add(sample.text);
    if (sample.channel !== null && !CHANNELS.includes(sample.channel)) throw new Error(`${sample.id} 渠道不在枚举内：${sample.channel}`);
    if (sample.type !== null && !TYPES.includes(sample.type)) throw new Error(`${sample.id} 类型不在枚举内：${sample.type}`);
    const row = summary.get(sample.id);
    if (!row) throw new Error(`${sample.id} 不在 §0 标注总表里`);
    const summaryChannel = expectedCell(row.channel);
    const summaryType = expectedCell(row.type);
    const summaryModule = expectedCell(row.module, { module: true });
    const summaryProposer = expectedCell(row.proposer);
    if (row.constraints === undefined) throw new Error(`${sample.id} 总表缺少约束列`);
    for (const [label, sectionValue, tableValue] of [
      ["渠道", sample.channel, summaryChannel],
      ["类型", sample.type, summaryType],
      ["模块", sample.module, summaryModule],
      ["提出人", sample.proposer, summaryProposer],
    ]) {
      if (sectionValue !== tableValue) throw new Error(`${sample.id} 的${label}正文标注(${sectionValue})与总表(${tableValue})不一致`);
    }
  }
  if (!markdown.includes("S11、S20 是负向/混合样本")) throw new Error("样本说明里的负向样本口径变了，请同步 NEGATIVE_IDS");
}

function checkDictionary(samples) {
  const pipelineSource = readFileSync(join(REPO_ROOT, "apps/api/src/contracts/pipeline.ts"), "utf8");
  for (const value of [...CHANNELS, ...TYPES]) {
    if (!pipelineSource.includes(`"${value}"`)) throw new Error(`pipeline.ts 里找不到枚举值：${value}`);
  }
  const seed = readFileSync(join(REPO_ROOT, "database/migrations/0003_team_directory_seed.sql"), "utf8");
  const modules = new Set(Array.from(seed.matchAll(/\{"name":"([^"]+)"/g), (match) => match[1]));
  if (modules.size === 0) throw new Error("未能从 0003 种子解析出模块词典");
  const unknown = samples.filter((sample) => sample.module !== null && !modules.has(sample.module));
  if (unknown.length > 0) throw new Error(`模块不在 0003 已发布词典：${unknown.map((sample) => `${sample.id}=${sample.module}`).join("; ")}`);
  return { modules: modules.size, nonNullModules: samples.filter((sample) => sample.module !== null).length };
}

const PII_PATTERNS = [
  { kind: "phone", re: /\b1[3-9]\d{9}\b/g },
  { kind: "email", re: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g },
  { kind: "order", re: /\b\d{12,}\b/g },
  { kind: "wechat", re: /(?:微信|wxid|wechat)\s*[:：]?\s*([A-Za-z][-_A-Za-z0-9]{4,})/gi },
];

function extractPii(text) {
  const found = new Map();
  for (const { kind, re } of PII_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const token = match[1] ?? match[0];
      if (token) found.set(token, kind);
    }
  }
  return found;
}

function redact(value, tokens) {
  let out = value;
  for (const token of tokens.keys()) out = out.split(token).join("***");
  return out;
}

function makeAiFilled(draft) {
  const filled = [];
  if (draft.title) filled.push("title");
  if (draft.description) filled.push("description");
  if (draft.sourceChannel) filled.push("sourceChannel");
  if (draft.requirementType) filled.push("requirementType");
  if (draft.productModel) filled.push("productModel");
  if (draft.constraintNotes) filled.push("constraintNotes");
  if (draft.intakeModule) filled.push("intakeModule");
  if (draft.proposer) filled.push("proposer");
  return filled;
}

// 桩返回的草稿按标注生成；下面几处故意写错，用来验证 harness 能抓到错。
const STUB_MUTATIONS = new Map([
  ["S02", (draft) => { draft.intakeModule = "电源管理（海信新平台）"; }],
  ["S03", (draft) => { draft.sourceChannel = "终端用户"; }],
  ["S11", (draft) => { draft.requirementType = "体验优化"; }],
  ["S16", (draft) => { draft.description += " 客户邮箱 buyer@example.com，请尽快联系。"; }],
  ["S19", (draft) => { draft.proposer = "小林"; }],
  ["S20", (draft) => { draft.sourceChannel = "终端用户"; }],
]);

function buildStubResponse(sample) {
  const draft = {
    title: sample.title,
    description: `用户反馈：${sample.title}。希望评估并跟进。`,
    sourceChannel: sample.channel,
    requirementType: sample.type,
    productModel: null,
    constraintNotes: sample.constraints,
    intakeModule: sample.module,
    proposer: sample.proposer,
  };
  let fallback = false;
  const mutate = STUB_MUTATIONS.get(sample.id);
  if (mutate) mutate(draft);
  if (sample.id === "S09") {
    // 模拟模型漏给标题/描述时的兜底：取掩码原文首行，aiFilled 为空。
    fallback = true;
    draft.title = sample.text.split("\n")[0].trim().slice(0, 80);
    draft.description = sample.text;
  }
  draft.aiFilled = fallback ? [] : makeAiFilled(draft);
  return { draft, similar: [], fallback, aiFilledCount: draft.aiFilled.length };
}

function startStubServer(samples) {
  return new Promise((resolveServer) => {
    const server = http.createServer((request, response) => {
      if (request.method !== "POST" || request.url !== INTAKE_PATH) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
        return;
      }
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        let text;
        try {
          text = JSON.parse(raw).text;
        } catch {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { code: "VALIDATION_FAILED" } }));
          return;
        }
        const sample = samples.find((item) => item.text === text);
        if (!sample) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { code: "UNKNOWN_SAMPLE" } }));
          return;
        }
        const body = buildStubResponse(sample);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolveServer({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function scoreSample(sample, { status, body, error }) {
  const draft = body && typeof body.draft === "object" && body.draft !== null ? body.draft : {};
  const actual = {
    channel: strOrNull(draft.sourceChannel),
    type: strOrNull(draft.requirementType),
    module: strOrNull(draft.intakeModule),
    proposer: strOrNull(draft.proposer ?? draft.proposerName),
  };
  const title = strOrNull(draft.title);
  const description = strOrNull(draft.description);
  const constraintNotes = strOrNull(draft.constraintNotes);
  const piiTokens = extractPii(sample.text);
  const rendered = [title, description, constraintNotes, strOrNull(draft.productModel), actual.proposer].filter(Boolean).join("\n");

  const fields = {};
  let fieldMatches = 0;
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const ok = sample[key] === actual[key];
    if (ok) fieldMatches += 1;
    fields[key] = { label, expected: sample[key], actual: actual[key], ok };
  }

  const pii = { leaks: [], title: false, description: false };
  for (const [token, kind] of piiTokens) {
    if (!rendered.includes(token)) continue;
    const where = [];
    if (title?.includes(token)) { where.push("title"); pii.title = true; }
    if (description?.includes(token)) { where.push("description"); pii.description = true; }
    if (constraintNotes?.includes(token)) where.push("constraintNotes");
    if (strOrNull(draft.productModel)?.includes(token)) where.push("productModel");
    if (actual.proposer?.includes(token)) where.push("proposer");
    pii.leaks.push({ kind, where });
  }

  const titleIssues = [];
  if (!title) titleIssues.push("标题为空");
  else if (Array.from(title).length > 200) titleIssues.push("标题超过 200 字");
  if (pii.title) titleIssues.push("标题含 PII");
  const descriptionIssues = [];
  if (!description) descriptionIssues.push("描述为空");
  else if (Array.from(description).length > 20_000) descriptionIssues.push("描述超过 20000 字");
  if (pii.description) descriptionIssues.push("描述含 PII");

  let constraint;
  if (sample.constraints === null) {
    constraint = constraintNotes === null
      ? { status: "pass", expected: null, actual: null }
      : { status: "fabricated", expected: null, actual: redact(constraintNotes, piiTokens) };
  } else if (constraintNotes === null) {
    constraint = { status: "missing", expected: sample.constraints, actual: null };
  } else {
    // 数字/型号是约束里最硬的锚点；语义覆盖仍需人工判。
    const numbers = [...new Set(Array.from(sample.constraints.matchAll(/\d+(?:\.\d+)?/g), (match) => match[0]))];
    const missing = numbers.filter((number) => !constraintNotes.includes(number));
    constraint = {
      status: missing.length === 0 ? "manual" : "review-numbers",
      expected: sample.constraints,
      actual: redact(constraintNotes, piiTokens),
      missing,
    };
  }

  return {
    id: sample.id,
    scene: sample.scene,
    negative: sample.negative,
    status,
    error: error ?? null,
    fallback: body?.fallback === true,
    scored: status === 200 && body?.fallback !== true,
    fields,
    fieldMatches,
    title: { value: title ? redact(title, piiTokens) : null, issues: titleIssues },
    description: { value: description ? redact(description, piiTokens) : null, issues: descriptionIssues },
    constraint,
    pii: { leaks: pii.leaks },
    expected: {
      channel: sample.channel,
      type: sample.type,
      module: sample.module,
      proposer: sample.proposer,
      constraints: sample.constraints,
    },
    elapsedMs: null,
  };
}

function summarize(results) {
  const positive = results.filter((result) => !result.negative);
  const negative = results.filter((result) => result.negative);
  const scoredPositive = positive.filter((result) => result.scored);
  const fieldTotal = scoredPositive.length * 4;
  const fieldMatched = scoredPositive.reduce((sum, result) => sum + result.fieldMatches, 0);
  return {
    total: results.length,
    httpErrors: results.filter((result) => result.status !== 200).length,
    fallbackIds: results.filter((result) => result.fallback).map((result) => result.id),
    piiLeakIds: results.filter((result) => result.pii.leaks.length > 0).map((result) => result.id),
    fieldFailureIds: results.filter((result) => result.scored && result.fieldMatches < 4).map((result) => result.id),
    positiveSamples: positive.length,
    positiveScoredSamples: scoredPositive.length,
    positiveFieldTotal: fieldTotal,
    positiveFieldMatched: fieldMatched,
    positiveAccuracy: fieldTotal === 0 ? null : Math.round((fieldMatched / fieldTotal) * 1000) / 10,
    negativeTotal: negative.length,
    negativePassed: negative.filter((result) => result.scored && result.fieldMatches === 4).length,
    constraintFabricated: results.filter((result) => result.constraint.status === "fabricated").map((result) => result.id),
    constraintMissing: results.filter((result) => result.constraint.status === "missing").map((result) => result.id),
    constraintReview: results.filter((result) => result.constraint.status === "review-numbers").map((result) => result.id),
    constraintManual: results.filter((result) => result.constraint.status === "manual").map((result) => result.id),
    titleIssues: results.filter((result) => result.title.issues.length > 0).map((result) => result.id),
    descriptionIssues: results.filter((result) => result.description.issues.length > 0).map((result) => result.id),
  };
}

function violates(actual, expected, label) {
  const problems = [];
  if (actual.total !== expected.total) problems.push(`${label} 样本数 ${actual.total} != ${expected.total}`);
  if (actual.httpErrors !== expected.httpErrors) problems.push(`${label} HTTP 错误 ${actual.httpErrors} != ${expected.httpErrors}`);
  for (const key of ["fallbackIds", "piiLeakIds", "fieldFailureIds"]) {
    const left = [...actual[key]].sort().join(",");
    const right = [...expected[key]].sort().join(",");
    if (left !== right) problems.push(`${label} ${key} [${left}] != [${right}]`);
  }
  for (const key of ["positiveScoredSamples", "positiveFieldTotal", "positiveFieldMatched", "negativeTotal", "negativePassed"]) {
    if (actual[key] !== expected[key]) problems.push(`${label} ${key} ${actual[key]} != ${expected[key]}`);
  }
  return problems;
}

function ymd(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function mark(field) {
  return `${field.ok ? "✓" : "✗"} ${field.expected ?? "null"}${field.ok ? "" : ` → ${field.actual ?? "null"}`}`;
}

function renderMarkdown({ mode, samples, results, summary, baseUrl, startedAt, finishedAt }) {
  const lines = [];
  lines.push(`# 聊天抽取 20 段回归结果（${mode}）`);
  lines.push("");
  lines.push(`- 样本文件：\`${samples}\``);
  lines.push(`- 时间：${startedAt} → ${finishedAt}`);
  lines.push(`- 端点：${baseUrl}`);
  lines.push(`- 样本：${summary.total}（正向 ${summary.positiveSamples}，负向/混合 ${summary.negativeTotal}）`);
  lines.push(`- HTTP 错误：${summary.httpErrors}`);
  lines.push(`- fallback：${summary.fallbackIds.length}${summary.fallbackIds.length ? `（${summary.fallbackIds.join(", ")}）` : ""}`);
  lines.push(`- 正向字段准确率：${summary.positiveFieldMatched}/${summary.positiveFieldTotal}（${summary.positiveAccuracy ?? "n/a"}%，已排除 fallback）`);
  lines.push(`- 负向样本通过：${summary.negativePassed}/${summary.negativeTotal}`);
  lines.push(`- PII 泄漏：${summary.piiLeakIds.length}${summary.piiLeakIds.length ? `（${summary.piiLeakIds.join(", ")}）` : ""}`);
  lines.push(`- 约束：编造 ${summary.constraintFabricated.length}，缺失 ${summary.constraintMissing.length}，数字待核 ${summary.constraintReview.length}，语义待人工 ${summary.constraintManual.length}`);
  lines.push(`- 标题问题：${summary.titleIssues.length}；描述问题：${summary.descriptionIssues.length}`);
  lines.push("");
  lines.push("## 明细");
  lines.push("");
  lines.push("| ID | HTTP | fallback | 渠道 | 类型 | 模块 | 提出人 | 字段 | PII | 约束 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const result of results) {
    const constraintText = result.constraint.status === "fabricated"
      ? "编造"
      : result.constraint.status === "missing"
        ? "缺失"
        : result.constraint.status === "review-numbers"
          ? `数字待核(${result.constraint.missing.join("/")})`
          : result.constraint.status === "pass" ? "null ✓" : "语义待人工";
    lines.push(`| ${result.id} | ${result.status || "ERR"} | ${result.fallback ? "是" : ""} | ${mark(result.fields.channel)} | ${mark(result.fields.type)} | ${mark(result.fields.module)} | ${mark(result.fields.proposer)} | ${result.fallback ? "—" : `${result.fieldMatches}/4`} | ${result.pii.leaks.length ? `泄漏(${result.pii.leaks.map((leak) => leak.kind).join("/")})` : "✓"} | ${constraintText} |`);
  }
  lines.push("");
  lines.push("## 失败与待人工项");
  lines.push("");
  for (const result of results) {
    const notes = [];
    for (const field of Object.values(result.fields)) if (!field.ok) notes.push(`${field.label}期望 ${field.expected ?? "null"}，实际 ${field.actual ?? "null"}`);
    if (result.pii.leaks.length) notes.push(`PII 泄漏：${result.pii.leaks.map((leak) => `${leak.kind}@${leak.where.join("+")}`).join("; ")}`);
    if (result.constraint.status === "fabricated") notes.push("约束标了 null 但返回了内容");
    if (result.constraint.status === "missing") notes.push("约束缺失");
    if (result.constraint.status === "review-numbers") notes.push(`约束数字未覆盖：${result.constraint.missing.join("/")}`);
    if (result.title.issues.length) notes.push(`标题：${result.title.issues.join("；")}`);
    if (result.description.issues.length) notes.push(`描述：${result.description.issues.join("；")}`);
    if (result.fallback) notes.push("fallback：字段不计入准确率，需人工改写");
    if (result.error) notes.push(`错误：${result.error}`);
    if (notes.length === 0) continue;
    lines.push(`- **${result.id}**（${result.scene}）：${notes.join("；")}。约束原文：${result.expected.constraints ?? "null"}`);
  }
  lines.push("");
  lines.push("> 说明：标题、描述和约束的语义质量只做自动提示，最终需人工按 SAMPLES-20261119.md 的标注复核；`约束` 一列的「语义待人工」只额外检查数字/型号锚点是否覆盖。");
  return `${lines.join("\n")}\n`;
}

function printSummary(summary, mode) {
  console.log(`\n[${mode}] 样本 ${summary.total}｜HTTP 错误 ${summary.httpErrors}｜fallback ${summary.fallbackIds.length}`);
  console.log(`[${mode}] 正向字段 ${summary.positiveFieldMatched}/${summary.positiveFieldTotal}（${summary.positiveAccuracy ?? "n/a"}%）｜负向通过 ${summary.negativePassed}/${summary.negativeTotal}`);
  console.log(`[${mode}] PII 泄漏 ${summary.piiLeakIds.length}｜约束编造 ${summary.constraintFabricated.length}｜约束缺失 ${summary.constraintMissing.length}｜数字待核 ${summary.constraintReview.length}｜语义待人工 ${summary.constraintManual.length}`);
  const flagged = [...new Set([...summary.fieldFailureIds, ...summary.piiLeakIds, ...summary.fallbackIds])];
  if (flagged.length > 0) console.log(`[${mode}] 需关注：${flagged.join(", ")}`);
}

async function main() {
  const mode = arg("--mode", "stub");
  if (!["stub", "live"].includes(mode)) die(`--mode 只支持 stub|live，收到 ${mode}`);
  const samplesPath = resolve(arg("--samples", DEFAULT_SAMPLES));
  const markdown = readFileSync(samplesPath, "utf8");
  const samples = parseSections(markdown);
  const summaryTable = parseSummary(markdown);
  validateSamples(samples, summaryTable, markdown);
  const dictionary = checkDictionary(samples);
  console.log(`[check] 样本 ${samples.length}/20｜枚举渠道 ${CHANNELS.length}、类型 ${TYPES.length}｜非空模块 ${dictionary.nonNullModules} 个均在 0003 词典里（词典共 ${dictionary.modules} 个）`);
  console.log(`[check] 负向样本：${samples.filter((sample) => sample.negative).map((sample) => sample.id).join(", ")}｜含 PII 样本：${samples.filter((sample) => extractPii(sample.text).size > 0).map((sample) => sample.id).join(", ")}`);
  if (hasFlag("--check")) {
    console.log("[check] 通过：样本解析、总表一致性、枚举与模块词典都对齐。");
    return;
  }

  const only = arg("--only");
  if (only && hasFlag("--assert-stub")) die("--assert-stub 只用于完整 20 段自检，不能和 --only 一起用");
  const selected = only
    ? samples.filter((sample) => only.split(",").map((id) => id.trim()).includes(sample.id))
    : samples;
  if (selected.length === 0) die(`--only 没有匹配到样本：${only}`);
  if (only && selected.length !== only.split(",").length) die("--only 里有不存在的样本 ID");

  let baseUrl;
  let stub;
  let delayMs;
  if (mode === "stub") {
    stub = await startStubServer(samples);
    baseUrl = stub.baseUrl;
    delayMs = Number(arg("--delay", "0"));
    console.log(`[stub] 本地桩已启动：${baseUrl}${INTAKE_PATH}`);
  } else {
    if (!hasFlag("--allow-live")) die("live 模式会写入 intake.* 审计，必须显式加 --allow-live");
    if (!hasFlag("--ack-audit-writes")) die("live 模式必须加 --ack-audit-writes，确认你会在跑完后清理 intake.* 审计");
    baseUrl = arg("--base-url");
    if (!baseUrl) die("live 模式必须提供 --base-url");
    if (!process.env.INTAKE_COOKIE && !process.env.INTAKE_AUTHORIZATION) die("live 模式需要 INTAKE_COOKIE 或 INTAKE_AUTHORIZATION 环境变量（登录态），harness 不接收明文参数");
    delayMs = Number(arg("--delay", "21000"));
    if (!Number.isFinite(delayMs) || delayMs < 0) die("--delay 必须是非负毫秒数");
    if (delayMs < 20000) console.warn(`[live] 警告：--delay ${delayMs}ms 低于 3 次/分钟的限流节奏，除非你确认了测试配置，否则会收到 429。`);
    console.log(`[live] 目标：${baseUrl}${INTAKE_PATH}｜${selected.length} 段｜间隔 ${delayMs}ms｜预计 ${Math.round((selected.length * delayMs) / 1000)}s`);
    console.log("[live] 注意：每段成功/失败都会写一条 intake.* 审计；跑完必须按 samples 文档 §3 清理并复查。");
  }

  const startedAt = new Date().toISOString();
  const results = [];
  for (const [index, sample] of selected.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    const fetchStarted = Date.now();
    let status = 0;
    let body = null;
    let error = null;
    try {
      const headers = { "content-type": "application/json" };
      if (process.env.INTAKE_COOKIE) headers.cookie = process.env.INTAKE_COOKIE;
      if (process.env.INTAKE_AUTHORIZATION) headers.authorization = process.env.INTAKE_AUTHORIZATION;
      const response = await fetch(new URL(INTAKE_PATH, baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({ text: sample.text }),
      });
      status = response.status;
      const raw = await response.text();
      try {
        body = JSON.parse(raw);
      } catch {
        body = { raw: raw.slice(0, 500) };
      }
      if (!response.ok) error = `HTTP ${status} ${body?.error?.code ?? body?.error?.message ?? ""}`.trim();
    } catch (cause) {
      error = String(cause?.message ?? cause);
    }
    const result = scoreSample(sample, { status, body, error });
    result.elapsedMs = Date.now() - fetchStarted;
    results.push(result);
    const flags = Object.values(result.fields).filter((field) => !field.ok).map((field) => field.label);
    console.log(`[${mode}] ${result.id} ${status || "ERR"} ${result.fallback ? "fallback(不计分)" : `${result.fieldMatches}/4`}${flags.length ? ` 失败:${flags.join("/")}` : ""}${result.pii.leaks.length ? " PII泄漏" : ""}${result.error ? ` ${result.error}` : ""}`);
  }
  const finishedAt = new Date().toISOString();
  const summary = summarize(results);
  printSummary(summary, mode);

  if (mode === "stub" && hasFlag("--assert-stub")) {
    const problems = violates(summary, STUB_EXPECTATION, "stub 预期");
    if (problems.length > 0) {
      console.error("\n[assert-stub] FAIL");
      for (const problem of problems) console.error(`- ${problem}`);
      process.exitCode = 1;
    } else {
      console.log("[assert-stub] PASS：harness 正确复现了已知的 5 个字段错误、1 个 fallback、1 个 PII 泄漏（S16），负向 0/2。");
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ymd(new Date(startedAt));
  const baseName = `${mode}-${stamp}`;
  const report = {
    mode,
    samples: samplesPath,
    baseUrl,
    startedAt,
    finishedAt,
    summary,
    results,
  };
  const jsonPath = join(RESULTS_DIR, `${baseName}.json`);
  const mdPath = join(RESULTS_DIR, `${baseName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown({ mode, samples: samplesPath, results, summary, baseUrl, startedAt, finishedAt }));
  console.log(`[report] ${jsonPath}`);
  console.log(`[report] ${mdPath}`);

  if (stub) await new Promise((resolveClose) => stub.server.close(resolveClose));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
