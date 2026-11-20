# 全量验收 · 后端块（6/7/8/9）— 2026-11-20

执行人：后端开发
范围：Base 同步链路、运维与管理页、工程门禁、数据一致性
原则：全程只读；未创建生产数据、未触发 PM 通知、未改 Base。

## 结论矩阵

| 块 | 结论 | 关键证据 |
|---|---|---|
| 6 Base 同步链路 | **PASS** | 收集表 0 行；最近一轮 11-20 11:09 扫描 0 / 建 0 / 拒 0 / readFailed=false；PM 334 行；来源方式 333 TB + 1 Web 手工，与 App 完全一致；最近真实同步 09:15 批次 333/333 succeeded，RQ-000335 已建并推送 |
| 7 运维与管理页 | **PASS**（数据/接口层） | 作业 3206 条全 succeeded、failed=0、卡死 running=0；审计近 3 天 22 条、失败事件均有解释；模块 published v7/53；负责人映射 19 条/15 active；数据源 1 个 enabled，周一 09:00 Asia/Shanghai，9 个负责人名；`/api/ops/*` 路由用例通过（鉴权下的线上点击不在本轮重复） |
| 8 工程门禁 | **PASS**（本机无 PG 的环境项除外） | 见下「门禁明细」；唯一失败是 59 条本机无 PG 的 `connect ENOENT`，非 ENOENT 错误 0；`check:contract` 1 失败同为该 ENOENT，另有 1 条 trigger=enabled 的流程提醒（非失败） |
| 9 数据一致性 | **PASS** | App active 334 = TB 333 + Web 手工 1 + 多维表格 0 + 聊天粘贴 0；PM 334；两边平台 ID 集合 md5 完全一致；评估表 0 行；各类孤儿行 0 |

## 6. Base 同步链路（只读）

**收集表** `tbliQ1fQPFzQHkEM`：0 行（`data.data: []`）。

**同步状态** `system_flags.base_form_sync_state`（11-20 11:09:16 更新）：

```json
{"pages":1,"created":0,"scanned":0,"skipped":0,"tableId":"tbliQ1fQPFzQHkEM","recorded":0,"rejected":0,"lastError":null,"lastRunAt":"2026-11-20T03:09:16.414Z","readFailed":false,"writeBackFailed":0}
```

**PM 表** `tbl6Gfi0KJ2a1llK`：334 行，平台 ID 唯一、无重复。

- 来源方式：Teambition 333 + Web 手工 1 + 多维表格 0 + 聊天粘贴 0。
- 推送状态：已推送 334。
- RQ-000316（手工）= Web 手工；RQ-000335（今日真实同步）= Teambition；RQ-000334 不存在。
- 「系统通知事件ID」：最近行（RQ-000318 起）均为空；非空共 303 行，全部 ≤ RQ-000317（历史阶段写入，本轮及 5b/5c 未新增）。

**最近同步批次**：全表 14 个批次均 succeeded；最近 11-20 09:15:15 scheduled 333/333。

**说明**：本轮未向收集表写入新行来复跑端到端，避免造生产数据；端到端收录路径以 11-19 的 5b 验收 + 11-20 09:15 的真实同步为证。

## 7. 运维与管理页（只读 + 用例）

- 作业：analysis 1886 / base_push 1306 / sync 14，全部 succeeded；`failed=0`，`running 且 locked_until<now()` = 0。
- 历史失败推送 2 条（RQ-000007、RQ-000323，Feishu 1254066），均已有后续成功推送且最新状态 `pushed`，属已恢复的历史失败。
- 审计（近 3 天 22 条）：失败 4 条均有解释——RQ-000335 的 provider 502/重试预算耗尽/base.push 重试、11-19 的 `title_missing` 测试行拒绝。
- 指标：`/api/ops/metrics` 用例覆盖 400/401/503、baseForm 降级；线上底层计数见块 9。
- 模块：`module_dictionary_versions` published **v7 / 53 项**。
- 负责人映射：`person_mappings` 19 条，15 active；App 侧 owner_state：manually_mapped 287 / pending_mapping 45 / not_required 2（无负责人允许推送，不阻塞）。
- 数据源：1 条 enabled，项目「室外产品-码表软固件需求池」，周一 09:00 Asia/Shanghai，9 个负责人名。
- SOP：`sop.tsx` 已含「来源」Tab 四来源、详情「这条需求怎么来的」、需求评估 4.4 段，无旧「来源筛选（下拉）」口径。

## 8. 工程门禁明细

| 项 | 结果 |
|---|---|
| 根仓 `typecheck` | PASS（exit 0） |
| 根仓 `build`（api + web） | PASS（exit 0） |
| API 测试 | 668 条 / 609 过 / 59 失败；59 条全部是本机无 PG 的 `connect ENOENT /Users/jacko/.local/share/rq-sys/postgres/.s.PGSQL.5432`；非 ENOENT 失败 0 |
| Web 测试 | 178/178 PASS |
| `check:alignment` | PASS，36/36 共用模块一致，无未声明漂移 |
| `check:migrations` | PASS，最大前缀 0030 与 EXPECTED 对齐 |
| `check:contract` | 3 过 / 1 失败 / 1 警告；失败为上述本机 PG ENOENT；警告为 `rqsysWeeklySyncRecovery` status=enabled（发布流程提醒，非契约失败） |
| `check:arco-styles` | PASS（13/13） |
| 妙搭 `type:check:server` / `type:check:client` | PASS |
| 妙搭 `test:rqsys-route` | 145/145 PASS |
| 妙搭 `build:client` / `test:rqsys-client` | PASS / 3/3 |
| 两仓 `git diff --check` | 干净 |

## 9. 数据一致性（线上只读 SQL）

```json
{"total_all":334,"active":334,"teambition":333,"web_manual":1,"base_form":0,"chat_paste":0,
 "assessments":0,"failed_jobs":0,"expired_jobs":0,"failed_pushes":2,
 "orphan_analysis":0,"orphan_push":0,"orphan_assessment":0,
 "orphan_scores":0,"orphan_snapshots":0,"orphan_pm":0,"orphan_jobs":0,
 "orphan_intake_receipts":0,"orphan_edit_receipts":0}
```

平台 ID 集合对账：App active `md5(string_agg(id))` = PM 平台 ID 集合 md5 = `34dcc534d58787aa4425dc52aabeb0c8`（各 334 条）。

流水线状态：pull synced 333 + collected 1；analysis analyzed 333 + failed_retryable 1；owner 287/45/2；push pushed 334。

## 跨块观察（不改变本块结论）

1. **RQ-000335 的 AI 分析未成功**：`analysis_state=failed_retryable`，3 次 `provider_error`（上游 HTTP 502），自动重试预算耗尽；推送本身成功（v3 pushed，PM 行存在）。属供应商时段性故障，不是契约或代码缺陷；是否手动重试请 Chief/测试决定。
2. **边界值**：`check:contract` 的 trigger=enabled 是当前正常运行状态；若发版流程要求验收时 disabled，需要按流程临时停用再恢复。
