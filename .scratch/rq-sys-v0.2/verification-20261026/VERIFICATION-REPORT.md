# RQ-Sys V0.2 全功能验证报告

- 日期：2026-10-26（Asia/Shanghai）
- 范围：V0.2 PRD 全部功能（Web 手工建单/编辑、来源模型、主 AI、六层人群、负责人、Base 平台键、U/M/S/C 规则、RICE Beta、Kano Beta、TB 兼容与同标题保留），并回看 MVP 主链路。
- 结论：**本地全链路验证通过；F-09/F-10 与 F-12 修复已发布到目标（最新 release `7700883606495153388` / commit `3beaec0`，finished、无错误日志）并完成目标复验；PRD §7 的 12 项验收标准本地与目标环境均已复验通过（#11 人群标签新增目标合成验证：多选→空集→AI 重跑保留、版本/审计/无 Base 副作用）。** 目标复验确认手工需求重复推送始终只有 1 条 Base 行，负责人/内容变更通知字段正确；F-04 非法 UUID 目标返回 404；F-05 契约矩阵已核对目标 Base 312/312 平台键；F-01/F-02/F-03 前端修复已在目标 UI 点检；F-12 畸形 URL 编码不再导致 500。**运行层仍待复核（见 5C：周计划当前周三 09:00，预期周一 09:00；触发器 enabled；队列 0 active）**。T16 AC01–10 已全部通过：AC05 经用户确认以正式 Base 为验收例外；AC06 的空→A/A→B/内容变更/AI重试/重复静默/PM 快照失败本地注入均通过，Base 自动化“负责人变更”经史东升确认送达。**代码与验收票可收口；定时任务按运营配置单独管理，不作为 MVP 验收强关联项**（见 5C：当前单 weekday=周三 09:00；周一/周三/周五需功能改动；触发器 enabled；队列 0 active）。

## 1. 基线

| 对象 | 值 |
|---|---|
| 根仓 HEAD | `7e79fc0`（2026-10-26 08:05，“Report import counts…”，工作树无已跟踪改动） |
| 妙搭仓 HEAD | `9eba60c`（同内容 mirror，2026-10-26 08:05） |
| 目标 Online release | `7700759824770141217`，commit `9eba60c…`，status `finished`，`error_logs=[]`，创建于 2026-10-26 08:05:58 CST |
| 目标 app | `app_17fqkjwyx1u`，Online URL `https://ecn8egz1lhkq.feishu.link/app/app_17fqkjwyx1u`，访问范围 `Tenant`、需登录 |
| 本地验证库 | 独立数据库 `rq_verify_20261026`，从零执行 0001–0017 共 18 个迁移 |
| 本地 E2E 接缝 | 真实 PostgreSQL 仓储 + 真实 HTTP handler + 真实 worker；AI/Base 为受控替身（与 Spec V02-S00「已确认的测试接缝」一致） |

## 2. 自动化门禁结果（本地）

| 检查 | 结果 | 证据 |
|---|---|---|
| 根仓 typecheck | 通过 | `typecheck.log` |
| 根仓 build（API + Web） | 通过；Web JS 508.07 kB（gzip 156.54 kB） | `build.log` |
| 根仓 API 测试 | **449 / 449 通过**（含 F-04 非法 UUID 404、F-12 畸形 URL 编码、F-09/F-10/PM 快照失败恢复回归用例） | `full-test-f10.log` / `harness-malformed.log` |
| 根仓 Web 测试 | **82 / 82 通过**（新增手工详情显示回归用例） | `full-test-f10.log` |
| 两仓对齐 | 通过：43 个模块逐字一致、28/28 共用逻辑一致、无未声明漂移 | `alignment.log` |
| 契约矩阵 | 20 通过 / 0 失败 / 1 警告 / 3 跳过（警告为联系人搜索缺 employee-id；跳过项为 TB 网关、真实 AI、Base 写入） | `contract.log` |
| `git diff --check` | 通过 | 本轮执行 |
| 妙搭 typecheck | 通过 | `miaoda-typecheck-basefix.log` |
| 妙搭 eslint / stylelint | 通过 | `miaoda-eslint-final.log` / `miaoda-stylelint-final.log` |
| 妙搭路由测试 | **114 / 114 通过** | `miaoda-route-basefix.log` |
| 妙搭 build:prod | 通过；client 1,308.32 kB（gzip 407.38 kB，仍有 >500 kB 警告） | `miaoda-build-basefix.log` |

## 3. 本地端到端功能验证（真实 DB/HTTP/worker）

