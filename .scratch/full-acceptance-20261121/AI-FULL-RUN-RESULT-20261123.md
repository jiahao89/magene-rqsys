# AI 分析全功能 · 线上实跑结果（2026-11-23）

- 目标环境：`https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`（ego-browser 租户会话）
- 版本：开跑时 `951745f`（`…/951745fadbfd…/client/assets/index-CoBJ-84Q.js`），B 需求复验时已切到 `94cf5e2`（`…/94cf5e225282…/`）
- 样本：A=RQ-000316（手工）、B=RQ-000267（TB，有同标题候选）、C=RQ-000323（TB）、D=RQ-000526（集团池）
- 模型调用：**4 次**（A 提示词 1、D 评估 1、D 提示词 1、C 强制重分析 1）；Kano **未跑**（缺已批准资料，见 F-3）
- 清理前基线：评估 A 1 行、D 1 行；提示词 A 1 行、D 1 行；补充上下文 A/C 各 1 条（已清）

## 1. 结果总览

| 项 | 样本 | 结果 | 证据 |
|---|---|---|---|
| AI 分析建议（模块/类型/人群/置信度+理由） | A、C | PASS（读态） | A：模块「无法识别」、置信度「低」+理由；C：模块「赛段」、类型「质量修复」、置信度「中」 |
| 九项评分输入（AI 建议 vs 当前值 + 依据/假设） | A、C | PASS（读态） | A 9 项 + α=0.8；C α=1；公式与 45/25/10 阈值显式可读 |
| 评分与优先级（服务端复算） | A、C | PASS | A 0.80→P3；C 6.00→P2；`scoring.suggested` 审计可见（C 新分析 score 8 → P1 建议） |
| 历史版本切换 | A（历史 4）、C（历史 3） | 只读到入口与版本号，未逐版切换 | 按钮可见、版本号正确 |
| 人群标签（读态） | A、C | PASS | AI 未给建议时提示「AI 未给出人群建议」；C 显示「尚未确认，当前选择是草稿」 |
| 补充上下文保存 → 清空 | A | PASS（0 调用） | 保存后 API `analysisContext.note` + `updatedAt/updatedBy` 正确；清空后回到 `null` |
| 生成评估 | D（集团池） | PASS（1 次调用） | `POST …/assessments` **201**，52.98s，v1 `succeeded`、verdict「需要调查」、置信度「中」 |
| 生成 PRD 提示词 | A、D | PASS（各 1 次） | A：201、42.4s、10 章齐、首章「角色与任务」；D：201、52.0s、10 章齐、绑定「评估 v1 · 待调查」 |
| 重新分析（普通按钮） | C | **FINDING（F-2）** | 12:05:40 审计 `analysis.retry_requested → queued_new_job`，之后**无 `analysis.terminal`**、无新版本、无推送 |
| 重新分析（保存并重新分析 / force） | C | PASS（1 次调用） | 12:11:16 审计入队 → 12:11:39 `analysis.terminal succeeded` + `scoring.suggested 8/P1` → 12:11:48 `base.push succeeded`，分析 v2 |
| Kano 生成 | C | **BLOCKED（F-3）** | 面板显示「暂无已批准的访谈资料」，接口要求 approved 且未标 PII 的资料版本，否则 409 |
| 重复处理·有候选 | B | PASS（只读） | 三个动作均可点；下拉显示「…（RQ-000291）」；未提交，`processingState` 仍 `active` |
| 重复处理·无候选（精简态） | C | PASS | 「未作判定 · 暂无重复候选」+ 说明，仅保留「忽略」；主记录/确认非重复不出现 |
| 重复处理·手工来源 | A | 符合既有边界 | web_manual 详情不渲染该区块 |

## 2. 发现

### F-1（P2）生成评估成功后，同页 PRD 提示词块不刷新

在 D 详情页生成评估 v1 成功（201、详情出现 v1）后，「PRD 提示词」块仍显示「先生成一条成功的需求评估」，按钮保持禁用；此时点击无响应（element cannot receive input）。**刷新页面后**变成「评估 v1 · 待调查」，按钮可点并成功生成。说明评估列表没有在生成成功后回传给 PRD 块，属于同页状态刷新缺口。

> 影响：用户生成评估后必须手动刷新才能用提示词功能，容易被当成“功能没做”。

### F-2（待定级）「重新分析」对已分析需求是静默空转

C 的「重新分析」按钮点击后提示「AI 分析重试已入队」，审计也记了 `analysis.retry_requested → queued_new_job`，但 160 秒后：分析版本仍为 `[1]`、`lastPushedAt` 未变、无 `analysis.terminal` 审计——作业被「同源版本已分析」的幂等守卫短路，**模型一次也没调**。同样的操作走「保存并重新分析」（`force: true`）才真正重跑（v2 + 评分 + 推送）。

> 需要产品确认语义：已分析需求点「重新分析」应当是 force 重跑，还是应给出「源版本无变化，无需重跑」的显式提示；当前是「提示已入队但什么也不会发生」。

### F-3（阻塞）Kano 在线上无法验证

`Kano 资料（已批准快照 · 只读）：暂无已批准的访谈资料`。接口要求 `evidenceVersion` 存在且 `status=approved`、未标 PII，否则 409。没有已批准资料就没有可跑路径，本轮 0 次调用。Kano 证据导入→批准链路同样未验。

### F-4（P3）集团池需求的详情深链需要池上下文

`?requirement=<集团UUID>` 直接打开会 404（详情按 UUID 推导 / 默认池不匹配），必须先进入「集团需求池」列表再点行，URL 里带 `#group-requirements`。界面上要复制一条集团需求链接分享时容易踩到。

## 3. Base 影响与还原

| 需求 | 字段变化 | 处理 |
|---|---|---|
| C RQ-000323 | `AI优先级建议` P2→P1、`AI分析版本` 1→2、`最后推送时间` 更新 | 已按快照 PUT 还原，**复核 0 差异** |
| A / B / D | 无变化 | 复核 0 差异 |

快照：`dumps/base-AI-20261123-{A,B,C,D}-*.json`；还原记录 `dumps/base-AI-20261123-C-RQ000323-restored.json`。

## 4. 清理

已完成：补充上下文 A、C 清空（`analysisContext: null`，审计 `requirement.analysis_context_updated`）。

待执行（无删除接口，需 SQL，由后端/Chief 执行）：

```sql
DELETE FROM requirement_assessments
WHERE requirement_id IN ('85837f43-1cd0-423b-9413-fe274e4ae8a1', '967634c9-48fd-4d0c-bbe2-091b466ea3f9');

DELETE FROM requirement_prd_prompts
WHERE requirement_id IN ('85837f43-1cd0-423b-9413-fe274e4ae8a1', '967634c9-48fd-4d0c-bbe2-091b466ea3f9');
```

按 Chief 决定保留：C 的分析 v2（删除会破坏 `base_push` 幂等键 `req:sv:av`），报告注明即为此意。

## 5. 复核项

- 需求总数：产品 334 / 集团 191（`overview/metrics.counts.total=334`、`suppressed=0`；集团列表页显示 191）
- 推送：产品 `pushPushed=334`、`pushFailed=0`
- B 未被压制：`processingState=active`、`duplicateOf=null`、`duplicates=1`、`duplicateCandidates=1`
- 待删除行数：评估 2 行、提示词 2 行
