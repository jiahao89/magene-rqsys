# RQ-Sys 迭代计划（2026-11-10）

> 依据：[生产就绪 PRD 增补](./2026-11-06-rq-sys-production-readiness-prd.md)（2026-11-10 修订版 §9 Gate、§13 待决口径）、[决策记录](./2026-11-06-production-readiness-decisions.md)、Ticket 批次 `.scratch/rq-sys-production/issues/`。
> 原则：
> 1. 每个迭代以**目标环境证据**收尾；本地测试通过只算「已实现」，不算「完成」。
> 2. 依赖用户口径的项（§13 Q1–Q4）先列为「待决」，不预先实现。
> 3. 不新增已取消范围：角色权限（PRD-16）、负责人维护（PRD-17）、人工优先级回写 Base（PRD-18）、Web 决策闭环（PRD-15）、Kano 状态流转（2026-11-10 用户决定暂不开发）。

## 0. 当前基线（2026-11-16）

| 能力 | 状态 |
|---|---|
| 上线 Gate | G1–G5 已通过（目标环境证据见下方部署记录）；G6–G8 待试点运营动作 |
| 正式 Base 推送与对账 | 330 条活跃需求全部已推送，Base 与 App 优先级一致 |
| 优先级 | `umsc_weighted_v3` 阈值规则已发布（p0=10 / p1=7.8 / p2=6）；基准为模拟基准，已确认接受（PRD-24） |
| 负责人 | 待匹配需求按 Q1 以空负责人推送（PRD-21）；妙搭使用平台通讯录（PRD-25） |
| 运维 | 运营指标、CSV 导出、作业告警、AI 额度暂停、迁移状态、Gate 状态页、备份恢复演练均已上线并验证 |
| 重复/来源提示 | Q2 重复标记字段已配置（尚无真实判定）；Q4 来源已移除提示已上线 |
| 验证（2026-11-16） | API 596、Web 125 全绿；根仓库与妙搭 typecheck、alignment、migrations 检查通过 |

## 部署记录（2026-11-13）

- 迁移 `0027_source_missing.sql` 已应用到 dev 并 `+db-env-migrate` 发布到 online（`changes_applied=2`，之后 env-diff 为空）；线上 `requirements.source_missing_since` 与 `requirements_source_missing_idx` 已回读存在。
- 妙搭发布（commit → release）：`c428d41` → `7707521422147276040`；`845d5e3` → `7707523097784470777`；`fc010ac` → `7707525674181758225`。三次均 `finished`、`error_logs=[]`。
- 目标环境已验证：总览优先级卡片下钻链接（`?priority=PN&sort=priority_asc#requirements`）；作业运维页迁移提示（目标库由平台管理迁移时显示“无法判断”，不误报落后）；需求列表/详情正常；发布后 error=0。
- Q1 存量：`owner-recheck` 现在会为“已分析、待推送、映射未建立”的需求以空负责人入队一次（owner 状态保持 pending_mapping、first_push 静默不通知）。2026-11-13 14:00 automation tick 已补推 **44/44**：其中 43 条一次成功；RQ-000157 首次因飞书过滤接口瞬时错误（1254607）失败，手工重试后成功。正式 Base 对应行「执行人」保持为空、通知字段为空（静默），未覆盖 PM 维护字段。
- 最终对账：App 323 条需求全部 `push_state=pushed`（pending/failed=0）；正式 Base 323 行、`需求平台ID` 唯一无重复、全部「已推送」；队列 0。
- 待配置（不阻塞代码部署）：Q2 需在正式 Base 建 `RQ重复标记`/`RQ主记录链接` 两个文本字段并在 `BASE_FIELDS_JSON.duplicate` 指向它们；作业告警需提供 `RQSYS_ALERT_WEBHOOK_URL`（飞书群机器人 https webhook）。

### 2026-11-13 下午增量部署

