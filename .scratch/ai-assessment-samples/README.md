# AI 需求评估样例集

用于「需求评估」功能（按需生成、落新表、不写 Base、Investigation 提示词复制走）的验收样例与判定规则。

## 文件

- [SAMPLES-20261120.md](SAMPLES-20261120.md)：四条样例的输入、预期结论、必备依据与禁止项。
- [RUBRIC-20261120.md](RUBRIC-20261120.md)：硬失败、100 分评分表、逐项检查清单、记录模板。
- [samples-20261120.json](samples-20261120.json)：同一组样例的机器可读版本，供后续 harness/脚本读取。

## 四条覆盖

| ID | 类型 | 预期结论 |
|---|---|---|
| A01 | 信息完整（OTA 断点续传/回滚） | `advance` / high |
| A02 | 信息严重缺失（App 不好用） | `investigate` / low |
| A03 | 技术不可行（C606 加 4G/在线音乐且不改硬件） | `hold` / high 或 medium |
| A04 | 价值存疑（C606 加 FM 收音机） | `hold` / medium 或 low |

## 使用方式

1. 评估接口就绪后，对每个样例构造一条**测试需求**（或使用后端提供的测试夹具），提交 `POST /api/requirements/:id/assessments`，补充输入用样例里的 `background / goal / scenario`。
2. 按 `RUBRIC` 先查硬失败，再按 100 分表打分；`verdict`、`confidence`、范围、价值、可行性逐项对照样例的「预期结论」。
3. 重点人工检查：数字是否都能在输入中找到、假设是否以「假设：」开头、技术不可行与价值存疑是否被混淆、Investigation 提示词是否包含目标用户/假设/问题/证据/PRD 章节。
4. 记录用 `RUBRIC` §5 的模板；四条都通过才算这一轮样例验收通过。

## 最终契约校准（2026-11-20）

- `value` 是**字符串**，不是数组/对象。
- `assumptions[]` 每条必须以「假设：」开头；没有假设用空数组。
- 输入上限：`background` 2,000、`goal` 1,000、`scenario` 2,000 字；三项都可为空。
- `scope.in` 1–8 条、`scope.out` 0–8 条；`assumptions` / `openQuestions` 各 0–8 条，每条 ≤300 字；`investigationPrompt` 100–5,000 字。
- 四条样例的补充输入都在上限内；接口层边界（2,001/1,001/2,001 → 400）见 `RUBRIC` §4.4。

## 目标环境注意

- 评估只写 `requirement_assessments`，不写 Base，不触发 PM 通知。
- 不要为了验收新建会触发推送/通知的生产需求；优先用测试夹具或明确的合成需求。若必须建需求，先确认推送开关，验收后删除评估行和测试需求。
- 本目录所有文本均为虚构，不得导入真实客户数据。
