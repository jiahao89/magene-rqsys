# 总览「AI 状态」验收清单（2026-11-18）

> 状态：**V 区已完成；A1–A6、D1–D5、E1–E4、F1/F3、K 已有证据；仅剩 B、D6/D7/D8/L（需写库）与 F2（需 EXPLAIN）待执行**。依据：用户 2026-11-18 要求「总览页面增加 AI 状态区：AI 状态 + 累计用量」；Chief 2026-11-18 给出的口径与接口契约。
> 执行环境：飞书妙搭线上 app（生产库、生产 Base）。本功能以只读为主，**唯一写操作是暂停态测试用的 `system_flags` 临时行**；执行前须拿到授权，执行后必须清理并复查（见 §2、§10）。
> 执行人：测试（V 区复验；线上 JSON/截图由 Chief 采集）　｜　日期：2026-11-18　｜　版本：V 区 release `7709458181873110291`（妙搭 `10ac4f9` / 根仓 `7dc8ec8`）

---

## 0. 一页结论

| 区块 | 用例数 | 必须通过 | 结果 |
| --- | --- | --- | --- |
| 执行前检查（P0） | 5 | 全部 | P0-1/2/3/5 PASS；P0-4 部分（flag/待处理作业未取基线） |
| 正常态展示（A） | 6 | A1–A5 | **A1–A6 全 PASS**（A4 本地；A5 线上连续刷新两次一致） |
| 暂停态与自动恢复（B） | 6 | B1–B5 | 待授权（写 `system_flags`，未执行） |
| 未配置态（C） | 2 | 以本地证据 | 目标不可构造；K-1 本地证据 PASS |
| 计数与对账（D） | 8 | D1–D6 | D1–D5 PASS；D6 待目标；D7/D8 待授权 |
| 降级（E） | 4 | E1–E4 | **E1–E4 全 PASS**（E1 线上阻断实测；E2–E4 本地） |
| 性能与索引（F） | 3 | F1 | **F1 PASS（281ms/271ms）、F3 PASS**；F2 待目标环境 `EXPLAIN` |
| 清理（L） | 5 | 全部 | 尚无测试数据；写操作后执行 |
| 线上复验·统计修复（V，2026-11-18） | 8 | V1–V6 | **V1–V8 全部 PASS**（V7 记「不适用降级」） |
| 目标不可构造（K） | 8 | 必须有本地证据 | **K-1–K-8 本地证据齐**（K-4/K-8 本轮补用例） |

**通过条件**：A、B、D、E、F1、L 全 PASS，K 每项有对应本地用例证据；**若本轮是「统计暂不可用」修复后的版本，另须 V1–V6 全 PASS**。任一 P0 失败即整体不通过；L 不通过不得判「通过」。

---

## 1. 契约与计数口径（先钉死，避免「数字对不上」各说各话）

接口：`GET /api/overview/metrics` 增加 `ai` 块（**契约定为顶层并列：`{counts:{...}, ai:{...}}`，`ai` 不在 `counts` 内**；见 `apps/web/src/api.ts` 的 `getOverviewMetrics` 与 openapi。字段名以下方为准）。

```
ai: {
  status: "ok" | "paused" | "unconfigured" | "unavailable",
  statsAvailable: boolean,
  pausedUntil: string | null,
  pauseReason: string | null,
  analysis:   { total: number, today: number },
  chatIntake: { total: number, today: number },
  lastCall:   { at: string | null, kind: "analysis" | "chat_intake" | null, result: "succeeded" | "failed" | null }
}
```

> `statsAvailable=false` 只表示「统计聚合失败」：此时 `status="unavailable"`、四个计数归零、`pausedUntil/pauseReason/lastCall` 均为 null，**整个接口仍返回 200 且 `counts` 完整**（Chief 2026-11-18 定）。`available` 时 `statsAvailable=true`。`status` 优先级：`unconfigured`（无密钥）> `paused`（未到期）> `ok`；聚合失败时输出 `unavailable`，不再报 ok/paused。

| 口径 | 定义 | 数据来源 | 备注（必须核对的边界） |
| --- | --- | --- | --- |
| 「分析」调用次数 | **`analysis_runs` 行数**（含 `running`、`analyzed`、`failed_retryable`） | `analysis_runs` | 不是供应商 HTTP 请求数；因缺词典等原因在调用前失败的也算一次运行 |
| 「聊天抽取」调用次数 | `intake.draft_extracted` + `intake.draft_failed` 审计行数 | `audit_events`（`entity_type='intake'`） | 429/400/413/401 不写审计，**不计入**（未调模型） |
| 今日 | **Asia/Shanghai 自然日**，与服务器时区无关 | 同上 | 必须固定时区，不接受 UTC/宿主时区；上海无夏令时 |
| lastCall | 两类事件中 `occurredAt`/`startedAt` 最新的一个 | 两边取最大 | `at` 用 ISO；`kind`/`result` 必须匹配该条记录 |
| lastCall.result | `analyzed`→succeeded；`failed_retryable`→failed；`intake.draft_extracted`→succeeded；`intake.draft_failed`→failed | — | `running` 无对应结果：**实现已定为 `result=null` 且 `at=startedAt`**，openapi 已登记；验收按此核对（不再是歧义） |
| status | `unconfigured`（无 AI 密钥）优先于 `paused`（暂停且未到期）优先于 `ok`；统计聚合失败 → `unavailable` + `statsAvailable=false` | 配置 + `system_flags.ai_analysis_pause` + 计数聚合 | **实现已定：`!configured` 先判，unconfigured 压过 paused**；统计失败时不再报 ok/paused，接口仍 200 |
| statsAvailable | 布尔；聚合失败时 false，计数归零、其余字段 null；正常时 true | 统计查询结果 | 前端据此降级，不看 `status` 也能判断 |
| 暂停 flag | `system_flags`：`name='ai_analysis_pause'`，`value={until, reason}`；`until > now` 才算暂停 | `readAiPause` | 到期自动恢复，不需要任何任务；flag 行可保留 |

