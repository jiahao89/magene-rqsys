#!/usr/bin/env node
// API 用例运行器：跑全部测试并额外守住"用例条数下限"。
//
// 背景（2026-11-25）：一个测试文件被覆盖成实现代码后，整个文件被 node --test 当成一个
// 通过的用例，CI 全绿但 88 条 HTTP 用例实际没跑。除了静态注册检查，这里再加一道运行时门槛：
// 用例总数低于 MIN_TESTS 直接判红，防止整段用例被静默吞掉（例如批量删除/合并文件）。
//
// 行为：正常输出原始测试报告；测试失败仍按原退出码失败；只有"条数不足"时额外报错。

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(root, "apps/api");
// 当前 778 条（2026-11-25）。留 8 条余量，避免正常增删用例就要改门槛。
const MIN_TESTS = 770;

const child = spawn(process.execPath, ["--import=tsx", "--test", "src/**/*.test.ts"], {
  cwd: apiDir,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));

// 先把子进程输出完整刷出去，再判断结果：管道是异步写，直接 process.exit 会把日志从中间截断。
await new Promise((flushed) => process.stdout.write(output, flushed));
// 本机（spec reporter）打印 `ℹ tests N`，CI（TAP reporter）打印 `# tests N`，两种都要认。
const summary = output.match(/^[ \t]*(?:#|ℹ)[ \t]*tests[ \t]+(\d+)[ \t]*$/m);
process.exitCode = exitCode ?? 1;
if (!summary) {
  console.error("\n未找到用例总数（测试进程可能在收集阶段就退出了）；按失败处理。");
  process.exitCode = 1;
} else {
  const tests = Number(summary[1]);
  if (tests < MIN_TESTS) {
    console.error(`\nAPI 用例数低于下限：${tests} < ${MIN_TESTS}。整段用例可能被静默吞掉，请检查测试文件是否被误覆盖或删除。`);
    process.exitCode = 1;
  } else {
    console.log(`\n用例数下限通过：${tests} ≥ ${MIN_TESTS}`);
  }
}