- 迁移 `0028_system_flags.sql`：dev 执行 → `+db-env-migrate` 到 online（`changes_applied=4`）；线上 `system_flags` 表存在，之后 env-diff 为空。
- 发布 release `7707561640783072506`（commit `665c7c3`，`finished`、`error_logs=[]`）。
- 目标环境验证：
  - 运营指标页（近 7 天）：同步成功率 100%（5/5）、分析成功率 100%（1/1）、推送成功率 100%（46/46）；负责人快照与评分快照可见。
  - 需求池「导出 CSV」可用：`GET /api/requirements/export` 返回 UTF-8 BOM + RFC 4180 CSV，首行 323 条（上限 5000），列含平台ID/优先级/状态/Base记录ID、来源已移除；已加公式注入防护。
  - 上线 Gate 页：G1 待人工证据、G2 未通过（当前规则 v2）、G3 通过（无待匹配未推送）、G4 未通过（未配置 webhook）、G5–G8 待确认；人工确认写入 `system_flags` 并留审计。
  - 迁移状态仍按平台限制显示“无法判断”（最新/期望：未知 / `0028_system_flags.sql`）；`system_flags` 为空、队列 0、323 条需求全部已推送、发布后 error=0。
- 新增的备份/恢复脚本（`scripts/rqsys-backup.mjs`、`scripts/rqsys-restore.mjs`）与 runbook 属本地/运维工具，不随妙搭运行时部署；快照含业务数据，`backups/` 已加入 `.gitignore`。

### 2026-11-13 傍晚：Q2 配置、G5 备份演练与 G1 通知验证

- **Q2 重复标记配置**：正式 Base 新增文本字段 `RQ重复标记`（fldyhDQ0xo）与 `RQ主记录链接`（fldAY4bPPb）；`BASE_FIELDS_JSON.duplicate` 已写入 dev+online 并随 release `7707576227033795828`（commit `7d43e20`，`finished`、`error_logs=[]`）生效。尚无真实重复判定，字段实际写入待首次业务判定验证。
- **G5 备份/恢复演练（通过）**：生产只读快照 21 表 / 9649 行（manifest `2026-11-13T08:53:11Z`；目标平台无 `schema_migrations`，manifest 记录 `migrationState=unavailable`）；在本地隔离 schema `rq_restore_drill_20261113` 重建 28 个迁移并恢复：21 表行数全部与 manifest 一致（requirements 323/323、base_push_runs 602/602、pipeline_jobs 2485/2485），RTO 实测 1.1s；演练 schema 已删除，生产库未修改。G5 已在 Gate 页人工确认并写审计（`ops.gate_confirmed`）。
  - 备份脚本修复：目标平台无 `schema_migrations` 时改为记录 `migrationState=unavailable` 而不是导出失败；恢复脚本在隔离 schema 加载阶段使用 `session_replication_role=replica` 处理 `requirements ↔ requirement_score_versions` 循环外键。
- **G1 通知验证（当日未通过，已于 2026-11-16 修复并通过，见后文）**：对 RQ-000323 做受控人工分配并回退：
  - 以 `open_id`（贾浩）分配 → Base 更新失败 `FEISHU_RECORD_UPDATE_CODE_1254066`（UserFieldConvFail）；正式 Base 现有人员映射以 `user_id` 为主（16/18），open_id 写入不兼容；
  - 改用 `user_id`（99f56141）分配 → 推送成功且 Base `执行人` 写入贾浩、`最后推送时间` 更新，但 **四个通知字段仍为空、记录历史无通知字段变更**，即人工分配未产生通知事件。测试后需求 owner 状态与 Base 执行人均已恢复。
  - 另发现：目标环境 `GET /api/feishu/users` 返回 503 `feishu_user_search_failed / client_not_configured`（runtime 未注入 Feishu 用户目录），负责人选择器无法搜索飞书用户——UI 人工分配同样被阻断。
  - 结论（当日）：人工分配通知路径需排查；该问题已在 2026-11-16 修复，见「反馈问题核实与 G1 通知修复」。

### 2026-11-13 傍晚：G4 告警通道完成

- `RQSYS_ALERT_WEBHOOK_URL` 已写入 dev+online（飞书群自定义机器人，关键词校验 `RQ-Sys`，冷却默认 360 分钟）；release `7707584858529336566`（commit `16b9143`，`finished`、`error_logs=[]`）使配置生效。
- 验证：17:38 直连 webhook → HTTP 200 / `code=0`；17:44:46 系统自动告警实发成功（审计 `ops.alert_sent`，entity `4d89d7dcc8f06798`，failed=2 / stuck=0，httpStatus=200），飞书群收到【RQ-Sys 运维提醒】消息。
- G4 已在 Gate 页人工确认并写审计 → **G4 pass**。