**本功能不统计 token**（供应商 `usage` 未落库）；累计用量按「调用次数」，不是成本数字。PRD 由软件产品补记。

---

## 2. 数据影响与前置授权

### 2.1 会产生什么

- **只读**：`GET /api/overview/metrics`、审计日志、Base 均不写。
- **一次临时写**：暂停态测试需要向 `system_flags` 插入/恢复一行 `ai_analysis_pause`（带 `until=now+2min`）。在其生效的约 2 分钟内，**自动分析入队会被暂停**（手动重试仍可用）。这是全局开关，不是聊天入口专用。
- **一条抽取审计**：计数增量测试会真实调用一次聊天抽取，产生 1 条 `intake.draft_extracted`（无需求、无 Base 行）。如做分析计数增量，需创建 1 条测试需求并推送 Base，成本更高（见 §5 D7）。
- 均按「验收后清理」规则处理（§10）。

### 2.2 必须拿到的授权

- [ ] 用户/发布负责人同意做暂停态测试，并接受约 2 分钟内自动分析入队暂停。
- [ ] 确认执行窗口内**没有同步批次、没有待分析作业**（执行前查一遍 `pipeline_jobs`），且不是 PM 集中处理时段。
- [ ] 允许写/删 `system_flags` 的测试行，并允许在计数增量测试后删除审计行（如做 D7，另含需求/快照/分析/推送/Base 行的清理授权）。
- [ ] PM（Base 使用方）知情：如做 D7，会短暂出现 1 条 `[验收]` 需求并推送 Base。

### 2.3 执行顺序

1. P0 前置与基线（含 `system_flags` 原有值快照）→ 2. A 正常态 → 3. D 对账（先做只读对账，再做抽取增量）→ 4. B 暂停态与到期恢复 → 5. E 降级 → 6. F 性能/索引 → 7. C/K 用本地证据核对 → 8. L 清理与复查。

---

## 3. P0：执行前检查

| ID | 检查 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| P0-1 | 版本正确 | 新 release `finished`、`error_logs: []`，与补丁 commit 一致 | release `7709458181873110291`（`finished`、`error_logs: []`），绑定妙搭 `10ac4f9` / 根仓 `7dc8ec8` | PASS |
| P0-2 | 契约字段存在 | 响应含 `ai` 块且字段名/类型与 openapi 完全一致（三态枚举、四个计数、`lastCall` 三字段） | `overview-metrics-raw.json`：`ai` 与 `counts` 顶层并列，`status` 枚举含 `unavailable`、`statsAvailable` 必填；openapi 定义一致 | PASS |
| P0-3 | 未加迁移 | `git status` 无新迁移文件；`schema_migrations` 最新号与发版前一致（`check:migrations` 输出记录） | `check:migrations` 通过，最新 `0028_system_flags.sql`，无新增迁移 | PASS |
| P0-4 | 基线快照 | 记录：`analysis_runs` 总数/今日、`intake.*` 审计总数/今日、`system_flags` 是否有 `ai_analysis_pause` 及其值、`pipeline_jobs` 待处理分析数、需求总数 | analysis **1422/2**、intake **0/0**、需求 **333**（V 区同窗口）；`system_flags` 与待处理分析作业未取基线 | **部分** |
| P0-5 | 页面入口 | 「总览」页可见「AI 状态」卡片（实际标题以实现为准），与既有指标卡同页不报错 | `online-ai-card.png` 可见「AI 状态」卡片，与优先级分级、处理阶段同页 | PASS |

基线查询（只读，Asia/Shanghai 自然日）：

```sql
-- 分析
SELECT count(*) AS total,
       count(*) FILTER (WHERE started_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')) AS today,
       max(started_at) AS last_at
FROM analysis_runs;
-- 聊天抽取（走 entity_type 前缀索引）
SELECT count(*) AS total,
       count(*) FILTER (WHERE occurred_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')) AS today,
       max(occurred_at) AS last_at
FROM audit_events
WHERE entity_type = 'intake'
  AND event_type IN ('intake.draft_extracted','intake.draft_failed');
-- 暂停 flag
SELECT name, value, updated_at FROM system_flags WHERE name = 'ai_analysis_pause';
-- 待处理分析作业
SELECT job_type, status, count(*) FROM pipeline_jobs WHERE job_type='analysis' GROUP BY 1,2;
```

> `analysis_runs` 在现有 schema 上**没有 `started_at` 索引**，全表计数是顺序扫描；当前量级（约 333 条需求、千级分析行）可接受。不要为此加迁移；如果响应时间异常，按 F 区记录，不在本轮改 schema。

---

