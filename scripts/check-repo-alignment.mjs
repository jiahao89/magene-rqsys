#!/usr/bin/env node
// 两仓对齐检查：
//   1. 后端：root 的 apps/api/src 与 app 仓的 server/rqsys 必须保持行为对齐；
//   2. 前端：root 的 apps/web/src 与 app 仓的 client/src/rqsys 必须保持共享组件与文件清单对齐；
//   3. Schema：database/migrations/*.sql 建表清单必须全部被 rq-sys-miaoda/server/database/schema.ts 覆盖。
//
// 用法：node scripts/check-repo-alignment.mjs
// 退出码：0 = 所有模块、前端文件与 Drizzle 表均已对齐；1 = 出现未分类漂移、过期声明或表缺失。
//
// 背景：两仓共用同一套 RQ-Sys 模块，但构建系统不同（root 用 tsc+ESM 扩展名，app 用 NestJS/SWC
// 无扩展名），平台适配层也不同（pg vs Drizzle、本地身份 vs 妙搭 userContext）。因此“完全一致”
// 不是正确目标——正确目标是：每一处差异要么是已声明的平台适配，要么是共用逻辑（必须一致），
// 并且声明表本身不能出现过期或互相矛盾的条目。

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_API = join(rootDir, "apps/api/src");
const APP_API = join(rootDir, "rq-sys-miaoda/server/rqsys");
const ROOT_WEB = join(rootDir, "apps/web/src");
const APP_WEB = join(rootDir, "rq-sys-miaoda/client/src/rqsys");
const MIGRATIONS_DIR = join(rootDir, "database/migrations");
const DRIZZLE_SCHEMA_FILE = join(rootDir, "rq-sys-miaoda/server/database/schema.ts");

// =========================== 1. 后端模块声明 ===========================

// 共用逻辑：必须逐字一致（忽略 import 扩展名差异）。
const SHARED = [
  "base/client.ts",
  "base/push-service.ts",
  "base/transport.ts",
  "analysis/context.ts",
  "analysis/contract.ts",
  "analysis/openai-http.ts",
  "analysis/priority-rule.ts",
  "analysis/provider.ts",
  "analysis/scoring-v4.ts",
  "analysis/service.ts",
  "assessment/rate-limit.ts",
  "owner/mapping.ts",
  "retry/policy.ts",
  "scheduler/due.ts",
  "scheduler/due-jobs.ts",
  "scheduler/analysis-recovery.ts",
  "scheduler/owner-recheck.ts",
  "sync/hashes.ts",
  "jobs/claim.ts",
  "jobs/deferred.ts",
  "application/batch-cursor.ts",
  "application/ports.ts",
  "audit/storage.ts",
  "contracts/rules.ts",
  "domain/workflow.ts",
  "domain/persistence.ts",
  "domain/team-directory.ts",
  "analysis/repository-adapter.ts",
  "audit/event.ts",
  "requirements/processing.ts",
  "beta/kano.ts",
  "beta/rice.ts",
  "ops/alerts.ts",
  "base/duplicate-marker.ts",
  "db/expected-migration.ts",
  "application/csv.ts",
  "ops/ai-pause.ts",
  "ops/gates.ts",
  "intake/chat-extract.ts",
];

// 平台适配：允许不同，但必须在 DECLARED 里给出理由，避免“漂移了却没人知道”。
const DECLARED = {
  "adapters/postgres/pool.ts": "root 自建 pg Pool；app 复用妙搭注入的 Drizzle 连接",
  "adapters/postgres/repositories.ts": "驱动差异：pg 参数化查询 vs Drizzle 查询构建",
  "adapters/postgres/analysis-run-repository.ts": "驱动差异",
  "adapters/postgres/requirement-assessment-repository.ts": "驱动差异",
  "adapters/postgres/prd-prompt-repository.ts": "驱动差异（pg Pool vs 妙搭 PgPoolLike）",
  "adapters/postgres/sync-persistence.ts": "驱动差异",
  "adapters/postgres/health.ts": "驱动差异",
  "adapters/teambition/client.ts": "凭据/网关注入来源不同（本地 env vs 妙搭 env）",
  "adapters/teambition/normalize.ts": "app 仓承载项目字段映射细节",
  "adapters/feishu/directory-client.ts": "app 仓按妙搭运行时调整通讯录调用",
  "application/repositories.ts": "驱动差异导致的仓储接口收敛",
  "contracts/pipeline.ts": "app 仓契约收敛",
  "contracts/source.ts": "app 仓契约收敛",
  "domain/transitions.ts": "app 仓状态机收敛",
  "http/app.ts": "路由装配差异（妙搭挂载前缀、fixture 路由）",
  "jobs/idempotency.ts": "app 仓幂等键生成差异",
  "jobs/worker.ts": "app 仓常驻 worker 生命周期不同",
  "pipeline/advance.ts": "app 仓推进器接线不同",
  "sync/service.ts": "app 仓同步编排接线不同",
};

