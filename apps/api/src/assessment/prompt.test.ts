// 0030：服务端 prompt 与 skill 同源断言。skill 是唯一口径源；改 skill 必须同步 skill-text.ts，
// 否则这里立即失败（防止服务端出现第二套规则）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ASSESSMENT_PROMPT_VERSION, buildAssessmentMessages } from "./prompt.js";
import { ASSESSMENT_SKILL_TEXT } from "./skill-text.js";

const skillPath = resolve(import.meta.dirname, "../../../../skills/requirement-assessment/SKILL.md");
const skillFile = readFileSync(skillPath, "utf8");
const frontmatter = skillFile.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n([\s\S]*)$/);

test("assessment system prompt is the skill body verbatim", () => {
  assert.ok(frontmatter, "skill must keep YAML frontmatter");
  assert.equal(frontmatter![2], ASSESSMENT_SKILL_TEXT, "skill 正文改过后必须重新生成 assessment/skill-text.ts");
});

test("assessment prompt version matches the skill frontmatter", () => {
  assert.match(frontmatter![1]!, new RegExp(`^promptVersion: ${ASSESSMENT_PROMPT_VERSION}$`, "m"));
  assert.match(frontmatter![1]!, /^version: rq-assessment-v1$/m);
});

test("assessment messages put the skill in system and only data in user", () => {
  const messages = buildAssessmentMessages({
    requirement: {
      title: "低温掉电", description: "零下十度关机", scope: null, acceptanceCriteria: null,
      sourceChannel: "终端用户", productModel: "C606", requirementType: "性能优化",
      constraintNotes: null, intakeModule: null,
    },
    supplements: { background: "冬季投诉增多" },
  });
  assert.equal(messages.system, ASSESSMENT_SKILL_TEXT);
  assert.equal(messages.system.includes("冬季投诉增多"), false);
  assert.match(messages.user, /## 需求事实/);
  assert.match(messages.user, /## 现有 AI 分析/);
  assert.match(messages.user, /本次未提供可用的 AI 分析/);
  assert.match(messages.user, /补充背景：冬季投诉增多/);
});
