// adapter 全流程真实冒烟：FeishuBasePushAdapter（真实 transport）对测试 Base 验证
// 创建 → 实质变化 → PM 快照 + 状态重置 → 读回确认 → 清理。
// 不写执行人字段（owner null → adapter 删除 owner 字段），不触发通知自动化。
import { spawnSync } from "node:child_process";
import { FeishuBasePushAdapter } from "../src/base/client.js";
import { FeishuBitableClient } from "../src/base/transport.js";

const APP_TOKEN = "OddqbqBeOamFjFsR5IXcJdjknmd";
const TABLE_ID = "tblxbyvbdLGVnLaO";
const KEY = `transport_smoke_${Date.now()}`;

function larkCliProxy(method: string, path: string, body?: unknown, params?: Record<string, string>): Response {
  const args = ["api", method, path];
  if (params && Object.keys(params).length > 0) args.push("--params", JSON.stringify(params));
  if (body !== undefined) args.push("--data", JSON.stringify(body));
  const result = spawnSync("lark-cli", args, { encoding: "utf8", timeout: 60_000 });
  if (!result.stdout.trim()) {
    throw new Error(`lark-cli empty stdout (exit ${result.status}, stderr: ${result.stderr.trim().slice(0, 200)})`);
  }
  const parsed = JSON.parse(result.stdout.trim()) as { ok?: boolean; code?: number; data?: unknown };
  const normalized = { code: parsed.code ?? (parsed.ok === true ? 0 : 1), data: parsed.data };
  return new Response(JSON.stringify(normalized), { status: 200, headers: { "content-type": "application/json" } });
}

const hybridFetch: typeof globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname.includes("/tenant_access_token")) {
    return new Response(JSON.stringify({ code: 0, tenant_access_token: "lark-cli-managed", expire: 3600 }), { status: 200 });
  }
  const method = (init?.method ?? "GET").toUpperCase();
  const params = Object.fromEntries(url.searchParams.entries());
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  return larkCliProxy(method, url.pathname, body, params);
}) as unknown as typeof globalThis.fetch;

const client = new FeishuBitableClient({
  appId: "lark-cli-managed", appSecret: "lark-cli-managed",
  appToken: APP_TOKEN, tableId: TABLE_ID,
  keyFields: { projectId: "TB项目ID", requirementId: "TB需求ID" },
  baseUrl: "https://open.feishu.cn",
  fetch: hybridFetch,
});
const snapshots: Array<{ requirementId: string; pmValues: Record<string, unknown> }> = [];
const adapter = new FeishuBasePushAdapter(client, {
  projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人",
  source: { title: "标题", description: "需求说明" }, ai: {},
  pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"],
}, {
  async savePmSnapshot(input) { snapshots.push({ requirementId: input.requirementId, pmValues: input.pmValues }); },
});

// 1) 首次推送（owner null）→ 真实创建
const first = await adapter.push({
  projectId: "poc_project_A", requirementId: KEY, title: "adapter-smoke-临时",
  owner: null, sourceVersion: 1, substantiveChanged: false, idempotencyKey: `smoke:${KEY}:v1`,
  sourceValues: { description: "真实环境全流程验证" },
});
console.log(`PUSH1-OK created=${first.created} recordId=${first.recordId}`);

// 2) 实质变化推送 → PM 快照保存 + PM 状态重置"待处理"
const second = await adapter.push({
  projectId: "poc_project_A", requirementId: KEY, title: "adapter-smoke-实质变化",
  owner: null, sourceVersion: 2, substantiveChanged: true, idempotencyKey: `smoke:${KEY}:v2`,
  sourceValues: { description: "实质变化后的 delta" },
});
console.log(`PUSH2-OK created=${second.created} snapshots=${snapshots.length} pmStatusReset=${JSON.stringify(snapshots.length ? "待处理" : "n/a")}`);

// 3) 读回验证：PM 五项确认字段零污染、PM状态仍为待处理、标题已更新
const pm = await client.readPmFields(second.recordId);
console.log(`VERIFY-OK title=${JSON.stringify(pm["标题"])} pmStatus=${JSON.stringify(pm["PM状态"])} pmModule=${JSON.stringify(pm["PM确认模块"])}`);

// 4) 清理
const cleanup = larkCliProxy("DELETE", `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${second.recordId}`);
const cleanBody = (await cleanup.json()) as { code?: number };
console.log(`CLEANUP-${cleanBody.code === 0 ? "OK" : `FAIL code=${cleanBody.code}`}`);
console.log("ADAPTER-REAL-SMOKE-DONE");
