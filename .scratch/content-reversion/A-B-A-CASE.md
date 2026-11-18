# #1 内容回退（A→B→A）复现与验收用例

> 状态：**已定稿（2026-11-18）**。结论：原始描述（确定性 A→B→A 永久停在 B）**误报**；竞态版本**确认为真**（两种精确时序），已按「按版本守卫 + 补入队」修复，不采用 `content_revision`、不加迁移。R1 用例见 §7，修复代码见 §6.3。
> 约束：**不加迁移**、不改键格式、不 commit/发版。测试在假依赖/harness 与 CI PostgreSQL 上跑，**不得连生产库**；目标环境不构造 A→B→A（不能写真实 TB）。
> 关联：`.scratch/ai-status/ACCEPTANCE.md`（同轮验收）、`docs/2026-11-16-requirement-sources-plan.md` §7.2。

---

## 1. 报告的现象与当前判断

- 报告：#1「A→B→A 时 `source_hash` 回到旧值，`push_state` 不重置、不入队，Base 永久停在 B」。
- 方案（报告人）：新增 `content_revision`（实质变化 +1）作单调判据，驱动重置与陈旧守卫；迁移 0029 回填；不改键格式，只把 `contentRevision` 放 payload + 改守卫。
- Chief 的读码结论：`upsert` 的 `push_state = CASE WHEN requirements.source_hash IS DISTINCT FROM excluded.source_hash THEN 'pending'`；A→B→A 两次都 distinct，**应当重置**。`advance` 与 `substantiveChanged` 比较的也是上一次成功推送的快照。因此先复现。
- 本文立场：**先证伪或证实**。确定性顺序路径大概率通过；真正可疑的是「推送/分析在途时回退」的竞态，以及失败分析终态下的推送门槛。

**进展与结论（2026-11-18）**：

1. **原始描述 → 误报**。后端在 `apps/api/src/base/push-service.test.ts` 新增「A→B→A: content returning to an older hash still pushes as a substantive change」：上次成功推送是 B(v2)、当前回到 A(v3) → `substantiveChanged=true`、`base.push` 调用 1 次、`baseRecordId` 落库，通过。说明推送判据看的是「上次成功推送的快照」，不是「是否推过」，顺序路径会推回 A；`content_revision` 与迁移 0029 不做。
2. **竞态版本 → 真缺陷，且必须精确到两种时序**。后端修正了我最初给的 R1 顺序：若 v3 分析终态是 `analyzed`、且在 B 推送**完成之后**才到，`advance` 实际会入队，不会卡死。真正卡死的是：
   - **① 分析终态早于 B 推送完成**（B 仍 `running`）：`advance.ts:29` 直接 `not_eligible`，此后没有任何事件再触发。
   - **② B 推送完成把 v3 的 `pending` 覆盖成 `pushed`，而 v3 分析是 `failed_retryable`**：`pushed && 非 analyzed` 再次挡住，同样无补偿。
3. **修复已落地（不加迁移）**：`push-service.ts` 用 `settlePushState` 按源版本守卫（旧版本完成不回写 `pushed`/`failed`，发现仍是 `running` 则复位 `pending`）；`processing.ts` 的 `handleBasePushJob` 在推送结束后调用 `enqueueSupersededPush`（当前版本已前进 + `pending` + 分析终态才补入队）；`advance` 未改，避免双入口重复入队。详见 §6.3。
4. **测试**：R1 竞态用例 2 条 + 补偿正/负例 2 条；push-service / processing / advance 三个文件合计 **75/75 通过**（证据 `evidence/20261118/r1-fix-tests.txt`）。

---

## 2. 术语与场景

| 记号 | 含义 |
| --- | --- |
| A、B | 同一条 TB 需求的两份实质性内容（如标题/描述不同），`sourceHash(A) ≠ sourceHash(B)`，`substantiveHash` 也随之不同 |
| A→B→A | 三次成功同步：v1=A、v2=B、v3=A（同一条需求、同一个 TB ID，版本递增） |
| 期望 | v3 之后 Base 行内容回到 A；`lastPushedAt` 更新；流水线终态一致 |

**为什么用实质性字段**：只改 `source_url`/状态/负责人等非实质字段，`substantiveHash` 不变，走的是元数据推进而不是重分析；那是另一条路径（见 §6.3），不能拿来验证本条。

### 2.1 已核实的代码路径与初步证据（2026-11-18）

