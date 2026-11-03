import test from "node:test";
import assert from "node:assert/strict";
import { analysisModelContext } from "./context.js";

test("appends the manual analysis context as a separate labeled section", () => {
  const context = analysisModelContext({
    scope: "范围",
    acceptanceCriteria: "验收",
    productModel: "C706",
    constraintNotes: "约束",
    analysisContextNote: "Q4 前上线",
  });
  assert.equal(context, "范围\n\n验收\n\nC706\n\n约束\n\n补充上下文：Q4 前上线");
});

test("reads the note from RequirementRecord.analysisContext when the record is passed directly", () => {
  // requirements/processing.ts 直接把 RequirementRecord 传给 analysisModelContext，不再改共享调用点。
  assert.equal(
    analysisModelContext({ scope: null, acceptanceCriteria: null, analysisContext: { note: "历史决策：仅支持 C706" } }),
    "补充上下文：历史决策：仅支持 C706",
  );
});

test("omits the supplement section when the note is absent or empty", () => {
  assert.equal(analysisModelContext({ scope: null, acceptanceCriteria: null, analysisContext: { note: "" } }), "");
  assert.equal(analysisModelContext({ scope: "S", acceptanceCriteria: null, analysisContext: null }), "S");
});
