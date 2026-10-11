import test from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_USER_ID_HEADER,
  createLocalIdentityProvider,
  describeLocalIdentity,
} from "./local-identity.js";

function request(url = "http://127.0.0.1:8787/api/sources", headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

test("defaults to disabled so the server stays fail-closed", () => {
  assert.equal(createLocalIdentityProvider({}), undefined);
  assert.equal(createLocalIdentityProvider({ userId: "" }), undefined);
  assert.equal(createLocalIdentityProvider({ userId: "   " }), undefined);
});

test("never activates in production, regardless of configuration", () => {
  assert.equal(createLocalIdentityProvider({ userId: "dev-user", nodeEnv: "production" }), undefined);
  assert.equal(describeLocalIdentity("dev-user", "production"), null);
});

test("accepts the platform contract header on loopback when explicitly enabled", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  const actor = await provider.requireActor(request("http://127.0.0.1:8787/api/sources", {
    [PLATFORM_USER_ID_HEADER]: "local-operator",
  }));
  assert.deepEqual(actor, { id: "local-operator" });
});

test("still requires the identity header rather than trusting the environment alone", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  await assert.rejects(
    () => provider.requireActor(request()),
    /identity header is missing/,
  );
});

test("rejects non-loopback requests so the seam cannot be reached remotely", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  for (const url of ["http://10.0.0.5:8787/api/sources", "http://example.com/api/sources", "http://192.168.1.9:8787/api/sources"]) {
    await assert.rejects(() => provider.requireActor(request(url, { [PLATFORM_USER_ID_HEADER]: "x" })), /loopback/);
  }
});

test("rejects control characters and over-long identities", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  // 运行时通常不允许构造含控制字符的 header，因此这里用最小 stub 直接验证 provider 自己的校验，
  // 避免把安全性寄托在 Fetch 实现上。
  const stub = (value: string): Request => ({
    url: "http://127.0.0.1/api/sources",
    headers: { get: () => value },
  }) as unknown as Request;
  // URL 的 hostname 由真实 Request 提供；stub 需要能被 new URL() 解析。
  await assert.rejects(() => provider.requireActor(stub("bad\u0000id")), /not a valid identity/);
  await assert.rejects(() => provider.requireActor(stub("x".repeat(129))), /not a valid identity/);
  assert.throws(() => createLocalIdentityProvider({ userId: "bad\u001fid" }), /not a valid identity/);
});

test("supports a configurable header name but defaults to the Miaoda contract", async () => {
  const custom = createLocalIdentityProvider({ userId: "u", headerName: "x-test-user" });
  assert.ok(custom);
  assert.deepEqual(await custom.requireActor(request("http://127.0.0.1/api/sources", { "x-test-user": "u" })), { id: "u" });
  const fallback = createLocalIdentityProvider({ userId: "u", headerName: "  " });
  assert.ok(fallback);
  assert.deepEqual(await fallback.requireActor(request("http://127.0.0.1/api/sources", { [PLATFORM_USER_ID_HEADER]: "u" })), { id: "u" });
});

test("startup notice describes the seam without leaking anything reusable", () => {
  const notice = describeLocalIdentity("local-operator", "development");
  assert.match(notice ?? "", /local-operator/);
  assert.match(notice ?? "", /never a production identity path/);
  assert.equal(describeLocalIdentity(undefined, "development"), null);
});
