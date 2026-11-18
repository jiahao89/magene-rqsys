# 总览「AI 状态」验收清单（2026-11-18）

> 状态：**待执行**（后端/前端补丁合入并发版后）。依据：用户 2026-11-18 要求「总览页面增加 AI 状态区：AI 状态 + 累计用量」；Chief 2026-11-18 给出的口径与接口契约。
> 执行环境：飞书妙搭线上 app（生产库、生产 Base）。本功能以只读为主，**唯一写操作是暂停态测试用的 `system_flags` 临时行**；执行前须拿到授权，执行后必须清理并复查（见 §2、§10）。
> 执行人：待填　｜　日期：待填　｜　版本：待填（release id / 两仓 commit）

---

## 0. 一页结论

| 区块 | 用例数 | 必须通过 | 结果 |
| --- | --- | --- | --- |
| 执行前检查（P0） | 5 | 全部 | 待填 |
| 正常态展示（A） | 6 | A1–A5 | 待填 |
| 暂停态与自动恢复（B） | 6 | B1–B5 | 待填 |
| 未配置态（C） | 2 | 以本地证据 | 待填 |
| 计数与对账（D） | 8 | D1–D6 | 待填 |
| 降级（E） | 4 | E1–E4 | 待填 |
| 性能与索引（F） | 3 | F1 | 待填 |
| 清理（L） | 5 | 全部 | 待填 |
| 目标不可构造（K） | 8 | 必须有本地证据 | 待填 |

**通过条件**：A、B、D、E、F1、L 全 PASS，K 每项有对应本地用例证据；任一 P0 失败即整体不通过；L 不通过不得判「通过」。

---

## 1. 契约与计数口径（先钉死，避免「数字对不上」各说各话）

接口：`GET /api/overview/metrics` 增加 `ai` 块（**具体是 `{counts:{...}, ai:{...}}` 并列还是放进 `counts` 内，以最终 openapi 为准**；验收时记录实际位置并核对字段名一致）。

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
| P0-1 | 版本正确 | 新 release `finished`、`error_logs: []`，与补丁 commit 一致 | | |
| P0-2 | 契约字段存在 | 响应含 `ai` 块且字段名/类型与 openapi 完全一致（三态枚举、四个计数、`lastCall` 三字段） | | |
| P0-3 | 未加迁移 | `git status` 无新迁移文件；`schema_migrations` 最新号与发版前一致（`check:migrations` 输出记录） | | |
| P0-4 | 基线快照 | 记录：`analysis_runs` 总数/今日、`intake.*` 审计总数/今日、`system_flags` 是否有 `ai_analysis_pause` 及其值、`pipeline_jobs` 待处理分析数、需求总数 | | |
| P0-5 | 页面入口 | 「总览」页可见「AI 状态」卡片（实际标题以实现为准），与既有指标卡同页不报错 | | |

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
| A1 | 打开总览 | AI 卡片显示状态「正常」；无暂停原因/恢复时间（或显示「—」）；不显示配置错误 | | |
| A2 | 累计用量 | 显示「分析 N 次 · 聊天抽取 M 次」；数字与 P0-4 的 SQL 总数一致；今日合计展示为「今日 X 次」或等价文案，且 X = 分析今日 + 抽取今日 | | |
| A3 | 最近一次调用 | 显示时间、类型（分析/聊天抽取）、结果（成功/失败）；与 SQL 取两边最大值比对 | | |
| A4 | 无调用记录（如可实现） | 空库/无记录时应显示「暂无调用记录」而不是 0/NaN/报错；目标环境不可构造时引用组件测试 | | |
| A5 | 刷新一致性 | 连续刷新两次，数字不抖动、不递减（除验收自身新增数据外） | | |
| A6 | 时区文案 | 卡片时间按本地（Asia/Shanghai）展示，不出现 UTC 时间或时区错位 | | |

---

## 5. D：计数与对账

先做只读对账，再做增量。所有 SQL 只读；`D7` 才建数据。

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| D1 | 分析总数对账 | API `ai.analysis.total` = `SELECT count(*) FROM analysis_runs` | | |
| D2 | 分析今日对账 | API `ai.analysis.today` = 上海自然日 SQL 计数；把系统时区改成 UTC 口径会不一致——用 SQL 验证即可 | | |
| D3 | 聊天抽取总数对账 | API `ai.chatIntake.total` = `entity_type='intake'` 且两类事件之和 | | |
| D4 | 聊天抽取今日对账 | 同上加上海自然日窗口 | | |
| D5 | lastCall 对账 | API `lastCall.at/kind/result` = 两边最新事件（按 SQL 取最大）；若最新是 running 分析，按契约定义核对并记录 | | |
| D6 | 429/400 不计入 | 在限流或 400 之后刷新，`chatIntake` 不增加；审计也无新增（与 5a 验收结论一致） | | |
| D7 | 增量（可选，需授权） | 做 1 次成功抽取：`chatIntake.total/today` 各 +1、lastCall 变 `chat_intake/succeeded`。若再做 1 条测试需求让分析跑完：`analysis.total/today` +1、lastCall 随之更新。记录前后差值 | | |
| D8 | 删除后还原 | L 区删除测试审计/需求后，计数回到 D7 前基线（累计是派生值，不缓存） | | |

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
| C1 | 状态「未配置」 | 缺 AI 密钥时 `status='unconfigured'`，优先于正常（以及按契约是否压过暂停）；卡片给配置提示，不显示「正常」 | | |
| C2 | 与聊天入口一致 | 未配置时聊天抽取应失败（当前映射为 500/配置类错误），卡片文案与入口行为不矛盾 | | |