### 2026-11-13 优先级校准基准（模拟）

- 按用户指示由 Agent 模拟 PM 判断：从 322 条已评分需求中分层抽样 30 条（12 个模块），生成人工排序基准；**AI Top20 与人工 Top20 重合 16/20 = 80%**，达到 G2 ≥70% 门槛（模拟基准，非真实 PM 亲排）。
- 全量池分数分位校准建议：v3 阈值 `p0=10 / p1=7.8 / p2=6`，预计分布 P0 7（2.2%）、P1 40（12.4%）、P2 127（39.4%）、P3 148（46.0%）；v2 为 P0 0 / P1 0 / P2 7 / P3 315。
- 报告与明细：`docs/2026-11-13-priority-calibration-baseline.md`、`docs/evidence/rq-priority-calibration-2026-11-13.csv`。
- **G2 尚未勾选**：需先实现并发布 `umsc_weighted_v3` 规则、重算现有池 AI 建议，并经真实 PM 复核（或确认沿用模拟基准）。

### 2026-11-16 v3 优先级规则落地

- 代码：根仓 `ba8bbde`、妙搭 `98b6921`（v2.3.7）；release **`7708593523218664684`**，`finished`、`error_logs=[]`。
- 规则：发布 `umsc_weighted_v3` v3（id `5fd4bbe2-d41f-4287-bc62-25d2319252b6`），阈值 `p0=10 / p1=7.8 / p2=6`，v2 retired；规则携带模拟基准校验证据。
- 重算：330 条活跃需求生成 v3 评分版本并采纳（新版本，不改历史），分布 P0 7 / P1 40 / P2 128 / P3 155；`/api/requirements?priority=P0` 7 条、详情返回 v3 阈值。
- **G2 已通过**（人工证据：v3 规则、分布、模拟基准 Top20 16/20=80%、筛选/下钻验证）。
- 备注：模拟基准非真实 PM 亲排，**用户已于 2026-11-16 确认接受（PRD-24）**，不再作为 G2 阻塞项；Base `AI优先级建议` 本次未批量回写，需后续确认是否调整推送取值（已在下一小节处理）。

### 2026-11-16 Base AI 优先级同步

- 推送取值改为「最新 AI 建议版本优先级」（sourceVersion 匹配），无建议时回落最近分析记录；模块/分析版本仍来自分析记录。根仓 `1104978`、妙搭 `4bdd397`（v2.3.8）发布。
- 发现并修复两个阻塞：飞书 `1254607` 记录过滤瞬时失败被误判为永久失败（`52bf806`）；线上 `BASE_FIELDS_JSON` 仍是旧的 P0–P2 选项，P3 被策略性省略——已在代码中固定 AI 优先级允许 P0–P3（`10840cb`，妙搭 `12596e0`，v2.3.14）。
- 分三轮批量推送 331 条（`v3-ai-priority` / `-2` / 最终补推），Base 活跃行 **330/330 与 App v3 优先级一致**（P0 7 / P1 40 / P2 128 / P3 155）；Base 表另有 1 条非活跃行保留旧 P3。
- 例外：RQ-000157 的自动重推在作业层反复 `max_attempts_reached`（未进入 base_push_runs），已人工将 Base AI 优先级对齐 P2；根因待查，后续同类失败需告警/排查。
- 发布后已将 `WORKER_POLL_MS` 恢复默认 5000（release `7708621575780289722`，v2.3.15）。
- **自动重排（I2-2）仍未实现**：当前 v3 是一次性阈值校准；真正的“活跃池分位重排”需要确定 rank 配额（P0 17 / P1 50 / P2 99）还是沿用阈值口径，以及是否自动覆盖 AI 建议/触发 Base 推送，待确认后实施。

### 2026-11-16 反馈问题核实与 G1 通知修复

