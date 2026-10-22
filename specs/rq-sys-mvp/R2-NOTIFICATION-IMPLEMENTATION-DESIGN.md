# R2 完整通知实施设计（已被更简单的最终方案取代）

> **状态：已取代。** 本文提出的"应用侧 outbox + 逐收件人台账"在 2026-10-19 被产品决策否决：确认不存在一条通知发多人的场景，且不要求逐收件人送达记录。最终实现改为「应用写 4 个系统字段 + 多维表格自动化发送 + 单收件人两步走」，见 `03-owner-and-base-push.md` 的收件人规则与 `RELEASE-CLOSEOUT.md` 的当前结论。本文保留作为取舍记录。

> 状态：**设计稿，待确认后实施**。依据工单 18、`NOTIFICATION-CLOSEOUT-DESIGN.md`（2026-10-16 已批准的隔离 POC 方案）与 `NOTIFICATION-CAPABILITY-RESULTS.md`（POC 结果）。
>
> 本文件回答工单 18 第 1 步要求的四件事：数据归属、幂等键、事务边界、故障恢复；并明确剩余平台未知项。**未经确认不实施、不配置正式 Base、不开启通知。**

## 1. 起点：POC 证明什么、没证明什么

| 能力 | POC 结果 |
|---|---|
| 延迟后的触发载荷（E1/E2 各用自己的事件ID，不读最新值） | 通过 |
| 同事件重放静默 | 通过 |
| 同次写入负责人+归并值不重复通知 | 通过 |
| 负责人清空不发通知、A→空→A 再次通知 | 通过 |
| 旧任务延迟回写不覆盖新值 | 通过 |
| **条件更新的并发原子性** | **未证明**（只有一个顺序样本，平台未保证筛选与写入原子） |
| **部分收件人失败后的精确补发** | **未证明**（只测了本人，没有真实失败） |

结论：**四字段主表方案不能作为最终实现**。两个未证明点都不是"再多测几次"能解决的——它们取决于平台能力，无法由我们控制：

- **条件更新原子性**：即使观察到"变更 0 条记录"，也不能证明并发下筛选与写入不可分割。
- **逐收件人补发**：Base 自动化一次通知动作对应多个收件人，平台**不暴露逐收件人的送达结果**，因此"已成功者不重复、失败者才补发"在结构上无法表达。

## 2. 架构决策

**采用「应用侧不可变意图 + 逐收件人投递台账」，通知由应用自己的 worker 发送；Base 只保留 PM 字段归属，不再承担通知发送。**

理由：PRD 要求"逐收件人记录实际成功/失败与补发证据"和"失败不回滚业务推送"。只有应用拥有逐收件人状态时才能满足；Base 自动化无法表达。POC 已验证 Base 侧**不可变载荷**可用，但那条能力等价于"我们不依赖它"——由应用持久化意图后，天然不可变。

`NOTIFICATION-CLOSEOUT-DESIGN.md` 已把"服务端 outbox"列为"仅在推荐方案目标能力验证失败时另行确认"的备选；POC 的两项未证明正是该触发条件，因此这里正式提出切换，等待确认。

**Base 自动化处置**：正式通知工作流 `wkfYO1EEYxJXbCaN` 保持 disabled、steps=[]，不启用。POC 的 4 个候选字段与 2 条合成记录按 POC 结论保留审计，不删除、不复用为生产字段。

## 3. 数据归属

新增两张表（**加法迁移，不改既有表结构**，迁移号 `0002_notification_intent.sql`）：

### `notification_intents` —— 不可变推送/通知意图

在**第一次外部写（Base 写）之前**持久化，一次业务推送产生一行。写入后不再更新，新推送产生新行。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | 应用生成 |
| `requirement_id` | uuid FK → requirements(id) | 与 `pm_snapshots` 一致，**用 DB uuid，不用 TB ID** |
| `source_version` | integer | 触发本意图的源版本 |
| `push_version` | integer | 第几次业务推送（`base_push_runs.push_version`） |
| `event_kind` | text | `first_push` / `substantive_update` / `owner_assigned` / `owner_changed` / `ai_retry_success` |
| `idempotency_key` | text UNIQUE | 见第 4 节 |
| `base_record_id` | text | 目标 Base 行（首次推送时为 null，写入后回填由 run 表承担，本表不改） |
| `reasons` | jsonb | 命中的全部原因（可多个同时成立，**不做单事件优先级**） |
| `write_projection` | jsonb | 本次写入 Base 的**完整固定投影**（字段名→值）。用于崩溃后重放，避免重算最新版 |
| `recipients` | jsonb | 固定收件人快照：`[{userId, idType, role}]`，role ∈ `pm_leader`/`proposer`/`owner` |
| `proposer_state` | text | `resolved` 或 `proposer_field_unavailable` |
| `created_at` | timestamptz | |

