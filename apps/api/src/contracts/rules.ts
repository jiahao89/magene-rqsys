// Rules 管理 API 契约 schemas：对齐 openapi.yaml 的词典/优先级规则请求体定义。
// 规则 JSON 契约与 analysis/priority-rule.ts 的解释器一致：{ thresholds: { p0, p1, p2 } }，
// 阈值取 0–4（四维证据得分总和的范围），且要求 p0 ≥ p1 ≥ p2 保证阈值语义单调。
// 严格度与契约一致：不在 zod 中添加契约没有的约束，避免契约合法请求被拒。

import { z } from "zod";

// POST /api/rules/dictionary 请求体：模块名列表（非空数组、非空字符串）
export const DictionaryCreateSchema = z.object({
  entries: z.array(z.string().min(1)).min(1),
});

// POST /api/rules/priority 请求体：阈值规则 + 可选历史案例校验证据
export const PriorityRuleCreateSchema = z.object({
  rules: z.object({
    thresholds: z.object({
      p0: z.number().min(0).max(4),
      p1: z.number().min(0).max(4),
      p2: z.number().min(0).max(4),
    }).refine((t) => t.p0 >= t.p1 && t.p1 >= t.p2, { message: "thresholds must satisfy p0 >= p1 >= p2" }),
  }),
  validationEvidence: z.array(z.unknown()).optional(),
});

export type DictionaryCreate = z.infer<typeof DictionaryCreateSchema>;
export type PriorityRuleCreate = z.infer<typeof PriorityRuleCreateSchema>;