- 详见 `docs/2026-11-16-feedback-triage.md`。
- G1 无通知根因确认并修复：unknown 旧负责人兜底到 Base 当前负责人；目标环境 RQ-000323 验证 Base 通知字段 + 飞书卡片实收（12:53），测试状态已恢复。
- 人员 ID 类型：妙搭路径返回 user_id；根 Web 本地绑定器改为优先 user_id；线上活跃映射均为 user_id。
- `/api/feishu/users` 在妙搭无注入（503），但妙搭 UI 使用平台通讯录 + `/resolve`，非当前生产路径；**用户已确认妙搭统一使用平台通讯录（PRD-25）**，该 503 属预期，不作缺陷处理。
- v3 规则已实现/发布（阈值可配置），但仍是阈值校准而非严格排名配额；基准为模拟 PM，**已确认接受（PRD-24）**；严格排名配额/自动重排口径仍待确认。

### 2026-11-16 G1 回退演练与 G1 通过

- 通知修复目标验证：RQ-000323 受控人工分配后 Base 通知字段写入、飞书「需求通知」卡片实收（12:53）；测试后需求/Base 状态已恢复。
- 回退演练：13:05:53 开始并禁用 Base 通知工作流；发布回滚快照（commit `2114107`，release `7708631098460736704`，13:07:44 finished、error_logs=[]）；13:08:13 重新启用工作流并发布当前代码（commit `5280477`，release `7708631706073812240`，13:10:43 finished、error_logs=[]）。端到端 **4 分 50 秒**（≤10 分钟），回滚窗口页面与 API 可访问。
- G1 已人工确认并写审计 → **G1 pass**。当前 Gate：G1/G2/G3/G4/G5 pass，G6–G8 pending。
- 备注：平台自动把 release 分支合并到 `main`，回滚演练因此把回滚快照合入 main；已通过 `sprint/default` 的恢复提交 `5280477` 合并回 main 并重新发布，生产已恢复当前代码。
- **严格 5%/15%/30% 排名配额自动重排仍未上线**：该口径会把 P0 从 7 条变为约 17 条，并影响 330 条当前评分/Base 优先级，属于一次产品级切换；需按维护窗口单独实施。

## 1. 已完成迭代 1–3（归档）

迭代 1（上线前收口）、迭代 2（优先级可用）、迭代 3（运营闭环）的计划项已全部落地并经目标环境验证，逐项证据见上方部署记录。仅两项带说明：

- **I2-2 自动重排**：当前 v3 是一次性阈值校准；严格 5%/15%/30% 排名配额与自动重排未做，见 [`2026-11-16-next-iteration-plan.md`](./2026-11-16-next-iteration-plan.md)。
- **I2-4 模块筛选**：需求池尚无按功能模块的筛选，未纳入已完成范围。

## 2. 迭代 4：试点（2–4 周）

| 项 | 内容 | 完成判据 |
|---|---|---|
| I4-1 | 角色 SOP（PM Leader / 执行 PM / 运维）各 1 页 + 30 分钟培训 | G6 |
| I4-2 | 10–15 PM 试点；每周复盘运营指标与告警 | G7：P0/严重缺陷清零 |
| I4-3 | 上线公告、反馈入口、值班人 | G8 |

> PR-15 状态页已提前完成（2026-11-13）：运维页「上线 Gate」可直接查看 G1–G8 与证据，不再依赖分散文档。

## 3. 后续（P2，不进入上线 Gate）

- 重复处理 P2/P3：Base 重复行标记（按 Q2）、指纹兜底、独立审查页。
- 日/周 digest、通知失败补发、消息卡片。
- 报表深化（趋势、老化、负载、漏斗）。
- 多来源连接器与 TB 增量。
- Arco 迁移剩余项（见 `2026-11-03-arco-design-remaining-tasks.md`）与主包代码分割。

## 4. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| `pg_trgm` 等扩展权限在新环境缺失 | 迁移失败 | 迁移在 dev 先跑；0026 已有修复路径 |
| 妙搭目标库不暴露应用迁移记录 | 无法在目标环境判断库结构是否落后 | readiness 返回 `upToDate=null`（未知≠落后）；上线前以 dev→online `+db-env-diff` 为空作为迁移一致性证据 |
| RQ-000157 自动重推在作业层反复 `max_attempts_reached`（未进入 `base_push_runs`） | 同类失败可能再次出现且不被察觉 | 根因待查，尚未排期；出现时靠失败作业告警与运维页发现 |
