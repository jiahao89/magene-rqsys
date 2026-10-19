# 定时合成验收方案

用户于 2026-10-15 明确批准开发、发布、临时配置并执行该方案，完成后恢复配置。

## 目的和边界

验证已发布平台 cron → 持久来源周计划 → 批次/作业 → 合成同步 → AI → 隔离 POC Base。复用真实调度器、数据库、队列及外部推送，仅替换 TB 数据输入为已有固定无人员合成记录。不修改产品 API、数据表或正式周计划约定。

## 服务端保护

- 新环境变量 `RQSYS_SCHEDULE_FIXTURE` 默认未设置。值为 JSON，仅包含 `sourceId`（UUID）和 `expiresAt`（带时区时间，未来且不超过两小时）。不接受调用方需求文本。
- 必须同时满足现有 `RQSYS_ENABLE_TEST_FIXTURES=true` 和隔离 Base `OddqbqBeOamFjFsR5IXcJdjknmd` / `tblxbyvbdLGVnLaO` 的精确匹配。
- 设置了无效、过期或不安全的模式时直接报错，不能回落到真实 TB。来源不存在时，在创建任何批次/作业前失败。测试模式仅调度指定来源，其余来源跳过。
- 指定来源仍须在数据库中 enabled + schedule_enabled；按真实持久时间/时区计算窗口。使用 `fixture-sched:` 批次幂等前缀，作业携带 `testFixture=true`，不占用正式 `sched:` 窗口。
- 测试模式期间所有 sync、analysis、Base push 只允许指定来源的合成作业。analysis/push 根据持久化需求的 `rqsys-fixture-` 身份判定，不能依赖只存在于 sync payload 的标记。合成输入无提出人/负责人，不自动通知其他人。
- 无论是否已退出定时测试模式，合成作业每次执行（包括延迟重试、手动重跑）都必须重新通过现有 fixture 开关和精确 POC Base 守卫；正式 Base 下直接拒绝。任何外部调用前执行守卫，避免恢复配置后夹具继续推送。保留已有快照/审计。
- 单项重试从持久 `onlyIds` 识别合成身份并沿用原需求 ID，拒绝混合真实/合成 ID，兼容旧队列缺少 marker 的情况。策略拒绝为终态；同步批次的失败收敛与 job 的 `running + expectedAttempt` 检查由同一条 PostgreSQL CTE 原子完成，避免孤儿批次和迟到 worker 覆盖结果。

## 执行与恢复

1. 本地先验证默认行为、保护条件、过期拒绝、指定来源与窗口幂等，再完成两仓回归/发布。
2. 核对 cron 实际执行环境、现有 Base 身份、所有 enabled sibling trigger、0 活动作业及来源原配置。安全备份需恢复的变量和来源配置，文件不入库、不打印密钥。
3. 若无法保留/恢复原变量，停止环境覆盖。仅在已批准 POC 配置及来源下启用短时模式和周计划，临时启用既有 cron，等待真实平台触发，不伪造成功。
4. 读取实际 instance 日志、scheduled batch/job、唯一合成需求/快照/分析/Base 行。重复触发不得生成同窗口第二批次。
5. 无论结果成功或失败，先停止新增触发并关闭来源计划，等待常驻 worker 在途作业收敛（0 queued/running）；若未收敛，保持 POC 安全配置并记录阻塞，不切回正式 Base。确认已缓存客户端对应的运行时重启/新实例实际读取新配置，不能仅凭控制台变量名判断生效。
6. 恢复原来源配置、环境变量和每个修改过的 trigger 原状态；本次目标原为 disabled，最终须回读 disabled。再次确认运行时配置恢复及 0 活动作业。测试历史可保留用于审计，临时目录仍为 7 人/54 模块。

## 实施顺序

1. 共享固定合成输入与短时模式策略（测试先行）。
2. 调度器增加显式的 fixture 来源参数及独立幂等命名空间，正常路径不变。
3. Root 和 Miaoda 组合根连接策略，防止测试模式误走 TB。
4. 类型检查、两仓测试/构建/对齐，提交并发布。
5. 真实平台验收与配置恢复，更新 Ticket 09。

## 2026-10-15 执行记录与关键缺陷（必须修正后再重跑）

本轮按本方案执行，**发现方案的核心假设不成立**，未取得夹具验收证据。所有临时配置已恢复（见文末核查）。

### 缺陷：`+env-set` 写入的夹具开关不会在运行实例中生效

