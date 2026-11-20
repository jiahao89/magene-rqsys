# 全量验收 · 测试块（需求池 / 新建 / AI 分析评分 / 需求评估）

- 日期：2026-11-20
- 环境：线上 `https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`（已登录租户会话，ego-browser）
- 方式：只读为主；表单只开不提交；未创建需求、未调用 intake-draft、未写 Base、未改评估数据
- 基线：`source-counts` = **334 / TB 333 / 手工 1 / 多维表格 0 / 聊天粘贴 0**（[01-source-baseline.json](01-source-baseline.json)）

## 1. 块 1：需求池（S1–S14）

| 项 | 检查 | 结果 | 证据 |
|---|---|---|---|
| S1 | 五个 Tab 顺序、默认全部、0 计数显示 0 | PASS | 基线 JSON + [01-pool-all.png](01-pool-all.png) |
| S2 | 点击 Tab 过滤、URL `source` 更新、分页回第一页 | PASS | 手工 `?source=web_manual`；[16-block1-deeplinks.json](16-block1-deeplinks.json) |
| S3 | 深链/刷新/无效值回退 | PASS | base_form、chat_paste、invalid 三组；[16-block1-deeplinks.json](16-block1-deeplinks.json) |
| S4 | 导出当前来源、行数一致、列不变 | PASS | web_manual 导出 1 行；[03-export-webmanual.csv](03-export-webmanual.csv) |
| S5 | 旧来源下拉移除、其他筛选不受影响 | PASS | 「更多筛选」只剩优先级/排序/负责人/分析/推送/批次/时间，无来源控件 |
| S6 | 行徽标/色条：TB 无、手工橙、多维表格蓝、聊天紫 | PASS（0 行来源用本地用例） | TB 行无徽标；手工行「手工·终端用户」+ 橙色条；[02-pool-manual.png](02-pool-manual.png) |
| S7 | 详情来源说明；非 TB 只留标题/描述/提出人、无来源徽标 | PASS（base/chat 0 行，本地用例） | 手工「来自手工录入 · 终端用户」，无 TB 字段；[15-detail-manual-source.png](15-detail-manual-source.png)；TB RQ-000308 八个 TB 字段 |
| S8 | 计数失败降级 | NOT RUN（目标环境未注入故障；本地测试覆盖） | 如实记录，不判 FAIL |
| S9 | 非活跃视图隐藏计数、切回恢复 | PASS | [07-nonactive-counts-hidden.png](07-nonactive-counts-hidden.png)；隐藏后 Tab 无数字，切回 334/333/0/1/0 |
| S10 | 计数与列表一致 | PASS | source-counts 334/333/0/1/0；分页列表 all=334、TB=333、手工=1、base/chat=0（[01-source-baseline.json](01-source-baseline.json)） |
| S11 | 搜索/其他筛选无回归 | PASS（搜索实测；其余沿用 178 条 Web 用例） | 搜索「验收测试：手工录入需求」命中 1 条 |
| S12 | 无新迁移/无 Base 变更 | PASS（代码侧对账） | 来源计数只改接口/前端；本轮验收未触发 Base 写入 |
| S13 | 目标环境 Tab/深链/导出/详情逐项 | PASS | 本表 + 截图 |
| S14 | 两仓一致/门禁 | PASS（后端/文档报告） | 见 BACKEND 与 DOC 证据 |

**块 1 结论：PASS**，S8 未在目标环境注入故障，S6/S7 的 base_form/chat_paste 两类因线上 0 行由本地用例覆盖。

## 2. 块 3：新建需求（与前端共同）

| 项 | 检查 | 结果 | 证据 |
|---|---|---|---|
| N1 | 手工表单字段齐全 | PASS | [08-manual-create-form.png](08-manual-create-form.png) |
| N2 | 空提交校验、无请求 | PASS | 「请填写标题、需求描述，并选择来源渠道。」；[09-manual-create-empty-validation.png](09-manual-create-empty-validation.png) |
| N3 | 标题/描述/渠道 API 边界 | PASS | 201 字、20001 字、缺渠道均 **400**；验收后计数仍 334 |
| N4 | 来源链接格式 | PASS（前端实测） | `ftp://` 被拦；前端证据 02-frontend 文档 N4 |
| N5 | 聊天粘贴入口/长度 | PASS（UI） | 聊天内容 0/20000；[11-chat-paste-panel.png](11-chat-paste-panel.png)；空串/20001 字 API 均 400 |
| N6 | AI 草稿 + 重复提示 | **BLOCKED（未造数）** | 会消耗模型并写 `intake.*` 审计；本轮未执行，沿用存量 PRD-26 验收与组件用例 |

**块 3 结论：PASS（N6 BLOCKED）**。手工提交成功路径也未执行（避免生产数据）；校验路径和 UI 均通过。