| 事实（修复前定位，已由后端确认） | 位置 | 影响 |
| --- | --- | --- |
| `upsert` 在 `source_hash` 变化时把 `push_state` 置 `pending`、`substantive_hash` 变化时把 `analysis_state` 置 `pending` | `apps/api/src/adapters/postgres/repositories.ts:147` | 顺序 A→B→A 的**重置本身成立**，报告的「不重置」在纯 SQL 层说不通 |
| 分析终态推进门：`push === "running"` 直接 `not_eligible`；`push === "pushed"` 且分析非 `analyzed` 也 `not_eligible` | `apps/api/src/pipeline/advance.ts:29` | 回退时若 B 的推送仍在途，A 的分析终态会被丢弃，不再入队（**未修改**） |
| 推送成功记账**无条件** `setPushState(req.id, "pushed")`，不校验这次推的是不是最新源版本 | `apps/api/src/base/push-service.ts`（修复前） | B 推送完成会把回退时置的 `pending` 覆盖回 `pushed`，制造「源=A、Base=B、状态=pushed」 |
| 同步 upsert 用行锁（`SELECT ... FOR UPDATE`），推送用 `withRequirementLock`（advisory lock）；两者不是同一把锁，推送可能在 v3 提交后仍按 v2 的读取写 Base | `repositories.ts:131`、`base/push-service.ts` 的 `pushRequirement` 注释 | 上述覆盖窗口真实存在，不只是理论 |
| `base_push` 只从 4 条路径入队：分析终态推进、元数据推进、人工负责人保存、owner-recheck；**没有**「pending 但无作业」的补偿扫描 | `advance.ts:53/125`、`http/app.ts:1234/1251/1269`、`scheduler/owner-recheck.ts:146` | 一旦 advance 返回 `not_eligible`，没有兜底会补推 |

**修复后（2026-11-18 已落地）**：

| 事实 | 位置 | 作用 |
| --- | --- | --- |
| `settlePushState(req, to)`：读当前需求，只有 `current.sourceVersion === 本次推送版本` 才写 `pushed`/`failed`；版本已前进时，若当前状态仍是 `running` 则复位 `pending`，绝不覆盖新版本状态 | `apps/api/src/base/push-service.ts` | 去掉「B 完成覆盖 v3 pending」的根因 |
| `enqueueSupersededPush`：当前版本已前进 + `push_state=pending` + 最新分析已终态（`analyzed`/`failed_retryable`）时，按 `base-push:{id}:sv{current}:av{latest}` 补入队；分析未终态则不抢先 | `apps/api/src/requirements/processing.ts`（`handleBasePushJob` 推送结束后调用） | 补上「pending 但无作业」的补偿；补推失败只记日志，不影响本次推送结果 |
| `advance` 的入队门**未改** | `apps/api/src/pipeline/advance.ts:29` | 只有补偿一个入口，避免与推进器重复入队 |

修复前的探针输出（源版本 3、分析终态依次为成功/失败；用于证明推进门确实会丢单）：

| 场景 | 结果 | 入队作业 |
| --- | --- | --- |
| `push=running` + A 分析成功 | `not_eligible` | 无 |
| `push=running` + A 分析失败 | `not_eligible` | 无 |
| `push=pushed`（B 已推）+ A 分析失败 | `not_eligible` | 无 |
| 对照：`push=pending` + 分析失败 | `queued` | `base-push:req-1:sv3:av3` |
| 对照：`push=pending` + 分析成功 | `queued` | `base-push:req-1:sv3:av3` |

**结论**：确定性顺序 A→B→A 正常（误报）；竞态的真实触发点不是「B 完成 → v3 分析成功」（那会入队），而是 **① 分析终态早于 B 完成** 与 **② B 完成覆盖 pending + 分析失败**。修复用「版本守卫 + 补偿」解决，`content_revision` 不采用。

---

## 3. 期望终态（顺序执行、无竞态）

以 v3=A 同步完成、下游全部跑完为前提：

| 对象 | 断言 |
| --- | --- |
| `requirements` | `source_version=3`；`source_hash=hash(A)`（与 v1 相等）；`substantive_hash=sub(A)`；`analysis_state=analyzed`；`push_state=pushed`；`last_pushed_at` 为 v3 推送时间；`base_record_id` 仍为同一 Base 行 |
| `source_snapshots` | 3 行：v1=A（`is_substantive_change=true`）、v2=B（true）、v3=A（true）；**v3 必须存在**（append-only，不覆盖 v1） |
| `analysis_runs` | v3 有一次分析（`source_version=3`，`status=analyzed`）；v1/v2 的运行可保留 |
| `pipeline_jobs` | 分析作业键 `analysis:{id}:v3`；推送作业键 `base-push:{id}:sv3:av{analysisVersion}`；跑完后无 pending/running |
| `base_push_runs` | 至少 3 次成功推送；最新成功的 `source_version=3`；Base 行标题/描述 = A |
| 审计 | `analysis.terminal` 至少 3 条（v1/v2/v3），`push` 相关记录指向 v3；无未解释的失败 |
| Base | 行内标题/描述 = A；`需求平台ID`/`需求链接`不变；PM 字段不被重置（若配置了快照保护） |

