#!/usr/bin/env node
// ARCO-12 防回归检查：源码里用到的 Arco 组件必须登记在对应客户端 arco-styles.ts 的按需样式列表中，
// 否则运行时该组件没有样式（Arco 2.x 按需引入要求 style/css.js 与组件一一对应）。
// 用法：node scripts/check-arco-styles.mjs（CI 可加 --strict 把“未使用的样式导入”也算失败）
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const targets = [
  { name: "apps/web", source: "apps/web/src", styles: "apps/web/src/arco-styles.ts" },
  { name: "miaoda client", source: "rq-sys-miaoda/client/src", styles: "rq-sys-miaoda/client/src/rqsys/arco-styles.ts" },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

function readStyleComponents(path) {
  const text = readFileSync(join(root, path), "utf8");
  const names = new Set();
  for (const match of text.matchAll(/es\/([\w/]+)\/style\/css\.js/g)) names.add(match[1].split("/")[0]);
  return names;
}

function usedComponents(files) {
  const used = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@arco-design\/web-react["']/g)) {
      for (const raw of match[1].split(",")) {
        const name = raw.trim().replace(/\s+as\s+.*$/, "").trim();
        if (!name || name === "type") continue;
        if (!used.has(name)) used.set(name, []);
        const list = used.get(name);
        const rel = relative(root, file);
        if (!list.includes(rel)) list.push(rel);
      }
    }
  }
  return used;
}

const strict = process.argv.includes("--strict");
let failed = false;
for (const target of targets) {
  const files = walk(join(root, target.source));
  const used = usedComponents(files);
  const styled = readStyleComponents(target.styles);
  // 少数组件（如 ConfigProvider）没有独立样式文件，用包内路径存在性判定，避免误报。
  const hasStyleFile = (name) => existsSync(join(root, "node_modules/@arco-design/web-react/es", name, "style/css.js"));
  const missing = [...used.keys()].filter((name) => !styled.has(name) && hasStyleFile(name)).sort();
  const unused = [...styled].filter((name) => !used.has(name)).sort();
  console.log(`\n[${target.name}] 使用 ${used.size} 个 Arco 组件，登记 ${styled.size} 个样式`);
  if (used.size === 0) continue;
  if (missing.length > 0) {
    failed = true;
    console.error(`  ✗ 缺少按需样式（会把组件名加到 ${target.styles}）：${missing.join(", ")}`);
    for (const name of missing) console.error(`      ${name} ← ${used.get(name).join(", ")}`);
  } else {
    console.log("  ✓ 所有使用中的 Arco 组件都已登记样式");
  }
  const realUnused = unused.filter((name) => name !== "style"); // style/index.css 是基础 token，不算组件
  if (realUnused.length > 0) {
    const line = `  ! 已登记但未被引用的样式（可删除）：${realUnused.join(", ")}`;
    if (strict) { failed = true; console.error(line); } else console.warn(line);
  }
}
if (failed) {
  console.error("\ncheck:arco-styles 失败：请补齐 arco-styles.ts 的按需样式导入，或移除未使用组件。");
  process.exit(1);
}
console.log("\ncheck:arco-styles 通过。");
