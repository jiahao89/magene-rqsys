# PRD 提示词 · L3 目标环境结果（2026-11-21）

- 版本：release `7710562551660121344` / commit `6c5f186`（线上资源 `index-BcL9coko.js` 路径含 `6c5f186fe78f4ad5c9f37e1b0abeb9be0f12e07c`）
- 数据：RQ-000316（`85837f43-1cd0-423b-9413-fe274e4ae8a1`，手工样例）
- 模型调用：3 次（评估 1、提示词 2），均为真实调用
- 结论：**API 层 PASS；UI 层首轮 FAIL（P1 前端缺陷），修复后复跑 PASS**（release `7710566160753134840` / commit `b0ebaff`）

## 1. API 层（PASS）

| 项 | 实测 | 判定 |
|---|---|---|
| 基线 | 评估 `items:[]`、提示词 `items:[]`；需求 334 / 集团 191 | PASS |
| 评估生成 | 201，v1 `succeeded`，31.8s，`promptVersion=rq-assessment-v1`，model `claude-sonnet-5-5` | PASS |
| 提示词 v1（调研结论空） | 201，`succeeded`，4,392 字，10 个二级标题齐全且顺序正确，`assumptions` 均以「假设：」开头，`openQuestions` 8 条，含「调研结论未回填」 | PASS |
| 提示词 v2（带调研结论） | 201，`succeeded`，4,757 字，10 章齐全，无「未回填」，`investigationNotes` 原样返回 | PASS |
| 版本历史 | GET 返回 v2、v1（倒序）；v1 长度 4,392 不变；`assessmentVersion=1`；`promptVersion=rq-prd-prompt-v1` | PASS |
| 无评估 409 | RQ-000335 POST → 409 `ASSESSMENT_REQUIRED`，未创建版本 | PASS |
| 无副作用 | 需求 334 / 集团 191 不变；产品 Base 334、集团 Base 191 不变；新增仅评估 1 行 + 提示词 2 行 | PASS |
| 跨池参数 | **GET 产品 UUID + `?pool=group` → 404**；集团 UUID + `?pool=product` → 404；同池或省略 → 200 | **与后端口径不一致（见 §3）** |

## 2. UI 层（FAIL，P1）

现象：详情「PRD 提示词」块加载失败，显示 `生成失败（REQUEST_FAILED）` + 空态「还没有 PRD 提示词」；RQ-000316 明明有 1 条评估和 2 条提示词。点击「生成 PRD 提示词」同样产生 404。

网络证据（performance resource）：

| 请求 | 实际 URL | 状态 |
|---|---|---|
| 块内 GET 历史 | `https://ecn8egz1lhkq.feishuapp.com/api/requirements/85837f43…/prd-prompts` | **404** |
| 对照：评估列表 | `https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u/api/requirements/85837f43…/assessments` | 200 |
| 点击生成 | 同缺前缀的 `…/prd-prompts` | **404**（未触达 API，也未产生模型调用） |

根因：`apps/web/src/prd-prompt.tsx` 的 `PrdPromptSection` 调用 `listRequirementAssessments` / `listPrdPrompts` / `createPrdPrompt` 时**没有传入平台注入的 fetcher**，`apps/web/src/api.ts` 里这些函数默认 `fetcher = fetch`，相对路径 `/api/...` 落到 origin 根，丢了 `/app/app_17fqkjwyx1u` 前缀。其它面板都走注入的 fetcher，所以评估列表正常。
影响：线上块永远显示失败+空态；「生成 PRD 提示词」按钮不可用。不是数据问题。
修复建议：`PrdPromptSection` 接收 `fetcher`（`panels.tsx` 把当前注入的 fetcher 传进来），三处 API 调用透传；补一条断言「请求路径带应用前缀」的用例（现有组件测试 mock 的是全局 fetch，覆盖不到）。

因此 UI 六条（禁用、字数、10 章节展示、复制、切版本回填、失败文案）**BLOCKED**，等修复发版后重跑；重跑不需要新的模型调用（历史已在库里）。

## 3. 契约偏差（P3，需对齐）

后端口径是「该接口没有 `pool` 参数，带不带都返回 201/200，结果一致」，但线上实测：**`pool` 与需求所属池不符时返回 404**（产品 UUID + `?pool=group`、集团 UUID + `?pool=product`）。这与详情/写接口的既有守卫一致，行为本身不算错，但与「参数不影响结果」的表述矛盾。
建议二选一：① 接受 404，S3-21/22 改成断言 404（与详情接口同口径）；② 后端忽略 `pool` 参数。我倾向 ①，和现有约定一致。

