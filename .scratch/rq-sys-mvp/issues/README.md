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
| 00 | Miaoda runtime capability POC | partially-available（最新 release `7695961039167278282` 已 finished，绑定 `b5ab0de`；发布版 UI 冷启动和 app-mediated E2E 尚未复核。） | — |
| 01 | Teambition API and field mapping POC | partially verified（2026-10-13 原始只读接口：需求 311 条，311 个非空唯一 ID；返回标题未命中“测试工具”精确词组。UI 的 311/314 仍未解释；按用户指示以 API 311 条作为导入范围。字段类型/绑定仍待核实。） | — |
| 02 | Feishu Base schema, upsert, and automation POC | partially verified（本轮官方 Bitable v1 app-token 读取命中合成记录；负责人自动化日志显示仅通知当前用户的步骤成功。该证据仍不等同发布版 Miaoda runtime 的完整 app-mediated E2E；正式表优先级选项仅 P0/P1/P2。） | — |
| 03 | AI provider and data-policy decision/POC | done（2026-10-08 离线校验 5/5 + 超时/无效 key 在线实测 + PII 掩码断言；2026-10-09 有效 key 补跑 T1–T3 全部通过 + 生产适配器冒烟通过并修复 factory env 断链/prompt 样例缺失，证据：specs/rq-sys-mvp/AI-ANALYSIS-POC.md） | D-06 已确认；T1–T3 已验证 |
| 04 | Persisted domain model and server API foundation | implemented-partially-target-verified（Dev 已回读 7 人 owner list 和 54 个模块的已发布字典版本；API/数据库其他路径仍需发布版 E2E 验收。） | 00 |
| 05 | Manual Teambition sync vertical slice | implemented-partially-target-verified（本轮新增本地 `source_only` 手动同步，不排 AI、owner mapping、Base push 或通知；两仓定向测试通过，尚未发布或导入 Dev 的 311 条 API 记录） | 00, 01, 04, D-08 |
| 06 | AI analysis vertical slice | implemented-not-target-verified（provider、结构化输出、存储和重试本地实现；Dev 密钥更新后固定合成需求分析及重试成功，但这不是发布版 runtime 的完整目标 E2E） | 03, 05 |
| 07 | Owner mapping and Feishu Base push vertical slice | implemented-not-target-verified（Owner UI/API 和 Base adapter 已有本地回归；需要 dev 指向 POC Base 后执行 app-mediated upsert） | 02, 05 |
| 08 | Weekly schedule, retry, and audit | implemented-not-target-verified（持久 due-job 与受限队列 drain、恢复 handler 已实现；用户选择周一 09:00 Asia/Shanghai。**2026-10-12 目标 runtime 演练通过**：启用 30 分钟 recovery trigger 一个 cron 窗口，`dispatch`/`trigger`/`action` 三阶段均 succeed（`instance_id 17695618791489929242`、`app_env=runtime`、`action` 663ms），应用侧记录 `RQ-Sys scheduled work poll completed`；Dev 计数无变化，触发器已复原为 disabled。同时确认安全性质：周计划关闭时恢复路径不产生工作。**仍未验证**：真正启用周计划后的错窗恢复、durable worker 重启、审计保留。） | 00, 05, 06, 07 |
| 09 | Target-environment end-to-end acceptance | partially executed（上一版 release `7695961039167278282` finished 且无错误；最近一次成功 Dev 回读为 37 条需求（7 条夹具）、7 人/54 模块、0 运行批次/作业、周计划关闭。API 311 条/ID 唯一作为导入范围；本轮实现本地 `source_only`，尚未发布或导入。发布版 app-mediated E2E、恢复错窗/worker 重启仍未验收。） | 00–08, 12–17 |
| D-08 | Resolve production UI component baseline after repo inspection | resolved（2026-10-08，ADR-001：基线已推送（main，03aef74）并检视——仓库无 UI 依赖，按 design.md 采用 HeroUI v3 + Tailwind；UI 托管方式留待 00） | ADR-001 已产出 |
| 10 | Grant `spark:app:read` user scope for Miaoda apps | resolved（2026-10-09 根因确认：TraeWork 注入凭证遮蔽本地授权；加 `env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND` 后 apps +list/+get/release 与 observability 命令调用成功。member APIs 仍为 feature_not_available；观测数据部分为空/null，详见工单 evidence） | — |
| 11 | Grant `spark:app:write` user scope for Miaoda apps | resolved（2026-10-09 双路径验证：member-add 路径返回 feature_not_available 3340005（该 full_stack app 不支持 CLI 协作者管理，非 scope 问题）；**release-create 路径验证通过**——同一 env -u 前缀下 `+release-create --branch sprint/default --apply-reason` 真实发布成功，release 7694661855108893966 publishing→finished、error_logs 空、无 missing_scope（方案A，用户显式确认；命令 Risk: write 无 --yes 门禁）。spark:app:write 对发布类写操作可用） | — |
| 12 | API wiring, login-only access, and source setup | implemented-not-target-verified（本地实现要求登录、不实现 RQ-Sys app 角色；目标来源写入仍待验证。旧 Dev preview 的 `FORBIDDEN` 与旧客户端文案不能归因为应用角色，需先通过受支持流程发布对齐已测代码，再验证登录用户可创建 schedule-disabled 来源。） | — |
| 13 | AI output semantics, priority rules, and privacy | implemented-not-target-verified（2026-10-09 本地完成：移除证据计数公式，规则 JSON 改为显式 U/M/S/C 评分映射 + 阈值，未发布/未校准规则时 priority 保持 null（buildPriorityRule 返回 null，取值不在映射中不猜测）；maskPii 增补身份证/24 位平台用户 ID/@提及；outbound payload 无姓名/用户 ID/联系方式/凭据的断言测试通过。provider target acceptance remains Ticket 09） | 03 |
| 14 | Complete analysis-to-Base push workflow | implemented-not-target-verified（本地分析终态后推进、失败/低置信度不阻塞推送、快照/映射顺序均有实现；目标 app TLS、身份、Base 凭据/夹具仍未验证） | 02, 12, 13 |
| 15 | Pipeline idempotency, retry, and worker fencing | implemented-not-target-verified（worker fencing/retry 本地验证通过；online Miaoda runtime、durable worker restart、schedule trigger 尚未实测） | 12, 14 |
| 16 | Source settings and batch workbench | implemented-not-target-reverified（最新 release `7695961039167278282` 已完成；本轮未通过已登录 UI 复核冷启动与来源页面，浏览器接入失败。） | 12, 15 |
| 17 | Requirement, owner mapping, retry, and audit workbench | implemented-not-target-verified（本地需求池/人员/模块 CRUD 与 AI 字典约束有回归；最近一次 Dev 回读已确认 7 人和 54 个模块。目标 UI CRUD 与发布版 runtime 尚未复验，匹配推送不得等同通知送达。） | 12–15 |

