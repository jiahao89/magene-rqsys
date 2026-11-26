import test from "node:test";
import assert from "node:assert/strict";
import { countPiiFindings, maskPii } from "./contract.js";

// 回归：PII 门禁（countPiiFindings，决定 Kano 资料能否批准）与掩码（maskPii）必须覆盖同一组模式，
// 否则 @提及 / 平台用户 ID 会以“未命中 PII”通过门禁、原样进入模型输入（2026-10-28 审核 P1）。
test("countPiiFindings covers the mention and platform-user-id patterns that maskPii already masks", () => {
  assert.ok(countPiiFindings("用户@张三反馈该问题") > 0, "an @mention must count as PII");
  assert.ok(countPiiFindings("TB 用户 0123456789abcdef01234567 反馈") > 0, "a 24-hex platform user id must count as PII");
  assert.ok(countPiiFindings("联系人 13800138000") > 0, "phone numbers must still count");
});

test("maskPii masks mentions and platform user ids", () => {
  const masked = maskPii("用户@张三反馈，平台 ID 0123456789abcdef01234567", []);
  assert.equal(masked.includes("张三"), false);
  assert.equal(masked.includes("0123456789abcdef01234567"), false);
});

test("maskPii matches markers case-insensitively and escapes regex metacharacters", () => {
  const masked = maskPii("Owner WANYING QI and wanying qi plus Jack (PM) reported issue", ["Wanying Qi", "Jack (PM)"]);
  assert.equal(/wanying qi/i.test(masked), false);
  assert.equal(/jack \(pm\)/i.test(masked), false);
  assert.equal(masked.includes("reported issue"), true);
});

test("maskPii and countPiiFindings redact Bearer tokens and password credentials", () => {
  const sample = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig, standalone Bearer tok_1234567890 and password=superSecret123";
  assert.ok(countPiiFindings(sample) >= 3);
  const masked = maskPii(sample, []);
  assert.equal(masked.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.equal(masked.includes("tok_1234567890"), false);
  assert.equal(masked.includes("superSecret123"), false);
});
