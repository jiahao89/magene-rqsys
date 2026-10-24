import test from "node:test";
import assert from "node:assert/strict";
import {
  PEER_ADDRESS_HEADER,
  PLATFORM_USER_ID_HEADER,
  createLocalIdentityProvider,
  describeLocalIdentity,
} from "./local-identity.js";

function request(headers: Record<string, string> = {}, url = "http://127.0.0.1:8787/api/sources"): Request {
  return new Request(url, { headers });
}

function loopback(overrides: Record<string, string> = {}): Record<string, string> {
  return { [PEER_ADDRESS_HEADER]: "127.0.0.1", ...overrides };
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

test("accepts the platform contract header from a loopback peer when explicitly enabled", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  const actor = await provider.requireActor(request(loopback({
    [PLATFORM_USER_ID_HEADER]: "local-operator",
  })));
  assert.deepEqual(actor, { id: "local-operator" });
});

test("still requires the identity header rather than trusting the environment alone", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  await assert.rejects(
    () => provider.requireActor(request(loopback())),
    /identity header is missing/,
  );
});

test("rejects non-loopback peers so the seam cannot be reached remotely", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  // 远端机器的请求即使伪造 Host: localhost / Origin 也必须被拒：
  // 边界只认 server.ts 从 socket 写入的对端地址。
  for (const peer of ["10.0.0.5", "192.168.1.9", "fd00::5", ""]) {
    await assert.rejects(
      () => provider.requireActor(request({ [PEER_ADDRESS_HEADER]: peer, [PLATFORM_USER_ID_HEADER]: "x" }, "http://localhost:8787/api/sources")),
      /loopback/,
    );
  }
  await assert.rejects(
    () => provider.requireActor(request({ [PLATFORM_USER_ID_HEADER]: "x" })),
    /loopback/,
  );
});

test("rejects control characters and over-long identities", async () => {
  const provider = createLocalIdentityProvider({ userId: "local-operator" });
  assert.ok(provider);
  // 运行时通常不允许构造含控制字符的 header，因此这里用最小 stub 直接验证 provider 自己的校验，
  // 避免把安全性寄托在 Fetch 实现上。
  const stub = (identity: string, peer = "127.0.0.1"): Request => ({
    url: "http://127.0.0.1/api/sources",
    headers: { get: (name: string) => (name === PEER_ADDRESS_HEADER ? peer : identity) },
  }) as unknown as Request;
  await assert.rejects(() => provider.requireActor(stub("bad\u0000id")), /not a valid identity/);
  await assert.rejects(() => provider.requireActor(stub("x".repeat(129))), /not a valid identity/);
  assert.throws(() => createLocalIdentityProvider({ userId: "bad\u001fid" }), /not a valid identity/);
});

test("supports configurable header names but defaults to the Miaoda contract", async () => {
  const custom = createLocalIdentityProvider({ userId: "u", headerName: "x-test-user" });
  assert.ok(custom);
  assert.deepEqual(await custom.requireActor(request(loopback({ "x-test-user": "u" }))), { id: "u" });
  const fallback = createLocalIdentityProvider({ userId: "u", headerName: "  " });
  assert.ok(fallback);
  assert.deepEqual(await fallback.requireActor(request(loopback({ [PLATFORM_USER_ID_HEADER]: "u" }))), { id: "u" });
  const customPeer = createLocalIdentityProvider({ userId: "u", peerHeaderName: "x-test-peer" });
  assert.ok(customPeer);
  await assert.rejects(() => customPeer.requireActor(request(loopback({ [PLATFORM_USER_ID_HEADER]: "u" }))), /loopback/);
  assert.deepEqual(
    await customPeer.requireActor(request({ "x-test-peer": "::1", [PLATFORM_USER_ID_HEADER]: "u" })),
    { id: "u" },
  );
});

test("accepts IPv6 and IPv4-mapped loopback forms", async () => {
  const provider = createLocalIdentityProvider({ userId: "u" });
  assert.ok(provider);
  for (const peer of ["::1", "::ffff:127.0.0.1"]) {
    assert.deepEqual(
      await provider.requireActor(request({ [PEER_ADDRESS_HEADER]: peer, [PLATFORM_USER_ID_HEADER]: "u" })),
      { id: "u" },
    );
  }
});

test("startup notice describes the seam without leaking anything reusable", () => {
  const notice = describeLocalIdentity("local-operator", "development");
  assert.match(notice ?? "", /local-operator/);
  assert.match(notice ?? "", /never a production identity path/);
  assert.equal(describeLocalIdentity(undefined, "development"), null);
});