## 4. A：正常态展示

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| A1 | 打开总览 | AI 卡片显示状态「正常」；无暂停原因/恢复时间（或显示「—」）；不显示配置错误 | 线上截图：徽标「正常」，无暂停原因/恢复时间 | PASS |
| A2 | 累计用量 | 显示「分析 N 次 · 聊天抽取 M 次」；数字与 P0-4 的 SQL 总数一致；今日合计展示为「今日 X 次」或等价文案，且 X = 分析今日 + 抽取今日 | 分析 **1422**（今日 2）· 聊天抽取 **0**（今日 0）；今日合计 **2** = 2+0 | PASS |
| A3 | 最近一次调用 | 显示时间、类型（分析/聊天抽取）、结果（成功/失败）；与 SQL 取两边最大值比对 | 分析·成功 **2026/11/18 09:25:48**（JSON `01:25:48.468Z`） | PASS |
| A4 | 无调用记录（如可实现） | 空库/无记录时应显示「暂无调用记录」而不是 0/NaN/报错；目标环境不可构造时引用组件测试 | 无调用时显示「暂无记录」，组件测试断言无 NaN/undefined（本轮补） | PASS（本地） |
| A5 | 刷新一致性 | 连续刷新两次，数字不抖动、不递减（除验收自身新增数据外） | 线上连续刷新两次，两次 `ai` 块完全相同：分析 1422（今日 2）、抽取 0（今日 0）、`lastCall` `01:25:48.468Z`/analysis/succeeded，无抖动 | PASS |
| A6 | 时区文案 | 卡片时间按本地（Asia/Shanghai）展示，不出现 UTC 时间或时区错位 | 卡片显示 09:25:48，对应 JSON `01:25:48Z`（UTC+8），无时区错位 | PASS |

---

## 5. D：计数与对账

先做只读对账，再做增量。所有 SQL 只读；`D7` 才建数据。

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| D1 | 分析总数对账 | API `ai.analysis.total` = `SELECT count(*) FROM analysis_runs` | **1422 = 1422** | PASS |
| D2 | 分析今日对账 | API `ai.analysis.today` = 上海自然日 SQL 计数；把系统时区改成 UTC 口径会不一致——用 SQL 验证即可 | **2 = 2**（Asia/Shanghai 自然日） | PASS |
| D3 | 聊天抽取总数对账 | API `ai.chatIntake.total` = `entity_type='intake'` 且两类事件之和 | **0 = 0** | PASS |
| D4 | 聊天抽取今日对账 | 同上加上海自然日窗口 | **0 = 0** | PASS |
| D5 | lastCall 对账 | API `lastCall.at/kind/result` = 两边最新事件（按 SQL 取最大）；若最新是 running 分析，按契约定义核对并记录 | `01:25:48.468Z` / `analysis` / `succeeded` = 库最近一条 `analyzed` | PASS |
| D6 | 429/400 不计入 | 在限流或 400 之后刷新，`chatIntake` 不增加；审计也无新增（与 5a 验收结论一致） | 待目标环境发一次 429/400 后刷新 | 待执行 |
| D7 | 增量（可选，需授权） | 做 1 次成功抽取：`chatIntake.total/today` 各 +1、lastCall 变 `chat_intake/succeeded`。若再做 1 条测试需求让分析跑完：`analysis.total/today` +1、lastCall 随之更新。记录前后差值 | 待授权（写操作） | 待授权 |
| D8 | 删除后还原 | L 区删除测试审计/需求后，计数回到 D7 前基线（累计是派生值，不缓存） | 待 D7 后清理复跑 | 待执行 |

> 计数精度提醒：`intake.*` 审计是 best-effort 写入（写失败不阻断草稿），极端情况下聊天计数会**少计**；这属于已知取舍，验收只要求「与审计表一致」，不要求等于真实模型调用次数。

---

## 6. B：暂停态与自动恢复（唯一写操作）

前置：P0-4 已确认没有既有 `ai_analysis_pause` 行；若存在，先停，找发布负责人确认，不要覆盖。

1. 记录 `now` 与 `until = now + 2 分钟`（ISO，带时区）。
2. 插入：`INSERT INTO system_flags(name, value, updated_at) VALUES ('ai_analysis_pause', '{"until":"<until>","reason":"ai_rate_limited"}'::jsonb, now())`。
3. 刷新总览；4. 到期后（`until + 10s`）再刷新；5. 删行并复查。

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| B1 | 暂停态展示 | 状态「暂停中」；显示原因（映射为可读文案，如「AI 供应商限流」；至少不能是原始英文键无解释）；显示恢复时间，且与 `until` 的本地时间一致 | | |
| B2 | 暂停生效 | 暂停期间调用 `POST /api/requirements/intake-draft` 返回 503「AI 额度暂时受限…」；不产生新审计、不调用模型、不计入 chatIntake | | |
| B3 | 到期自动恢复 | `until` 过后无需重新发版/重启，刷新即回到「正常」；`pausedUntil/pauseReason` 清空（或为 null） | | |
| B4 | 状态优先级 | 若同时存在暂停 flag 与「未配置」条件，按 openapi 定义的优先级展示；契约没写清则记 OBS 并要求补文档（目标环境无法构造未配置，见 K-1） | | |
| B5 | 暂停期间计数不变 | 暂停 503 不增加审计与计数 | | |
| B6 | 清理 | 删除 flag 行后复查 `SELECT ... WHERE name='ai_analysis_pause'` 0 行；如原本有行，按快照恢复原值 | | |

> 写 flag 会影响自动分析入队约 2 分钟；不要延长、不要在执行同步/批量分析时做。手动重试仍可用，但本验收不做。

---

## 7. C：未配置态（目标不可构造）

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| C1 | 状态「未配置」 | 缺 AI 密钥时 `status='unconfigured'`，优先于正常（以及按契约是否压过暂停）；卡片给配置提示，不显示「正常」 | 本地：`app.test` 无 key → `unconfigured` 且优先于暂停；web 组件「未配置」提示 | PASS（本地） |
| C2 | 与聊天入口一致 | 未配置时聊天抽取应失败（当前映射为 500/配置类错误），卡片文案与入口行为不矛盾 | 本地：`app.test` 未配置时 intake-draft 返回 503，卡片提示与入口文案一致 | PASS（本地） |

