import assert from "node:assert/strict";
import test from "node:test";
import { FeishuUserDirectoryClient, type FetchLike } from "./directory-client.js";

test("uses the documented user-authenticated GET search and users response", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher: FetchLike = async (input, init) => {
    calls.push({ url: new URL(String(input)), ...(init ? { init } : {}) });
    return Response.json({ code: 0, data: { users: [
      { open_id: "ou_1", name: "张三", email: "private@example.com" },
      { name: "Malformed result" },
    ] } });
  };
  const client = new FeishuUserDirectoryClient({ userAccessToken: async () => "user-token", fetch: fetcher });
  assert.deepEqual(await client.search(" 张三 "), [{ openId: "ou_1", name: "张三" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.pathname, "/open-apis/search/v1/user");
  assert.equal(calls[0]!.url.searchParams.get("query"), "张三");
  assert.equal(calls[0]!.url.searchParams.get("page_size"), "20");
  assert.equal(calls[0]!.init?.method, "GET");
  assert.equal(calls[0]!.init?.body, undefined);
  assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), "Bearer user-token");
});

test("rejects expired credentials without retaining provider messages", async () => {
  const client = new FeishuUserDirectoryClient({ userAccessToken: async () => "user-token", fetch: async () =>
    Response.json({ code: 99991677, msg: "private token=should-not-leak" }, { status: 401 }) });
  await assert.rejects(client.search("张三"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes("should-not-leak"), false);
    return true;
  });
});