脚本：`.scratch/rq-sys-v0.2/verification-20261026/e2e/harness.mts`（测试夹具 `fixtures.mts`，只位于 `.scratch`，不参与构建）。Base 客户端与生产组合根一致，套了 `RateLimitedBaseClient` 限流装饰器。
结果：**233 项断言通过，0 项观察性缺口**；F-04 修复后 EQ-02 的 404 断言通过，F-09 修复后 Base 行复用断言通过（`e2e/harness-after-f04-f05.log`）。重跑命令：

```sh
node --import tsx .scratch/rq-sys-v0.2/verification-20261026/e2e/harness.mts
```

覆盖场景与关键断言：

| 场景 | 关键结果 |
|---|---|
| S0 健康/身份 | health/ready 200；无身份访问受保护路由 401；初始指标全 0 |
| S1 手工收录 | 201 + `RQ-000001`；同键同内容重放 200 同 ID；同键异内容 409；缺键/缺描述/未知渠道/未发布模块 400；DB `source_type=web_manual`、`pull_state=collected`、无 TB ID/来源配置；快照/审计/回执各 1；TB 人员映射 0；空搜索 200 空数组（F-01 回归）；列表/详情来源区分、无 TB 地址 |
| S2 主 AI + 首推 | 受控 provider 只调用 1 次；PII（手机号/邮箱/带标签姓名）未进模型；规则 v1 确定性产出 **P2**（高+中+低+无法判断=1.5）；模块/类型/2 条人群建议落库；Base 写入平台键 `RQ-000001`、不写 TB 字段、执行人=人工负责人 A、通知=`owner_assigned` 致 A、PM 待处理；映射表仍为空 |
| S3 改派 | 分配版本 1→2；Base 执行人/收件人改为 B、通知=`owner_changed`；只影响本条，不污染 TB 映射 |
| S4 编辑/版本/PM 快照 | 实质编辑 v1→v2，新快照 v2，审计 1；同键 replay；同键异内容 409；旧版本 409 带当前版本；重跑分析 v2、同 recordId 推送、PM 快照保存“已采纳/方案设计”后 Base PM 重置“待处理”；元数据编辑不改版本、不重跑 AI、不重置 PM；模拟 PM 读取失败时 Base 行未被改写，恢复后重试成功并补快照 |
| S5 人群 | L2/L4→L1/L2→明确空集，版本 1/2/3；旧版本 409；不触发分析/推送/通知、不改 PM；AI 重跑保留人工空集与确认状态 |
| S6 RICE | 初始待补充/无分数；部分草稿可存；完整输入 `200×3×0.8÷4=120.0`、状态已计算、actor 留痕；Effort=0、Confidence=150 均不出分数；409 冲突；历史累计；主优先级/流水线/分析/Base 推送零变化 |
| S7 Kano | 含 PII 资料导入即标记、批准 409；干净资料批准；手动运行 v1 成功：`AI假设（待验证）`、候选“期望型”、证据 S1、无数值统计字段、模型/提示词版本留痕；显式重跑 v2；伪造证据引用 v3 安全失败；源内容变更后旧报告 `staleInputs=true`；主分析/推送零变化；TB 需求同样可运行 |
| S9 TB 兼容 | 来源创建不暴露内部 ID；全量同步 4/4 成功、计数审计 fetched=4/duplicateIds=0/processed=4；同标题两条均保留且后者仅 `duplicate_of` 提示；RQ 编号跨来源连续；TB Base 行同时写平台键与 TB ID；已映射负责人推送、未映射 `pending_mapping` 不误推；`source_only` 零下游；全量重放不新增/不重编号；映射补齐后 scheduler recheck 自愈推送；TB 行 Web 编辑 409；手工同标题独立编号不受重复提示；批次 DTO 使用 `id`（F-02 回归）；分页无重复；TB 需求可跑 Kano |
| 汇总 | 6 条需求全部 `pushed`（含 1 条新增手工需求）；审计可读且无手机号等敏感值 |

## 4. 本地浏览器 UI 验证

环境：Vite `127.0.0.1:5173` + 验证 API `127.0.0.1:8791`（真实 DB + 受控 AI/Base + 250ms worker）。使用 ego-browser 实际操作，截图见 `ui/`。