> 生产不能删除密钥来构造；由后端单测（env 覆盖）证明，目标侧只核对代码/测试证据。见 K-1。

---

## 8. E：降级

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| E1 | 接口请求失败 | DevTools 阻断 `/api/overview/metrics`（或离线后仅恢复页面静态资源）→ AI 卡片显示「状态不可用」；不出现白屏/未捕获异常；其他指标卡各自显示不可用但不互相拖垮 | 线上 CDP `Network.setBlockedURLs` 阻断该接口后刷新：AI 卡片「状态不可用 / 总览接口没有返回可用的 AI 状态；同一次响应里的其他指标照常展示」；无白屏、无 NaN/undefined/`[object Object]`，优先级分级、处理阶段、今日待办各自「暂不可用」互不拖垮；解除阻断刷新恢复「正常」且数字不变 | PASS |
| E2 | `ai` 块缺失/字段非法 | 其他指标正常渲染，AI 卡片降级为「状态不可用」或「暂无数据」；不出现 NaN/undefined/`[object Object]` | 本地：`App.test` 无 `ai` 块仍渲染其他指标；`overview-ai` 缺块/坏块降级 | PASS（本地） |
| E3 | 统计聚合失败（服务端） | 后端注入统计查询异常 → 接口仍 **200** 且 `counts` 完整；`ai.status="unavailable"`、`ai.statsAvailable=false`、四个计数为 0、`pausedUntil/pauseReason/lastCall` 为 null。**不允许接口 500、也不允许伪装成 `ok` + 0 次** | 本地：`app.test` 聚合抛错 → 200 + counts 完整 + `unavailable`；诊断仅脱敏字段 | PASS（本地） |
| E4 | 卡片对 `unavailable` 的降级展示 | `status==="unavailable"` 或 `statsAvailable===false` → 卡片显示「状态不可用（统计暂不可用）」类文案；其他指标照常渲染；不显示「0 次」当成真实用量 | 本地：`overview-ai` + `App.test` 断言降级文案、不显示 0 用量 | PASS（本地） |

> E1 可在目标环境用 Chromium DevTools「Block request URL」只挡这个接口；E2/E3/E4 目标不可构造，用后端/组件测试证据（E4 也可在本地用 `ai` stub 验证）。E3 与 E4 必须成对：服务端契约对、客户端不把 0 当真实值。
>
> **OBS（2026-11-19 E1 实测顺带发现，P3 文案，未修）**：接口整体失败时页面顶部兜底横幅写的是「服务暂不可用 / 无法连接到本地 API。请启动 API 服务后重试。」——这是给开发者看的句子，线上用户看不懂。文案来源 `apps/web/src/App.tsx:60`（`formatApiError` 的兜底返回），建议改成「服务暂不可用，请稍后重试」。不属于 AI 状态区范围，本轮不改。
>
> **2026-11-18 线上已实际触发过一次降级**：release `7709454179102362905` / `63f2b1b` 的卡片显示「统计不可用」，但直接用 `+db-execute` 跑统计 SQL 正常（分析 1422/今日 2/最近 analyzed；聊天抽取 0/0/0）——说明是运行时适配层抛错，`aiOverview` 的 catch 把异常吞了。修复后按 §13 复验；E3 的「注入失败」仍以单测为准，线上只验修复后的正常路径与诊断日志。

---

## 9. F：性能与索引

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| F1 | 响应时间 | 总览接口在正常数据量下 < 2s（记录实测；含 AI 统计后不得明显劣化） | 线上两次实测 **281ms / 271ms**（CDP Network 事件计时，HTTP 200，含 AI 统计） | PASS |
| F2 | 审计计数走索引 | 若能看到后端 SQL：`audit_events` 计数必须带 `entity_type='intake'` 前缀（现有 `audit_events_entity_idx` 是 `(entity_type, entity_id, occurred_at DESC)`；**没有 `event_type` 索引**）。`EXPLAIN` 不应对大表全表 Seq Scan；若为 Seq Scan，记 P2 并反馈后端改查询（不加迁移） | 待目标环境 `EXPLAIN`（需 `+db-execute`） | 待执行 |
| F3 | 不加迁移 | 确认没有为 AI 统计新增表/索引/迁移；`check:migrations` 通过 | `check:migrations` 通过，最新 `0028_system_flags.sql`，无新增 | PASS |

`EXPLAIN` 参考（只读）：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM audit_events
WHERE entity_type = 'intake'
  AND event_type IN ('intake.draft_extracted','intake.draft_failed');