**失败（复现成立）的定义**（满足任一）：

1. 所有作业终态、无 pending/running，但 `requirements.source_hash=hash(A)` 而 Base 仍显示 B，且无新的 `base_push_runs`。
2. v3 同步后 `push_state` 仍为 `pushed`（未重置为 pending）或 `pending` 但没有对应 `base_push` 作业/已终态失败。
3. v3 没有触发分析（`analysis_state` 未回到 pending 且无 v3 运行），也没有任何路径重新推送。
4. 出现「作业已完成但需求状态与 Base 内容不一致」的其他组合；典型是详情页显示「已推送」、UI 不提供推送重试入口，用户无法自救。

---

## 4. 测试层次（从下往上，先定位再端到端）

### L1 仓储契约（PG，直击报告的 SQL 条件）

在 `apps/api/src/adapters/postgres/repository-contract.test.ts` 增加用例（CI 有 Postgres service；本地无库时该文件会因 `DATABASE_URL`/连接失败而失败，属环境缺口，不能据此判定「未复现」）：

```text
upsert A (sourceVersion 1) → 断言 push_state=pending, analysis_state=pending, source_hash=A
upsert A 重放 → 断言 version 仍 1、hash 不变、不新增快照
upsert B (version 2) → 断言 version=2, push_state=pending, analysis_state=pending, snapshot v2
upsert A (version 3) → 断言 version=3, source_hash=A, push_state=pending, analysis_state=pending, snapshot v3 存在
```

重点断言（对应报告）：

```sql
SELECT source_version, source_hash, substantive_hash, analysis_state, push_state
FROM requirements WHERE id = :id;
-- 期望 v3：source_version=3, source_hash=hash(A), push_state='pending', analysis_state='pending'

SELECT source_version, source_hash, is_substantive_change
FROM source_snapshots WHERE requirement_id = :id ORDER BY source_version;
-- 期望 3 行，v3 hash=hash(A)
```

> 如果这里 v3 的 push_state 已经是 pending，报告的「不重置」就不成立；继续做 L2 看「是否入队/是否推送」。

### L2 下游推进（服务层，验证「入队 + 推送 + Base 回 A」）

用现有 `requirements/processing.ts` 的 `dispatchAfterSync` + `pipeline/advance.ts` + `base/push-service.ts` 组合，配假 provider/假 Base（或 PG 集成）：

```text
dispatchAfterSync(touched=[{id, sourceVersion:3, substantiveHash:sub(A), analysisRequired:true}])
→ 断言 enqueue 了 analysis:{id}:v3
handleAnalysisJob(v3)（stub provider 返回 analyzed）
→ 断言 enqueue 了 base-push:{id}:sv3:avN
pushRequirement（stub Base）
→ 断言 Base 写入的 title/description = A；substantiveChanged=true（相对 v2 快照）
→ 断言 requirements.push_state='pushed'、lastPushedAt 更新
```

若 L1 显示 v3 的 `analysisRequired` 没有被正确计算（`substantive` 为 false），L2 会直接暴露「不入队」。若 L1 正常而 L2 失败，问题在推进/推送层。

### L3 竞态变体（最可疑；必须显式控制时序，不靠 sleep）

| 变体 | 时序 | 期望 | 观察点 / 结果 |
| --- | --- | --- | --- |
| R1（触发①，已修） | B 的 base_push 处于 running → v3 回退同步完成 → **v3 分析终态先到**（B 仍 running）→ B 推送完成 | 最终应有 v3 的 base_push，Base=A | 修复前：`advance` 在 `running` 时 `not_eligible`，B 完成后再无事件；修复后：B 完成触发 `settlePushState` 复位 pending + `enqueueSupersededPush` 补入队 |
| R2（触发②，已修） | B 推送 running → v3 回退同步完成 → **B 推送完成**（旧实现把 pending 覆盖为 pushed）→ v3 分析 `failed_retryable` | 按不变式，分析失败不阻断新版本推送，Base=A | 修复前：`pushed && 非 analyzed` 挡住且无补偿；修复后：`settlePushState` 不覆盖新版本状态，补偿在分析终态后入队 |
| R3（对照，非缺陷） | B 推送完成 → v3 分析 `analyzed` 才到 | 入队 v3，Base=A | 原实现的 `advance` 本来就允许（`pushed && analyzed`），我最初给的 R1 顺序属于这一种，不会卡死 |
| R4 | B 的 analysis job 尚未跑；A 回退后 v2 job 被 worker 领取 | v2 job 因 `substantiveHash` 不匹配直接返回；v3 job 正常 | `handleAnalysisJob` 的陈旧守卫 |
| R5 | B 的分析在跑时 A 回退 | v2 分析完成时源版本已变（v2 结果不应写终态）；v3 重新分析 | `complete` 的 sourceVersion 守卫 |
| R6 | 回退恰好与 push 完成同一时刻（顺序不可控） | 最终 Base=A 或明确进入 failed 待重试，不得静默 | 作业/审计 |

