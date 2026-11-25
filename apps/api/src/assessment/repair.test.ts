import assert from "node:assert/strict";
import test from "node:test";
import { mergePrematureRootClose, normalizeContractKeys, repairAssessmentOutput, stripTrailingCommasOutsideStrings } from "./repair.js";
import { parseModelJson } from "../analysis/provider.js";

const REQUIRED_TOP = ["background", "goal", "scope", "value", "feasibility", "verdict", "verdictReason", "confidence", "assumptions", "openQuestions", "investigationPrompt"];
const REQUIRED_FEASIBILITY = ["technical", "cost", "dependency", "risk"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 测试用契约校验：只比对键形状并返回字段路径，和线上 Zod 契约的失败口径一致。 */
function validate(value: unknown): { ok: true; value: unknown } | { ok: false; fields: string[] } {
  if (!isObject(value)) return { ok: false, fields: ["root"] };
  const fields = REQUIRED_TOP.filter((key) => !(key in value));
  if (isObject(value.feasibility)) fields.push(...REQUIRED_FEASIBILITY.filter((key) => !(key in (value.feasibility as Record<string, unknown>))).map((key) => `feasibility.${key}`));
  else fields.push("feasibility");
  return fields.length === 0 ? { ok: true, value } : { ok: false, fields };
}

const output = {
  background: "b", goal: "g", scope: { in: ["a"], out: [] }, value: "v",
  feasibility: { technical: "t", cost: "c", dependency: "d", risk: "r" },
  verdict: "advance", verdictReason: "vr", confidence: "medium",
  assumptions: ["a1"], openQuestions: ["q1"], investigationPrompt: "p",
};

const options = { parse: parseModelJson, validate };

test("合法 JSON 原样通过，不触发任何修复", () => {
  const result = repairAssessmentOutput(JSON.stringify(output), options);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.repairs, []);
});

test("去掉字符串外的尾随逗号；字符串内容里的逗号与大括号不动", () => {
  const text = JSON.stringify({ ...output, background: "含逗号，和 } 的正文" }).replace(/}$/, ",}");
  assert.equal(stripTrailingCommasOutsideStrings(text).endsWith(",}"), false);
  const result = repairAssessmentOutput(text, options);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.repairs, ["trailing_comma"]);
    assert.equal((result.output as typeof output).background, "含逗号，和 } 的正文");
  }
});

test("合并提前闭合的根对象：{,}... 后的键接回同一个对象", () => {
  const text = JSON.stringify(output);
  const splitAt = text.indexOf(',"openQuestions"');
  const malformed = `${text.slice(0, splitAt)}}${text.slice(splitAt)}`;
  const merged = mergePrematureRootClose(malformed);
  assert.ok(merged);
  assert.deepEqual(JSON.parse(merged!), output);
  const result = repairAssessmentOutput(malformed, options);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.repairs, ["early_close"]);
});

test("中文契约键名按白名单改回英文键，未知键保持不动", () => {
  // normalizeContractKeys 原地改名：断言和修复各用一份新对象，避免前一次调用影响后一次。
  const localized = () => ({ ...output, feasibility: { 技术: "t", 成本: "c", 依赖: "d", 风险: "r" }, extra: "keep" });
  const normalized = normalizeContractKeys(localized());
  assert.equal(normalized.changed, true);
  assert.deepEqual(Object.keys((normalized.value as { feasibility: Record<string, unknown> }).feasibility).sort(), ["cost", "dependency", "risk", "technical"]);
  assert.equal((normalized.value as Record<string, unknown>).extra, "keep");
  const result = repairAssessmentOutput(JSON.stringify(localized()), options);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.repairs, ["keys"]);
});

test("修复不了就返回分类：语法坏 → non_json，字段缺 → contract + 字段路径", () => {
  assert.deepEqual(repairAssessmentOutput("不是 JSON", options), { ok: false, kind: "non_json" });
  const missing = repairAssessmentOutput(JSON.stringify({ ...output, feasibility: { ...output.feasibility, cost: undefined } }), options);
  assert.equal(missing.ok, false);
  if (!missing.ok && missing.kind === "contract") assert.deepEqual(missing.fields, ["feasibility.cost"]);
});

test("键名归一化不覆盖已存在的目标键", () => {
  const mixed = { ...output, feasibility: { ...output.feasibility, 成本: "被翻译的成本" } };
  const normalized = normalizeContractKeys(mixed);
  assert.equal((normalized.value as { feasibility: Record<string, unknown> }).feasibility.cost, "c");
});