`ready-for-agent` 表示可开始做 POC/决策工作，不代表生产集成已具备条件。具体 blocker 在各 ticket 中列出。全生命周期 28 字段不属于这些 tickets。

最新状态（2026-10-13）：root `main` 当前 HEAD `15ae9f3` 已推送；Miaoda `sprint/default` 当前 HEAD `b5ab0de` 已推送，release `7695961039167278282` finished。本轮 source-only 同步改动仍在本地工作区。本轮 API 全量单测 235/235（未运行连接非 loopback 数据库的 integration）、Web 39/39、妙搭路由 66/66；根仓和妙搭类型检查、构建、lint、共享逻辑对齐及 `git diff --check` 通过。Dev 最近一次只读聚合为 37 条需求（7 条夹具）、7 人、已发布字典 54 个模块、0 运行批次/作业、周计划关闭。用户选择 Teambition 原始 API 返回的 311 个唯一 ID 作为本次导入范围；UI `311/314` 的额外 3 条仍未识别。本轮 CLI 认证探测因 DNS 无法解析 `open.feishu.cn` 失败，代码尚未推送/发布，Dev 尚未执行 source-only 对齐。恢复错窗/worker 重启及发布版 app-mediated 合成 E2E 未验收。周计划与干系人通知保持关闭。
