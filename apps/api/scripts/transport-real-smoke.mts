// transport 真实环境冒烟：lark-cli 代理 fetch（托管凭证）驱动 FeishuBitableClient
// 对 Ticket 02 测试 Base 执行真实 API 调用，验证 URL 路径/过滤构造/响应解析/错误处理。
// 边界：tenant token 环节走本地假实现（真实凭证注入属工单 00/W7）；
// 写段不写执行人字段（不触发通知自动化）；目标为可删除的测试 Base。
import { spawnSync } from "node:child_process";
import { FeishuBitableClient } from "../src/base/transport.js";

const APP_TOKEN = "OddqbqBeOamFjFsR5IXcJdjknmd";
const TABLE_ID = "tblxbyvbdLGVnLaO";

function larkCliProxy(method: string, path: string, body?: unknown, params?: Record<string, string>): Response {
  const args = ["api", method, path];
  if (params && Object.keys(params).length > 0) args.push("--params", JSON.stringify(params));
  if (body !== undefined) args.push("--data", JSON.stringify(body));
  const result = spawnSync("lark-cli", args, { encoding: "utf8", timeout: 60_000 });
  if (!result.stdout.trim()) {
    throw new Error(`lark-cli empty stdout (exit ${result.status}, stderr: ${result.stderr.trim().slice(0, 200)})`);
  }
  const parsed = JSON.parse(result.stdout.trim()) as { ok?: boolean; code?: number; data?: unknown; msg?: string };
  // 归一化：lark-cli 信封 {ok, identity, data} → 原生 {code, data}
  const normalized = { code: parsed.code ?? (parsed.ok === true ? 0 : 1), msg: parsed.msg, data: parsed.data };
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

const mode = process.argv[2] ?? "read";

if (mode === "read" || mode === "all") {
  // 1) 真实复合键搜索（Ticket 02 POC 测试记录）
  const found = await client.findByRequirementKey({ projectId: "poc_project_A", requirementId: "poc_req_0001" });
  if (!found) throw new Error("SEARCH-FAIL: record not found");
  console.log(`SEARCH-OK recordId=${found.recordId}`);

  // 2) 真实 PM 字段读取
  const pm = await client.readPmFields(found.recordId);
  console.log(`PM-READ-OK status=${JSON.stringify(pm["PM状态"])} module=${JSON.stringify(pm["PM确认模块"])} priority=${JSON.stringify(pm["PM确认优先级"])}`);
}

if (mode === "write" || mode === "all") {
  // 3) 真实创建（不写执行人 → 不触发通知自动化）
  const created = await client.create({ 标题: "transport-smoke-临时", TB需求ID: "transport_smoke_0001", TB项目ID: "poc_project_A" });
  console.log(`CREATE-OK recordId=${created.recordId}`);
  // 4) 真实 delta 更新
  const updated = await client.update(created.recordId, { 标题: "transport-smoke-临时-已更新" });
  console.log(`UPDATE-OK recordId=${updated.recordId}`);
  // 5) 清理临时记录
  const cleanup = larkCliProxy("DELETE", `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${created.recordId}`);
  const cleanBody = (await cleanup.json()) as { code?: number };
  console.log(`CLEANUP-${cleanBody.code === 0 ? "OK" : `FAIL code=${cleanBody.code}`}`);
}

console.log("TRANSPORT-REAL-SMOKE-DONE");
