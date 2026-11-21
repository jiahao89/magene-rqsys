// 2026-11-21：服务端 prompt 与 skill 同源断言。skill 是唯一口径源；改 skill 必须同步 skill-text.ts，
// 否则这里立即失败（防止服务端出现第二套规则）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PRD_PROMPT_SECTIONS, PRD_PROMPT_VERSION, buildPrdPromptMessages } from "./prompt.js";
import { PRD_PROMPT_SKILL_TEXT } from "./skill-text.js";
import type { RequirementAssessmentRecord, RequirementRecord } from "../domain/persistence.js";

const skillPath = resolve(import.meta.dirname, "../../../../skills/prd-prompt/SKILL.md");
const skillFile = readFileSync(skillPath, "utf8");
const frontmatter = skillFile.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n([\s\S]*)$/);

test("PRD prompt system prompt is the skill body verbatim", () => {
  assert.ok(frontmatter, "skill must keep YAML frontmatter");
  assert.equal(frontmatter![2], PRD_PROMPT_SKILL_TEXT, "skill 正文改过后必须重新生成 prd-prompt/skill-text.ts");
});

test("PRD prompt version matches the skill frontmatter", () => {
  assert.match(frontmatter![1]!, new RegExp(`^promptVersion: ${PRD_PROMPT_VERSION}$`, "m"));
  assert.match(frontmatter![1]!, /^version: rq-prd-prompt-v1$/m);
});

test("skill 正文的章节清单与服务端 10 个固定章节逐字一致", () => {
  // skill 的「## 4. 十个章节」一节就是清单本身：顺序与文字必须与 PRD_PROMPT_SECTIONS 完全一致。
  const section = PRD_PROMPT_SKILL_TEXT.split("## 4. 十个章节")[1]?.split("## 5.")[0] ?? "";
  const listed = (section.match(/`## [^`]+`/g) ?? []).map((item) => item.slice(1, -1));
  assert.deepEqual(listed, [...PRD_PROMPT_SECTIONS]);
});

const requirement = {
  id: "req-1", title: "坡段数量与坡度", description: "骑行中显示坡段", scope: null, acceptanceCriteria: null,
  sourceChannel: "终端用户", productModel: "C706", requirementType: "新增功能", constraintNotes: "固件内存有限",
  intakeModule: "骑行数据", sourceVersion: 3,
  proposerName: "张三", sourceUrl: "https://teambition.example/task/1", proposalContact: "13800000000",
} as unknown as RequirementRecord;

const assessment = {
  id: "assessment-1", requirementId: "req-1", version: 3, status: "succeeded", promptVersion: "rq-assessment-v1", model: "m",
  inputs: {}, errorCode: null, createdAt: "2026-11-21T00:00:00.000Z", completedAt: "2026-11-21T00:00:01.000Z",
  output: {
    background: "冬季爬坡投诉", goal: "让用户提前看到坡段", scope: { in: ["坡段预览"], out: ["导航"] },
    value: "降低爬坡体验落差", feasibility: { technical: "可做", cost: "中", dependency: "地图数据", risk: "中" },
    verdict: "advance", verdictReason: "投入产出可接受", confidence: "medium",
    assumptions: ["假设：地图数据可商用"], openQuestions: ["坡度数据精度要求？"],
  },
} as unknown as RequirementAssessmentRecord;

test("PRD prompt messages put the skill in system and only data in user", () => {
  const messages = buildPrdPromptMessages({ requirement, assessment, investigationNotes: "访谈了 5 位骑行用户" });
  assert.equal(messages.system, PRD_PROMPT_SKILL_TEXT);
  assert.equal(messages.system.includes("访谈了 5 位骑行用户"), false);
  assert.match(messages.user, /## 需求事实/);
  assert.match(messages.user, /## 现有 AI 分析/);
  assert.match(messages.user, /## 需求评估结论/);
  assert.match(messages.user, /## PM 调研结论/);
  assert.match(messages.user, /访谈了 5 位骑行用户/);
  assert.match(messages.user, /评估结论：推进/);
  // 规格 §2：提出人、联系方式、补充链接都不进模型。
  assert.equal(messages.user.includes("张三"), false);
  assert.equal(messages.user.includes("13800000000"), false);
  assert.equal(messages.user.includes("teambition.example"), false);
});

test("空调研结论在 user 消息里显式标注，要求写进第 9 章", () => {
  const messages = buildPrdPromptMessages({ requirement, assessment, investigationNotes: "" });
  assert.match(messages.user, /未回填/);
  assert.match(messages.user, /调研结论未回填/);
});
