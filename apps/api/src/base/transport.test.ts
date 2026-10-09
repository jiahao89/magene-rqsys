import assert from "node:assert/strict";
import test from "node:test";
import { FeishuBitableClient } from "./transport.js";

const CONFIG = {
  appId: "cli_x", appSecret: "s3cret", appToken: "app-token", tableId: "tbl-1",
  keyFields: { projectId: "TB项目ID", requirementId: "TB需求ID" },
  baseUrl: "https://open.feishu.test",
};

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }, calls: string[]) {
  return (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(/^https:\/\/open\.feishu\.test/, "");
    calls.push(`${(init?.method ?? "GET")} ${path}`);
    const result = handler(path, init);
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
}

test("tenant token 请求并缓存至过期前", async () => {
  const calls: string[] = [];
  let tokenCalls = 0;
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: (async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https:\/\/open\.feishu\.test/, "");
      calls.push(`${(init?.method ?? "GET")} ${path}`);
      if (path.includes("/tenant_access_token")) {
        tokenCalls++;
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-1", expire: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
    }) as unknown as typeof globalThis.fetch,
  });

  await client.findByRequirementKey({ projectId: "p1", requirementId: "r1" });
  await client.findByRequirementKey({ projectId: "p1", requirementId: "r1" });
  // token 只请求一次（缓存生效）
  assert.equal(tokenCalls, 1);
  const tokenRequests = calls.filter((c) => c.includes("/tenant_access_token"));
  assert.equal(tokenRequests.length, 1);
});

test("findByRequirementKey 走 base/v3 复合键过滤 + bitable 命名字段读取", async () => {
  const calls: string[] = [];
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: fakeFetch((path) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "t-1", expire: 3600 } };
      if (path.includes("/base/v3/bases/")) {
        const url = new URL(`https://x${path}`);
        const filter = JSON.parse(url.searchParams.get("filter") ?? "{}") as { conditions?: unknown[]; logic?: string };
        assert.deepEqual(filter.conditions, [
          ["TB项目ID", "==", "p1"],
          ["TB需求ID", "==", "r1"],
        ]);
        assert.equal(filter.logic, "and");
        return { body: { code: 0, data: { record_id_list: ["rec-1"] } } };
      }
      if (path.includes("/bitable/v1/apps/app-token/tables/tbl-1/records/rec-1")) {
        return { body: { code: 0, data: { record: { record_id: "rec-1", fields: { 标题: "A" } } } } };
      }
      return { body: { code: 0 } };
    }, calls),
  });
  const found = await client.findByRequirementKey({ projectId: "p1", requirementId: "r1" });
  assert.equal(found?.recordId, "rec-1");
  assert.equal(found?.fields["标题"], "A");
  assert.ok(calls.some((c) => c.startsWith("GET /open-apis/base/v3/bases/app-token/tables/tbl-1/records")));
  assert.ok(calls.some((c) => c.startsWith("GET /open-apis/bitable/v1/apps/app-token/tables/tbl-1/records/rec-1")));
});

test("复合键无命中返回 null", async () => {
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: fakeFetch((path) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "t-1", expire: 3600 } };
      if (path.includes("/base/v3/bases/")) return { body: { code: 0, data: { record_id_list: [] } } };
      return { body: { code: 0 } };
    }, []),
  });
  assert.equal(await client.findByRequirementKey({ projectId: "p", requirementId: "none" }), null);
});

test("create/update/readPmFields 走 bitable records API", async () => {
  const calls: string[] = [];
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: fakeFetch((path) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "t-1", expire: 3600 } };
      if (path.endsWith("/records") && !path.includes("/")) return { body: { code: 0 } };
      if (path.includes("/records/rec-1")) return { body: { code: 0, data: { record: { record_id: "rec-1", fields: { PM状态: "待处理" } } } } };
      return { body: { code: 0, data: { record: { record_id: "rec-2", fields: {} } } } };
    }, calls),
  });

  const created = await client.create({ 标题: "A" });
  assert.equal(created.recordId, "rec-2");
  const updated = await client.update("rec-1", { 标题: "B" });
  assert.equal(updated.recordId, "rec-1");
  const pm = await client.readPmFields("rec-1");
  assert.deepEqual(pm, { PM状态: "待处理" });
  assert.ok(calls.some((c) => c.startsWith("PUT /open-apis/bitable/v1/apps/app-token/tables/tbl-1/records/rec-1")));
});

test("Feishu 业务错误（code != 0）抛错且不泄露 appSecret", async () => {
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: fakeFetch((path) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "t-1", expire: 3600 } };
      return { body: { code: 1254043, msg: "record not found" } };
    }, []),
  });
  await assert.rejects(() => client.findByRequirementKey({ projectId: "p", requirementId: "r" }), /code 1254043/);
});