- 17:56 通过 `+env-set` 在 dev/online 写入 `RQSYS_ENABLE_TEST_FIXTURES=true` 与 `RQSYS_SCHEDULE_FIXTURE`（含过期探测值），并启用 cron 触发器。
- 18:43 平台真实投递后，在线实例**按普通来源**处理了被指定来源：批次幂等键为 **`sched:`**（而非夹具命名空间的 `fixture-sched:`），作业 `payload.testFixture` 为 **null**。
- 即运行实例**没有读取到**新环境变量。控制台变量名可见不等于运行时生效——本方案第 5 步已警示这一点，但第 3 步"设置变量后等待真实触发"缺少强制重启步骤，因此**按原样执行必然走到无保护分支**。
- 10-14 那次夹具作业（`fixture-recovery:…` / `testFixture=true`）之所以生效，很可能是变量写入后伴随了一次发布/实例重建。

**修正**：设置夹具变量后必须先触发一次运行时重启/新实例（例如伴随一次发布），再用"过期配置应报错拒绝"的方式验证生效，**确认后才可启用任何来源的计划**。本方案第 3 步须补上该前置。

### 本轮为何未造成损害

探测用的临时来源 `external_project_id` 被刻意设为不存在的值，且**正式来源的 `schedule_enabled` 始终为 false**。因此落到无保护分支时只发生一次针对不存在项目的网关调用：批次 `total_count=0`、`requirements=0`、`base_push_runs=0`，**未写任何 Base、未发任何通知**。若当时按"直接指定正式来源并启用其周计划"执行，后果将是 311 条真实同步 + 正式 Base 写入 + 干系人通知。

### 恢复核查（2026-10-15 18:50）

- dev / online `RQSYS_ENABLE_TEST_FIXTURES`、`RQSYS_SCHEDULE_FIXTURE`：**已删除**，两环境各 8 个变量、无 `RQSYS_*`。
- 临时夹具来源：两库**已删除**（online 需先清理其探测批次/作业以解外键）。
- 正式来源：两库均为 `enabled=true, schedule_enabled=false`，与执行前一致。
- 触发器 `rqsysWeeklySyncRecovery`：**disabled**，与执行前一致。
- 两库 `pipeline_jobs` 无 queued/running，`sync_batches` 无 running。


## 2026-10-19 当前版本定时复验与可观测性根因

- 按已批准的隔离夹具方案检查两个在线 cron 窗口，没有捕获 app handler/guard 日志、scheduled batch 或 job。此证据无法区分平台未投递、handler 初始化失败或调度处理失败；没有启动 TB、AI、Base 或通知业务。
- 根因代码检查：`RqsysAutomation.pollDueSyncs` 原先仅在 `pollOnce()` 成功返回后打印完成日志；`getRuntime()` 或 `pollOnce()` 抛错时，应用侧没有对应阶段日志。平台 automation CLI 只提供触发器配置读写，不提供触发实例历史查询。
- 修复：handler 增加安全的 started、runtime-initialization failure、durable-poll failure、completed 日志。失败时仅输出错误类别，不输出异常消息/数据，并继续抛出原错误供平台判失败。
- 本地回归曾在修复前失败、修复后通过；Miaoda 路由测试90/90、server/client typecheck、lint、stylelint、production build通过。commit `9f6fb5d` 已发布为 release `7698043401983593483`（finished、`error_logs=[]`）。新标签冷启动 API 已连接，314/314需求可读；这只证明发布和普通请求，尚未证明 cron handler 接收调用。
- Online 状态已恢复：fixture 配置移除，source weekly plan disabled，`rqsysWeeklySyncRecovery` disabled (`*/30 * * * *`, `Asia/Shanghai`)，无 queued/running jobs 或 running batches。上述日志修复现已发布。下一步需在周计划关闭且无活动作业时临时启用该恢复触发器观察一个窗口；若 handler 到达，再评估隔离来源的 scheduled fixture 链路。正式周计划和通知保持关闭，恢复触发器原态仍为 disabled。

## 最新 Online release 与手动全量批次（2026-10-19）

- Online 已发布 app commit `9cf3dc492ca1f951c7e50ee72b61fb7157d0e3c5`（release `7698200680474332465`，`finished`、`error_logs=[]`）。这是定时日志修复之后的版本；当前 release 的 cron handler 仍未取得窗口级触发证据。
- 用户手动启动的 full_pipeline 批次 `4c75a3f7-c14e-4f85-9f86-4ae446831f6b` 源同步314条成功。该批次有7条 analysis run 为 `failed_retryable`、1条仍标记 `running`；该 running 记录对应的最新作业已 `failed/max_attempts_reached`，不是仍在执行的 cron/worker 作业。本轮没有重拉TB或重试AI。
- 当前正式周计划与 `rqsysWeeklySyncRecovery` 仍 disabled；本轮未更改调度配置。重新启用当前触发器观察窗口需单独明确授权。
- 独立 Base 回读：项目311条记录、311个唯一需求键；本批次314个源需求中缺少的3个键均处于 `pending/pending_mapping`，60个已推送键均存在且版本/状态一致。58条映射记录的 Base 人员字段非空，但 Base 回读 OpenID 与 RQ-Sys 保存的 user_id 类型不同，精确身份对应仍待验证。
