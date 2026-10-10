import assert from "node:assert/strict";
import test from "node:test";
import { FeishuUserDirectoryClient, type FetchLike } from "./directory-client.js";

test("searches Feishu users with a cached tenant token and returns only selectable identity fields", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: FetchLike = async (input, init) => {
    const url = String(input); calls.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.endsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "tenant-token", expire: 3600 });
    }
    return Response.json({ code: 0, data: { items: [
      { open_id: "ou_1", name: "张三", en_name: "San Zhang", email: "private@example.com", is_cross_tenant: false },
      { open_id: "ou_guest", name: "外部人员", is_cross_tenant: true },
      { open_id: "ou_unknown", name: "租户标记缺失" },
      { name: "Malformed result" },
    ] } });
  };
  const client = new FeishuUserDirectoryClient({ appId: "app", appSecret: "secret", fetch: fetcher });

  assert.deepEqual(await client.search("张三"), [{ openId: "ou_1", name: "张三", enName: "San Zhang" }]);
  assert.deepEqual(await client.search(" 张三 "), [{ openId: "ou_1", name: "张三", enName: "San Zhang" }]);
  assert.equal(calls.filter((call) => call.url.endsWith("/tenant_access_token/internal")).length, 1);
  const request = calls.find((call) => call.url.includes("/contact/v3/users/search"))!;
  assert.match(request.url, /user_id_type=open_id/);
  assert.equal(request.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init?.body)), { query: "张三", page_size: 20 });
  assert.equal(new Headers(request.init?.headers).get("authorization"), "Bearer tenant-token");
});

test("rejects a failed Feishu directory response without exposing response content", async () => {
  const fetcher: FetchLike = async (input) => String(input).endsWith("/tenant_access_token/internal")
    ? Response.json({ code: 0, tenant_access_token: "tenant-token", expire: 3600 })
    : Response.json({ code: 99991663, msg: "private permission details", secret: "do-not-leak" });
  const client = new FeishuUserDirectoryClient({ appId: "app", appSecret: "secret", fetch: fetcher });
  await assert.rejects(client.search("张三"), (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal((error as Error).message.includes("private"), false);
    assert.equal((error as Error).message.includes("secret"), false);
    return true;
  });
});