// root 独有：平台中立侧的专属实现，app 仓由妙搭提供等价能力。
const ROOT_ONLY = {
  "application/idempotency-keys.ts": "root 幂等键工具；app 仓有自身实现",
  "db/migrate.ts": "root 自带迁移 runner；妙搭托管库用平台迁移",
  "db/migration-sql.ts": "root 迁移 runner 的事务包装剥离；app 仓没有 SQL 迁移 runner",
  "http/local-identity.ts": "本地开发身份 seam；目标环境用妙搭 userContext，故 app 仓不应有",
  "server.ts": "root 为独立 node:http 入口；app 仓由 NestJS 模块与 runtime.ts 装配",
};

// app 独有：妙搭运行时的专属实现，root 侧没有对应物。新增 app 独有文件必须在此声明，
// 否则脚本报错——2026-10-24 审查发现单向遍历放过妙搭侧真实漂移（audit 白名单、分析守卫等）。
const APP_ONLY = {
  "adapters/feishu/identity.ts": "妙搭可信身份适配（userContext 注入），root 用本地身份 seam",
  "adapters/postgres/drizzle-pool.ts": "妙搭 Drizzle 传输层（$N 参数拆分语义），root 用 pg",
  "adapters/postgres/team-directory-repository.ts": "妙搭团队目录仓储接线，root 内联于 repositories",
  "jobs/drain.ts": "妙搭请求内 drain 编排，root 由轮询 worker 驱动",
  "runtime.ts": "妙搭应用装配入口，root 对应 server.ts（已在 ROOT_ONLY）",
};

// 声明为平台适配的文件里，有些共用函数仍必须逐字一致。只按整个文件声明会把字段级漂移
// 一并放过（2026-11-25：妙搭 /mine 列表缺 pool 字段就是这样漏掉的）。这里按函数名抽取后比对。
const MIRRORED_SNIPPETS = {
  "http/app.ts": ["identityUnavailable", "deletedRequirementWriteGate", "requirementListPayload"],
};