> 生产不能删除密钥来构造；由后端单测（env 覆盖）证明，目标侧只核对代码/测试证据。见 K-1。

---

## 8. E：降级

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| E1 | 接口请求失败 | DevTools 阻断 `/api/overview/metrics`（或离线后仅恢复页面静态资源）→ AI 卡片显示「状态不可用」；不出现白屏/未捕获异常；其他指标卡各自显示不可用但不互相拖垮 | | |
| E2 | `ai` 块缺失/字段非法 | 其他指标正常渲染，AI 卡片降级为「状态不可用」或「暂无数据」；不出现 NaN/undefined/`[object Object]` | | |
| E3 | 统计聚合失败（服务端） | 后端注入统计查询异常 → 接口仍 **200** 且 `counts` 完整；`ai.status="unavailable"`、`ai.statsAvailable=false`、四个计数为 0、`pausedUntil/pauseReason/lastCall` 为 null。**不允许接口 500、也不允许伪装成 `ok` + 0 次** | | |
| E4 | 卡片对 `unavailable` 的降级展示 | `status==="unavailable"` 或 `statsAvailable===false` → 卡片显示「状态不可用（统计暂不可用）」类文案；其他指标照常渲染；不显示「0 次」当成真实用量 | | |

> E1 可在目标环境用 Chromium DevTools「Block request URL」只挡这个接口；E2/E3/E4 目标不可构造，用后端/组件测试证据（E4 也可在本地用 `ai` stub 验证）。E3 与 E4 必须成对：服务端契约对、客户端不把 0 当真实值。

---

## 9. F：性能与索引

| ID | 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| F1 | 响应时间 | 总览接口在正常数据量下 < 2s（记录实测；含 AI 统计后不得明显劣化） | | |
| F2 | 审计计数走索引 | 若能看到后端 SQL：`audit_events` 计数必须带 `entity_type='intake'` 前缀（现有 `audit_events_entity_idx` 是 `(entity_type, entity_id, occurred_at DESC)`；**没有 `event_type` 索引**）。`EXPLAIN` 不应对大表全表 Seq Scan；若为 Seq Scan，记 P2 并反馈后端改查询（不加迁移） | | |
| F3 | 不加迁移 | 确认没有为 AI 统计新增表/索引/迁移；`check:migrations` 通过 | | |

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

---

## 12. 验收前自动化门禁（补丁必须带的用例）

后端（`apps/api/src/http/app.test.ts`、指标 repository 测试）：

- [ ] `ai.status` 四态：正常 / 暂停未到期 / 暂停已到期（`until == now` 视为恢复）/ 未配置（优先于正常；与暂停同时存在时按 openapi 定）/ 统计失败（`unavailable`）。
- [ ] `statsAvailable`：正常为 true；注入统计聚合异常时为 false，`status="unavailable"`、四个计数为 0、`pausedUntil/pauseReason/lastCall` 为 null，且整个接口仍 **200 + counts 完整**；不得吞异常返回「ok + 0」。
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

## 13. 执行记录

| ID | 结果（PASS/FAIL/BLOCKED/OBS） | 实际现象 | 证据（截图/JSON 路径） | 执行人 | 时间 |
| --- | --- | --- | --- | --- | --- |
| P0-1 | | | | | |
| … | | | | | |

证据目录：`.scratch/ai-status/evidence/<YYYYMMDD>/`，命名 `<用例ID>-<简述>.png|json|txt`。

### 13.1 暂停态与清理登记

| 项 | 值 |
| --- | --- |
| 暂停测试开始/结束（本地时间） | |
| `until` | |
| flag 原值（无则「无」） | |
| 是否恢复/删除并复查 | |
| 清理前/后需求总数 | |
| 清理前/后 `analysis_runs` / `intake.*` 计数 | |

---

## 14. 签字

- 执行人：____________　日期：____________
- 清理复核（flag、审计、需求、Base 均回基线）：____________　日期：____________
- 复核（发布负责人）：____________　日期：____________
- 结论：通过 / 有条件通过（列出条件） / 不通过（列出 P0；L 不通过不得判「通过」）