| 页面/交互 | 结果 |
|---|---|
| 需求池列表 | 6 条；“手工”角标、已收录/已同步区分、排序与摘要正常；截图 `requirements-list.png` |
| 手工需求详情 | 平台 ID、负责人（手动指定）、四阶段、录入上下文、人群编辑器、AI 类型/人群建议、U/M/S/C 理由、Base recordId、推送时间、分析历史均展示；截图 `detail-manual-top.png`、`detail-dark.png` |
| Beta 面板 | 详情次级入口默认收起；展开后 RICE 四项草稿/依据/状态/源版本/草稿版本、Kano 资料（v2 已批准 + 覆盖限制 + 来源）与历史报告均可见；截图 `detail-beta-panel.png`、`beta-viewport.png` |
| RICE UI | 填写 200/3/80/4 保存 → 提示 `RICE = 120`、状态“已计算”；截图 `detail-rice-saved.png` |
| Kano UI | 选择 v2 触发 → 新报告 v4 成功、标注 `AI假设（待验证）`；截图 `detail-kano-run.png`、`detail-kano-success.png` |
| 人群 UI | L2/L3 选中态 `aria-pressed=true`，保存后版本递增；截图 `detail-audience-saved.png` |
| 编辑 UI | 修改描述保存成功（API 源版本 v5、审计/分析/推送完成）；修复后详情显示新描述；截图 `detail-edited-refreshed.png`、`detail-manual-fixed.png` |
| 新建 UI | 提交后进入详情 `RQ-000007`；等待后状态变为已分析/已推送；截图 `detail-created-requirement.png`、`detail-created-analyzed.png` |
| 负责人 UI | 负责人下拉加载已有人员映射，指派成功并显示“手动指定”；截图 `detail-owner-picker.png`、`detail-owner-assigned.png` |
| 总览 / 来源 / 同步记录 / 规则 | 指标、四阶段、批次 4/4、周计划未启用、规则 v1 阈值 3/2/1 均正确；批次明细头显示完整批次 ID（F-02 修复验证）；截图 `overview.png`、`sources.png`、`sync-records.png`、`sync-batch-detail.png`、`rules.png` |
| 深色 / 390px 移动端 | 无整页横向溢出（scrollWidth=390）；Beta/人群/编辑区可读；截图 `detail-dark.png`、`detail-mobile-390.png` |

## 5. 目标环境只读核对

| 项目 | 结果 |
|---|---|
| 登录门禁 | app 与 `/api/health` 未登录均 **302** 到飞书授权；access scope `Tenant`、`require_login=true` |
| 环境变量（只列名） | online/dev 均含 10 项：`TEAMBITION_GATEWAY_URL`、`GATEWAY_API_KEY`、`AI_API_KEY`、`FEISHU_APP_ID/SECRET`、`BASE_APP_TOKEN`、`BASE_TABLE_ID`、`BASE_FIELDS_JSON`、`RQSYS_WEB_BASE_URL`、`RQSYS_PM_LEADER_USER_ID`；无 `RQSYS_ENABLE_TEST_FIXTURES` |
| 需求库状态 | 315 条：platform ID 非空 315、去重 315；`web_manual` 0；synced/analyzed 315；pushed 270；pending push 45、push failed 0；pending_mapping 45；同标题提示 27；活动作业 0 |
| V0.2 schema | `requirement_intake_receipts`、`requirement_edit_receipts`、`rice_drafts`、`rice_draft_history`、`kano_evidence_versions`、`kano_runs` 全部存在；requirements 新列可查询 |
| U/M/S/C 规则 | published v1，阈值 `{p0:3,p1:2,p2:1}` |
| Beta 数据 | intake/edit 回执 0、RICE 草稿/历史 0；Kano 资料 1 份 approved、Kano 运行 1 次 succeeded（`deepseek-chat`、`rq-kano-v1`、evidence v1、source v1、`AI假设（待验证）`、报告 key 仅 capabilities/gaps/confidence/… 无样本量/比例/系数） |
| 正式 Base `TB需求池`（`GRnEboCIga7Omas8RwgcDmmgnib` / `tbl6Gfi0KJ2a1llK`） | 312 行；`需求平台ID` 非空且唯一 **312/312**；全部“已推送”；`AI优先级建议` 仅 RQ-000099 为 P2；行集合与 DB 对比：Base 独有 0，DB 独有 3（RQ-000317/332/342，均为待映射的重新导入同标题记录，尚未首推） |
| T18 回读（RQ-000099） | 平台键 `RQ-000099`；`AI优先级建议=[P2]`；`AI分析版本="3"`；`PM状态=待处理`；`源版本=1`；执行人空；PM 确认模块/优先级空；系统通知事件 `ai_retry_success…:sv1`、类型“AI 重试成功”、收件人王赵云 |
| 错误日志/指标 | 近 24h ERROR 日志 0；requests error 指标近期 0，仅有 2026-10-23 一条历史错误（早于当前 release） |

> 说明：契约矩阵已支持 `CONTRACT_TARGET_BASE_TOKEN/CONTRACT_TARGET_TABLE_ID` 只读核对目标正式 Base（F-05）；本轮得到 312 行 / 312 唯一平台键 / 0 空值。

## 5A. 目标环境登录后写入验证（2026-10-26，用户授权）

目标 Online release `7700759824770141217`（commit `9eba60c`）下，在正式 Base 用 1 条明确标注“验收-请忽略”的合成手工需求完成真实链路：

