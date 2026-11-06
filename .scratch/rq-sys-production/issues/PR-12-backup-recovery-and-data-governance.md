# PR-12 备份恢复 / 环境隔离 / 数据治理

> 批次：2026-11-06 生产就绪（PR）
> **Status**：`blocked-on-external`（备份/平台权限部分；其余子项 ready-for-agent）
> **优先级**：P1
> **创建**：2026-11-06；基线：root `5490d75`

## 背景 / 目标

生产 PostgreSQL 备份/保留/恢复未验证（`AGENTS.md:45` 明写 Miaoda backup/retention 未验证）；应用内删除/导出/归档流程缺失；测试 Base vs 生产 Base 无启动校验（当前生产配置疑似指向测试表）；审计/日志保留期未定义；密钥轮换 SOP 缺失（AI key 曾被覆盖未留存）；dev→online 迁移手工、已发生一次真实漂移（0024 动态 DDL → 0026 前滚修复）；env 清单/配置变更不可审计；失败 run/测试需求/合成数据无清理策略。目标：回答「数据在哪、备份多久、谁能删、怎么恢复」，并把环境与配置漂移挡在上线前。

## 范围

- 备份策略：频率/保留/存储/责任人 + 一次真实恢复演练，记录 RPO/RTO。
- 应用回滚 runbook：已知良好 release/commit 表、命令、回滚后冒烟、前滚修复路径。
- 环境指纹校验：Base/项目/环境配置与预期不符时 fail-fast 或告警（与 PR-01 启动校验合并实现）。
- 迁移门禁：发布后 `+db-env-diff` 期望空；迁移 ledger（仓库文件 vs 平台已应用）比对；禁不可捕获的动态 DDL。
- `ENV-INVENTORY`：键、用途、dev/online 是否必填、值来源、轮换周期、责任人；发布前 env 名称 diff。
- 审计/日志保留期；清理策略：failed analysis runs 聚合/TTL、未采纳 `ai_suggested`、测试需求（如 `RQ-000316`）、POC/合成数据。
- 涉及：`deployment/*RUNBOOK*`、`scripts/check-migrations.mjs`、`scripts/rqsys-maintenance.mjs`、`database/migrations/`、`.env.example`。

## 验收标准（未取得目标环境证据前不得宣称完成）

- [ ] 备份策略文档化（频率/保留/存储/责任人），完成一次真实恢复演练并记录 RPO/RTO 实测。
- [ ] 应用回滚 runbook 完成并演练（回退到已知良好 release，冒烟通过）。
- [ ] 环境指纹校验实现：配置不匹配时 fail-fast/告警（mismatch 场景验证）。
- [ ] 发布后 schema diff 门禁与迁移 ledger 比对可用（与 CI 集成），一次演练通过。
- [ ] `ENV-INVENTORY` 评审通过；发布前 env 名称 diff 可执行。
- [ ] 审计/日志保留期与清理策略文档化；至少完成一轮清理并回读验证。
- [ ] 平台能力（备份/保留/恢复时长）取得目标环境证据；未取得不得标完成。

## 不在范围

- Miaoda 平台备份能力本身的改造；历史数据归档工具/长期数仓（PR-13）。
- 凭据轮换执行本身（涉密操作需用户授权；本票只定义 SOP 与责任人）。

## 依赖 / 阻塞

- **blocked-on-external**：Miaoda 备份/保留/恢复能力与平台权限需外部确认。
- 其余子项（回滚 runbook、env 清单、迁移门禁、清理策略）可 ready-for-agent 先行。

## 证据引用

- `/tmp/rq-verify/pm-gaps.md` P1-8（第 173–178 行）；`/tmp/rq-verify/ops-readiness-gaps.md` P0-4/P1-1/P1-6/P1-7（第 28–31、42–45、67–78 行）。
- `AGENTS.md:45`（backup/retention 未验证）；`deployment/MIAODA-LOCAL-AND-TARGET-RUNBOOK.md:41`；`deployment/V0.2-TARGET-RUNBOOK.md:9,11`。
- `database/migrations/0026_repair_trgm_index.sql` 注释（0024 动态 DDL 漂移）；`/tmp/rq-verify/api-verifier.md` §1（2026-11-06T01:25:53Z 才 PUBLISH）。
- `scripts/rqsys-maintenance.mjs` 头注释（触发器投递延迟、依赖人工）。
