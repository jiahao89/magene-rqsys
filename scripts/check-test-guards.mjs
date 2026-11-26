#!/usr/bin/env node
// 测试文件假绿守卫：所有测试文件必须真的注册至少一条用例。
//
// 背景（2026-11-25）：一次写文件错误把 apps/api/src/http/app.test.ts 覆盖成了实现代码，
// 文件里一条 test() 都没有；node --test 把整个文件当成一个"通过"的文件级用例，CI 照样绿。
// 这里在类型检查之后做一次纯静态扫描，文件里没有 test()/it() 注册就直接判红。
// 当 rq-sys-miaoda/ 存在时，一并扫描 rq-sys-miaoda/scripts/rqsys-*.test.{cjs,mjs}。

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_TARGETS = [
  { dir: "apps/api/src", pattern: /\.test\.(?:ts|tsx)$/, recursive: true, optional: false },
  { dir: "apps/web/src", pattern: /\.test\.(?:ts|tsx)$/, recursive: true, optional: false },
  { dir: "rq-sys-miaoda/scripts", pattern: /^rqsys-.*\.test\.(?:cjs|mjs)$/, recursive: false, optional: true },
];
// 允许 test.only / it.skip / test.concurrent 之类的修饰；describe 不算注册用例。
const REGISTRATION = /^[ \t]*(?:test|it)(?:\.\w+)?\s*\(/m;

async function collect(dir, pattern, recursive) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...(await collect(full, pattern, recursive)));
    } else if (pattern.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
let miaodaScanned = false;
for (const target of SCAN_TARGETS) {
  const absDir = join(root, target.dir);
  if (!existsSync(absDir)) {
    if (target.optional) continue;
    throw new Error(`缺少必需扫描目录：${target.dir}`);
  }
  if (target.dir.startsWith("rq-sys-miaoda/")) miaodaScanned = true;
  files.push(...(await collect(absDir, target.pattern, target.recursive)));
}
files.sort();

const empty = [];
let registrations = 0;
for (const file of files) {
  const source = await readFile(file, "utf8");
  const matches = source.match(new RegExp(REGISTRATION.source, "gm")) ?? [];
  registrations += matches.length;
  if (matches.length === 0) empty.push(relative(root, file));
}

console.log(`测试文件注册检查：${files.length} 个测试文件，${registrations} 处用例注册${miaodaScanned ? "（含 rq-sys-miaoda/scripts）" : "（未检出 rq-sys-miaoda）"}`);
if (empty.length > 0) {
  console.log(`\n未通过（${empty.length}）：以下测试文件没有注册任何 test()/it()，会被当成一个"通过"的文件级用例：`);
  for (const file of empty) console.log(`  - ${file}`);
  process.exitCode = 1;
} else {
  console.log("通过：每个测试文件都至少注册了一条用例。");
}