| 步骤 | 结果 |
|---|---|
| 登录 | 通过扫码进入 `青岛迈金智能科技股份有限公司 / 贾浩`；应用可访问（此前 `not_in_scope` 系应用域名旧会话） |
| 建单 | Web 表单创建 `RQ-000343`（Web 手工 / 产品研发测试 / 模块爬坡 / 类型体验优化），DB `web_manual`、`collected`；首推 Base 行 `reczz28RsZ117lC3` |
| 主 AI | v1 analyzed，优先级 P3（规则 v1 确定性），模块“导航（路线/离线/位置点）”，类型建议“性能优化”；模型明确识别并低置信度处理了“验收占位”文本 |
| Base 首推 | 平台键、标题、AI 模块/优先级/分析版本、源版本、PM 状态“待处理”、需求深链均写入；无 TB 字段、无执行人（首推静默） |
| 指派 | 通过目标 UI 指派给当前登录账号“贾浩”（`user_id=99f56141`），分配版本 1→2；Base 行执行人被解析为 `ou_eb8d…` |
| 编辑 | 描述实质编辑 v1→v2（新快照/审计/分析 v2 P2）；目标 UI 仍显示旧描述（命中 F-01，本地已修复未发布） |
| RICE | 详情 Beta 面板保存 200/3/80/4，目标 UI 显示“已计算 · RICE = 120”，源版本 v1、草稿版本 v1 |
| Kano | 用目标已批准的合成资料 v1 手动运行：`deepseek-chat`、`rq-kano-v1`、3 个能力项、`AI假设（待验证）`，证据不足处明确标注、无样本量/比例/系数；UI 报告展示正常 |
| 清理 | 删除全部合成的 3 条 Base 行；删除该需求及分析/推送/快照/RICE/Kano/审计等关联行；回读：315 需求、0 手工、Base 312 行、RQ-000343 0 行、RICE 0、活动作业 0；仅保留 T17 的 1 条 Kano 运行 |

**目标阻断缺陷（F-09）**：该需求共触发 4 次推送（首推、两次负责人推送、一次内容变更），每次都把 `base_record_id` 换成新值，并**新建一条 Base 行**；清理前 Base 中同时存在 3 条 `需求平台ID=RQ-000343`（其中一条 `执行人` 为空）。这违反 PRD §7.5“平台 ID 为 Base 幂等键”和 §6 的“同一条 Base 行”。负责人首次指派行的四个通知系统字段也未观察到落库（F-10）。两项均已在发布后复验修复，见 5B。


## 5B. 发布后目标复验（release `7700859734937226543` / commit `7359934`）

- 发布链：`7700844703307533617 / 9f16d18`（F-09 + F-04 + F-01/F-02/F-03）→ 复验 F-10 未过 → `7700859734937226543 / 7359934`（F-10）。
- **F-09 单行幂等**：`RQ-000344` 首推创建 `reczz28RwmjHFsj3` 1 行；指派贾浩后仍为同 1 行同一 `base_record_id`；内容编辑 v1→v2 后仍为同 1 行同一 `base_record_id`，`base_push_runs` 三次均 `pushed`。
- **F-10 通知**：指派后 Base 回读 `系统通知事件ID=owner_assigned:cf525833-…:sv1:none:99f56141`、`系统通知类型=已分配负责人`、`系统通知收件人=贾浩`、`系统负责人通知归并值=贾浩`；编辑后 `系统通知事件ID=substantive_update:cf525833-…:sv2`、`系统通知类型=需求内容变更`、收件人仍为贾浩，`PM状态=待处理`，`pm_snapshots=1`，分析 v2 P2 且仍在同一 Base 行。
- **F-04**：目标应用 API（带 CSRF）`/api/requirements/not-a-uuid` 返回 404 JSON；普通非法 UUID 已闭环。
- **F-12（畸形 URL 编码）**：已发布 `7700883606495153388 / 3beaec0`；目标应用 API 对 `%E0%A4%A` 返回 400（网关层拦截），本地 `safeDecodePath` 单测/E2E 覆盖 app 内解码路径，均不再 500。
- **F-05**：`CONTRACT_TARGET_BASE_TOKEN/TABLE_ID` 只读核对目标正式 Base：312 行 / 312 唯一平台键 / 0 空值；POC 字段结构检查 13 通过 / 0 失败。
- **F-01/F-02/F-03**：目标详情显示编辑后的当前描述（v2），8 个“手工”徽标、0 个“TB”徽标，已分析后不再出现“AI 分析未完成”；截图 `ui/target-final-edit.png`。
- **清理**：删除 2 条合成 Base 行及 RQ-000343/344 关联的分析、推送、快照、审计等行；回读 315 需求 / 0 手工 / Base 312 行 / 0 活动作业 / 0 PM 快照。
- **AC05 例外确认**：用户 2026-10-26 确认正式 Base 可作为 AC05 验收载体（POC 表无 `需求平台ID`）；AC05 按例外通过。
- **AC06 补测（完成）**：A→B 改派通过（贾浩→史东升，同 Base 行，`owner_changed`/“负责人变更”/收件人史东升，3 次推送均成功）；重复静默通过（`replay:true`、Base 时间/通知不变）；PM 快照失败恢复按用户选择做**本地故障注入**（首读失败不写 Base、恢复后重试快照 1 条、PM 状态重置）；Base 自动化 workflow enabled，史东升确认收到“负责人变更”通知。AC06 已关闭。
- **PRD #11 / T09 目标补验**：目标合成需求首次未确认正常推送；保存 L2/L5（version 1/审计）→ 保存确认空集（version 2/审计）→ AI 重跑成功（分析 v2 P2）后人工空集仍保留；`base_push_runs` 仍 1、无新 Base 推送/通知；UI 显示“已确认为空”。
- 观察 **F-11**：一次 Base `records filter` 返回 1254607，worker 自动重试后成功且未新建行；属外部 API 瞬时错误，但会短暂置 `push_state=failed`，需纳入监控。
- **票面口径说明**：AC05 经用户确认以正式 Base 为验收例外；AC06 的空→A、A→B、内容变更、重复静默、PM 快照失败本地注入均已覆盖，Base 自动化“负责人变更”通知经史东升确认送达。T16 AC01–10 全部通过。

