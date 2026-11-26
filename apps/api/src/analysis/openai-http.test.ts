import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiHttpError, requestOpenAiChatContent, type OpenAiFetchLike } from "./openai-http.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("requestOpenAiChatContent sends JSON-mode payload and returns content", async () => {
  let capturedUrl = "";
  let capturedAuth: string | null = null;
  let capturedBody: Record<string, unknown> = {};
  const fetchStub: OpenAiFetchLike = async (input, init) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("authorization");
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({ choices: [{ message: { content: "{\"ok\":true}" } }] });
  };
  const content = await requestOpenAiChatContent({
    baseUrl: "https://ai.example",
    apiKey: "sk-test",
    model: "m",
    temperature: null,
    timeoutMs: 1_000,
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }],
    fetch: fetchStub,
  });
  assert.equal(content, "{\"ok\":true}");
  assert.equal(capturedUrl, "https://ai.example/chat/completions");
  assert.equal(capturedAuth, "Bearer sk-test");
  assert.equal("temperature" in capturedBody, false);
  assert.deepEqual(capturedBody.response_format, { type: "json_object" });
});

test("requestOpenAiChatContent classifies HTTP errors, preserves httpStatus, drains body and never echoes provider text", async () => {
  const cases: Array<[number, string]> = [
    [401, "auth_error"],
    [403, "auth_error"],
    [429, "rate_limited"],
    [400, "request_error"],
    [502, "provider_error"],
  ];
  for (const [status, expectedKind] of cases) {
    const response = new Response("upstream secret sk-live-9876543210 bearer-token", { status });
    await assert.rejects(
      () => requestOpenAiChatContent({
        baseUrl: "https://ai.example",
        apiKey: "k",
        model: "m",
        temperature: 0,
        timeoutMs: 1_000,
        messages: [{ role: "user", content: "hi" }],
        fetch: async () => response,
      }),
      (error: unknown) =>
        error instanceof OpenAiHttpError
        && error.kind === expectedKind
        && error.httpStatus === status
        && !error.message.includes("sk-live")
        && !error.message.includes("bearer-token"),
      `HTTP ${status}`,
    );
    assert.equal(response.bodyUsed, true, `HTTP ${status} error body must be drained`);
  }
});

test("requestOpenAiChatContent keeps the abort timer alive through response body reading", async () => {
  const aborting = new AbortController();
  const fetchStub: OpenAiFetchLike = async (_input, init) => {
    init?.signal?.addEventListener("abort", () => aborting.abort());
    const body = new ReadableStream({
      start(controller) {
        aborting.signal.addEventListener("abort", () =>
          controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(
    () => requestOpenAiChatContent({
      baseUrl: "https://ai.example",
      apiKey: "k",
      model: "m",
      temperature: 0,
      timeoutMs: 40,
      messages: [{ role: "user", content: "hi" }],
      fetch: fetchStub,
    }),
    (error: unknown) => error instanceof OpenAiHttpError && error.kind === "timeout",
  );
});

test("requestOpenAiChatContent distinguishes envelope, empty_content, and network errors", async () => {
  await assert.rejects(
    () => requestOpenAiChatContent({
      baseUrl: "https://ai.example", apiKey: "k", model: "m", temperature: 0, timeoutMs: 1_000,
      messages: [{ role: "user", content: "hi" }],
      fetch: async () => jsonResponse({ unexpected: true }),
    }),
    (error: unknown) => error instanceof OpenAiHttpError && error.kind === "envelope",
  );
  await assert.rejects(
    () => requestOpenAiChatContent({
      baseUrl: "https://ai.example", apiKey: "k", model: "m", temperature: 0, timeoutMs: 1_000,
      messages: [{ role: "user", content: "hi" }],
      fetch: async () => jsonResponse({ choices: [{ message: { content: "   " } }] }),
    }),
    (error: unknown) => error instanceof OpenAiHttpError && error.kind === "empty_content",
  );
  await assert.rejects(
    () => requestOpenAiChatContent({
      baseUrl: "https://ai.example", apiKey: "k", model: "m", temperature: 0, timeoutMs: 1_000,
      messages: [{ role: "user", content: "hi" }],
      fetch: async () => { throw new TypeError("fetch failed"); },
    }),
    (error: unknown) => error instanceof OpenAiHttpError && error.kind === "network_error",
  );
});
