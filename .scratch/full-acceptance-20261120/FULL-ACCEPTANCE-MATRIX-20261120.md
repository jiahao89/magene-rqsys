# 全量验收矩阵（2026-11-20）

- 环境：线上 `https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`
- 发版：`7710084772375416077`（commit `3422425`）
- 数据基线：需求 **334** = TB 333 + 手工 1 + 多维表格 0 + 聊天粘贴 0；PM 表 334；`requirement_assessments` 0 行
- 数据安全：全轮无生产数据新增；未触发 Base 写入/PM 通知；评估表 0 行

## 1. 矩阵

| # | 验收块 | 结论 | 关键证据 | 失败/阻塞项 | 责任方 |
|---|---|---|---|---|---|
| 1 | 需求池：列表、筛选、来源 Tab、徽标/色条、导出 | **PASS** | [测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §1；[01-source-baseline.json](01-source-baseline.json)、[03-export-webmanual.csv](03-export-webmanual.csv) | S8 故障降级未注入；base/chat 0 行用本地用例 | 测试 |
| 2 | 需求详情：四来源字段、编辑、负责人、重复处理 | **FAIL** | [前端文档](02-frontend-detail-and-intake-20261120.md) §1 | **F1（P2）** 手工/多维表格「创建时间 未填写」，DTO 无 `createdAt`；base/chat 详情 0 行 BLOCKED | 后端+前端 |
| 3 | 新建需求：手工表单、聊天粘贴草稿、长度校验、重复提示 | **PASS（有 BLOCKED）** | [前端文档](02-frontend-detail-and-intake-20261120.md) §2；[测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §2 | N6 AI 草稿/重复提示未造数，BLOCKED；手工校验、长度、链接格式全 PASS | 前端+测试 |
| 4 | AI 分析、评分、优先级覆盖 | **PASS** | [测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §3；[14-block4-detail.json](14-block4-detail.json) | 优先级覆盖只开不写；RQ-000335 分析 502 为上游 OBS | 测试 |
| 5 | 需求评估（本轮新功能） | **FAIL** | [测试块文档](FULL-ACCEPTANCE-TEST-20261120.md) §4；[RQ-000308 复核](</Volumes/Files/A_Projects/RQ-Sys/.scratch/iteration-5/evidence/20261120/ASSESSMENT-RQ308-REVIEW-20261120.md>) | **F2（P2）** 非 409 失败后不刷新历史，failed 版本不出现；**F1（P3）** UI 60s vs PRD 65s；A12 四条样例未跑 | 前端 |
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
- **BLOCKED**：多维表格/聊天粘贴详情（块 2 D8）——线上各 0 行；本地 178 条组件用例覆盖。
- **NOT RUN**：评估四条样例 A12——样例集已备（[SAMPLES-20261120.md](</Volumes/Files/A_Projects/RQ-Sys/.scratch/ai-assessment-samples/SAMPLES-20261120.md>)），本轮未跑 4 条模型调用。
- **OBS**：`base_form` 详情无「编辑需求」入口（前端 F2/OBS），需产品确认是否与「要改去 App 改」口径一致；本轮无数据未线上验。
- **OBS**：RQ-000335 AI 分析三次上游 502，`failed_retryable`；推送正常。属供应商故障，是否手动补分析请 Chief 定。
- **OBS**：任务写「S1–S15」，PRD §4.9 实际 S1–S14、§4.10 是 A1–A15，无 S15；按实际编号对账，待确认是否笔误。

## 4. 总体结论

**全量验收未通过：10 块中 8 块 PASS、2 块 FAIL（块 2、块 5），共 2 个 P2 + 1 个 P3，均有明确复现与责任方；无 P0/P1，无数据/通知副作用。**

建议：前端修 F1/F2、后端补 `createdAt` 后，只复验「手工详情创建时间」和「评估失败/超时」两组，再跑 Web/API 定向用例，即可转 PASS；无需重跑 Base 与门禁全量。
