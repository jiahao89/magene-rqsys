# RQ-Sys MVP — Ticket Drafts

来源：`specs/rq-sys-mvp/`，以当前 PRD revision 60 为产品行为基线。此处是本地待评审 ticket 草案，尚未发布到外部 tracker。

Agent 可直接使用的总任务说明：[`../AGENT-HANDOFF.md`](../AGENT-HANDOFF.md)。

技术栈建议见 [`../../../specs/rq-sys-mvp/TECHNICAL-PLAN-MIAODA.md`](../../../specs/rq-sys-mvp/TECHNICAL-PLAN-MIAODA.md)；首个 POC 需核对 GitHub 仓库与妙搭之间的代码导入/发布方式。

## 建议顺序

先并行验证外部依赖，再按纵向切片开发：

```mermaid
flowchart LR
  P10[10 spark:app:read grant] -. external scope grant .-> P0[00 Miaoda runtime POC]
  P11[11 spark:app:write grant] -.-> P0
  P0 --> T04[04 persistence/API foundation]
  P1[01 Teambition API POC] --> T05[05 manual sync slice]
  T04 --> T05
  T05 --> T06[06 AI analysis slice]
  P3[03 model/provider approval + POC] --> T06
  P2[02 Feishu Base POC] --> T07[07 owner mapping + Base push]
  T06 --> T07
  T07 --> T08[08 schedule/retry/audit]
  T12[12 API wiring and authorization]
  T13[13 AI semantics and privacy]
  T12 --> T14[14 Base workflow closure]
  T13 --> T14
  T14 --> T15[15 pipeline reliability]
  T12 --> T16[16 source and batch workbench]
  T15 --> T16
  T12 --> T17[17 requirement workbench]
  T13 --> T17
  T14 --> T17
  T15 --> T17
  T08 --> T09[09 target-environment acceptance]
  T16 --> T09
  T17 --> T09
  D08[UI library decision] -. gates production UI work .-> T05
```

## Ticket list