```

---

## 10. L：清理（必做，沿用 5a 规则）

| ID | 步骤 | 要求 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| L0 | 记录基线与 ID | P0-4 的计数基线；暂停 flag 原值（无则记「无」）；D7 产生的审计/需求 ID | | |
| L1 | 恢复 flag | 删除本次插入的 `ai_analysis_pause` 行；若原本有行，按快照恢复 `value/updated_at`；复查与快照一致 | | |
| L2 | 删除测试审计 | 删除本轮 `intake.draft_extracted`/`intake.draft_failed` 审计行（按 requestId/时间窗/账号限定） | | |
| L3 | 删除测试需求（仅 D7 做了时） | 按 5a 的 L2 流程删除快照、分析、推送、评分、回执、作业、审计、需求本体，以及 Base 行 | | |
| L4 | 复查 | AI 卡片数字回到 L0 基线；`analysis_runs`/`intake.*` 计数与基线一致；`system_flags` 无本次残留；需求总数回到基线；Base 对应行 0 | | |

> 只删本轮数据；删除前导出 JSON 到 `.scratch/ai-status/evidence/<YYYYMMDD>/`；L4 不通过不得判「通过」。

---

## 11. K：目标环境不可构造的场景（必须有本地自动化证据）

| ID | 场景 | 为什么不能构造 | 覆盖方式 | 残余风险 |
| --- | --- | --- | --- | --- |
| K-1 | `unconfigured` 状态 | 不能删生产 AI 密钥 | 后端单测（env 无 key）+ 前端组件测试 | 配置事故时卡片是否准确 |
| K-2 | 统计聚合失败（`statsAvailable=false`） | 不能在生产注入 DB 故障 | 后端单测（repository 抛错 → 200 + `unavailable` + 计数归零）+ 前端组件测试（`status/statsAvailable` 降级） | 接口整体 500 会拖垮总览；客户端把 0 次当真实值 |
| K-3 | 上海自然日边界（23:59/00:01） | 无法改系统时间 | 后端单测固定 `now` 跨日 | 时区口径漂移会长期少计/多计 |
| K-4 | `lastCall` 恰为 running 分析 | 难以精确卡在 running | 后端单测（实现：`result=null`、`at=started_at`） | 展示为「进行中」还是「未知」需 UI 文案自洽 |
| K-5 | `ai` 块字段非法/缺失 | 生产响应不可篡改 | 前端组件测试（fetch 返回缺块/坏块） | 老版本缓存/代理导致字段缺失 |
| K-6 | 请求被阻断时的页面降级 | 需 DevTools 故障注入 | E1 目标可做；组件测试补 | 其他卡片同时不可用时是否混淆 |
| K-7 | 计数在审计写入失败时少计 | 需注入审计写失败 | 后端单测（best-effort 分支） | 统计偏低 |
| K-8 | 暂停到期瞬间的并发请求 | 无法卡点 | 后端单测（`until` 边界：等于 now 算恢复） | 到期前后一次请求的状态歧义 |

**K 区取证结果（2026-11-18，本地）**：

| ID | 本地证据 | 结论 |
| --- | --- | --- |
| K-1 | `app.test`：无 key → `unconfigured`，且优先于暂停；Web `overview-ai`：未配置提示 | PASS |
| K-2 | `app.test`：聚合抛错 → 200 + counts + `unavailable`；诊断只含脱敏字段；Web 两个降级用例 | PASS |
| K-3 | `app.test`：UTC `2026-10-08T00:00Z` → 日界 `2026-10-07T16:00Z`；当地 23:59 仍算前一天 | PASS |
| K-4 | `app.test`（本轮补）：running 分析 → `result=null`、`at=started_at` | PASS |
| K-5 | `overview-ai`：`ai` 缺块/坏块 → 「状态不可用」 | PASS |
| K-6 | `App.test`：metrics 503 仍渲染总览与 AI 卡片；无 `ai` 块同样降级 | PASS |
| K-7 | `app.test`：审计写失败仍返回草稿（best-effort，计数可能偏低） | PASS |
| K-8 | `ai-pause.test`（本轮补）：`until == now` → 已恢复 | PASS |

> 本轮补的两条用例只加测试、不改业务代码：`app.test.ts` 的 running 映射、`ai-pause.test.ts` 的 `until == now` 边界。证据：`evidence/20261118/E-K-api-tests.txt`（97/97）。

---

## 12. 验收前自动化门禁（补丁必须带的用例）

后端（`apps/api/src/http/app.test.ts`、指标 repository 测试）：

- [ ] `ai.status` 四态：正常 / 暂停未到期 / 暂停已到期（`until == now` 视为恢复）/ 未配置（优先于正常；与暂停同时存在时按 openapi 定）/ 统计失败（`unavailable`）。
- [ ] `statsAvailable`：正常为 true；注入统计聚合异常时为 false，`status="unavailable"`、四个计数为 0、`pausedUntil/pauseReason/lastCall` 为 null，且整个接口仍 **200 + counts 完整**；不得吞异常返回「ok + 0」。
- [ ] **2026-11-18 线上事故回归**：统计查询不依赖 `ANY($n::text[])` 数组绑定与 `FILTER` 子查询（或有一条适配层等价测试证明妙搭 drizzle 能正确绑定）；聚合抛错时平台日志有脱敏 `errorClass`（不含 SQL 参数/聊天正文），接口仍 200 + counts + `unavailable`。
- [ ] `analysis.total/today` 与 `chatIntake.total/today` 的 SQL 计数正确；今日按 Asia/Shanghai 固定时区（固定 `now` 跨日用例）。
- [ ] `lastCall` 取两边最新：analysis 最新、intake 最新、只有一边有数据、都没有（null）；running 的取舍与 openapi 一致。
- [ ] 429/400/413 不产生 `intake.*` 审计、不增加 chatIntake 计数（与既有用例对齐）。
- [ ] 审计写入失败时计数不报错（best-effort）。
- [ ] 暂停 flag 读取失败时按「未暂停」处理且不 500。
- [ ] openapi 补 `ai` 块定义，响应字段与实现一致；本功能不改 `PayloadTooLarge`、不改其他响应形状。

前端（`apps/web/src/panels.test.tsx` 或新组件测试；妙搭镜像同步）：

- [ ] 正常态：状态徽标、累计/今日数字、最近一次调用（时间/类型/结果）。
- [ ] 暂停态：原因与恢复时间可见；到期态正确。
- [ ] 未配置态：配置提示，不显示「正常」。
- [ ] 接口失败/`ai` 缺块：卡片「状态不可用」，其他指标不崩溃。
- [ ] `status==="unavailable"` 或 `statsAvailable===false`：显示「状态不可用（统计暂不可用）」，不把 0 次显示成真实用量。
- [ ] 两仓 `intake` 无关文件不产生漂移；`check:alignment` 通过。

门禁命令：

```bash
npm run typecheck && npm run build
npm --workspace @rq-sys/api run test      # 期望除本机无 PostgreSQL 的 59 条外全绿
npm --workspace @rq-sys/web run test
npm run check:alignment && npm run check:contract && npm run check:migrations
git diff --check
cd rq-sys-miaoda && npm run test:rqsys-route && npm run test:rqsys-client
```

记录实际通过数，不要沿用旧基线（上一轮：API 623/564 过、Web 139/139、妙搭路由 131/131、适配层 3/3、alignment 36/36）。

---

## 13. 线上复验：统计不可用修复后（V，2026-11-18）

> 触发：release `7709454179102362905` / `63f2b1b` 线上卡片显示「统计不可用（统计暂不可用）」，但直接 `+db-execute` 跑两条统计 SQL 正常（分析 1422 / 今日 2 / 最近 analyzed；聊天抽取 0/0/0）→ 运行时报错被 `aiOverview` 的 catch 吞掉。修复 = 补脱敏错误日志 + 简化统计查询（不依赖数组参数/FILTER 子查询），不加迁移。
> **本轮约束**：只读复验。不粘贴聊天、不创建需求、不写 `system_flags`、不删任何数据；不跑 E1/E2/E5/E6（会产生审计或需求）。若期间有正常同步导致 `analysis_runs` 增长，记录并解释，不算失败。

### 13.1 前置（P0）

| 项 | 要求 | 实际 |
| --- | --- | --- |
| 版本 | 新 release `finished`、`error_logs: []`，绑定修复提交；确认线上已不是 `7709454179102362905` | release `7709458181873110291`（`finished`、`error_logs: []`），绑定妙搭 `10ac4f9`；根仓 `7dc8ec8`；已不是坏版本 |
| 契约 | 响应 `ai` 块存在，含 `status`、`statsAvailable`、两组计数、`lastCall` | `overview-metrics-raw.json`：`counts` 与 `ai` 顶层并列，字段齐全；`ai-block.json` 为其 `ai` 子集，逐字段一致 |
| 参数 | 记录复验开始/结束时间（Asia/Shanghai），用于同窗口对账 | 证据采集时间 2026-11-18 18:40:58 +08（`capturedAt` `10:40:58.466Z`）；同窗口对账值由 Chief 提供（V2/V3） |
| 环境 | 线上登录态；DevTools 可复制 `/api/overview/metrics` 响应；有 `+db-execute` 只读权限 | 线上登录态导出原始响应（HTTP 200）；Chief 具备 `+db-execute` 只读权限并提供了同窗口 SQL 结果 |

### 13.2 对账 SQL（只读；今日=Asia/Shanghai 自然日）

```sql
-- 分析调用：total / today / 最近一次状态与时间
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE started_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'))::int AS today,
       max(started_at) AS last_at,
       (SELECT status FROM analysis_runs ORDER BY started_at DESC, id DESC LIMIT 1) AS last_status
