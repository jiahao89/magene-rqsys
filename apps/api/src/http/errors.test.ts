import assert from "node:assert/strict";
import test from "node:test";
import {
  ERROR_STATUS,
  errorBody,
  jsonError,
  redactSecrets,
  safeProviderError,
} from "./errors.js";

test("redactSecrets 脱敏密钥/凭据/联系方式", () => {
  // API 密钥
  assert.equal(
    redactSecrets("DeepSeek call failed with key sk-abc123def456ghi789"),
    "DeepSeek call failed with key [REDACTED]",
  );
  // Bearer token（authorization 模式整体命中，头名与值一并脱敏）
  assert.equal(
    redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig rejected"),
    "[REDACTED] rejected",
  );
  // api_key=value 形式
  assert.equal(
    redactSecrets("request had api_key=abcd1234efgh5678"),
    "request had [REDACTED]",
  );
  // 邮箱
  assert.equal(redactSecrets("user pm@example.com not mapped"), "user [REDACTED] not mapped");
  // 手机号
  assert.equal(redactSecrets("contact 13812345678 lookup failed"), "contact [REDACTED] lookup failed");
});

test("redactSecrets 保留资源标识符（UUID）以维持可诊断性", () => {
  const message = "Batch 3f2b8c9e-1234-4abc-9def-112233445566 failed";
  assert.equal(redactSecrets(message), message);
});

test("errorBody 默认消息与契约一致，自定义消息自动脱敏", () => {
  // 默认消息
  assert.deepEqual(errorBody("NOT_FOUND"), {
    error: { code: "NOT_FOUND", message: "Resource not found." },
  });
  assert.deepEqual(errorBody("UNAUTHORIZED"), {
    error: { code: "UNAUTHORIZED", message: "Missing or invalid identity." },
  });
  // 自定义消息脱敏
  const body = errorBody("VALIDATION_FAILED", "field api_key=sk-verysecretkey1 invalid");
  assert.equal(body.error.message, "field [REDACTED] invalid");
});

test("jsonError 返回注册表对应的 HTTP 状态", () => {
  assert.equal(jsonError("NOT_FOUND").status, 404);
  assert.equal(jsonError("VALIDATION_FAILED").status, 400);
  assert.equal(jsonError("CONFLICT").status, 409);
  assert.equal(jsonError("ROUTE_NOT_IMPLEMENTED").status, 501);
  assert.equal(jsonError("DEPENDENCY_UNAVAILABLE").status, 503);
  // 状态覆盖
  assert.equal(jsonError("CONFLICT", "custom", 422).status, 422);
});

test("ERROR_STATUS 与 openapi 错误契约对齐", () => {
  assert.equal(ERROR_STATUS.VALIDATION_FAILED, 400);
  assert.equal(ERROR_STATUS.UNAUTHORIZED, 401);
  assert.equal(ERROR_STATUS.FORBIDDEN, 403);
  assert.equal(ERROR_STATUS.NOT_FOUND, 404);
  assert.equal(ERROR_STATUS.CONFLICT, 409);
  assert.equal(ERROR_STATUS.INTERNAL, 500);
  assert.equal(ERROR_STATUS.ROUTE_NOT_IMPLEMENTED, 501);
  assert.equal(ERROR_STATUS.DEPENDENCY_UNAVAILABLE, 503);
});

test("provider 原始错误永不回显", () => {
  const leaky = new Error(
    'POST https://api.deepseek.com/v1/chat/completions failed: 401 {"error":{"message":"Invalid key sk-realkey12345"}}',
  );
  const safe = safeProviderError(leaky);
  assert.equal(safe.error.code, "DEPENDENCY_UNAVAILABLE");
  assert.equal(safe.error.message, "Upstream provider request failed.");
  // 原始 message 中的密钥和 URL 不出现在安全错误中
  assert.ok(!safe.error.message.includes("sk-realkey"));
  assert.ok(!safe.error.message.includes("deepseek"));
  assert.ok(!safe.error.message.includes("401"));

  // 非 Error 值映射为 INTERNAL
  assert.equal(safeProviderError("weird").error.code, "INTERNAL");
  assert.equal(safeProviderError(null).error.code, "INTERNAL");
});
