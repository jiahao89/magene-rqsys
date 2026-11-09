# RQ-Sys 生产就绪 Ticket 批次（PR）

> **创建日期**：2026-11-06
> **批次性质**：本地 ticket 草稿（tracker 仍为仓库内 Markdown）。把「生产就绪」缺口拆成可领取任务；PRD 增补由 Lead/产品另行编写，不在本批次内。
> **产品决策**：PRD-13 ~ PRD-20 见 [`docs/2026-11-06-production-readiness-decisions.md`](../../../docs/2026-11-06-production-readiness-decisions.md)。
> **来源**：
> - 用户 2026-11-06 确认的 README 级结论：**2 个 P0 / 9 个 P1 / 8 个 P2**（评估报告 `/tmp/rq-verify/pm-gaps.md` 摘要表）。
> - 运维就绪度评估 `/tmp/rq-verify/ops-readiness-gaps.md`（生产 Base、AI 配额/告警、备份恢复、上线 gate 等 P0 级运维闭环）。
> - 代码/文档基线：root `5490d75`（clean）；妙搭仓 `ecd5b7a`（pm-gaps 基线；ops 报告记为 `9fee0f2`，实施前回读确认）。
> **通用准则**：
> 1. **未取得目标环境证据前，任何票不得标记完成**；本地测试、只读评估、仓库文档均不算目标环境证据。
> 2. 不改动 `.scratch/rq-sys-mvp/` 与 `.scratch/rq-sys-v0.2/` 既有票；新增功能/口径变更先改 PRD/Spec，再建/更新票。
> 3. 本批次只描述任务与验收，不预设实现方案；涉及代码/DB/发布的操作按 `AGENTS.md` 安全门禁执行。

## 状态定义

| Status | 含义 |
|---|---|
| `draft` | 仅登记为路线条目，未细化/未排期，不可领取 |
| `ready-for-agent` | 决策与代码前置已足够，可领取实施（仍需目标环境证据才可完成） |
| `blocked-on-decision` | 需产品/用户先定稿口径、角色、归属等决策 |
| `blocked-on-external` | 需平台能力、正式 Base 授权或目标环境操作许可 |

## Ticket 列表

| ID | 任务 | Status | Blocked by | 优先级 | 涉及仓库文件/范围 |
|---|---|---|---|---|---|
| PR-01 | [正式 Base 切换与通知闭环](PR-01-formal-base-and-notification.md) | target-verified（切换/推送/对账完成；通知 IM 实收待试点确认） | 测试 Base 已删除，回滚目标不可用；字段已核对 | P0 | `deployment/`、`specs/rq-sys-mvp/RELEASE-CLOSEOUT.md`、线上 env；Base 配置 |
| PR-02 | [优先级阈值/α/业务上下文口径定稿](PR-02-scoring-rule-finalization.md) | ready-for-agent | 相对分位口径已定（PRD-14）；v3 实施与校准基准待 PM 提供 | P0 | `specs/rq-sys-v0.2/SCORING-RULE-COMPARISON.md`、`06-ai-scoring-and-priority.md`、`apps/api/src/analysis/*`、`database/migrations/` |
| PR-03 | [需求池优先级分诊](PR-03-requirement-priority-triage.md) | implemented-local（优先级列/筛选/排序/API/URL 已实现；已发布 8d07753） | 剩余：总览下钻、模块/人群筛选；批量确认随 PR-04 取消 | P0 | `apps/web/src/panels.tsx`、`rq-sys-miaoda/client/src/rqsys/panels.tsx`、`apps/api/src/contracts/pipeline.ts`、`http/app.ts`、`openapi.yaml` |
| PR-04 | [人工优先级投影 Base](PR-04-manual-priority-to-base.md) | cancelled | PRD-18：不自动回写 Base | P1 | `apps/web/src/panels.tsx`、`apps/api/src/base/push-service.ts`、`BASE_FIELDS_JSON`、Base 字段 |
| PR-05 | [负责人组织维护闭环](PR-05-owner-mapping-closed-loop.md) | ready-for-agent | 离职/外部人员转交部分 blocked-on-decision | P1 | `apps/web/src/panels.tsx`、`apps/api/src/http/app.ts`、`domain/team-directory.ts`、`adapters/postgres/repositories.ts` |
| PR-06 | [AI 质量校准与反馈闭环](PR-06-ai-quality-calibration.md) | ready-for-agent | PR-02 的 v3 规则/基准作为输入 | P1 | `apps/api/src/analysis/*`、`http/app.ts`、`apps/web/src/panels.tsx`、回归集/文档 |
| PR-07 | [PM 决策闭环与单一入口](PR-07-pm-decision-loop-and-single-entry.md) | closed-by-decision | PRD-15：Base 唯一 PM 工作台；Web 不新增决策闭环 | P1 | `specs/rq-sys-mvp/OPEN-DECISIONS.md`、`00-foundation-and-data-contract.md`、`apps/web/src/panels.tsx`、Base 视图 |
| PR-08 | [角色与权限最小集](PR-08-minimal-roles-and-permissions.md) | cancelled | 2026-11-09 用户决定现在不需要角色/权限（PRD-16 暂缓） | P1 | `apps/api/src/http/app.ts`、`application/*`、`apps/web/src/App.tsx`、审计 |
| PR-09 | [通知 digest 与运营提醒](PR-09-notification-digest-and-ops-alerts.md) | ready-for-agent | 收件人清单需用户确认 | P1 | `apps/api/src/base/push-service.ts`、worker/调度、`deployment/` runbook |
| PR-10 | [运营指标与导出](PR-10-ops-metrics-and-export.md) | ready-for-agent | — | P1 | `apps/api/src/adapters/postgres/repositories.ts`、`http/app.ts`、`apps/web/src/panels.tsx`、`openapi.yaml` |
| PR-11 | [AI 可靠性/额度告警/降级与切换](PR-11-ai-reliability-quota-and-failover.md) | ready-for-agent | 告警通道可与 PR-09 复用 | P1 | `apps/api/src/analysis/provider.ts`、worker、`scripts/`、env/SOP 文档 |
| PR-12 | [备份恢复/环境隔离/数据治理](PR-12-backup-recovery-and-data-governance.md) | blocked-on-external | Miaoda 备份/保留能力与平台权限；其余子项 ready-for-agent | P1 | `deployment/`、`scripts/check-migrations.mjs`、`database/migrations/`、env 清单、保留/清理策略 |
| PR-13 | [P2 路线：生命周期/多来源/协作/文档治理](PR-13-p2-roadmap.md) | draft | 产品 Roadmap + D-01/D-02 决策 | P2 | 路线条目（实施前另建票）；`docs/`、`specs/` |
| PR-14 | [上线培训、角色 SOP 与文档同步](PR-14-training-sop-and-docs.md) | ready-for-agent | 需用户/试点团队配合 | P1 | `deployment/`、`docs/`、`specs/`、App 使用指南 |
| PR-15 | [唯一上线 Gate 与当前状态页](PR-15-go-live-gate-and-current-status.md) | ready-for-agent | 用户/产品确认 gate 为唯一判据 | P0 | `deployment/`、`specs/rq-sys-mvp/`、PRD 增补 §9 |