## 5C. 运行层只读复核（2026-10-27）

- 查询方式：`apps +db-execute` 被 CLI 归类为 high-risk-write，即使 SELECT 也需要 `--yes`（用户遇到的 exit 10 确认门禁，未绕过）。本轮改用 read-risk 的 `apps +db-data-export` 导出 `source_configs/pipeline_jobs/sync_batches/audit_events` 后本地分析，未执行任何目标写入。摘要见 `target-readonly/runtime-readonly-summary.json`。
- **周计划当前状态**：来源 `室外产品-码表软固件需求池`，`schedule_enabled=true`，`weekday=3`（**周三**），`09:00`，`Asia/Shanghai`，最后更新 `2026-10-23 09:36`。与文档约定的**周一 09:00**不一致。
- **恢复触发器**：`rqsysWeeklySyncRecovery`，`enabled`，cron `*/30 * * * *`，`Asia/Shanghai`。
- **队列状态**：`pipeline_jobs` 0 queued/running（644 条历史：640 succeeded / 4 failed）；`sync_batches` 18 条（17 succeeded / 1 failed）；最近一次批次是 2026-10-25 20:21 的 manual full sync（315/315 succeeded）；最近一次 scheduled 批次是 2026-10-23 09:41，窗口 `2026-10-21T01:00Z`（= 周三 09:00 Asia/Shanghai），288/288 succeeded。
- **结论**：代码/功能验收保持完成；**定时任务属于运营配置，不是强关联的 MVP 验收项**，因此周计划日期不作为验收阻塞。当前为单 weekday 配置（周三 09:00），与文档约定的周一不同；用户要求的“周一/周三/周五”需要多 weekday 功能支持，见下。
- **配置能力限制**：当前来源模型只有单个 `schedule_weekday`（1–7），无法直接保存“周一/周三/周五”；需要新增多 weekday 字段、due 窗口计算、API/UI 与迁移后发布。直接改成周一还可能让下一次 30 分钟触发器立即补跑 `2026-10-26 09:00` 的逾期窗口并触发真实 315 条同步，需先确定变更窗口。

## 6. PRD 第 7 节验收矩阵