// 高风险平台适配接缝的行为守卫：确保曾在审计中漂移的关键安全/并发/契约行为同时存在于双仓。
const PARITY_INVARIANTS = {
  "http/app.ts": [
    {
      label: "GET /api/kano/evidence 须在 piiFlagged 时调用 maskPii",
      pattern: /kano\/evidence[\s\S]{0,1400}maskPii\(/,
    },
    {
      label: "CALIBRATED_SCORING_FORMULAS 须包含 umsc_weighted_v3",
      pattern: /CALIBRATED_SCORING_FORMULAS\s*=\s*new Set\(\[[^\]]*"umsc_weighted_v3"/,
    },
    {
      label: "PUT /api/requirements/:id/scoring 须保留缺省 safetyFlag 回落语义",
      pattern: /CALIBRATED_SCORING_FORMULAS[\s\S]{0,2200}safetyFlag\s*\?\?\s*sourceScore\?\.safetyFlag\s*\?\?\s*false/,
    },
    {
      label: "PUT /api/requirements/:id/rice-draft 须处理 source_version_conflict",
      pattern: /\/rice-draft\$\/[\s\S]{0,4000}source_version_conflict/,
    },
    {
      label: "GET /api/batches 须支持 decodeBatchCursor 与 since/until 过滤",
      pattern: /\/api\/batches"[\s\S]{0,1200}decodeBatchCursor[\s\S]{0,500}since[\s\S]{0,200}until/,
    },
    {
      label: "未知 API 路由须返回 404 NOT_FOUND（非 501）",
      pattern: /return jsonError\("NOT_FOUND"\);\s*\}\s*$/,
    },
  ],
  "adapters/postgres/repositories.ts": [
    {
      label: "PostgresSyncBatchRepository.reopen 须使用 FOR UPDATE 与 pg_advisory_xact_lock",
      pattern: /async reopen\([\s\S]{0,1400}FOR UPDATE[\s\S]{0,900}pg_advisory_xact_lock/,
    },
    {
      label: "PostgresRequirementRepository.saveRiceDraft 须校验 source_version_conflict",
      pattern: /saveRiceDraft\([\s\S]{0,2200}source_version_conflict/,
    },
  ],
};

// =========================== 2. 前端文件声明 ===========================

// 前端共用文件：apps/web/src 与 rq-sys-miaoda/client/src/rqsys 必须逐字一致（忽略扩展名差异）。
const WEB_SHARED = [
  "arco-styles.ts",
  "cache.ts",
  "confirm-modal.tsx",
  "deep-link.ts",
  "intake-form.tsx",
  "overview-ai.tsx",
  "pages/guide-page.tsx",
  "pages/modules-page.tsx",
  "pages/ops-page.tsx",
  "pages/requirements-page.tsx",
  "pages/sop-page.tsx",
  "pages/sources-page.tsx",
  "pages/sync-records-page.tsx",
  "panel-shared.tsx",
  "panels.tsx",
  "prd-prompt.tsx",
  "safe-url.ts",
  "schedule.ts",
  "skeleton.tsx",
  "sop.tsx",
  "state-labels.ts",
  "styles.css",
  "unsaved-guard.ts",
];

// 前端平台适配文件：允许存在宿主差异，但必须登记理由，且不得缺少任一侧文件。
const WEB_DECLARED = {
  "App.tsx": "宿主壳层差异（独立 Vite 壳 vs 妙搭 Layout/路由）",
  "api.ts": "请求传输层差异（原生 fetch vs 妙搭 backendFetch/axios）",
  "pages/team-page.tsx": "妙搭平台选人组件接线差异（PlatformFeishuBinder / platform-people）",
  "requirement-view.ts": "注释差异",
  "requirements-url.ts": "查询参数 trim 与注释差异",
  "workbench-routing.ts": "路由注释差异",
};

const WEB_ROOT_ONLY = {
  "main.tsx": "独立 Vite 渲染入口；妙搭入口在 client/src/index.tsx",
  "test-setup.ts": "root web 单测环境初始化",
  "vite-env.d.ts": "root Vite 类型声明",
};

const WEB_APP_ONLY = {
  "backend-response.ts": "妙搭 axios/backendFetch 响应适配",
  "backendFetch.ts": "妙搭应用前缀请求封装",
  "platform-people.ts": "妙搭飞书选人组件适配",
};

const BACKEND_IGNORE = /\.test\.ts$/;
const WEB_IGNORE = /\.test\.(ts|tsx|mjs)$/;
const IGNORED_MIGRATION_TABLES = new Set(["schema_migrations"]);

/** 按函数名抽取源码片段：括号配对时跳过字符串、模板字面量与注释，避免 `${}` / `}` 干扰。 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let parens = 0;
  let bodyStart = -1;
  for (let i = source.indexOf("(", start); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") parens += 1;
    else if (ch === ")") {
      parens -= 1;
      if (parens === 0) { bodyStart = source.indexOf("{", i); break; }
    }
  }
  if (bodyStart < 0) return null;
  const braceStart = bodyStart;
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

async function walk(dir, exts, ignore, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, exts, ignore, base)));
    else if (exts.some((ext) => entry.name.endsWith(ext)) && !ignore.test(entry.name)) {
      out.push(relative(base, full));
    }
  }
  return out;
}

/** app 仓用无扩展名 import；归一化后再比较，避免把构建差异误判为行为漂移。 */
function normalize(source) {
  return source.replace(/from "(\.[^"]*?)\.js"/g, 'from "$1"');
}

/** 校验一组（rootDir, appDir）的双向对齐与声明表完整性。 */
async function checkPair({
  label,
  rootBase,
  appBase,
  exts,
  ignore,
  shared,
  declared,
  rootOnly,
  appOnly,
  mirroredSnippets = {},
  parityInvariants = {},
}) {
  const failures = [];
  const sharedSet = new Set(shared);

  // 声明表互斥自检
  const seen = new Map();
  for (const [bucket, items] of [
    ["SHARED", shared],
    ["DECLARED", Object.keys(declared)],
    ["ROOT_ONLY", Object.keys(rootOnly)],
    ["APP_ONLY", Object.keys(appOnly)],
  ]) {
    for (const rel of items) {
      if (seen.has(rel)) failures.push(`[${label}] 重复声明（${seen.get(rel)} 与 ${bucket}）：${rel}`);
      else seen.set(rel, bucket);
    }
  }

  const rootFiles = (await walk(rootBase, exts, ignore)).sort();
  const appFiles = (await walk(appBase, exts, ignore)).sort();
  let identical = 0;
  const observed = {
    sharedOk: [],
    declaredDiff: [],
    declaredCoincides: [],
    undeclaredIdentical: [],
    rootOnly: [],
    appOnly: [],
  };

  for (const rel of rootFiles) {
    const appPath = join(appBase, rel);
    const declaredReason = declared[rel];
    const rootOnlyReason = rootOnly[rel];
    const isShared = sharedSet.has(rel);

    if (!existsSync(appPath)) {
      if (rootOnlyReason) observed.rootOnly.push(rel);
      else failures.push(`[${label}] app 仓缺少文件且未声明为 root 独有：${rel}`);
      continue;
    }

    if (rootOnlyReason) {
      failures.push(`[${label}] 声明为 root 独有但 app 仓已存在，请更新声明：${rel}`);
      continue;
    }

    const [a, b] = await Promise.all([readFile(join(rootBase, rel), "utf8"), readFile(appPath, "utf8")]);
    const equal = normalize(a) === normalize(b);

    if (equal) {
      identical += 1;
      if (isShared) observed.sharedOk.push(rel);
      else if (declaredReason) observed.declaredCoincides.push(rel);
      else observed.undeclaredIdentical.push(rel);
    } else if (isShared) {
      failures.push(`[${label}] 共用逻辑必须一致，但已漂移：${rel}`);
    } else if (declaredReason) {
      const drifted = [];
      for (const name of mirroredSnippets[rel] ?? []) {
        const left = extractFunction(a, name);
        const right = extractFunction(b, name);
        if (left === null || right === null || normalize(left) !== normalize(right)) drifted.push(name);
      }
      if (drifted.length) failures.push(`[${label}] 平台适配文件里的共用函数已漂移：${rel} → ${drifted.join(", ")}`);
      else observed.declaredDiff.push(`${rel} — ${declaredReason}`);
    } else {
      failures.push(`[${label}] 出现未声明的新漂移，需要人工判定：${rel}`);
    }

    for (const inv of parityInvariants[rel] ?? []) {
      const inRoot = inv.pattern.test(a);
      const inApp = inv.pattern.test(b);
      if (!inRoot || !inApp) {
        failures.push(`[${label}] 高风险行为守卫缺失（${rel} — ${inv.label}；root=${inRoot}, app=${inApp}）`);
      }
    }
  }

  for (const rel of appFiles) {
    if (existsSync(join(rootBase, rel))) continue;
    if (appOnly[rel]) observed.appOnly.push(rel);
    else failures.push(`[${label}] app 仓独有文件未声明：${rel}`);
  }

  // 过期声明检查：所有声明条目都必须在磁盘上处于预期位置。
  for (const rel of shared) {
    if (!existsSync(join(rootBase, rel)) || !existsSync(join(appBase, rel))) {
      failures.push(`[${label}] 声明的共用文件已不存在，请更新 SHARED：${rel}`);
    }
  }
  for (const rel of Object.keys(declared)) {
    if (!existsSync(join(rootBase, rel)) || !existsSync(join(appBase, rel))) {
      failures.push(`[${label}] 声明的平台适配文件已不存在于双侧，请更新 DECLARED：${rel}`);
    }
  }
  for (const rel of Object.keys(rootOnly)) {
    if (!existsSync(join(rootBase, rel))) {
      failures.push(`[${label}] 声明的 root 独有文件已不存在，请更新 ROOT_ONLY：${rel}`);
    }
  }
  for (const rel of Object.keys(appOnly)) {
    if (!existsSync(join(appBase, rel))) {
      failures.push(`[${label}] 声明的 app 独有文件已不存在，请更新 APP_ONLY：${rel}`);
    } else if (existsSync(join(rootBase, rel))) {
      failures.push(`[${label}] 声明为 app 独有但 root 仓也存在，请更新 APP_ONLY：${rel}`);
    }
  }
  for (const rel of [...Object.keys(mirroredSnippets), ...Object.keys(parityInvariants)]) {
    if (!declared[rel]) failures.push(`[${label}] 片段/行为守卫指向了未声明为平台适配的文件：${rel}`);
  }

  return { identical, observed, failures };
}

/** 校验 Drizzle schema.ts 覆盖 database/migrations/*.sql 里的所有有效业务表。 */
async function checkDrizzleSchemaCoverage() {
  const failures = [];
  const migrationFiles = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
  const sqlTables = new Set();
  for (const file of migrationFiles) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi)) {
      const name = match[1];
      if (!IGNORED_MIGRATION_TABLES.has(name)) sqlTables.add(name);
    }
    for (const match of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi)) {
      sqlTables.delete(match[1]);
    }
  }

  const schemaSource = await readFile(DRIZZLE_SCHEMA_FILE, "utf8");
  const schemaTables = new Set();
  for (const match of schemaSource.matchAll(/pgTable\(\s*["']([a-zA-Z0-9_]+)["']/g)) {
    schemaTables.add(match[1]);
  }

  const missing = [...sqlTables].filter((name) => !schemaTables.has(name)).sort();
  const extra = [...schemaTables].filter((name) => !sqlTables.has(name)).sort();
  for (const table of missing) failures.push(`[schema] Drizzle schema.ts 缺少迁移表：${table}`);
  for (const table of extra) failures.push(`[schema] Drizzle schema.ts 声明了迁移中不存在的表：${table}`);

  return { sqlCount: sqlTables.size, schemaCount: schemaTables.size, failures };
}

const backend = await checkPair({
  label: "backend",
  rootBase: ROOT_API,
  appBase: APP_API,
  exts: [".ts"],
  ignore: BACKEND_IGNORE,
  shared: SHARED,
  declared: DECLARED,
  rootOnly: ROOT_ONLY,
  appOnly: APP_ONLY,
  mirroredSnippets: MIRRORED_SNIPPETS,
  parityInvariants: PARITY_INVARIANTS,
});

const frontend = await checkPair({
  label: "frontend",
  rootBase: ROOT_WEB,
  appBase: APP_WEB,
  exts: [".ts", ".tsx", ".css"],
  ignore: WEB_IGNORE,
  shared: WEB_SHARED,
  declared: WEB_DECLARED,
  rootOnly: WEB_ROOT_ONLY,
  appOnly: WEB_APP_ONLY,
});

const schema = await checkDrizzleSchemaCoverage();
const failures = [...backend.failures, ...frontend.failures, ...schema.failures];

const parityCount = Object.values(PARITY_INVARIANTS).reduce((sum, list) => sum + list.length, 0);

console.log(`两仓对齐检查（忽略 import 扩展名差异）`);
console.log(`  [后端 apps/api/src ↔ server/rqsys]`);
console.log(`    逐字一致：${backend.identical} 个模块（含未声明但一致 ${backend.observed.undeclaredIdentical.length} 个）`);
console.log(`    声明的共用逻辑：${backend.observed.sharedOk.length}/${SHARED.length} 一致`);
console.log(`    已声明的平台适配：${backend.observed.declaredDiff.length} 处确有差异，${backend.observed.declaredCoincides.length} 处当前恰好一致`);
console.log(`    高风险行为守卫：${parityCount} 项已校验`);
console.log(`    已声明的 root 独有：${backend.observed.rootOnly.length} 处；app 独有：${backend.observed.appOnly.length} 处`);
console.log(`  [前端 apps/web/src ↔ client/src/rqsys]`);
console.log(`    逐字一致：${frontend.identical} 个文件（含未声明但一致 ${frontend.observed.undeclaredIdentical.length} 个）`);
console.log(`    声明的共用文件：${frontend.observed.sharedOk.length}/${WEB_SHARED.length} 一致`);
console.log(`    已声明的平台适配：${frontend.observed.declaredDiff.length} 处确有差异，${frontend.observed.declaredCoincides.length} 处当前恰好一致`);
console.log(`    已声明的 root 独有：${frontend.observed.rootOnly.length} 处；app 独有：${frontend.observed.appOnly.length} 处`);
console.log(`  [Drizzle Schema 覆盖 database/migrations]`);
console.log(`    迁移业务表：${schema.sqlCount} 张；schema.ts 声明：${schema.schemaCount} 张`);

if (failures.length) {
  console.log(`\n未通过（${failures.length}）：`);
  for (const item of failures) console.log(`  - ${item}`);
  process.exitCode = 1;
} else {
  console.log(`\n全部差异均已分类：后端、前端与 Drizzle Schema 均无未声明漂移。`);
}