不变量：
- 本表**只追加**，无 UPDATE。
- `write_projection` 与 `recipients` 一旦写入即固定；任何重放都读本行，不重算。
- 不含姓名、手机号、邮箱等人员信息以外的内容；**模型绝不接收本表任何字段**。

### `notification_deliveries` —— 逐收件人投递台账

每个 (意图, 收件人) 一行，状态机 `pending → sending → sent | failed_permanent`，`failed` 可重试。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `intent_id` | uuid FK → notification_intents(id) | |
| `recipient_user_id` | text | 飞书 user_id（经 `/resolve` 校验） |
| `recipient_role` | text | 与意图里的一致 |
| `dedupe_key` | text UNIQUE | `<intent_id>:<recipient_user_id>`，保证同事件同收件人只投一次 |
| `status` | text | `pending`/`sending`/`sent`/`failed_retryable`/`failed_permanent` |
| `attempt_count` | integer | 默认 0，上限 5 |
| `message_id` | text null | 成功后的飞书消息 id（证据） |
| `last_error_code` | text null | 脱敏结构化码，不写 provider 原文 |
| `next_attempt_at` | timestamptz null | 退避 |
| `created_at` / `updated_at` | timestamptz | |

不变量：
- `dedupe_key` UNIQUE 保证"已成功者不重复"。
- 只有 `status='pending'` 且到期的行会被认领（与 `pipeline_jobs` 同样的 `FOR UPDATE SKIP LOCKED` 模式）。
- **通知失败不回滚业务推送**：`base_push_runs.status` 与 `requirements.pipeline.push` 不受 `notification_deliveries` 影响。

Web 不回读本表；不加任何送达状态接口。

## 4. 幂等键

| 层 | 键 | 语义 |
|---|---|---|
| 业务推送 | `base-push:<requirementId>:sv<sourceVersion>:av<analysisVersion>` | 与现有一致 |
| 通知意图 | `<event_kind>:<requirementId>:sv<sourceVersion>` | 同一事件同版本只产生一次意图 |
| 负责人事件 | `owner:<requirementId>:<fromUserId|none>:<toUserId>:<occurredAtMillis>` | 负责人变化必须能表达 A→空→A（A 相同但中间有空），因此带时间戳；同值写入不产生键 |
| 投递 | `<intent_id>:<recipient_user_id>` | 唯一约束即幂等 |

**去重规则**：同一 `idempotency_key` 已存在意图 → 不新建、不重发，直接返回既有结果（静默）。这与 POC 的"同事件重放静默"等价，但由唯一约束保证而不是平台行为。

## 5. 事务边界

**核心原则：先持久化意图，再写外部。**

1. **T1（应用库，单事务）**：`INSERT notification_intents` + `INSERT notification_deliveries`（逐收件人 `pending`）+ `UPDATE base_push_runs SET status='intent_recorded'`。
   - 若 T1 失败 → **不发起 Base 写**，业务推送记为失败可重试。这是"没有意图不产生外部副作用"的硬保证。
2. **T2（外部，不可回滚）**：Base create/update，使用 T1 固定下来的 `write_projection`。
3. **T3（应用库，单事务）**：`base_push_runs.status='pushed'` + `requirements.base_record_id` / `pipeline.push='pushed'` + 推进 owner 状态。
   - 沿用 P1 的 `pushed_unrecorded` 语义：T3 失败不算推送失败、绝不重推外部。
4. **投递由独立的 `notification` 作业完成**，与推送作业解耦；推送成功即可，不等投递。

**跨进程单需求串行**：对同一 `requirement_id` 的推送串行化，用 PG advisory lock（`pg_advisory_xact_lock(hashtext(requirement_id))`）在 T1 的作用域内取锁；拿不到则本轮跳过、下轮重试。避免两个实例同时为同一需求创建意图。

**旧推送不得覆盖新推送**：T3 的 UPDATE 必须带版本谓词
```sql
UPDATE requirements SET base_record_id=$1, pipeline.push='pushed', ...
WHERE id=$2 AND source_version <= $3 AND push_version < $4
```
返回 0 行 → 说明已有更新版本写入，**本次结果作废**（不回写、不覆盖），并记一条审计。

