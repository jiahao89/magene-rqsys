# 集团池首个定时批次 · 核对清单

- 触发时间：**2026-11-23（周一）09:00 Asia/Shanghai**（开启 schedule 后首个自动批次）
- 目标：证明集团池定时触发链路可用、数据只进集团表、产品池不受影响
- 基线（2026-11-21 收尾）：产品池 334（TB 333 / 手工 1）、集团池 191、产品 Base 334、集团 Base 191、集团批次 3 批（均手动）
- 观察窗口：09:00–10:00（平台 automation 粒度 30 分钟、pollOnce 按 `BASE_INTAKE_SYNC_INTERVAL_MS` 轮询，允许偏移；记录实际时间即可）

## 0. 开跑前（周一 08:55 前）

1. 确认来源配置：`GET /api/sources` → 集团项 `enabled=true`、`schedule` = 周一/三/五 09:00、`executorAllowlist` 8 人（刘媛媛、史东升、李晨璐、毕梓浩、盛永帮、贾浩、王赵云、兰诣伟）。
2. 记快照：`source-counts` 产品/集团、`batches?pool=group` 条数与最后一条 id、集团 Base `record_count`。
3. 记 TB 口径：集团项目「需求收集与管理」当前任务总数（用于核对 `filteredCount`）。

## 1. 批次本体（09:00 后轮询 `batches?pool=group`）

| # | 检查 | 期望 |
|---|---|---|
| 1.1 | 出现新批次 | `triggerType=scheduled`、`pool=group`、`actorId=null` |
| 1.2 | 时间 | `startedAt` 落在 09:00–10:00（记录实际偏移） |
| 1.3 | 计数 | `totalCount = succeededCount`、`failedCount=0`；`totalCount` = 8 人名单内任务数 |
| 1.4 | 过滤 | `filteredCount` = 项目任务总数 − `totalCount`；与基线 1106 的差值能对上 TB 侧变化 |
| 1.5 | 状态 | 批次 `succeeded`；`errorSummary` 为空 |

## 2. 数据增量（本批前后对比）

| # | 检查 | 期望 |
|---|---|---|
| 2.1 | 集团池条数 | 新增条数 = 本批新任务数；无任务变化时仍 191（幂等同样算 PASS） |
| 2.2 | 产品池条数 | 仍 334，不因集团批次变化 |
| 2.3 | 产品 Base | `数据表` 仍 334，无新增/无改动 |
| 2.4 | 集团 Base | `集团需求池` 条数 = 集团池条数；旧 191 条 `record_id` 不变 |
| 2.5 | 去重 | 集团表内 `需求平台ID`、`TB需求ID` 无重复；新增行 `TB链接` 非空（URL 对象）、`来源方式=Teambition`、`推送状态=已推送` |
| 2.6 | 编号 | 新需求编号连续且 > RQ-000526，不回收、不撞号 |

## 3. 通知与审计

| # | 检查 | 期望 |
|---|---|---|
| 3.1 | 推送静默 | 本批推送不产生新的 `系统通知事件ID`（工作流忽略 openAPIBatchUpdate） |
| 3.2 | 负责人变更 | 若确有人事变更，事件为 `owner_changed:*` 且类型「负责人变更」；无变更则不新增 |
| 3.3 | 审计 | 批次审计含 `filteredCount`；无 `base_config_missing`、无 `scan_truncated` |
| 3.4 | 运维 | 集团 `ops/metrics` sync +1、成功率 100%；`ops/jobs` 不新增 failed；既有 41 条历史 job 不参与当前口径 |

## 4. 失败与回退

- 任一写入落到产品 Base、或集团 Base 条数与 App 不一致 → **立即停**：关集团 schedule，保留证据，报 Chief。
- 批次 `failed`/`partialFailure` → 记录 `errorSummary`、失败项 id，按重试入口处理前先确认不是配置问题。
- 若 10:00 仍无批次：先查 `ops/metrics` 最近同步时间与调度日志（妙搭 automation），区分「未触发」与「触发失败」，不要直接改配置。

## 5. 证据留存

- `source-counts`（产品/集团）前后各一张 JSON
- `batches?pool=group` 全量 JSON + 新批次详情截图
- 集团 Base 导出 ndjson（本批后）+ 产品 Base 计数
- 通知事件新增情况（`系统通知事件ID` 计数）
- 时间偏移记录（计划 09:00 vs 实际 startedAt）

判据：1.x 全过 + 2.1–2.6 无误 + 产品侧零变化 = **PASS**；任一条不满足按 §4 处理并如实标注。
