// 验证「一次修复调用」能否救回三类坏输出（尾随逗号 / 提前闭合 / 中文键名）。跑完删除。
import { readFileSync, writeFileSync } from "node:fs";

const envText = readFileSync("/tmp/rqenv/.env.local", "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

const rows = JSON.parse(readFileSync("/tmp/rqenv/repro-bodies.json", "utf8")) as string[];
const bad = [3, 5, 11].map((i) => JSON.parse(rows[i]!).body).map((b: string) => JSON.parse(b).choices[0].message.content as string);
const expected = ["background", "goal", "scope", "value", "feasibility", "verdict", "verdictReason", "confidence", "assumptions", "openQuestions", "investigationPrompt"];
const feasibilityKeys = ["technical", "cost", "dependency", "risk"];

const contract = `只输出一个合法 JSON 对象，键名必须逐字使用下列英文键，禁止翻译键名，禁止尾随逗号、注释或解释文字：
{"background":string,"goal":string,"scope":{"in":string[],"out":string[]},"value":string,"feasibility":{"technical":string,"cost":string,"dependency":string,"risk":string},"verdict":"advance|hold|investigate","verdictReason":string,"confidence":"high|medium|low","assumptions":string[],"openQuestions":string[],"investigationPrompt":string}`;

const results: unknown[] = [];
for (const [index, content] of bad.entries()) {
  const started = Date.now();
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.AI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你是 JSON 修复器：只修复格式与键名，不新增或删减内容，只输出 JSON。" },
        { role: "user", content: `${contract}\n\n把下面这段模型输出修复为合法 JSON；只修语法（如尾随逗号、提前闭合）和键名，内容保持不变：\n\n${content}` },
      ],
    }),
  });
  const body = await response.json() as { choices: { message: { content?: string }; finish_reason?: string }[]; usage?: unknown };
  const repaired = body.choices[0]?.message.content ?? "";
  let ok = false; let reason = "";
  try {
    const obj = JSON.parse(repaired.trim());
    const missing = expected.filter((k) => !(k in obj));
    const feas = obj.feasibility ?? {};
    const missFeas = feasibilityKeys.filter((k) => !(k in feas));
    ok = missing.length === 0 && missFeas.length === 0;
    reason = ok ? "valid" : `missing=${missing.join(",")} feas=${missFeas.join(",")}`;
  } catch (error) {
    reason = `parse: ${(error as Error).message}`;
  }
  results.push({ sample: index, ms: Date.now() - started, ok, reason, len: repaired.length, usage: body.usage });
  writeFileSync("/tmp/rqenv/repair-results.json", JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