## 6. 故障恢复

| 故障点 | 状态 | 恢复方式 |
|---|---|---|
| T1 后、T2 前崩溃 | 有意图、无 Base 行 | 重试读同一意图的 `write_projection` 执行 T2（**不重算最新版**） |
| T2 成功、T3 前崩溃 | Base 已写、应用未记 | 下次推送先 `findByRequirementKey` 命中 → 按"已有行"update 而非新建；并据 `base_push_runs` 中已记的 `base_record_id` 对账补写 |
| T2 成功、T3 写失败 | 同上 | `pushed_unrecorded`（P1 已实现），作业判成功，不重推外部 |
| 投递失败 | `failed_retryable` | 独立补发作业按 `attempt_count` 退避重试；**只补发未成功的收件人** |
| 投递永久失败 | `failed_permanent` | 记审计，等待人工；不阻塞业务 |
| 进程崩溃在投递中 | `sending` | 租约过期（复用 `pipeline_jobs` 的租约+心跳）后由回收器重置为 `pending` |

**"Base 已写、应用未记成功"的判定**：不靠猜测。`base_push_runs` 已记 `baseRecordId` 时视为已写；未记时以 `findByRequirementKey(projectId, requirementId)` 的真实命中为准。两者都不成立才允许创建新行。

## 7. 事件判定规则（实施依据）

逐条件独立计算，命中多个则**合并原因与收件人并去重**：

| 事件 | 触发条件 | 收件人 |
|---|---|---|
| `first_push` | 应用首次成功推送该需求 | 自动匹配时**静默**；**人工分配时通知被分配的负责人**（D-12，2026-10-22 修订） |
| `substantive_update` | 实质字段 hash 变化且推送成功 | 同上 |
| `owner_assigned` / `owner_changed` | 负责人由空→A 或 A→B（含仅映射变化、源版本未变） | 新负责人 |
| `ai_retry_success` | AI 由失败转成功且推送成功 | PM Leader + 当前负责人 |

静默条件（**必须有实际消息/运行记录证明**）：重复同步无变化、无新结果的分析重试、同 `idempotency_key` 重放、负责人清空（但须清空归并值）、同值写入。

其他规则：
- 提出人：当前 `field_map` 未建立提出人投影 → 记 `proposer_field_unavailable` 并跳过，**不从标题/姓名/自定义字段猜测**。
- 新行初始化 `PM状态=待处理`；已有行首次推送**不重置** PM 字段。
- 不新增 RBAC；PM Leader 初始为贾浩（配置项，不硬编码）。

## 8. 剩余平台未知项（实施前必须验证）

1. **应用是否有可用于发送消息的 bot，以及 `im:message`（按 user_id 单聊）权限**。POC 的消息来自 Base 应用自有 bot；RQ-Sys 应用自己的 bot 能力未验证。**这是本方案唯一的硬阻塞点**。
2. 应用 bot 能否向**非测试用户**发送（正式收件人启用前单独确认）。
3. 消息卡片形态是否可复用 POC 的模板（标题/链接/原因）。
4. Miaoda 侧对出站请求的限流。

> 若第 1 项不成立：本方案失败，退回"Base 自动化发送 + 接受无法证明逐收件人补发"，并需重新确认 PRD 该项是否可降级。**不用时间窗口或布尔开关绕过。**

## 9. 实施与验收顺序

1. 本设计评审确认（含第 8 节第 1 项的验证结果）。
2. 加法迁移 `0002` + 仓储 + 意图写入（T1）+ Base 写用固定投影（T2）+ 版本谓词（T3）。本地测试。
3. 投递 worker + 补发；只向贾浩发送。
4. 目标 Base（POC 表）构造场景：首次、实质变更、分配、A→B、A→空→A、AI 重试成功、无变化静默、同键重放静默、**注入部分收件人失败后精确补发**。
5. 逐收件人证据：`notification_deliveries` 行 + 飞书 `message_id`；证明已成功者不重复、业务推送不被通知失败回滚。
6. 通过后才配置正式 Base 与正式收件人；周计划仍关闭，待单独确认。

## 10. 明确不做

- 不启用正式工作流 `wkfYO1EEYxJXbCaN`。
- 不向除贾浩外的任何人发送测试消息。
- 不把人员信息发送给模型。
- 不在 Web 显示送达状态。
- 不删除 POC 的 4 个字段与 2 条合成记录。
- 不在本设计确认前写任何生产通知代码。
