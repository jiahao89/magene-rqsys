# 定时合成验收方案（已废止，仅存档）

> **状态：已废止（2026-11-21）。**
> 本文原方案依赖的造数/夹具通道已从生产代码删除，包括 `sync/test-fixture.ts`、`/api/dev/fixtures/status`、`RQSYS_ENABLE_TEST_FIXTURES`、`RQSYS_SCHEDULE_FIXTURE` 和 `rqsys-fixture-*` 合成需求。**任何人不得按本文设置环境变量、启用夹具、触发 dev fixture 端点或创建合成需求。**
> 本文只保留历史结论，供审计追溯；不再作为验收步骤。历史原文见 `git log -- specs/rq-sys-mvp/SCHEDULE-FIXTURE-ACCEPTANCE.md`。

## 1. 废止范围

- 定时夹具模式：`RQSYS_SCHEDULE_FIXTURE`、`RQSYS_ENABLE_TEST_FIXTURES`。
- 夹具来源与幂等命名空间：`fixture-sched:`、`testFixture=true`、POC Base 精确匹配守卫。
- dev fixture 入口：`POST /api/dev/fixtures/sync`、`GET /api/dev/fixtures/status`。
- 合成需求身份：`rqsys-fixture-*`、`【RQ-Sys安全测试】` 记录。
- 相关验收步骤：用合成需求走 sync → AI → POC Base → 本人通知；不再属于任何目标环境验收。

## 2. 历史结论（只读）

- **2026-10-15**：平台真实触发后，运行实例未读取到 `+env-set` 写入的夹具开关，按普通来源处理了指定来源；批次幂等键为 `sched:`、`testFixture` 为 null。未写 Base、未发通知；临时来源、环境变量、周计划和触发器均已恢复。
- **2026-10-19**：补了 cron handler 的 started / runtime-initialization failure / durable-poll failure / completed 日志并发布；仍未捕获到可用的 scheduled fixture 证据。
- **2026-11-21**：收尾版 `7710556274223631598`（commit `649a611`）删除造数通道；线上不再提供 fixture 入口或合成需求。

## 3. 当前替代

- 需求池/集团池全量验收：[FULL-ACCEPTANCE-20261121.md](../../.scratch/full-acceptance-20261121/FULL-ACCEPTANCE-20261121.md)
- 集团池定时批次核对：[SCHEDULED-BATCH-CHECKLIST-20261123.md](../../.scratch/full-acceptance-20261121/SCHEDULED-BATCH-CHECKLIST-20261123.md)
- 写链路冒烟（负责人变更 → 通知 → 回写，通知只用用户本人）：[WRITE-PATH-SMOKE-PLAN-20261121.md](../../.scratch/full-acceptance-20261121/WRITE-PATH-SMOKE-PLAN-20261121.md)

## 4. 当前验收规则

- 目标环境**不造数**；验收测试数据必须删除（应用库 + Base 两侧）。
- 集团池只用 Teambition 现有真实需求（8 人名单），不需要 TB 写权限。
- 通知验证只用用户本人，不用其他干系人。
- 不恢复 fixture 环境变量、不重新引入 dev fixture 端点；如未来确需测试通道，另立产品决策与 PRD 修订，不能直接复用本文。