FROM analysis_runs;

-- 聊天抽取：total / today / 最近一次事件
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE occurred_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'))::int AS today,
       max(occurred_at) AS last_at,
       (SELECT event_type FROM audit_events
         WHERE entity_type='intake' AND event_type IN ('intake.draft_extracted','intake.draft_failed')
         ORDER BY occurred_at DESC, id DESC LIMIT 1) AS last_event_type
FROM audit_events
WHERE entity_type='intake' AND event_type IN ('intake.draft_extracted','intake.draft_failed');
```

事故时的参考值（复验以现场同窗口 SQL 为准，不能直接把 1422/2 当断言）：分析 total **1422**、today **2**、last status **analyzed**；聊天抽取 **0/0/0**。

### 13.3 用例

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| V1 | 版本与字段 | 新 release；`ai.statsAvailable` 为 true；`status` 为 `ok`（无暂停、密钥正常）；字段类型正确 | | |
| V2 | 分析计数对账 | `ai.analysis.total` / `today` 与 SQL **同窗口**完全相等；误差 0 | | |
| V3 | 聊天抽取对账 | `ai.chatIntake.total` / `today` 与 SQL 相等；**0 是合法值**（`statsAvailable=true`），不是降级 | | |
| V4 | lastCall 对账 | `at/kind/result` = 两边最新的那条；分析 `analyzed→succeeded`、`failed_retryable→failed`、`running→result=null` 且 `at=started_at` | | |
| V5 | 卡片展示 | 显示真实数字（如「分析 1422 次 · 聊天抽取 0 次」，今日 2）；**不再出现「统计暂不可用」**；无 NaN/undefined；其他指标卡正常 | | |
| V6 | 数据副作用 | 需求总数不变（未造需求）；`intake.*` 审计数不变（未抽取）；`system_flags.ai_analysis_pause` 不变；无需清理 | | |
| V7 | 诊断（条件） | 若仍降级：接口必须 200 + counts 完整 + `statsAvailable=false`；服务端日志出现脱敏 `errorClass`（不含 SQL 参数/聊天正文）。修复成功则本项记 `OBS/不适用` | | |
| V8 | 无回归 | 总览其他数字、作业运维、需求池加载正常；发布后 ERROR 日志 0 条（复验窗口） | | |

### 13.4 判定

- **V1–V5 全 PASS 才算修复通过**；V6 必须核对（防止为了验证而造数据）；V7 仅在仍降级时适用；V8 作为回归观察。
- 证据：DevTools 响应 JSON、卡片截图、两条 SQL 的输出与时间戳，存 `.scratch/ai-status/evidence/<YYYYMMDD>/`。
- 若数字仍对不上：先核对 `since` 是否按 Asia/Shanghai、计数是否含 `running`、`intake` 是否带 `entity_type='intake'`、以及 release 是否真的换成修复版；不要先改口径。

### 13.5 复验结果（2026-11-18，release `7709458181873110291` / 妙搭 `10ac4f9` / 根仓 `7dc8ec8`）

| ID | 结果 | 证据 / 说明 |
| --- | --- | --- |
| V1 | PASS | `overview-metrics-ai-block.json` / `overview-metrics-raw.json`：HTTP **200**，`status:"ok"`、`statsAvailable:true`、`pausedUntil/pauseReason:null`；类型正确（布尔/数字/ISO 字符串/null）；采集时间 `2026-11-18T10:40:58.466Z`（北京 18:40:58），晚于修复版发布 |
| V2 | PASS | `ai.analysis` = **1422** / 今日 **2**；与 Chief 同窗口 SQL 的 `analysis_runs` **1422** / 今日 **2** 完全相等（JSON 见 `evidence/20261118/overview-metrics-ai-block.json`） |
| V3 | PASS | `ai.chatIntake` = **0** / 今日 **0**，与库 `intake.*` **0/0/0** 相等；`statsAvailable=true`，0 是真实值而非降级 |
| V4 | PASS | `lastCall`：`at=2026-11-18T01:25:48.468Z`（=北京时间 09:25:48）、`kind:"analysis"`、`result:"succeeded"`；与卡片文本、库最近一条 `analyzed` 三者一致 |
| V5 | PASS | `online-ai-card.png`（1468×886）：AI 卡片完整入镜——徽标「正常」，分析调用 **1422**（今日 2 次）、聊天抽取 **0**（今日 0 次）、今日合计 **2** 次调用、最近一次 **分析·成功 2026/11/18 09:25:48**；无「统计暂不可用」、无 NaN/undefined；同屏其他指标正常（处理阶段 332/333、333/333、289/333、333/333） |
| V6 | PASS | `overview-metrics-raw.json` 的 `counts.total=333`，与 5a 清理后基线 **333** 一致（未造需求）；本轮未粘贴/未建需求/未写 flag；`intake.*` 仍 0/0 |
| V7 | PASS（不适用降级） | 修复后未降级；本地诊断用例：根仓 `app.test + repositories.test` **92/92**、妙搭 `drizzle-pool + overview-metrics` **9/9**（`evidence/20261118/`）；代码只记录 `phase/stat/errorType/databaseCode/causeType`，不写 SQL/参数/message |
| V8 | PASS | Chief：线上 ERROR 日志 0 条、无 `overview_ai_stats_failed`；迁移检查通过（最新仍 `0028`，无 0029）；根仓 `7dc8ec8` / 妙搭 `10ac4f9` 与发布说明一致 |

**代码级核对（补充证据）**：

- 根因修复：妙搭 `drizzle-pool.ts` 改用 `sql.param(...)` 绑定每个值，数组不再被 Drizzle 当 chunk 展开。
- 两条统计已拆成最简 count：分析 3 条查询、intake 3 条查询；**无 `ANY(`、无 `FILTER`、无标量子查询**；intake 用 `IN ($2,$3)` 逐个占位，`entity_type=$1` 保留。
- 未新增迁移：`database/migrations` 仍到 `0028`，`check:migrations` 通过。

**当前结论**：**V1–V8 全部 PASS（V7 记「不适用降级」），统计修复的线上复验通过。**

- V1/V5 证据已补齐并复核：卡片截图 `online-ai-card.png` 完整入镜（正常 / 分析 1422 / 聊天抽取 0 / 今日合计 2 / 最近一次 09:25:48，无「统计暂不可用」）；原始响应 `evidence/20261118/overview-metrics-raw.json` 为 HTTP **200**，`counts` 与 `ai` 同响应；`overview-metrics-ai-block.json` 是 `ai` 子集，与 raw 逐字段一致。
- 三处数值/时间闭合：JSON `01:25:48Z` = 卡片「09:25:48」= 库最近 `analyzed`；`analysis` 1422/2、`chatIntake` 0/0 与同窗口 SQL 一致；`counts.total=333` 回到清理后基线。
- **范围提醒**：本节只关闭「统计暂不可用修复」的 V 区；A/D/E/F3/K 的只读与本地项已在 §4–§11 补证，但 B、D6/D7、E1、F1/F2、A5 仍未执行，不能据此宣布整个 AI 状态区验收通过。

---

## 14. 执行记录

| ID | 结果（PASS/FAIL/BLOCKED/OBS） | 实际现象 | 证据（截图/JSON 路径） | 执行人 | 时间 |
| --- | --- | --- | --- | --- | --- |
| V1 | PASS | 线上 JSON：HTTP 200，`status:"ok"`、`statsAvailable:true`、类型正确 | `evidence/20261118/overview-metrics-ai-block.json`、`overview-metrics-raw.json` | 测试（复核）/ Chief（采集） | 2026-11-18 18:40 +08 |
| V2 | PASS | 分析 1422 / 今日 2 = 库 1422 / 2 | 同上 + Chief 同窗口 SQL | 测试 / Chief | 2026-11-18 18:40 +08 |
| V3 | PASS | 聊天抽取 0 / 0 = 库 0/0/0 | 同上 | 测试 / Chief | 2026-11-18 18:40 +08 |
| V4 | PASS | `lastCall` `01:25:48Z` = 卡片 09:25:48 = 库最近 `analyzed` | 同上 + `online-ai-card.png` | 测试 / Chief | 2026-11-18 18:40 +08 |
| V5 | PASS | 卡片完整入镜：正常 / 1422 / 0 / 今日合计 2 / 最近一次 09:25:48 | `online-ai-card.png` | 测试（复核）/ Chief（采集） | 2026-11-18 18:40 +08 |
| V6 | PASS | `counts.total=333` 回到基线，未造需求 | `overview-metrics-raw.json` | 测试 | 2026-11-18 18:40 +08 |
| V7 | PASS（不适用降级） | 修复后未降级；诊断只记脱敏字段 | `evidence/20261118/root-stats-tests.txt`、`miaoda-stats-tests.txt` | 测试 | 2026-11-18 18:40 +08 |
| V8 | PASS | 同屏其他指标正常（332/333、333/333、289/333、333/333）；ERROR 0、无 `overview_ai_stats_failed` | `online-ai-card.png`、`overview-metrics-raw.json` | 测试 / Chief | 2026-11-18 18:40 +08 |
| P0 | PASS（P0-4 部分） | 版本/契约/迁移/页面入口已核；flag 与待处理作业基线未取 | `evidence/20261118/F3-migrations.txt`、`overview-metrics-raw.json` | 测试 | 2026-11-18 18:45 +08 |
| A1–A3, A6 | PASS | 正常态徽标、1422/0、今日合计 2、最近一次 09:25:48、时区正确 | `online-ai-card.png`、`overview-metrics-raw.json` | 测试 | 2026-11-18 18:45 +08 |
| A4 | PASS（本地） | 无调用显示「暂无记录」，无 NaN/undefined | `evidence/20261118/E-K-web-tests.txt` | 测试 | 2026-11-18 18:45 +08 |
| A5 | PASS | 连续刷新两次，`ai` 块逐字段相同（1422/2、0/0、`01:25:48.468Z`） | CDP Network 采集两次响应 | Chief | 2026-11-19 09:02 +08 |
| D1–D5 | PASS | 1422/2、0/0、lastCall 与同窗口 SQL 一致 | `overview-metrics-raw.json` + Chief 同窗口 SQL | 测试 | 2026-11-18 18:45 +08 |
| D6 | 待执行 | 429/400 后刷新计数不变 | — | 测试 / Chief | — |
| E2–E4 | PASS（本地） | `ai` 缺块/聚合失败降级，其他指标不挂、不显示 0 用量 | `E-K-api-tests.txt`、`E-K-web-tests.txt` | 测试 | 2026-11-18 18:45 +08 |
| F3 | PASS | 无新增迁移，最新 `0028` | `evidence/20261118/F3-migrations.txt` | 测试 | 2026-11-18 18:45 +08 |
| K-1–K-8 | PASS（本地） | 8 项均有对应用例；K-4、K-8 本轮补 | `E-K-api-tests.txt`（97/97）、`E-K-web-tests.txt`（156/156）、`E-K-miaoda-tests.txt`（9/9） | 测试 | 2026-11-18 18:45 +08 |
| B / D7 / D8 / L | 待授权 | 写 flag 或造数据后按 L 清理 | — | 测试 / Chief | — |
| E1 | PASS | 阻断 `/api/overview/metrics` → AI 卡片「状态不可用」、其他面板各自「暂不可用」、无白屏/NaN；解阻后恢复「正常」 | `evidence/20261118/e1-metrics-blocked.png`、`e1-ai-card-blocked.png` | Chief | 2026-11-19 09:02 +08 |
| F1 | PASS | 281ms / 271ms（HTTP 200） | CDP Network 计时 | Chief | 2026-11-19 09:02 +08 |
| F2 | 待目标环境 | `EXPLAIN` 需线上库执行工具 | — | 测试 / Chief | — |

> 尚未执行：B（写 `system_flags`）、D7（造 1 次抽取/1 条需求）、D8/L（删数据复查）、D6（429/400 实测）、A5（连续刷新）、E1（DevTools 阻断）、F1/F2（计时/EXPLAIN）。V 区通过不等于整体验收通过。
> 证据指纹（2026-11-18 复核）：`online-ai-card.png` sha256 `06d9b58a29f37aa6978263a0bd7cc4dd0e2c2ebf1e185cfd515e68cc5821d5d3`；`overview-metrics-ai-block.json` `be1ea2942f3c7b366ba1da33bfb01c7e5d0be740f849e5dc64e99fd10483b148`；`overview-metrics-raw.json` `bf97f7c17b3fc5110964ebffa3db4764fce6b6e276a708822e976d624bebae72`。

证据目录：`.scratch/ai-status/evidence/<YYYYMMDD>/`，命名 `<用例ID>-<简述>.png|json|txt`。

### 14.1 暂停态与清理登记

| 项 | 值 |
| --- | --- |
| 暂停测试开始/结束（本地时间） | |
| `until` | |
| flag 原值（无则「无」） | |
| 是否恢复/删除并复查 | |
| 清理前/后需求总数 | |
| 清理前/后 `analysis_runs` / `intake.*` 计数 | |

---

## 15. 签字

- 执行人：____________　日期：____________
- 清理复核（flag、审计、需求、Base 均回基线）：____________　日期：____________
- 复核（发布负责人）：____________　日期：____________
- 结论：通过 / 有条件通过（列出条件） / 不通过（列出 P0；L 不通过不得判「通过」）