| # | 验收标准 | 本地 | 目标环境 |
|---|---|---|---|
| 1 | 唯一、连续、不可编辑平台 ID；重复请求不重复建单/Base 行 | 通过 | 通过：RQ-000344 首推/指派/编辑三次推送始终同一 Base 行 |
| 2 | 标题/描述/渠道必填；描述不完整不阻断 | 通过 | 通过（目标实际建单校验/提交成功） |
| 3 | 两种来源同池可区分；手工不伪装“已同步” | 通过（UI 有 F-02 标签瑕疵） | 通过：目标手工行显示“已收录/来自 Web 收录”，TB 行显示“已同步”；旧发布仍带 F-02 徽标 |
| 4 | 模块/负责人可选；模块责任人为候选；未分配可推；人工指定首推通知本人 | 通过（API + UI 指派/通知字段） | 通过：未分配首推静默；指派后 `owner_assigned` + 收件人本人；编辑后 `substantive_update` 收件人本人 |
| 5 | 平台 ID 为 Base 幂等键；TB 字段仅 TB 来源 | 通过 | 通过：平台键 312/312；手工行不写 TB 字段；重复推送复用同一行（F-09 已复验） |
| 6 | 编辑生成新版本/审计/PM 快照/重跑 AI/同 Base 行/置待处理 | 通过 | 通过：v1→v2、分析 v2 P2、PM 快照 1、同一 Base 行、PM 状态待处理；详情显示新描述（F-01 已复验） |
| 7 | 默认分析含模块/整体置信度/六层人群/U-M-S-C 理由；仅已发布规则产 P0–P3；Beta 不影响 | 通过（v1→P2；人群/证据；Beta 隔离） | 规则 v1 + 手工行 P3、编辑后 P2 均确定性产出；RQ-000099 P2 回读通过 |
| 8 | Beta 只在详情次级入口；Beta 失败不影响主状态 | 通过 | 通过：目标详情 Beta 面板可开，RICE/Kano 操作未改主状态 |
| 9 | RICE 人工输入；缺项/非法不产正式分；不改主优先级 | 通过（120.0 复算；非法 null） | 通过：目标 UI “已计算 · RICE=120”、草稿/源版本正确，主优先级未变 |
| 10 | Kano 输出候选类型/人群/解释/证据/置信度/状态/缺口；标记 AI 假设；无虚构统计 | 通过 | 通过：目标真实模型运行 + UI 回读，`AI假设（待验证）`，无统计字段 |
| 11 | PM 可编辑人群；区分 AI/人工并留历史；无标签不阻断 | 通过 | 通过：目标保存 L2/L5→确认空集→AI 重跑保留；版本/审计/无 Base 推送；UI 确认态正确 |
| 12 | 已发布 U/M/S/C 规则版本化确定性执行；未发布留空 | 通过 | v1 已发布，阈值 3/2/1；手工行 P3→P2 随分析版本变化；RQ-000099 P2 |

## 7. 工单收口状态

| 工单 | 状态 | 本轮核对 |
|---|---|---|
| T01–T08、T11–T15 | implemented-local | 本地测试/对齐全绿；本轮 E2E 覆盖其行为 |
| T09 | target-verified | 目标合成需求完成人群多选/空集/AI 重跑保留/版本审计/无 Base 副作用复核 |
| T10 | implemented-local | 规则 v1 种子与 P0–P3 复算通过；目标规则已发布 |
| T16 | target-verified | AC01–10 全部通过；AC05 经用户确认以正式 Base 为验收例外；AC06 空→A/A→B/内容变更/AI重试/重复静默/PM快照失败本地注入均通过，Base 自动化通知经史东升确认送达 |
| T17 | target-verified | Kano 目标真实模型运行与报告回读通过；RICE 目标 UI 点检（RICE=120）；Beta 不影响主流程已复核 |
| T18 | target-verified | 目标 Base RQ-000099 回读与 T18 记录一致；2026-10-26 已按 T10/迁移0017、目标回读和本地边界用例补勾 AC01–06（AC01 注明“用户代确认”来源） |

## 8. 本轮可复现命令

```sh
# 本地门禁
npm run typecheck && npm test && npm run build
npm run check:alignment && npm run check:contract && git diff --check

# 妙搭仓
cd rq-sys-miaoda
npm run type:check && npm run test:rqsys-route && npm run build:prod && npm run eslint && npm run stylelint
```

## 9. 缺陷与观察

### F-01（高，显示层，已修复并在目标复验）手工需求编辑后，详情“描述”仍显示初版内容

- 现象：手工需求源版本已到 v5、API 顶层 `description` 为新值、AI/Base 均使用新值，但详情描述始终显示 v1 的 `source_payload.description`。已用全新页面导航复核：DOM 与 API 不一致（`stale: true`）。
- 位置：`apps/web/src/requirement-view.ts:263`；同构 `rq-sys-miaoda/client/src/rqsys/requirement-view.ts:263`。
- 原因：`requirementSourceFacts()` 只从 `requirement.source`（来源快照 payload）取 description，没有优先使用 `RequirementDetail.description`；手工来源的 payload 不随编辑更新。
- 影响：PRD §7.6 的“编辑后详情反映新内容”无法被用户观察到；PM 可能以为编辑未生效。
- 修复：改为优先取详情顶层当前描述，回退 source payload；本地浏览器复核显示新描述，Web 82/82 通过；目标 release 复验显示 v2 描述。

### F-02（中，显示层，已修复并在目标复验）手工需求详情仍用“TB”徽标标注字段

