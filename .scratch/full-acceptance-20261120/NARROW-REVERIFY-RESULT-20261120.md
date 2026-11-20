# 窄复验结果（修复后）

- 日期：2026-11-20
- 发版：`7710101227455401251`（commit `c99a0e6`，产物前缀 `c99a0e6020de…`）
- 环境：线上 `https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`（ego-browser 租户会话）
- 范围：块 2 F1、块 5 F2/F1、chat_paste 详情补验；不重跑 Base 链路与全量门禁

## 结论

| 块 | 结论 | 说明 |
|---|---|---|
| 块 2 需求详情（F1 创建时间） | **PASS** | 手工详情有值；TB 详情保持原样 |
| 块 5 需求评估（F2 失败刷新 / F1 65s） | **PASS**（真失败路径单测覆盖） | 产物 65e3；非 409 失败刷新历史；线上 409 单飞正常 |
| chat_paste 详情补验 | **PASS**（含 1 条 P3 OBS） | 字段/来源/编辑入口/徽标/创建时间均符合 |

## 1. 发版识别

- 旧产物：`.../3422425af3…/assets/index-DHJIcWL7.js`，评估处 `window.setTimeout(()=>r.abort(),6e4)`
- 新产物：`.../c99a0e6020de…/assets/index-DRrTFtpn.js`，评估处 `window.setTimeout(()=>r.abort(),65e3)`
- 其余 5 处 `6e4` 为 dayjs / OTel 等库常量，与评估无关

## 2. 块 2 · F1

| 项 | 结果 | 证据 |
|---|---|---|
| `GET /api/requirements/{id}` 返回 `createdAt` | PASS：`2026-11-02T03:28:47.292Z`（手工 RQ-000316） | 接口实测 |
| 手工详情底部「创建时间」 | PASS：`2026/11/2 11:28:47` | [rv-01-manual-createdat.png](rv-01-manual-createdat.png) |
| TB 详情「需求信息」8 字段 + TB 创建时间 | PASS：`2026/7/14 17:25:00` 未变；底部 `2026/10/29 13:29:56` 取自服务端 `createdAt` | 页面实测 |
| 前端改读 `detail.createdAt ?? sourceCreatedAt` | PASS：`panels.tsx:1934-1935` | 代码走查 |

## 3. 块 5 · F2 / F1

| 项 | 结果 | 证据 |
|---|---|---|
| 产物内超时常量 | PASS：`abort(),65e3` | 产物走查 |
| 非 409 分支刷新历史 | PASS：`catch` 中 `w(!0,!0)`（静默刷新，保留当前选中，不存在则选最新） | 产物走查 |
| 单元测试（503 failed 版本可见 / 64.999s 不中断、65s 中断） | PASS：本地 `vitest run src/panels.test.tsx` **88/88** | `panels.test.tsx:725,767` |
| 线上 409 单飞 | PASS：并发两次 POST → 一个 **201 v2 succeeded**、一个 **409 `ASSESSMENT_IN_PROGRESS`**；历史只有 v2，无重复版本 | 接口实测 |
| 真实 `analysis_failure` / 超时路径 | 单测 + 产物走查覆盖，生产不可控触发，**不记线上 PASS** | — |

## 4. chat_paste 详情补验（造数）

- 创建：`POST /api/requirements`，`intakeOrigin:"chat_paste"`、`proposerName:"验收测试待删"`、`sourceChannel:"售后"` → **201**，`RQ-000336`，id `59278aad-d939-42bd-ad10-f043fe04a8e2`
- 落库：`source_type=web_manual` + `source_payload.intakeOrigin=chat_paste`；`source-counts` 聊天粘贴 **0→1**（现 335/333/0/1/1）
- 池：Tab「聊天粘贴 1」，行徽标「聊天粘贴 ·售后」，已分析 / 已推送
- 详情：来源「来自聊天粘贴 · 售后」，标题/描述/提出人（验收测试待删），**有**「编辑需求」；**无**执行人/更新时间/重复处理；创建时间 `2026/11/20 12:14:38`；评估区空态正常
- 证据：[rv-02-chatpaste-detail.png](rv-02-chatpaste-detail.png)、[rv-04-pool-chatpaste.png](rv-04-pool-chatpaste.png)、[rv-03-chatpaste-assessment.png](rv-03-chatpaste-assessment.png)
- Base：`baseRecordId=reczz28bnR1hXvZZ`，推送成功、`created:true`；审计 omitted 只有「AI模块建议」，**来源方式未被省略**（按 5c-2 应写「聊天粘贴」）。Base 表为 canvas 渲染，字段值需后端在删除前确认
- 通知：首推静默（`first_push` 返回 undefined），未写「系统通知事件ID」，无 PM 通知

## 5. 发现（P3，不计 FAIL）

- `assumptions` 前缀冒号偶发半角：v2 三条均为「假设:…」（U+003A），契约写「假设：」（U+FF1A）；前端 `/^(假设|推断)[：:]/` 兼容，显示正常；服务端 schema 只校验 `z.string().min(1)`，不校验前缀。
- 建议：服务端归一化为「假设：」，或契约明确两种冒号都接受。

## 6. 待清理（验完由后端删）

- App：`requirements` 1 行 `59278aad-d939-42bd-ad10-f043fe04a8e2`；派生 `base_push_runs 1`、`analysis_runs 1`、`requirement_score_versions 1`、`source_snapshots 1`、`pipeline_jobs`、`audit_events 4`、`requirement_assessments 2`（随需求外键级联）
- Base：PM 表 `reczz28bnR1hXvZZ`；收集表未变（0 行）
- 清理后应回 **334 / 333 / 0 / 1 / 0**，由测试复查 `source-counts`、`items:[]`、全表评估 0 行

## 7. 本轮资源消耗

- 模型调用 3 次：AI 分析 1 次（自动）、需求评估 2 次（v1、v2，均为 409 单飞验证的一部分）
- 无 Base 结构变更、无工作流改动、未停用任何自动化
