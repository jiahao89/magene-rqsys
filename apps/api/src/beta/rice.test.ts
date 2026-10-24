// V02-T12：RICE 计算接缝——确认量纲 rice-v1 的手工可复算案例与非法输入拒绝。
import test from "node:test";
import assert from "node:assert/strict";
import { RICE_CONFIG_VERSION, computeRiceScore } from "./rice.js";

test("rice-v1 computes R×I×(C/100)÷E with hand-checkable cases", () => {
  assert.equal(RICE_CONFIG_VERSION, "rice-v1");
  // 200 × 3 × (80/100) ÷ 4 = 120
  assert.deepEqual(computeRiceScore({ reach: "200", impact: "3", confidence: "80", effort: "4" }), { score: 120, status: "computed" });
  // 50 × 1 × (50/100) ÷ 10 = 2.5
  assert.deepEqual(computeRiceScore({ reach: "50", impact: "1", confidence: "50", effort: "10" }), { score: 2.5, status: "computed" });
  // 保留 1 位小数：33 × 2 × (77/100) ÷ 3 = 16.94 → 16.9
  assert.deepEqual(computeRiceScore({ reach: "33", impact: "2", confidence: "77", effort: "3" }), { score: 16.9, status: "computed" });
});

test("missing, non-finite, zero-effort, bad-level and out-of-range inputs yield no score", () => {
  for (const inputs of [
    { reach: null, impact: "3", confidence: "80", effort: "4" },
    { reach: "200", impact: null, confidence: "80", effort: "4" },
    { reach: "abc", impact: "3", confidence: "80", effort: "4" },
    { reach: "200", impact: "3", confidence: "80", effort: "0" },
    { reach: "200", impact: "3", confidence: "80", effort: "-2" },
    { reach: "200", impact: "9", confidence: "80", effort: "4" },
    { reach: "200", impact: "3", confidence: "120", effort: "4" },
    { reach: "0", impact: "3", confidence: "80", effort: "4" },
  ]) {
    assert.deepEqual(computeRiceScore(inputs), { score: null, status: "incomplete" }, JSON.stringify(inputs));
  }
});
