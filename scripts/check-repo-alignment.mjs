#!/usr/bin/env node
// 两仓对齐检查：root 的 apps/api/src 与 app 仓的 server/rqsys 必须保持行为对齐。
//
// 用法：node scripts/check-repo-alignment.mjs
// 退出码：0 = 所有模块已分类；1 = 出现未分类的新漂移（需要人工判定）。
//
// 背景：两仓共用同一套 RQ-Sys 模块，但构建系统不同（root 用 tsc+Esm 扩展名，app 用 NestJS/SWC
// 无扩展名），平台适配层也不同（pg vs Drizzle、本地身份 vs 妙搭 userContext）。因此"完全一致"
// 不是正确目标——正确目标是：每一处差异要么是已声明的平台适配，要么是共用逻辑（必须一致）。

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_API = join(rootDir, "apps/api/src");
const APP_API = join(rootDir, "rq-sys-miaoda/server/rqsys");

// 共用逻辑：必须逐字一致（忽略 import 扩展名差异）。
const SHARED = [
  "base/client.ts",
  "base/push-service.ts",
  "base/transport.ts",
  "analysis/context.ts",
  "analysis/contract.ts",
  "analysis/priority-rule.ts",
  "analysis/provider.ts",
  "analysis/service.ts",
  "owner/mapping.ts",
  "retry/policy.ts",
  "scheduler/due.ts",
  "scheduler/due-jobs.ts",
  "scheduler/analysis-recovery.ts",
  "scheduler/owner-recheck.ts",
  "sync/hashes.ts",
  "sync/test-fixture.ts",
  "jobs/claim.ts",
  "jobs/deferred.ts",
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
];

// 平台适配：允许不同，但必须在 DECLARED 里给出理由，避免"漂移了却没人知道"。
const DECLARED = {
  "adapters/postgres/pool.ts": "root 自建 pg Pool；app 复用妙搭注入的 Drizzle 连接",
  "adapters/postgres/repositories.ts": "驱动差异：pg 参数化查询 vs Drizzle 查询构建",
  "adapters/postgres/analysis-run-repository.ts": "驱动差异",
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
  "server.ts": "root 为独立 node:http 入口；app 仓为 NestJS 模块",
  "sync/service.ts": "app 仓同步编排接线不同",
};

// root 独有：平台中立侧的专属实现，app 仓由妙搭提供等价能力。
const ROOT_ONLY = {
  "application/batch-cursor.ts": "root 游标编解码；app 仓内联等价实现",
  "application/idempotency-keys.ts": "root 幂等键工具；app 仓有自身实现",
  "db/migrate.ts": "root 自带迁移 runner；妙搭托管库用平台迁移",
  "db/migration-sql.ts": "root 迁移 runner 的事务包装剥离；app 仓没有 SQL 迁移 runner",
  "http/local-identity.ts": "本地开发身份 seam；目标环境用妙搭 userContext，故 app 仓不应有",
};

// app 独有：妙搭运行时的专属实现，root 侧没有对应物。新增 app 独有文件必须在此声明，
// 否则脚本报错——2026-10-24 审查发现单向遍历放过妙搭侧真实漂移（audit 白名单、分析守卫等）。
const APP_ONLY = {
  "adapters/feishu/identity.ts": "妙搭可信身份适配（userContext 注入），root 用本地身份 seam",
  "adapters/postgres/drizzle-pool.ts": "妙搭 Drizzle 传输层（$N 参数拆分语义），root 用 pg",
  "adapters/postgres/team-directory-repository.ts": "妙搭团队目录仓储接线，root 内联于 repositories",
  "jobs/drain.ts": "妙搭请求内 drain 编排，root 由轮询 worker 驱动",
  "runtime.ts": "妙达应用装配入口，root 对应 server.ts（已在 DECLARED）",
};

const IGNORE = /\.test\.ts$/;

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.name.endsWith(".ts") && !IGNORE.test(entry.name)) out.push(relative(base, full));
  }
  return out;
}

/** app 仓用无扩展名 import；归一化后再比较，避免把构建差异误判为行为漂移。 */
function normalize(source) {
  return source.replace(/from "(\.[^"]*?)\.js"/g, 'from "$1"');
}

const rootFiles = (await walk(ROOT_API)).sort();
const appFiles = (await walk(APP_API)).sort();
const failures = [];
let identical = 0;
const observed = { declared: [], rootOnly: [], sharedOk: [], adapterCoincides: [] };

for (const rel of rootFiles) {
  const appPath = join(APP_API, rel);
  const declaredReason = DECLARED[rel];
  const rootOnlyReason = ROOT_ONLY[rel];
  const isShared = SHARED.includes(rel);

  if (!existsSync(appPath)) {
    if (rootOnlyReason) observed.rootOnly.push(rel);
    else failures.push(`app 仓缺少模块且未声明为 root 独有：${rel}`);
    continue;
  }

  const [a, b] = await Promise.all([readFile(join(ROOT_API, rel), "utf8"), readFile(appPath, "utf8")]);
  const equal = normalize(a) === normalize(b);

  if (equal) {
    identical += 1;
    if (isShared) observed.sharedOk.push(rel);
    else observed.adapterCoincides.push(rel);
    continue;
  }
  if (isShared) failures.push(`共用逻辑必须一致，但已漂移：${rel}`);
  else if (declaredReason) observed.declared.push(`${rel} — ${declaredReason}`);
  else failures.push(`出现未声明的新漂移，需要人工判定：${rel}`);
}

const missingShared = SHARED.filter((rel) => !observed.sharedOk.includes(rel));
if (missingShared.length) failures.push(`声明的共用模块未能确认一致：${missingShared.join(", ")}`);

// 反向遍历：app 独有文件必须声明。此前只走 root 侧，妙搭新增/漂移的独有文件无人核对。
let appOnlyCount = 0;
for (const rel of appFiles) {
  if (existsSync(join(ROOT_API, rel))) continue; // 双侧都有，已在正向遍历处理
  const reason = APP_ONLY[rel];
  if (reason) { appOnlyCount += 1; continue; }
  failures.push(`app 仓独有模块未声明：${rel}`);
}
for (const [rel] of Object.entries(APP_ONLY)) {
  if (!existsSync(join(APP_API, rel))) failures.push(`声明的 app 独有模块已不存在，请更新声明：${rel}`);
}

console.log(`两仓对齐检查（忽略 import 扩展名差异）`);
console.log(`  逐字一致：${identical} 个模块`);
console.log(`  声明的共用逻辑：${observed.sharedOk.length}/${SHARED.length} 一致`);
console.log(`  已声明的平台适配：${observed.declared.length} 处确有差异，${observed.adapterCoincides.length} 处当前恰好一致`);
console.log(`  已声明的 root 独有：${observed.rootOnly.length} 处`);
console.log(`  已声明的 app 独有：${appOnlyCount} 处`);
if (failures.length) {
  console.log(`\n未通过（${failures.length}）：`);
  for (const item of failures) console.log(`  - ${item}`);
  process.exitCode = 1;
} else {
  console.log(`\n全部差异均已分类：无未声明的行为漂移。`);
}
