#!/usr/bin/env node
// 迁移文件名检查（R-16）。
//
// 规则来自 AGENTS.md「Keep migrations additive … never rewrite an already applied migration」：
// 已应用的迁移文件名不能改名，所以历史上已经共享前缀的 0002_* 只能白名单保留；
// 之后新增的重复前缀直接失败，避免“看起来有顺序、实际靠文件名排序”的隐患。
//
// 退出码：0 = 通过；1 = 出现未白名单的重复前缀，或白名单与仓库现状不一致。

import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = resolve(rootDir, "database/migrations");

// 已上线、不能改名的重复前缀。条目必须与磁盘上的文件完全一致，否则视为白名单过期。
const APPLIED_DUPLICATE_PREFIXES = new Map([
  ["0002", ["0002_person_mapping_idempotency.sql", "0002_single_source_config.sql"]],
]);

const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const byPrefix = new Map();
for (const file of files) {
  const prefix = file.match(/^(\d+)_/)?.[1];
  if (!prefix) continue;
  byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
}

const failures = [];
const duplicates = [...byPrefix.entries()].filter(([, names]) => names.length > 1);

for (const [prefix, names] of duplicates) {
  const allowed = APPLIED_DUPLICATE_PREFIXES.get(prefix);
  if (!allowed) {
    failures.push(`新增重复迁移前缀 ${prefix}：${names.join(", ")}。请给新迁移使用下一个空号，并保持已应用文件不改名。`);
    continue;
  }
  const same = allowed.length === names.length && allowed.every((name, index) => name === names[index]);
  if (!same) failures.push(`白名单 ${prefix} 与仓库现状不一致：期望 ${allowed.join(", ")}，实际 ${names.join(", ")}。`);
}

for (const [prefix, allowed] of APPLIED_DUPLICATE_PREFIXES) {
  const actual = byPrefix.get(prefix) ?? [];
  if (!actual.length) failures.push(`白名单 ${prefix} 已不存在：相关迁移是否被改名或删除？已应用迁移不允许改名。`);
  else {
    const unexpected = actual.filter((name) => !allowed.includes(name));
    if (unexpected.length) failures.push(`白名单前缀 ${prefix} 出现未登记文件：${unexpected.join(", ")}。`);
  }
}

// 顺序提示：前缀缺口只告警，不阻断（缺号可能来自被合并/取消的迁移）。
const numbers = [...byPrefix.keys()].map(Number).sort((left, right) => left - right);
const gaps = [];
for (let index = 1; index < numbers.length; index += 1) {
  if (numbers[index] !== numbers[index - 1] + 1) gaps.push(`${String(numbers[index - 1]).padStart(4, "0")} → ${String(numbers[index]).padStart(4, "0")}`);
}

console.log("迁移文件名检查（database/migrations）");
console.log(`  迁移文件：${files.length} 个；前缀：${numbers.length} 个；最大前缀 ${String(numbers.at(-1) ?? 0).padStart(4, "0")}`);
console.log(`  已白名单的重复前缀：${duplicates.filter(([prefix]) => APPLIED_DUPLICATE_PREFIXES.has(prefix)).map(([prefix, names]) => `${prefix}（${names.length} 个文件）`).join("、") || "无"}`);
for (const [prefix, names] of duplicates.filter(([prefix]) => !APPLIED_DUPLICATE_PREFIXES.has(prefix))) {
  console.log(`  未白名单的重复前缀：${prefix} → ${names.join(", ")}`);
}
if (gaps.length) console.log(`  警告：前缀存在缺口（仅提示，不阻断）：${gaps.join("、")}`);

if (failures.length) {
  console.log(`\n未通过（${failures.length}）：`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\n通过：没有新增重复迁移前缀。");
}