**结论**：真实缺陷只有 R1（①）与 R2（②）两种时序；R3 是正常路径。修复只做「版本守卫 + 补偿」，`advance` 不动，避免重复入队。R4–R6 未在本轮构造，作为残余风险记录。

### L4 目标环境

**不可构造**：验收不允许改真实 TB 需求内容（A→B→A 需要写 Teambition），因此不在线上制造。目标环境只核对发布后的既有回归（同步/分析/推送不回归），本条以 L1–L3 的 CI 证据为准，记 `BLOCKED（目标不可构造）`。

---

## 5. 复现执行方式（只读/一次性库）

```bash
# CI 同款：一次性 Postgres（本地/容器），指向临时库
export DATABASE_URL=postgres://rqsys:rqsys@127.0.0.1:5432/rqsys_abatest
npm --workspace @rq-sys/api run db:migrate:ci
node --import=tsx --test apps/api/src/adapters/postgres/repository-contract.test.ts
npm --workspace @rq-sys/api run test   # 需要 PG 的用例会随 DATABASE_URL 真实执行
```

- 测试内使用临时 schema、结束回滚/清理；**不得**指向生产或共享库。
- 若本机仍无 Postgres，则在 CI 分支跑；本地只做类型/单测，不能据此判定「未复现」。
- 记录失败用例的完整输出、断言值、期望值，附到本文 §7。

---

## 6. 结论（2026-11-18 已定）

### 6.1 原始描述：误报（确定性 A→B→A 正常）

- 证据：`apps/api/src/base/push-service.test.ts` 的「A→B→A: content returning to an older hash still pushes as a substantive change」通过；加入竞态用例后该文件 **49/49**，三个相关文件合计 75/75。
- 原因：推送判据比较的是「上次成功推送时的源快照」（B），不是「是否推过」；`upsert` 在 A→B→A 两次 hash 变化时都会把 `push_state` 置 `pending`。所以顺序执行下 Base 会推回 A。
- 结论：不引入 `content_revision`，**不加迁移 0029**；原报告里的「source_hash 回旧值就不重置」不成立。

### 6.2 竞态版本：确认为真缺陷

根因三层（缺一不可，均指**修复前**）：

1. **入队门**：`advance.ts:29` 在 `push === "running"` 时返回 `not_eligible`；v3 分析终态不入队。
2. **记账覆盖**：`push-service.ts` 在 B 推送成功后**无条件** `setPushState("pushed")`，把 v3 回退时置的 `pending` 覆盖掉。
3. **无补偿**：`base_push` 只有分析终态、元数据推进、人工负责人、owner-recheck 四条入队路径，没有「`pending` 但无作业」的扫描。

结果：`source_hash=A`、Base=B、`push_state=pushed`，详情页不给重试入口，用户无法自救。

**`content_revision` 与本问题无关**：它解决的是「判据是否单调」，而这里判据（上次成功推送快照）已经是对的；挡住推送的是推进门与状态覆盖。即使加了 `content_revision`，`advance` 在 `running` 时仍然会丢弃，问题照旧。修复见 §6.3。

### 6.3 修复与验收（2026-11-18 已落地）

实际实现（按 Chief 的两步收敛为**一处入队**，不加迁移）：

1. **`settlePushState(req, to)`**（`apps/api/src/base/push-service.ts`）：先读当前需求；只有 `current.source_version === 本次推送版本` 才写 `pushed`/`failed`；版本已前进时，若当前状态仍是 `running` 则复位 `pending`，绝不覆盖新版本状态。成功与两条失败路径都走它。
2. **`enqueueSupersededPush`**（`apps/api/src/requirements/processing.ts`，`handleBasePushJob` 在推送结束后调用）：当前版本已前进 + `push_state=pending` + 最新分析已终态（`analyzed`/`failed_retryable`）→ 按 `base-push:{id}:sv{current}:av{latest}` 补入队；分析未终态则不抢先，交给分析终态推进器。补推入队失败只记日志，不影响本次推送结果。
3. **`advance` 未改**：只有补偿这一个入口，避免两处都入队。`content_revision` 不采用（它治判据单调性，治不到推进门/状态覆盖）。