## 4. 清理（待 UI 复验后执行）

当前行数（清理前）：

| 表 | 行数 | 明细 |
|---|---|---|
| `requirement_assessments`（RQ-000316） | **1** | v1 succeeded |
| `requirement_prd_prompts`（RQ-000316） | **2** | v1、v2 succeeded |

待 UI 修复复验后执行（交后端）：

```sql
DELETE FROM requirement_prd_prompts WHERE requirement_id = '85837f43-1cd0-423b-9413-fe274e4ae8a1';
DELETE FROM requirement_assessments WHERE requirement_id = '85837f43-1cd0-423b-9413-fe274e4ae8a1';
```

复核：两个 GET 返回 `items:[]`；需求 334 / 集团 191、Base 334/191 不变。

## 5. 证据

- `evidence/l3-01-assessment.json`、`l3-02-prompt-v1.json`、`l3-03-prompt-v2.json`、`l3-04-contract-checks.json`
- 截图：`l3-05-ui-block.png`、`l3-06-ui-reload.png`、`l3-07-ui-no-assessment.png`、`l3-08-ui-generate-error.png`


---

## 6. UI 复跑（release `7710566160753134840` / commit `b0ebaff`）

线上资源 `client/assets/index-2_5MuhpD.js` 路径含 `b0ebaffffc3b971c54cf5c41716e9e7bb54da8c1`，确认跑在修复版。

| 项 | 实测 | 结论 |
|---|---|---|
| 网络前缀 | `GET …/app/app_17fqkjwyx1u/api/requirements/85837f43…/prd-prompts` → **200**（首轮是 origin 根 404） | PASS |
| 前置禁用（RQ-000335） | 「先生成一条成功的需求评估，才能生成 PRD 提示词。前往需求评估」，生成按钮 `disabled=true` | PASS |
| 调研结论字数 | 输入 9 字 → `9/8000`；粘贴 8,100 字被 maxlength 截到 **8,000**，计数 `8000/8000` | PASS |
| 10 章节与假设/待确认 | 「包含 10 个章节」+ 10 个章节名；页面含假设与待确认区块 | PASS |
| 复制一致 | 复制按钮捕获内容 **4,757 字，与 `output.prompt` 逐字一致**（用 clipboard stub 捕获，避免权限弹窗） | PASS |
| 切版本回填 | v2：调研结论 89 字、提示词 4,757 字；切 v1：调研结论 **0 字**、提示词 **4,392 字**；切回 v2 恢复 89/4,757 | PASS |
| 不自动生成 | 打开详情只发 GET；版本仍为 v2/v1 两条，无新版本 | PASS |
| 失败文案（409/429/503/超时） | 目标环境未触发（409 需无评估需求点生成、按钮禁用；429/503 要真实模型失败）；由 S2 组件用例覆盖 | 未在线上验证 |

**UI 六条：5 条 PASS，失败文案 1 条留在组件用例层。** 首轮 P1 的修复有效，且没有产生新的模型调用。

## 7. 清理（已执行，2026-11-21 18:2x）

| 表 | 清理前行数 | 清理后 |
|---|---|---|
| `requirement_assessments`（RQ-000316） | 1 | **0** |
| `requirement_prd_prompts`（RQ-000316） | 2 | **0** |

SQL 由 Chief 直接执行并复核：两个 GET 均返回 `items: []`；需求 525（334 + 191）不变；两 Base 334/191 不变。清理前基线已留档（评估 1 行、提示词 2 行），UI 复跑未新增任何行、未新增模型调用。

## 8. 最终结论

- **API 层 L3：PASS**（评估 v1 → 提示词 v1/v2、10 章节、版本倒序、v1 不变、无评估 409、跨池守卫、零副作用）。
- **UI 层：5/6 PASS**（首轮 P1 已修复复验；失败文案 409/429/503/超时由组件用例覆盖，线上无安全触发方式，标「已覆盖、线上未验」）。
- **数据：已清理回零**，需求与 Base 计数不变。
- 未验证项：真实模型失败下的 503/超时文案（L2 stub 覆盖）；集团池详情不点生成（只做 API 级）。
- 本文件为最终版。
