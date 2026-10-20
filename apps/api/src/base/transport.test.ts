import assert from "node:assert/strict";
import test from "node:test";
import { FeishuBitableClient } from "./transport.js";
import { FeishuBasePushAdapter } from "./client.js";
import { RateLimitedBaseClient } from "./rate-limit.js";

const CONFIG = {
  appId: "cli_x", appSecret: "s3cret", appToken: "app-token", tableId: "tbl-1",
  keyFields: { projectId: "TB项目ID", requirementId: "TB需求ID" },
  baseUrl: "https://open.feishu.test",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("source versions use the actual target field type for both numeric production and text POC tables", async () => {
  for (const type of [2, 1, 3]) {
    const writes: Record<string, unknown>[] = [];
    const client = new FeishuBitableClient({ ...CONFIG, fetch: fakeFetch((path, init) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "test-token", expire: 3600 } };
      if (path.includes("/fields?")) return { body: { code: 0, data: { items: [{ field_name: "源版本", type }], has_more: false } } };
      if (init?.method === "PUT") {
        const { fields } = JSON.parse(String(init.body)) as { fields: Record<string, unknown> };
        writes.push(fields);
        return { body: { code: 0, data: { record: { record_id: "rec-existing", fields } } } };
      }
      return { body: { code: 0, data: { items: [{ record_id: "rec-existing", fields: {} }] } } };
    }, []) });
    const adapter = new FeishuBasePushAdapter(new RateLimitedBaseClient(client), {
      projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人", source: {}, ai: {}, pm: [],
      metadata: { sourceVersion: "源版本" },
    });
    const input = { projectId: "p", requirementId: "r", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "synthetic", owner: null, sourceVersion: 3,
      substantiveChanged: false, idempotencyKey: "synthetic-v3" };
    if (type === 3) {
      await assert.rejects(() => adapter.push(input));
      assert.equal(writes.length, 0);
    } else {
      await adapter.push(input);
      assert.equal(writes[0]?.["源版本"], type === 2 ? 3 : "3");
    }
  }
});

test("owner ID type passes through the production adapter and rate limiter", async () => {
  const calls: Array<{ url: URL; method: string; body?: string }> = [];
  const client = new FeishuBitableClient({ ...CONFIG, fetch: async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method ?? "GET", ...(typeof init.body === "string" ? { body: init.body } : {}) });
    if (url.pathname.endsWith("/auth/v3/tenant_access_token/internal")) return jsonResponse({ code: 0, tenant_access_token: "test-token", expire: 3600 });
    if (url.pathname.endsWith("/records") && init.method === "POST") return jsonResponse({ code: 0, data: { record: { record_id: "rec-created", fields: {} } } });
    if (url.pathname.endsWith("/records")) return jsonResponse({ code: 0, data: { items: [], has_more: false } });
    if (url.pathname.endsWith("/records/rec-existing") && init.method === "PUT") return jsonResponse({ code: 0, data: { record: { record_id: "rec-existing", fields: {} } } });
    return jsonResponse({ code: 999, msg: "unexpected" });
  } });
  const adapter = new FeishuBasePushAdapter(new RateLimitedBaseClient(client), {
    projectId: "TB项目ID", requirementId: "TB需求ID", owner: "执行人", source: {}, ai: {}, pm: [],
  });
  await adapter.push({ projectId: "p", requirementId: "new", requirementDbId: "11111111-2222-4333-8444-555555555555", title: "new", owner: { userId: "employee-id", idType: "user_id" }, sourceVersion: 1, substantiveChanged: false, idempotencyKey: "new" });
  const create = calls.find((call) => call.method === "POST" && call.url.pathname.endsWith("/records"));
  assert.equal(create?.url.searchParams.get("user_id_type"), "user_id");
  assert.deepEqual(JSON.parse(create?.body ?? "{}").fields["执行人"], [{ id: "employee-id" }]);
});

test("field schema follows pagination, caches reads, and rejects incomplete or cyclic responses", async () => {
  const calls: string[] = [];
  const client = new FeishuBitableClient({ ...CONFIG, fetch: fakeFetch((path) => {
    if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "test-token", expire: 3600 } };
    if (path.includes("page_token=next")) return { body: { code: 0, data: { items: [{ field_name: "源版本", type: 2 }], has_more: false } } };
    return { body: { code: 0, data: { items: [{ field_name: "标题", type: 1 }], has_more: true, page_token: "next" } } };
  }, calls) });
  assert.equal(await client.readFieldType("源版本"), 2);
  assert.equal(await client.readFieldType("标题"), 1);
  assert.equal(calls.filter(call => call.includes("/fields?")).length, 2);
  await assert.rejects(() => client.readFieldType("missing"));
  for (const data of [undefined, { items: [] }, { items: [], has_more: true, page_token: "repeat" }]) {
    const invalid = new FeishuBitableClient({ ...CONFIG, fetch: fakeFetch(path => path.includes("/tenant_access_token")
      ? { body: { code: 0, tenant_access_token: "test-token", expire: 3600 } }
      : { body: { code: 0, data } }, []) });
    await assert.rejects(() => invalid.readFieldType("源版本"));
  }
});

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

test("findByRequirementKey 使用 Bitable v1 按 TB 需求 ID 精确过滤", async () => {
  const calls: string[] = [];
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: fakeFetch((path) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "t-1", expire: 3600 } };
      if (path.includes("/bitable/v1/apps/app-token/tables/tbl-1/records?")) {
        const url = new URL(`https://x${path}`);
        assert.equal(url.searchParams.get("filter"), 'CurrentValue.[TB需求ID] = "r1"');
        assert.deepEqual(JSON.parse(url.searchParams.get("field_names") ?? "[]"), ["TB需求ID"]);
        assert.equal(url.searchParams.get("page_size"), "2");
        return { body: { code: 0, data: { items: [{ record_id: "rec-1", fields: { TB需求ID: "r1" } }] } } };
      }
      return { body: { code: 0 } };
    }, calls),
  });
  const found = await client.findByRequirementKey({ projectId: "p1", requirementId: "r1" });
  assert.equal(found?.recordId, "rec-1");
  assert.deepEqual(found?.fields, { TB需求ID: "r1" });
  assert.ok(calls.some((c) => c.startsWith("GET /open-apis/bitable/v1/apps/app-token/tables/tbl-1/records?")));
  assert.equal(calls.some((c) => c.startsWith("GET /open-apis/base/v3/")), false);
});

test("TB 需求 ID 无命中返回 null", async () => {
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: fakeFetch((path) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "t-1", expire: 3600 } };
      if (path.includes("/bitable/v1/apps/app-token/tables/tbl-1/records?")) return { body: { code: 0, data: { items: [] } } };
      return { body: { code: 0 } };
    }, []),
  });
  assert.equal(await client.findByRequirementKey({ projectId: "p", requirementId: "none" }), null);
});

test("重复 TB 需求 ID 拒绝任意选择记录", async () => {
  const client = new FeishuBitableClient({
    ...CONFIG,
    fetch: fakeFetch((path) => {
      if (path.includes("/tenant_access_token")) return { body: { code: 0, tenant_access_token: "t-1", expire: 3600 } };
      if (path.includes("/bitable/v1/apps/app-token/tables/tbl-1/records?")) {
        return { body: { code: 0, data: { items: [{ record_id: "rec-1" }, { record_id: "rec-2" }] } } };
      }
      return { body: { code: 0 } };
    }, []),
  });
  await assert.rejects(
    () => client.findByRequirementKey({ projectId: "p", requirementId: "r" }),
    /multiple records for the configured requirement key/,
  );
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