## 与评估报告的覆盖映射

- P0-1（生产 Base/通知未切真）→ PR-01；P0-2（优先级不可区分/人工 P 不进 Base）→ PR-02 + PR-03 + PR-04。
- P1-1…P1-8 → PR-05…PR-12（P1-1→PR-05、P1-2→PR-06、P1-3→PR-07、P1-4→PR-08、P1-5→PR-09、P1-6→PR-10、P1-7→PR-11、P1-8→PR-12）。
- P2-1…P2-8 → PR-13（合并为路线条目）。
- ops 报告：P0-1→PR-01；P0-2/P0-3/P1-4→PR-11/PR-09/PR-10；P0-4→PR-12；P1-1/P1-6/P1-7→PR-12；P1-2→PR-12；P1-3→PR-05；P1-5→PR-12（含仓库公开/真实资源标识脱敏，需单独授权）。
- 未单列项已补票：P1-9 上线培训与角色 SOP → PR-14；ops P0-5 唯一上线 gate/当前状态页 → PR-15。

## 建议执行顺序

1. PR-01 回读 env → 授权/切换演练（外部依赖先行）。
2. PR-02 产品定稿；并行 PR-03（分诊 UI）、PR-05（43 条清零）。
3. PR-04、PR-06、PR-09、PR-10、PR-11 并行推进。
4. PR-07、PR-08 决策后实施；PR-12 在上线前 3 天完成备份/回滚演练。
5. PR-13 保持 draft，不阻塞试点；P0 未完成前不宣布正式上线。

## 参考

- 评估报告：`/tmp/rq-verify/pm-gaps.md`、`/tmp/rq-verify/ops-readiness-gaps.md`（临时文件，非长期证据）。
- 既有 tracker：`.scratch/rq-sys-mvp/issues/README.md`、`.scratch/rq-sys-v0.2/issues/README.md`。

## 实施进度（2026-11-06 晚）

- PR-03（P0 代码部分）：`implemented-local`。需求池优先级列 + P0–P3 筛选 + `sort=priority_asc` 分诊排序（单页 100 条、不分页）+ URL 深链 + openapi/DTO + 两端一致性 + 测试（API 552、Web 115、妙搭路由 116）。
- PR-05（部分）：待匹配负责人列表显示 TB 真实姓名并按执行人聚合（`姓名×数量`）；DTO 增加 `executorName`。逐条处置/批量/离职转交仍待决策。
- 其余票保持原状态；目标环境验证与发布均未执行。
