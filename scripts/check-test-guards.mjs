#!/usr/bin/env node
// 测试文件假绿守卫：所有 *.test.ts / *.test.tsx 必须真的注册至少一条用例。
//
// 背景（2026-11-25）：一次写文件错误把 apps/api/src/http/app.test.ts 覆盖成了实现代码，
// 文件里一条 test() 都没有；node --test 把整个文件当成一个"通过"的文件级用例，CI 照样绿。
// 这里在类型检查之后做一次纯静态扫描，文件里没有 test()/it() 注册就直接判红。

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["apps/api/src", "apps/web/src"];
const TEST_FILE = /\.test\.(?:ts|tsx)$/;
// 允许 test.only / it.skip / test.concurrent 之类的修饰；describe 不算注册用例。
const REGISTRATION = /^[ \t]*(?:test|it)(?:\.\w+)?\s*\(/m;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (TEST_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

const files = (await Promise.all(SCAN_DIRS.map((dir) => walk(join(root, dir))))).flat().sort();
const empty = [];
let registrations = 0;
for (const file of files) {
  const source = await readFile(file, "utf8");
  const matches = source.match(new RegExp(REGISTRATION.source, "gm")) ?? [];
  registrations += matches.length;
  if (matches.length === 0) empty.push(relative(root, file));
}

console.log(`测试文件注册检查：${files.length} 个测试文件，${registrations} 处用例注册`);
if (empty.length > 0) {
  console.log(`\n未通过（${empty.length}）：以下测试文件没有注册任何 test()/it()，会被当成一个"通过"的文件级用例：`);
  for (const file of empty) console.log(`  - ${file}`);
  process.exitCode = 1;
} else {
  console.log("通过：每个测试文件都至少注册了一条用例。");
}