- 现象：手工需求详情的标题/描述/提出人/执行人/状态/链接/创建时间/更新时间均显示“TB”徽标（title=“来自 Teambition 的原始字段”），与“Web 收录”来源标识冲突。
- 位置：`apps/web/src/panels.tsx:610`（`TbFieldLabel`）及详情使用处；同构 app 仓 `panels.tsx:552`。
- 影响：PRD §7.3 要求可区分来源；虽列表/页头有“手工/来自 Web 收录”，字段徽标仍会误导。
- 修复：徽标按 `detail.sourceType` 渲染“TB”或“手工”；本地浏览器复核手工详情 8 个“手工”、0 个“TB”，TB 详情仍 8 个“TB”。

### F-03（低，文案，已修复并在目标复验）已分析需求仍提示“AI 分析未完成”

- 现象：需求已分析完成、按钮为“重新分析”，摘要下提示仍写“AI 分析未完成，可在此重试分析。”
- 位置：`apps/web/src/panels.tsx:1025`；同构 app 仓 `panels.tsx:967`。
- 原因：`analysisRetryable` 为支持人工重跑把 `analyzed` 也算作可重试，指引文案复用了该布尔值。
- 修复：指引只在 pending/failed_retryable/running 时提示，running 单独文案；本地浏览器复核已完成分析时不再出现该提示。

### F-04（中，PRD 8.5 EQ-02，已修复并在目标复验）非法 UUID 路径返回 500

- 现象：`GET /api/requirements/not-a-uuid`、`GET /api/batches/not-a-uuid` 触发 PostgreSQL `22P02`，生产 server 兜底成 500。
- 修复：两仓 HTTP 路由在进入仓储前校验路径 ID；真实数据库组合根下非法 UUID 统一返回 404（测试替身仍可用短 ID 夹具）；覆盖需求/批次/条目/分析/负责人/推送/规则发布/人群/RICE/Kano 等 UUID 路由。
- 验证：本地 E2E 的 EQ-02 两条观察项消失（0 缺口）；根仓新增 `app.test.ts` 回归用例，API 447/447。目标发布后应用内 `fetch` 三个非法 UUID 路径均返回 404。

### F-05（中，验收工具，已修复并在目标验证）契约矩阵不能证明目标平台键

- 现象：`scripts/contract-matrix.mjs` 硬编码 POC Base `tblxbyvbdLGVnLaO`（无 `需求平台ID`），无法证明目标正式 Base 的平台键。
- 修复：新增 `CONTRACT_TARGET_BASE_TOKEN` / `CONTRACT_TARGET_TABLE_ID`（可选 `CONTRACT_TARGET_PLATFORM_FIELD`）只读核对：字段存在且为 text、全表平台键非空且唯一；不触碰写入路径。默认仍只检查 POC，避免误读生产表。
- 验证：对目标正式 Base 运行得到 `312 行 / 312 唯一平台键 / 0 空值`；POC 字段结构检查仍 13 通过 / 0 失败。

### F-06（已解除，环境）目标登录态 UI

- 已通过应用域名扫码 + OAuth 授权进入 `青岛迈金智能科技股份有限公司 / 贾浩`，完成目标写入点检；不再是阻塞项。

### F-09（阻断，Base 幂等，已修复并在目标复验通过）手工需求每次推送新建 Base 行

- 目标复现（RQ-000343，release `9eba60c`）：首推、两次负责人推送、一次内容变更共 4 次推送 → 4 个不同 `base_record_id`；清理前 Base 同时存在 **3 条** `需求平台ID=RQ-000343`，其中负责人/编辑推送新建的行 `执行人` 为空；每次推送均报成功。
- 根因：`RateLimitedBaseClient`（生产组合根在 `FeishuBitableClient` 外包的限流装饰器）**没有实现 `findByPlatformKey`**。适配器 `resolveExisting` 检测到 `client.findByPlatformKey` 不存在，就跳过平台键查找；TB 行还能由旧 `TB需求ID` 兼容键命中（因此历史 TB 验证未暴露），手工行 `requirementId=null` 没有兜底，于是每次 create。
- 本地修复：`apps/api/src/base/rate-limit.ts` 与 `rq-sys-miaoda/server/rqsys/base/rate-limit.ts` 增加转发；新增回归用例 `client.test.ts`（限流装饰器后手工需求两次推送复用同一行）与 `rate-limit.test.ts`（平台键方法也受限流）。本地 E2E 夹具改为与生产一致的“限流装饰器 + 真实适配器”，233 项仍全绿。
- 状态：**已在目标复验通过**（RQ-000344 首推/指派/编辑始终同一 Base 行）。

### F-10（已修复并在目标复验通过）手工需求首次推送后再指派负责人未产生通知

