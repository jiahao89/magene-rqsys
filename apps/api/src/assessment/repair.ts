// 0033：评估输出的确定性修复层。
// 背景（2026-11-25）：deepseek-flash 约 16.7% 概率返回不可直接使用的 JSON——尾随逗号、
// 提前闭合根对象后继续输出键、或把契约键名翻成中文（如 feasibility.cost 写成「成本」）。
// 这里只做语法与已知键名的确定性修复，不改内容；每个候选都必须通过调用方的完整契约校验
// 才被接受，修复不了就返回失败分类，由调用方落库与记录子类型。

// 不用可辨识联合：妙搭服务端 tsconfig 的 strict=false 下布尔判别不会收窄，两仓共用同一份实现。
export interface AssessmentRepairOutcome {
  ok: boolean;
  /** 修复成功的输出（ok=true）。 */
  output?: unknown;
  /** 已执行的修复类型（ok=true）：trailing_comma / early_close / keys，可叠加。 */
  repairs?: string[];
  /** 失败分类（ok=false）：non_json 或 contract。 */
  kind?: "non_json" | "contract";
  /** 契约失败的字段路径（kind=contract）。 */
  fields?: string[];
}

export interface AssessmentRepairOptions {
  /** JSON 解析（复用 parseModelJson：原文优先，解析失败再尝试整段围栏）。 */
  parse(text: string): unknown;
  /** 完整契约校验；失败时只返回字段路径（不含模型内容）。 */
  validate(value: unknown): { ok: boolean; value?: unknown; fields?: string[] };
}

/** 已知键名别名：只映射契约里出现过的键，避免把正文内容当键名处理。 */
const TOP_LEVEL_ALIASES: Record<string, string> = {
  背景: "background",
  目标: "goal",
  范围: "scope",
  价值: "value",
  业务价值: "value",
  可行性: "feasibility",
  结论: "verdict",
  结论理由: "verdictReason",
  置信度: "confidence",
  假设: "assumptions",
  开放问题: "openQuestions",
  待确认问题: "openQuestions",
  调研提示词: "investigationPrompt",
  调查提示词: "investigationPrompt",
};

const FEASIBILITY_ALIASES: Record<string, string> = {
  技术: "technical",
  成本: "cost",
  依赖: "dependency",
  风险: "risk",
};

const SCOPE_ALIASES: Record<string, string> = {
  包含: "in",
  范围内: "in",
  不包含: "out",
  范围外: "out",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 去掉字符串外的尾随逗号（`,}` / `,]`）；字符串内的逗号与转义不动。 */
export function stripTrailingCommasOutsideStrings(text: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      out.push(char);
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out.push(char);
      continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next]!)) next += 1;
      if (next < text.length && (text[next] === "}" || text[next] === "]")) continue;
    }
    out.push(char);
  }
  return out.join("");
}

/** 找到第一个完整根对象结束位置（深度回到 0 的下标）；字符串内忽略括号。 */
function findRootClose(text: string): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { depth += 1; started = true; continue; }
    if (char === "}") {
      depth -= 1;
      if (started && depth === 0) return index;
    }
  }
  return null;
}

/**
 * 修复「根对象提前闭合后继续输出键」：`{...},"openQuestions":[...]` → `{...,"openQuestions":[...]}`。
 * 只在根闭合后的剩余文本以逗号开头时尝试；其余形状返回 null，避免误改正常内容。
 */
export function mergePrematureRootClose(text: string): string | null {
  const close = findRootClose(text);
  if (close === null) return null;
  const rest = text.slice(close + 1);
  if (!/^\s*,/.test(rest)) return null;
  return text.slice(0, close) + text.slice(close + 1);
}

/** 只在目标键不存在时改名；返回是否发生改动。 */
function renameKey(target: Record<string, unknown>, from: string, to: string): boolean {
  if (!(from in target) || from === to || to in target) return false;
  target[to] = target[from];
  delete target[from];
  return true;
}

/** 契约键名归一化：顶层、scope、feasibility 三层白名单，其余键不动。 */
export function normalizeContractKeys(value: unknown): { value: unknown; changed: boolean } {
  if (!isObject(value)) return { value, changed: false };
  let changed = false;
  const root = value;
  for (const [from, to] of Object.entries(TOP_LEVEL_ALIASES)) changed = renameKey(root, from, to) || changed;
  for (const [key, aliases] of [["scope", SCOPE_ALIASES], ["feasibility", FEASIBILITY_ALIASES]] as const) {
    const nested = root[key];
    if (!isObject(nested)) continue;
    for (const [from, to] of Object.entries(aliases)) changed = renameKey(nested, from, to) || changed;
  }
  return { value: root, changed };
}

/**
 * 依次尝试：原文 → 去尾随逗号 → 合并提前闭合（再叠加去尾随逗号）。
 * 每个候选解析成功后先做契约校验，失败再做键名归一化后重校验；第一个通过完整契约的结果被接受。
 */
export function repairAssessmentOutput(content: string, options: AssessmentRepairOptions): AssessmentRepairOutcome {
  const trimmed = content.trim();
  const candidates: Array<{ text: string; repairs: string[] }> = [{ text: trimmed, repairs: [] }];
  const withoutCommas = stripTrailingCommasOutsideStrings(trimmed);
  if (withoutCommas !== trimmed) candidates.push({ text: withoutCommas, repairs: ["trailing_comma"] });
  const merged = mergePrematureRootClose(trimmed) ?? (withoutCommas !== trimmed ? mergePrematureRootClose(withoutCommas) : null);
  if (merged !== null) {
    const mergedText = stripTrailingCommasOutsideStrings(merged);
    if (!candidates.some((candidate) => candidate.text === mergedText)) {
      candidates.push({ text: mergedText, repairs: mergedText === merged ? ["early_close"] : ["early_close", "trailing_comma"] });
    }
  }

  let sawParsed = false;
  let contractFields: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.text)) continue;
    seen.add(candidate.text);
    let parsed: unknown;
    try {
      parsed = options.parse(candidate.text);
    } catch {
      continue;
    }
    sawParsed = true;
    const direct = options.validate(parsed);
    if (direct.ok) return { ok: true, output: direct.value, repairs: candidate.repairs };
    const normalized = normalizeContractKeys(parsed);
    if (normalized.changed) {
      const repaired = options.validate(normalized.value);
      if (repaired.ok) return { ok: true, output: repaired.value, repairs: [...candidate.repairs, "keys"] };
    }
    if (contractFields.length === 0) contractFields = direct.fields ?? [];
  }
  if (!sawParsed) return { ok: false, kind: "non_json" };
  return { ok: false, kind: "contract", fields: contractFields };
}
