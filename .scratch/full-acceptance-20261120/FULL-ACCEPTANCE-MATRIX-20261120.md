# 全量验收矩阵（2026-11-20）

- 环境：线上 `https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`
- 首次验收发版：`7710084772375416077`（commit `3422425`）
- 修复后复验发版：`7710101227455401251`（commit `c99a0e6`）；复验记录见 §5
- 数据基线：需求 **334** = TB 333 + 手工 1 + 多维表格 0 + 聊天粘贴 0；PM 表 334；`requirement_assessments` 0 行
- 数据安全：全轮无生产数据新增；未触发 Base 写入/PM 通知；评估表 0 行

## 1. 矩阵

| # | 验收块 | 结论 | 关键证据 | 失败/阻塞项 | 责任方 |
|---|---|---|---|---|---|
| 1 | 需求池：列表、筛选、来源 Tab、徽标/色条、导出 | **PASS** | [测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §1；[01-source-baseline.json](01-source-baseline.json)、[03-export-webmanual.csv](03-export-webmanual.csv) | S8 故障降级未注入；base/chat 0 行用本地用例 | 测试 |
| 2 | 需求详情：四来源字段、编辑、负责人、重复处理 | **PASS**（复验后） | [前端文档](02-frontend-detail-and-intake-20261120.md) §1；[复验](NARROW-REVERIFY-RESULT-20261120.md) §2 | F1（P2）已修：DTO 补 `createdAt`、前端改读，手工详情有值、TB 区块不变；chat_paste 详情已造数补验；base_form 详情仍 0 行（产品口径待定） | 后端+前端 |
| 3 | 新建需求：手工表单、聊天粘贴草稿、长度校验、重复提示 | **PASS（有 BLOCKED）** | [前端文档](02-frontend-detail-and-intake-20261120.md) §2；[测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §2 | N6 AI 草稿/重复提示未造数，BLOCKED；手工校验、长度、链接格式全 PASS | 前端+测试 |
| 4 | AI 分析、评分、优先级覆盖 | **PASS** | [测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §3；[14-block4-detail.json](14-block4-detail.json) | 优先级覆盖只开不写；RQ-000335 分析 502 为上游 OBS | 测试 |
| 5 | 需求评估（本轮新功能） | **PASS**（复验后，真失败路径单测覆盖） | [测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §4；[复验](NARROW-REVERIFY-RESULT-20261120.md) §3 | F2/F1 已修并在产物确认（`65e3`、非 409 静默刷新），线上 409 单飞正常；A12 四条样例未跑；`analysis_failure`/超时生产不可控，记单测+走查 | 前端 |
| 6 | Base 同步链路 | **PASS** | [后端文档](</Volumes/Files/A_Projects/RQ-Sys/.scratch/iteration-5/evidence/20261120/FULL-ACCEPTANCE-BACKEND-20261120.md>) | 本轮未造新行复跑端到端 | 后端 |
| 7 | 运维与管理页 | **PASS** | 同上 | 审计近 3 天失败 4 条有解释 | 后端 |
| 8 | 工程门禁 | **PASS** | 同上；Web 178/178、API 668（59 条本机无 PG）、alignment 36/36 | `check:contract` 1 条 PG ENOENT + trigger 提醒，非契约失败 | 后端 |
| 9 | 数据一致性 | **PASS** | 同上；App 334 = PM 334，平台 ID 集合 md5 一致；孤儿 0 | 无 | 后端 |
| 10 | 文档口径对账 | **PASS** | [文档对账](</Volumes/Files/A_Projects/RQ-Sys/.scratch/iteration-5/evidence/20261120/DOC-CONSISTENCY-20261120.md>) | 文档侧 PASS；发现的 2 个前端 FAIL 已计入块 5；S15 编号 OBS | 软件产品 |

## 2. 缺陷清单（按责任方）

### 前端开发

1. **F2 / P2 · 评估失败后历史不刷新**（块 5，A6）：`apps/web/src/panels.tsx:1776-1784` 只在 409 时 `load(true)`；429/503/500/超时只提示错误，failed 版本已落库但页面不显示。建议非 409 也刷新历史或合并 failed 行，补 503 用例。
2. **F1 / P3 · 评估超时 60s 与服务端抢跑**（块 5，A15）：`apps/web/src/panels.tsx:1768` 用 60000，PRD 要求 65s；服务端 60s 边界可能先被前端 abort。改 65000，补 59–60s 返回成功的时钟用例。

### 后端开发 + 前端开发

3. **F1 / P2 · 手工/多维表格详情「创建时间 未填写」**（块 2）：`GET /api/requirements/:id` 无 `createdAt`，前端退回 `source.createdAt`，手工/多维表格 payload 没有该字段。建议后端 DTO 增补 `createdAt`（加法），前端原位改读；补手工详情断言。

## 3. 未执行 / 待确认（不算 FAIL）

- **BLOCKED**：聊天粘贴 AI 草稿、重复提示（块 3 N6）——会消耗模型并写 `intake.*` 审计，本轮未造数；存量 PRD-26 验收与组件用例覆盖。
- **已补验**：多维表格/聊天粘贴详情（块 2 D8）——chat_paste 已造 1 条 `[验收]` 行线上验证并删除；base_form 详情仍无线上数据，待产品口径确认后补。
- **NOT RUN**：评估四条样例 A12——样例集已备（[SAMPLES-20261120.md](</Volumes/Files/A_Projects/RQ-Sys/.scratch/ai-assessment-samples/SAMPLES-20261120.md>)），本轮未跑 4 条模型调用。
- **OBS**：`base_form` 详情无「编辑需求」入口（前端 F2/OBS），需产品确认是否与「要改去 App 改」口径一致；本轮无数据未线上验。
- **OBS（已关闭）**：RQ-000335 AI 分析三次上游 502（`failed_retryable`），11-20 12:01 补跑成功、`analysis_state=analyzed`；补跑按设计写了一次 `ai_retry_success` 通知（无负责人 → PM Leader），属预期副作用。
- **OBS**：任务写「S1–S15」，PRD §4.9 实际 S1–S14、§4.10 是 A1–A15，无 S15；软件产品确认笔误并已在 PRD 更正。
- **OBS（P3，下轮）**：评估 `assumptions` 偶发半角「假设:」，契约写全角「假设：」；前端两种都兼容，服务端 schema 不校验前缀，建议归一化。

## 4. 总体结论

**复验后全量验收通过：10 块全部 PASS（块 2、块 5 经修复复验转 PASS），无 P0/P1/P2 遗留，无数据或通知副作用（复验前后需求 334、评估表 0 行）。**

遗留均为非阻塞项：A12 四条样例未跑（需模型调用，未授权）、块 3 AI 草稿/重复提示未造数、`base_form` 详情编辑入口待产品口径、评估假设前缀冒号为 P3 归一化。

## 5. 复验记录（2026-11-20，发版 `7710101227455401251` / `c99a0e6`）

| 项 | 修复前 | 复验结果 | 证据 |
|---|---|---|---|
| 块 2 F1 手工详情创建时间 | 「未填写」 | **PASS**：`2026/11/2 11:28:47`（`createdAt=2026-11-02T03:28:47.292Z`）；TB 区块不变 | [rv-01-manual-createdat.png](rv-01-manual-createdat.png) |
| 块 5 F2 失败后历史刷新 | 非 409 不刷新 | **PASS**：产物非 409 分支 `w(!0,!0)`；503 单测断言「v2（失败）」可见；`panels.test.tsx` 88/88 | [复验 §3](NARROW-REVERIFY-RESULT-20261120.md) |
| 块 5 F1 评估超时 | `6e4`（60s） | **PASS**：产物 `abort(),65e3`；64.999s 不中断 / 65s 中断用例通过 | 产物走查 + 单测 |
| 409 单飞 | 已验 | **PASS**：并发两次 POST → 201 v2 + 409，历史仅 v2 | 接口实测 |
| chat_paste 详情补验 | 无数据 | **PASS**：RQ-000336 来源/字段/编辑入口/徽标/创建时间均正确，来源方式=聊天粘贴、通知事件ID 为空；数据已删 | [rv-02](rv-02-chatpaste-detail.png)、[rv-04](rv-04-pool-chatpaste.png) |
| 清理后基线 | — | **PASS**：334/333/0/1/0、PM 334、收集表 0、评估全表 0、旧 UUID 404 | 本节 + 后端复核 |

## 6. 遗留补跑（2026-11-20 下午，发版 `7710120419668593957` / `6f2942a`）

| 项 | 结果 | 证据 |
|---|---|---|
| A12 四条样例 | **PASS（RUBRIC v1）**：A01 `investigate/medium` 两项风险点名 → PASS；A02 94、A03 96、A04 93（`confidence=high` 记 P3）；契约四条全过，假设全角归一化生效 | [A12-RESULT](A12-RESULT-20261120.md)、[原始 JSON](</Volumes/Files/A_Projects/RQ-Sys/.scratch/ai-assessment-samples/a12-raw-20261120.json>) |
| 块 3 AI 草稿 | PASS：3 次调用均 200、`fallback=false`、`aiFilledCount` 6/3/3、不写库；审计只记 `requestId/promptVersion/textLength` | A12-RESULT §3.1 |
| 块 3 重复提示（草稿 `similar`） | **部分验证**：3 次真实草稿 `similar` 均为空，线上未触发渲染；组件用例覆盖非空分支 | A12-RESULT §3.2 |
| 评估切版本回填（A16） | **PASS**：默认载入最新版；切 v1 回填 v1 三输入 + 提示；切回 v2 一致；切换不发 POST；输入可编辑 | [rv-06-backfill-v1.png](rv-06-backfill-v1.png) |
| base_form 详情编辑（S15） | **PASS**：入口存在 + 固定提示「修改只保存在需求平台，不会写回多维表格收集表。」；元数据编辑保存成功，`sourceVersion` 仍 1、`formRecordId` 保留、`sourceType` 仍 base_form，只重推一次（`replay=true`）、未重跑分析 | [rv-07-baseform-edit.png](rv-07-baseform-edit.png) |
| base_form 重复处理区块 | **P3 OBS**：base_form 详情渲染「确认重复/确认非重复/忽略」，但对非 TB 来源 `PUT /duplicate-decision` 返回 **404**（`requirement_resolutions` 需要 TB 身份）；建议非 TB 来源隐藏该区块 | 接口探针 404 |
| 清理 | RQ-000336–340 + 5 行评估 + 派生行 + PM 5 行已删，基线回 334/333/0/1/0；base_form 那条待删 | 后端脚本 + 测试复核 |

## 7. 最终基线核对（全部清理后，2026-11-20 13:5x）

| 项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| App `source-counts` | 334 / 333 / 手工 1 / 多维表格 0 / 聊天粘贴 0 | **334 / 333 / 1 / 0 / 0** | PASS |
| 已删需求 UUID | 404 | `d02816cb…`、`dddd77dd…` 等全 404 | PASS |
| base_form 列表 | 0 | 0 | PASS |
| 评估表 | 0 行 | 0（后端 SQL；RQ-000308 接口 `items: []`） | PASS |
| PM 表 | 334 | 334（平台 ID 集合 md5 `34dcc5…`） | PASS |
| 收集表 | 0 行 | 0（创建/收录/删除历史已留档） | PASS |

**收尾结论**：本轮新增功能（评估按需生成、版本回填、base_form 编辑、假设归一化）全部线上验收通过；遗留 A12 四条样例按 RUBRIC v1 全 PASS；验收数据全部删除，应用库、PM 表、收集表均回到验收前基线，无孤儿行、无 PM 通知（首推静默）。

## 8. 第二轮验收：非 TB 重复边界 + PRD-31 相似需求（R1–R8）

- 发版：`7710167761297870088`（`148706b`，第一版）→ `7710176283252133048`（`0014e1c`，R8）
- 无造数部分（第一版线上）：手工详情无重复区块；TB 详情保留；手工/聊天粘贴表单相似提示命中 5 条、空态不渲染、提交不阻断（0 次 POST）、点击新标签、聊天粘贴不用草稿即可命中
- base_form 行 `d5a1ce84…`（RQ-000336，`reczz28brpbYLNdy`）：无重复按钮；只读相似块排除自身（标题 `C606` 时 4 条）；编辑入口 + 固定提示；实质编辑 v1→v4、`formRecordId` 保留

### R8 复验（`0014e1c`）

| 项 | 实测 | 结论 |
|---|---|---|
| 短标题单段成功 | `q=C606` 仅 **1 次**请求，列出 4 条 | PASS |
| ≥2 字门槛 | 输入 `C` 无请求、无提示 | PASS |
| 空态 | 输入 `OTA` 有 1 次请求但整块不渲染 | PASS |
| 2s 超时 | 注入 5s 延迟，请求 **2004ms** 被中断，块隐藏、无 loading、只 1 次请求不降级 | PASS |
| 查询失败 | 屏蔽 `/api/requirements?*`，1 次请求、块隐藏、无错误提示 | PASS |
| 新文案 | 「相似需求（只读，仅供参考）」「按标题关键字匹配」 | PASS |
| 链接新标签 | 表单与详情均为 `target="_blank"` | PASS |
| 草稿后立即查（1 次调用） | 草稿标题 `C606 低温环境下电池掉电快…` 生成后**立即**触发 `q=草稿标题` 查询；0 条不渲染 | PASS |
| 长标题两段查询（1 次分析调用） | 标题 `C606码表无法定位海报数据异常乱跳（验收复现）`：第 1 段整条 **0 条** → 第 2 段 `C606码表无法`（前 8 字）命中 RQ-000274；**恰好 2 次请求**，排除自身 | PASS |

- 证据：[rv-11-r8-two-stage.png](rv-11-r8-two-stage.png)
- 模型调用：草稿 1 次（批准）+ 实质编辑重跑分析 1 次（批准）
- 清理已完成（后端）：需求 `d5a1ce84…`（v4）及派生行、PM `reczz28brz00SUAx`、收集表 `reczz28brpbYLNdy` 全部删除；收集表历史核对仅 create + 收录写回，平台侧编辑（含长标题实质编辑）均未写回。复测基线 **334/333/0/1/0**、评估 0、base_form 0、已删 UUID 404