- 根因：手工来源的源快照不含 `sourceExecutorId/mappedFields`，`snapshotOwnerLookup` 返回 `answered=false`，被当成“负责人未知”，后续 `owner_assigned` 事件被吞掉。
- 修复：`web_manual` 且未记录已推送人工负责人时，前次负责人按 `none` 处理；新增真实手工快照形态回归用例。
- 目标复验：RQ-000344 指派后 Base 写入 `owner_assigned/已分配负责人/收件人贾浩`；编辑后写入 `substantive_update/需求内容变更/收件人贾浩`。

### F-11（观察，外部瞬时错误）Base records filter 偶发 1254607

- 现象：一次手工需求的 owner-reset 推送在 `findByPlatformKey` 的 records filter 上返回 `FEISHU_RECORDS_FILTER_CODE_1254607`（HTTP 400），worker 4 次重试后置 `push_state=failed`；随后人工/恢复重试成功，且 Base 仍只有 1 行，未产生重复记录。
- 判断：外部 Bitable filter 的瞬时错误，不是平台键逻辑回归；失败路径在创建前抛出，因此不会新建行。
- 建议：监控该错误码；若频率上升，在 Base filter 调用上增加有限指数退避或告警，不要用新建行兜底。

### F-12（中，路径解码，已修复并发布）畸形 URL 编码返回 500

- 现象：`GET /api/requirements/%E0%A4%A` 等非法百分号编码会让 `decodeURIComponent` 抛 `URIError`，落进 `server.ts` 的 500 兜底；普通非法 UUID 已由 F-04 收敛为 404。
- 修复：两仓 `http/app.ts` 新增 `safeDecodePath`；UUID 路径解码失败返回 404，人员姓名路径解码失败返回 400，不再抛异常。补 `app.test.ts` 回归用例与本地 E2E `畸形 URL 编码返回 4xx` 断言。
- 验证：本轮复验 API 449/449、Web 82/82、妙搭路由 114/114、E2E 233 项全绿且畸形 URL 断言通过；目标 release `7700883606495153388 / 3beaec0` 后，应用 API 对 `%E0%A4%A` 返回 400（网关层拦截），不再 500。根仓类型检查/构建、妙搭 lint/类型检查/生产构建、两仓对齐及 `diff --check` 通过。

### F-07（观察）目标 45 条待处理不是失败

- 45 条 `pending_mapping` 中：42 条已有 Base 行（负责人未映射，保持旧行），3 条为 T15 重新导入的同标题记录（RQ-000317/332/342）尚未首推；`push_failed=0`、活动作业=0。符合“无负责人/未映射不阻断其他需求”的不变量，但发布前建议确认这 45 条的负责人映射处理口径。

### F-08（观察）妙搭客户端包体仍 1.3 MB

- `build:prod` client 1,308.32 kB（gzip 407.38 kB），无按需拆包；与 PRD 8.5 EQ-09 的“Beta 按需加载”方向不符。根仓 Web 已 508 kB，非 V0.2 第 7 节门槛。

## 10. 剩余工作（建议顺序）

1. 复核 Online 周计划：上次只读快照是每周三 09:00，需求记录为每周一 09:00；本轮 `apps +db-execute` 的 SELECT 收到 exit 10、要求确认，未绕过该门禁，因此没有当前读数，也没有修改配置。
2. 持续观察 F-11（Bitable filter 瞬时 1254607），必要时增加退避/告警；最近快照中的未映射负责人需求按既有流程推进。
3. F-08 前端包体拆分属于非阻断性能优化，不在当前 V0.2 功能验收门槛内。

## 11. 证据索引

- 自动化日志：`typecheck.log`、`build.log`、`api-test.log`、`web-test.log`、`alignment.log`、`contract.log`、`miaoda-*.log`，以及修复后的 `full-test-after-fixes.log`、`build-after-fixes.log`、`api-test-after-fix.log`、`web-test.log`、`miaoda-route-final.log` 等
- 本地 E2E：`e2e/harness-after-base-fix.log`（233 PASS/2 OBSERVED，含限流装饰器）、`e2e/harness.mts`、`e2e/fixtures.mts`、`e2e/ui-server.mts`
- 浏览器截图：`ui/`（本地列表/详情/Beta/RICE/Kano/人群/编辑/新建/负责人/总览/来源/同步记录/批次明细/规则/深色/移动端；目标 `target-created-detail.png`、`target-created-analyzed.png`、`target-owner-assigned.png`、`target-rice.png`、`target-kano.png`、`target-edited.png`）
- 目标只读：`target-base-summary.json`（正式 Base 312 行、平台键 312/312 的唯一性与状态聚合；为避免留存生产标题/PII，原始全表导出已删除）
- 目标写入证据：`target/rq343-db.json`（需求状态/4 次推送）、`target/rq343-base-rows.ndjson`（清理前 3 条同平台键行，仅合成需求）、`target-base-summary.json`（清理后 312 行）