验收结果：

- **R1（①）**：`A→B→A race: a stale push completion must not overwrite the newer pending state`——推送期间 2→3，断言不写 `pushed`、写回 `pending`；旧实现会红，现在绿。
- **R2（②）**：补偿用例 `push compensation enqueues the current version when content advanced during the push` 断言补出 `base-push:req-1:sv3:av3`；负例覆盖「版本没变」「分析仍 running」均不入队。
- **R3（对照）**：顺序 A→B→A 的 `substantiveChanged=true` 用例保持绿；`advance` 既有「同版本重推不入队 / 新版本入队」用例不回归。
- 测试：`base/push-service.test.ts` + `requirements/processing.test.ts` + `pipeline/advance.test.ts` 合计 **75/75**（证据 `evidence/20261118/r1-fix-tests.txt`）。
- 目标环境不构造 A→B→A（不能写真实 TB），以 harness/CI 证据为准，记 `BLOCKED（目标不可构造）`；发布后只做同步/分析/推送的回归冒烟。

### 6.4 边界：非实质字段回退

只改 `source_url`/状态/负责人等不在 `substantiveHash` 的字段时，不重跑分析，走 `advanceSourceMetadata`。用例只断言「Base 元数据回到 A」且不新增 AI 版本；不要把它算作 #1 的复现。

---

## 7. 复现与验证记录（2026-11-18，已定稿）

| 项 | 值 |
| --- | --- |
| 执行环境 | 本机 Node 26 + tsx；**无 PostgreSQL**（L1 的 PG 用例未跑）；push-service/processing/advance 用 harness/假依赖 |
| 确定性 A→B→A 用例 | `apps/api/src/base/push-service.test.ts`「A→B→A: content returning to an older hash still pushes as a substantive change」通过：`substantiveChanged=true`、`base.push` 1 次、`baseRecordId` 落库（证据 `evidence/20261118/push-service-tests.txt`） |
| L1 仓储契约 | **未跑**（需 PG）。代码路径已核对：`push_state`/`analysis_state` 按 hash 差异重置；CI 有 Postgres service 时可补跑，本机结果不构成结论 |
| L2 下游推进 | 顺序路径由 push-service 用例覆盖；完整 sync→analysis→push 的 PG 集成未在本机跑 |
| R1（触发①） | `A→B→A race: a stale push completion must not overwrite the newer pending state`：推送期间 2→3，断言不写 `pushed`、写回 `pending`；修复前红、现在绿 |
| R2（触发②） | `push compensation enqueues the current version when content advanced during the push`：断言补出 `base-push:req-1:sv3:av3`；负例「版本没变」「分析仍 running」不入队；通过 |
| R3（对照） | 顺序 A→B→A 与 `advance` 既有同版本/新版本用例保持绿，未回归 |
| 探针证据 | `evidence/20261118/advance-probe.txt`：修复前 `push=running`（成功/失败）与 `push=pushed+分析失败` 均 `not_eligible`、无作业；`push=pending` 才 `queued` |
| 测试计数 | push-service + processing + advance 三个文件 **75/75**（`evidence/20261118/r1-fix-tests.txt`） |
| 结论 | **原始描述（确定性路径）误报；竞态版本确认为真（①/②），已修复**；不采用 `content_revision`、未加迁移 |
| 目标环境 | `BLOCKED（不可构造）`：不能改真实 TB 做 A→B→A；发布后只做同步/分析/推送回归冒烟 |
| 证据路径 | `.scratch/content-reversion/evidence/20261118/` |

---

## 8. 定稿结论

- 原始 #1「A→B→A 时 `source_hash` 回旧值 → 不重置、不入队」：**误报**，确定性顺序路径正常，不加 `content_revision`、不加迁移 0029。
- 竞态 #1（①分析终态早于旧推送完成；②旧推送完成覆盖新版本 pending 且新分析失败）：**真缺陷，已修复**；修复为「按版本记账守卫 + 补入队」，`advance` 未改，只有一处入队避免重复。
- 验收证据：R1/R2 用例 + 补偿正负例 + 顺序 A→B→A 用例，合计 75/75；目标环境不可构造，以 harness/CI 证据为准。
- 残余风险：L1 需 PG 的仓储契约用例未在本机跑（CI 可补）；R4–R6 竞态未构造；发布后需做一次正常同步/分析/推送回归冒烟。
- 本文状态：**已定稿**。同步给 Chief 与方案文档。
