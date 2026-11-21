# 目标环境验收清单（已废止，仅存档）

> **状态：已废止（2026-11-21）。**
> 本清单依赖合成夹具、`RQSYS_ENABLE_TEST_FIXTURES` 和 `/api/dev/fixtures/*`；这些通道已在收尾版 `7710556274223631598`（commit `649a611`）从生产代码删除。**不要再按本清单执行第 2–6 步，不要再启用夹具或创建合成记录。**
> 本文只保留历史验收结论，供审计追溯；历史原文见 `git log -- deployment/TARGET-ACCEPTANCE-CHECKLIST.md`。

## 1. 原清单中已失效的内容

- 合成夹具走通 sync → AI → POC Base（原第 2 节）。
- `POST /api/dev/fixtures/sync`、`GET /api/dev/fixtures/status`、`RQSYS_ENABLE_TEST_FIXTURES`。
- POC Base 中的 `【RQ-Sys安全测试】` 合成记录及“保留 7 条合成夹具”的基线。
- 旧发布版本 `7695978028435049655` 的 dev preview 验收步骤。
- 用 POC Base 自动化验证负责人通知的替代路径（原第 3 节）；当前通知验收只用用户本人，按写链路冒烟计划执行。

## 2. 历史结论（只读）

- 2026-10-12/13：隔离 POC Base 与合成夹具完成了部分 sync → AI → Base 冒烟；不代表发布版 runtime 全链路。
- 2026-10-15：定时夹具模式因运行实例未读取新环境变量失败，未取得夹具验收证据；未写正式 Base、未发通知，配置已恢复。
- 2026-10-19：补了 cron handler 日志并发布；仍未取得可用的 scheduled fixture 窗口证据。
- 2026-11-21：造数通道删除，本文不再具备可执行性。

## 3. 当前验收入口

- 发布：`7710556274223631598` finished，commit `649a611`；线上指标产品池 333/333、集团池 191/191。
- 全量验收：[FULL-ACCEPTANCE-20261121.md](../.scratch/full-acceptance-20261121/FULL-ACCEPTANCE-20261121.md)
- 写链路冒烟：[WRITE-PATH-SMOKE-PLAN-20261121.md](../.scratch/full-acceptance-20261121/WRITE-PATH-SMOKE-PLAN-20261121.md)
- 集团池定时批次：[SCHEDULED-BATCH-CHECKLIST-20261123.md](../.scratch/full-acceptance-20261121/SCHEDULED-BATCH-CHECKLIST-20261123.md)

## 4. 当前验收规则

- 目标环境不造数；验收测试数据必须删除（应用库 + Base 两侧）；`RQ-000316` 是已登记的正式样例，不作为可删除测试数据。
- 通知验证只用用户本人；不向其他干系人发测试通知。
- 发布后先做只读核对，再做用户批准的写操作；没有目标环境证据不得标记 PASS。
- 不恢复夹具环境变量、不重新引入 dev fixture 端点；如未来确需测试通道，另立产品决策与 PRD 修订。