## 3. 块 4：AI 分析、评分、优先级覆盖

| 项 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 4.1 | AI 分析字段齐全（facts/inferences/missing/blind_spots/受众/模块/类型/置信度） | PASS | RQ-000308 detail DTO 含全部字段（[14-block4-detail.json](14-block4-detail.json)）；UI 显示模块/类型/人群/低置信度 |
| 4.2 | 评分公式与九项输入 | PASS | 2.00 / P3 / v5 / 低置信度；U/M/S/C 九项、α、置信度理由均展示；[12-detail-ai-analysis.png](12-detail-ai-analysis.png) |
| 4.3 | 人工优先级入口与历史覆盖 | PASS（只开不写） | 「设置人工优先级」展开 P0–P3 + 原因；RQ-000316 现有 v2「PM 人工」证明覆盖链路；[13-priority-override-dialog.png](13-priority-override-dialog.png) |
| 4.4 | AI 分析失败可见 | OBS | RQ-000335 三次上游 502，`failed_retryable`；属供应商故障，非代码 FAIL |

**块 4 结论：PASS**（优先级覆盖未做写入实测，读态 + 历史数据证明）。

## 4. 块 5：需求评估（A1–A15）

| 项 | 检查 | 结果 | 证据/说明 |
|---|---|---|---|
| A1 | 入口、按需、空态不自动调用 | PASS | 详情空态「还没有评估结果」；[assessment-rq308-after-cleanup.png](</Volumes/Files/A_Projects/RQ-Sys/.scratch/iteration-5/evidence/20261120/assessment-rq308-after-cleanup.png>) |
| A2 | 完整输入生成、字段渲染 | PASS（复用本轮 v3） | v3 investigate/medium，范围/可行性/假设/提示词完整；[ASSESSMENT-RQ308-REVIEW](</Volumes/Files/A_Projects/RQ-Sys/.scratch/iteration-5/evidence/20261120/ASSESSMENT-RQ308-REVIEW-20261120.md>) |
| A3 | 空输入生成、不编造 | PASS（复用本轮 v1/v4） | investigate/low；明确写依据不足、不编造 |
| A4 | 输出契约、失败不展示半成品 | PASS | v1/v3/v4 全字段、value string、假设前缀；v2 failed output=null |
| A5 | 版本化、唯一键、输入回读 | PASS（回填按 PRD 延期） | v1–v4 chips/倒序；inputs 三键在 v4 已对齐；切版本回填下一轮 |
| A6 | 失败版本/错误提示/重试 | **FAIL（前端 F2）** | 非 409 的 429/503/500/超时只提示错误，不刷新历史，failed 版本不出现；`panels.tsx:1776-1784` |
| A7 | 429/409 单飞 | PASS（复用本轮验收） | 409 `ASSESSMENT_IN_PROGRESS`；429 等待文案有组件用例 |
| A8 | 提示词折叠/复制 | PASS（组件用例 + 截图） | 折叠区/复制按钮在；剪贴板降级有测试 |
| A9 | inputs 落库、需求/Base/分析不变 | PASS | v4 inputs 三键齐全；清理后需求 334、分析未变 |
| A10 | PII/注入 | PASS（用例 + 输出抽查） | 无 PII/密钥/内部链接；maskPii 在模型前 |
| A11 | skill 同源 | PASS（后端断言） | prompt 与 SKILL.md 同源断言；promptVersion v1 |
| A12 | 四条样例（完整/缺失/不可行/价值存疑） | **NOT RUN（样例集已备）** | [SAMPLES-20261120.md](</Volumes/Files/A_Projects/RQ-Sys/.scratch/ai-assessment-samples/SAMPLES-20261120.md>)；本轮未跑 4 条模型调用 |
| A13 | 无回归/两仓/门禁 | PASS（后端/文档报告） | Web 178/178、route 145/145、alignment 36/36 |
| A14 | 目标环境生成一次并清理 | PASS | v4 生成后删除；`items:[]`、表 0 行 |
| A15 | 性能/超时 | **FAIL（前端 F1）** | UI abort **60s** 与服务端 60s 边界抢跑，PRD 要求 65s；`panels.tsx:1768`；POST 实测 31–42s |

**块 5 结论：FAIL（P2×1 + P3×1）**：A6 失败版本不刷新（F2，P2）、A15 超时 60s vs 65s（F1，P3）；A12 未执行。其余 A1–A5、A7–A11、A13–A14 通过。

## 5. 测试块结论

- 块 1 PASS；块 3 PASS（N6 BLOCKED）；块 4 PASS；块 5 **FAIL**（2 个前端修正项，另 A12 未跑）。
- 未造生产数据；验收前后需求总数均为 334；未触发 Base/通知。
- 证据目录：`.scratch/full-acceptance-20261120/`；评估复用证据：`.scratch/iteration-5/evidence/20261120/`。