| ID | Ticket | Status | Depends on |
|---|---|---|---|
| 00 | Miaoda runtime capability POC | partially-available（最新 release `7696073033094450405` 已 finished，绑定 `59189609c8260f6201d15e990ba2d8ca00e4f355`，错误日志为空；发布版 UI 冷启动与 app-mediated E2E 尚未复核。） | — |
| 01 | Teambition API and field mapping POC | partially verified（2026-10-13 原始接口返回 311 条、311 个非空唯一 ID；Dev source-only 批次 311/311 成功且逐项匹配持久化需求。历史 UI `311/314` 不再是当前 Dev 对齐差异；旧分母由分页数据计算，历史多出的 3 条没有独立识别。字段类型/绑定及更大数据集的分页完整性仍待核实。） | — |
| 02 | Feishu Base schema, upsert, and automation POC | partially verified（本轮官方 Bitable v1 app-token 读取命中合成记录；负责人自动化日志显示仅通知当前用户的步骤成功。该证据仍不等同发布版 Miaoda runtime 的完整 app-mediated E2E；正式表优先级选项仅 P0/P1/P2。） | — |
| 03 | AI provider and data-policy decision/POC | done（2026-10-08 离线校验 5/5 + 超时/无效 key 在线实测 + PII 掩码断言；2026-10-09 有效 key 补跑 T1–T3 全部通过 + 生产适配器冒烟通过并修复 factory env 断链/prompt 样例缺失，证据：specs/rq-sys-mvp/AI-ANALYSIS-POC.md） | D-06 已确认；T1–T3 已验证 |
| 04 | Persisted domain model and server API foundation | implemented-partially-target-verified（Dev 已回读 7 人 owner list 和 54 个模块的已发布字典版本；API/数据库其他路径仍需发布版 E2E 验收。） | 00 |
| 05 | Manual Teambition sync vertical slice | implemented-target-data-aligned（Dev `source_only` 批次 `2d372363-31f5-482a-aca9-4c26cb43010c`：311/311 成功、0 失败、0 缺失真实需求；Dev 保留 7 条合成夹具。该批次未触发 AI、负责人匹配、Base 推送或通知。） | 00, 01, 04, D-08 |
| 06 | AI analysis vertical slice | implemented-not-target-verified（provider、结构化输出、存储和重试本地实现；Dev 密钥更新后固定合成需求分析及重试成功，但这不是发布版 runtime 的完整目标 E2E） | 03, 05 |
| 07 | Owner mapping and Feishu Base push vertical slice | implemented-not-target-verified（Owner UI/API 和 Base adapter 已有本地回归；需要 dev 指向 POC Base 后执行 app-mediated upsert） | 02, 05 |
| 08 | Weekly schedule, retry, and audit | implemented-not-target-verified（持久 due-job 与受限队列 drain、恢复 handler 已实现；用户选择周一 09:00 Asia/Shanghai。**2026-10-12 目标 runtime 演练通过**：启用 30 分钟 recovery trigger 一个 cron 窗口，`dispatch`/`trigger`/`action` 三阶段均 succeed（`instance_id 17695618791489929242`、`app_env=runtime`、`action` 663ms），应用侧记录 `RQ-Sys scheduled work poll completed`；Dev 计数无变化，触发器已复原为 disabled。同时确认安全性质：周计划关闭时恢复路径不产生工作。**仍未验证**：真正启用周计划后的错窗恢复、durable worker 重启、审计保留。） | 00, 05, 06, 07 |
| 09 | Target-environment end-to-end acceptance | partially executed（最新 release `7696073033094450405` finished，绑定 Miaoda commit `5918960`。Dev source-only 数据已按 TB API 的 311 个唯一需求 ID 对齐，保留 7 条夹具；311 已拉取、0 分析/推送/失败，周计划关闭。发布版时间格式修复已上线，但登录态设置保存回读、合成 AI→POC Base→仅通知本人 E2E、错窗恢复和 durable worker 重启仍未验收。） | 00–08, 12–17 |
| D-08 | Resolve production UI component baseline after repo inspection | resolved（2026-10-08，ADR-001：基线已推送（main，03aef74）并检视——仓库无 UI 依赖，按 design.md 采用 HeroUI v3 + Tailwind；UI 托管方式留待 00） | ADR-001 已产出 |
| 10 | Grant `spark:app:read` user scope for Miaoda apps | resolved（2026-10-09 根因确认：TraeWork 注入凭证遮蔽本地授权；加 `env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND` 后 apps +list/+get/release 与 observability 命令调用成功。member APIs 仍为 feature_not_available；观测数据部分为空/null，详见工单 evidence） | — |
| 11 | Grant `spark:app:write` user scope for Miaoda apps | resolved（2026-10-09 双路径验证：member-add 路径返回 feature_not_available 3340005（该 full_stack app 不支持 CLI 协作者管理，非 scope 问题）；**release-create 路径验证通过**——同一 env -u 前缀下 `+release-create --branch sprint/default --apply-reason` 真实发布成功，release 7694661855108893966 publishing→finished、error_logs 空、无 missing_scope（方案A，用户显式确认；命令 Risk: write 无 --yes 门禁）。spark:app:write 对发布类写操作可用） | — |
| 12 | API wiring, login-only access, and source setup | implemented-not-target-verified（本地实现要求登录、不实现 RQ-Sys app 角色；目标来源写入仍待验证。旧 Dev preview 的 `FORBIDDEN` 与旧客户端文案不能归因为应用角色，需先通过受支持流程发布对齐已测代码，再验证登录用户可创建 schedule-disabled 来源。） | — |
| 13 | AI output semantics, priority rules, and privacy | implemented-not-target-verified（2026-10-09 本地完成：移除证据计数公式，规则 JSON 改为显式 U/M/S/C 评分映射 + 阈值，未发布/未校准规则时 priority 保持 null（buildPriorityRule 返回 null，取值不在映射中不猜测）；maskPii 增补身份证/24 位平台用户 ID/@提及；outbound payload 无姓名/用户 ID/联系方式/凭据的断言测试通过。provider target acceptance remains Ticket 09） | 03 |
| 14 | Complete analysis-to-Base push workflow | implemented-not-target-verified（本地分析终态后推进、失败/低置信度不阻塞推送、快照/映射顺序均有实现；目标 app TLS、身份、Base 凭据/夹具仍未验证） | 02, 12, 13 |
| 15 | Pipeline idempotency, retry, and worker fencing | implemented-not-target-verified（worker fencing/retry 本地验证通过；online Miaoda runtime、durable worker restart、schedule trigger 尚未实测） | 12, 14 |
| 16 | Source settings and batch workbench | implemented-target-save-pending（修复 PostgreSQL `TIME` 返回 `HH:mm:ss` 与 API `HH:mm` 不一致的问题已随 release `7696073033094450405` 发布；本地 round-trip 回归通过，发布后登录态保存与回读尚未验证。） | 12, 15 |
| 17 | Requirement, owner mapping, retry, and audit workbench | implemented-not-target-verified（本地需求池/人员/模块 CRUD 与 AI 字典约束有回归；最近一次 Dev 回读已确认 7 人和 54 个模块。目标 UI CRUD 与发布版 runtime 尚未复验，匹配推送不得等同通知送达。） | 12–15 |

`ready-for-agent` 表示可开始做 POC/决策工作，不代表生产集成已具备条件。具体 blocker 在各 ticket 中列出。全生命周期 28 字段不属于这些 tickets。

最新状态（2026-10-13）：root commit `ae8fc89` 已推送至 `main`；Miaoda `sprint/default` commit `59189609c8260f6201d15e990ba2d8ca00e4f355` 已推送，release `7696073033094450405` finished 且 `error_logs` 为空。API 253/253（含隔离 PostgreSQL integration）、Web 43/43、妙搭路由 72/72；根仓 typecheck/build、妙搭 server/client typecheck、lint/stylelint、直接 production build、共享逻辑对齐和两仓 `git diff --check` 通过。妙搭 wrapper build 因 npm mirror DNS 失败，直接 server/client production build 均通过。Dev source-only 已按 TB 原始接口 311 个唯一 ID 对齐：311 条业务需求已拉取、7 条合成夹具保留，0 分析/推送/失败，0 running batch/job；周一 09:00 Asia/Shanghai 计划关闭。旧 UI `311/314` 的统计口径已由 TB 原始 API 与 Dev 对齐结果取代；历史多出的 3 条未逐项识别，不再作为当前导入范围的阻塞项，也不推断为测试工具。最新 release 修复了数据库时间值到 API 时间格式的转换，但发布后登录态设置保存/回读仍待验证。视觉复核、发布版合成 AI→POC Base→仅通知本人、错窗恢复及 durable worker 重启仍未完成；周计划和干系人通知保持关闭。
