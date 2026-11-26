# RQ-Sys 全量审查与验收报告（UI / 交互重点）

- 日期：2026-10-23
- 范围：根仓 `apps/api` + `apps/web`，妙搭运行时仓 `rq-sys-miaoda`（server + client），MVP 规格与 V0.2 规格/工单状态，本地可运行链路，目标环境发布状态
- 方法：全量本地检查（类型/测试/构建/对齐/契约/差异检查）＋ 真实浏览器走查（桌面 1440×900、手机 390×844、深色主题、键盘、错误/空态/确认框）＋ 只读目标环境核查（release / env / schema / automation）＋ 独立视觉评审
- 证据目录：`review-20261023/evidence/`
- 行号说明：正文行号以快照 A 为主，快照 B 因新增代码有约 +5–20 行偏移；语义未变。
- 约束：未修改业务代码；未对真实 Teambition / AI / 飞书 Base / 通知做写入；目标数据库行级读回受 `--yes` 高风险确认门禁限制，未执行


> **修复进展（2026-10-23 晚）**：已按本报告与 `.scratch/rq-sys-v0.2/acceptance/2026-10-23/READ-ONLY-ACCEPTANCE.md` 共同修复 P1 与必修 P2；本地两仓验证已重新通过（root API 399/399、Web 79/79、miaoda 107/107）。目标环境仍未迁移/发布，因此本文的“发布验收不通过”结论仍适用于已发布的快照 A；修复明细、复验证据与剩余阻断见 [`FIX-REPORT.md`](FIX-REPORT.md)。

> **重要：评审期间仓库发生了并发修改。** 本报告把证据分成两个快照：
>
> - **快照 A（已发布基线）**：root `a3e7b5f` / miaoda `7d77dcf`，对应 Online release `7699409141857750254`。本报告第三部分的全部问题与浏览器证据均取自该快照（且当前代码中仍能看到相同缺陷）。
> - **快照 B（评审期间出现的新提交）**：root `1775738`（13:15）→ `bcf207d`（15:15，手工负责人 + 疑似重复链接），miaoda `01f3ccf` → `3a1e4fa`；迁移 `0006`/`0007` 为新增。13:15–15:15 期间文件持续变化，曾出现测试失败；15:15 后代码稳定，15:18 复跑测试已全绿。**该快照尚未在目标环境迁移/发布，不能当作已验收。**
>
> 因此：**下面的验收结论针对已发布快照 A；快照 B 的本地检查已转绿，但尚未完成目标迁移/发布/运行时验收，不能与已发布快照混在一起签署。**

## 一、结论

| 层面 | 结论 |
| --- | --- |
| 快照 A 本地工程门槛 | **通过**：root API 371/371、Web 78/78、miaoda 路由 106/106；两仓类型检查、lint/stylelint、生产构建、api/web 对齐检查、契约矩阵、`git diff --check` 均通过 |
| 快照 A MVP 本地 UI/交互验收 | **不通过**：1 个阻断级缺陷（空结果搜索 500）和 3 个高影响缺陷（批次明细契约、部署端失败重试契约、桌面摘要栏吸顶失效） |
| 快照 B 当前工作树 | **可进入复验，尚未验收**：截至 15:18，root API 395/395、Web 78/78、miaoda 106/106、两仓 typecheck、root build、miaoda `build:prod`、两仓对齐 24/24、`git diff --check` 均通过；但评审期间曾失败且目标未迁移/未发布；不能据此签署目标验收 |
| 目标环境 | **发布状态核查通过，但不能签署运行时全量验收**：最新 Online release `7699409141857750254`（commit `7d77dcf`）`finished`、`error_logs=[]`；schema/环境变量/自动化触发器就位。目标 release 已落后于当前 root/miaoda 新提交；登录后的目标 UI、目标库计数与端到端链路未在本轮独立复验 |
| V0.2 | **未完成**：6 份 Spec、18 张 Ticket 已确认（2026-10-23），尚无完成的 V0.2 功能。快照 B 已开始实现手工负责人与同标题“重复链接”（迁移 0006/0007），但测试/目标环境均未收口 |

**一句话结论**：已发布快照的工程功底和本地自动化是达标的，但 UI 链路存在一个可被普通搜索/筛选稳定触发的 500，且恢复路径（批次重试）在浏览器上会误报失败；因此不能以现有证据签署 MVP 生产验收。评审期间新出现的工作树仍在开发中且测试不绿，不能与已发布快照混在一起验收。

## 二、本地验证结果

### 快照 A（与已发布 release 对齐）

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`（root） | 通过 |
| `npm test`（root） | API 371/371、Web 78/78 通过 |
| `npm run build`（root） | 通过（Web 3492 modules，1.89s） |
| `npm run check:alignment` | 通过：16 处声明差异、15 处恰好一致，无未声明漂移 |
| `npm run check:contract` | 20 通过 / 1 警告 / 3 跳过（warning：身份缺少 employee-id，部署路径必须经 `/resolve`；跳过项需要目标环境凭据） |
| `git diff --check` | 通过 |
| miaoda `type:check` | server + client 通过 |
| miaoda `eslint` / `stylelint` | 通过 |
| miaoda `test:rqsys-route` | 106/106 通过（含 server 构建） |
| miaoda `build:prod` | 通过；`index-*.js` 1,283 kB（gzip 400 kB），有 >500 kB chunk 警告 |
| 本地 UI 走查 | 8 个页面全部可加载；无控制台错误、无失败请求（除已复现的 500 缺陷） |

### 快照 B（评审期间出现的新提交；截至 2026-10-23 15:18 本地已稳定）

| 检查 | 结果 |
| --- | --- |
| root `typecheck` | 通过 |
| root `npm test` | 395/395 通过（新提交增加了手工负责人/重复链接测试） |
| root Web 测试 | 78/78 通过 |
| root build | 通过（Web 485.23 kB JS，1.95s） |
| root `check:alignment` | 通过：24/24 共享模块一致 |
| miaoda `type:check` | 通过 |
| miaoda `test:rqsys-route` | 106/106 通过 |
| miaoda `build:prod` | 通过 |
| 线程状态 | 13:15–15:15 期间文件持续变化并曾出现测试失败；15:15 提交后稳定，15:18 复跑全绿 |

说明：快照 B 的本地测试已全绿，但新增的 0006/0007 迁移尚未在目标库执行；当前代码依赖这些列，**不能在未迁移前发布**。本地已验证迁移可用，但这不等于目标环境验收。

运行时环境：本地 API `127.0.0.1:8787`，Web `127.0.0.1:5173`，本地 PostgreSQL；本地库已执行 `0003`–`0007` 迁移（原库停留在 `0001`–`0002`；其中 0006/0007 来自快照 B）。本地数据：284 条需求、5 条已分析、1 条推送失败、8 个批次、74 条审计；未执行任何业务写入。

## 三、问题清单（按严重度）

### P0 — 阻断

#### F-01 搜索/筛选无结果时接口 500，空态永远不可达

- **证据**
  - `GET /api/requirements?q=zzz` → HTTP 500 `INTERNAL`；`q=zzz-no-such`、任意无匹配筛选同样 500。
  - 截图：`evidence/requirements-empty-error.png`（截图工具同时捕获 `500 (Internal Server Error) /api/requirements?q=zzz-no-such`）。
  - API 日志：`unhandled request error GET /api/requirements kind=error`。
- **根因**：列表接口用首页第一条需求的 `sourceConfigId` 取负责人映射；空结果时传入 `""`，PostgreSQL 将其当 uuid 解析失败：
  - `apps/api/src/http/app.ts:399`
  - `rq-sys-miaoda/server/rqsys/http/app.ts:550`
- **影响**
  - 普通「搜索一个不存在的词」直接报错；
  - 任意筛选组合无结果时报错；
  - 人员全部映射完成后，「负责人映射」页待匹配列表为空 → 页面报「无法加载映射数据」；
  - 总览「待分配负责人 0」卡片点击后报错；
  - 分页期间数据变化导致某页返回空结果时，同样的 500 也会出现。
- **浏览器表现**：红色 `请求失败 / An internal error occurred.（INTERNAL）`，同时保留上一批旧行、摘要仍写「已加载 50 条（已应用 1 个筛选）」——用户会误以为筛选没有生效。
- **建议**
  1. 空页时跳过映射查询（`page.items[0] ? await listActive(...) : []`）；
  2. 补 HTTP 级「无结果」用例；现有 API 单测的 `people` 依赖为空，恰好绕过了该分支；
  3. UI 侧错误时不要把旧行当新结果展示（见 F-11）。
- **回归来源**：`4c9a3d9` / miaoda `e2e51f9`（"Show the real owner name…"），已包含在最新发布 `7d77dcf` 中。

### P1 — 高影响

#### F-02 批次明细标题为空，重试后刷新必然误报

- **证据**：展开批次明细时 DOM 为 `<strong>批次 </strong>`，批次 ID 不显示；接口返回 `id`，前端类型读取 `batchId`：
  - `apps/web/src/api.ts:210-212`（`BatchDetail.batchId`）
  - `apps/web/src/panels.tsx:480, 498`
  - `rq-sys-miaoda/client/src/rqsys/api.ts:265-267`
  - `rq-sys-miaoda/client/src/rqsys/panels.tsx:428, 443`
  - API 契约 `specs/rq-sys-mvp/openapi.yaml` 的 `Batch` 使用 `id`；实际响应也是 `id`
- **影响**：明细头部信息缺失；失败项「重试」成功后调用 `getBatch(undefined)`，接口返回 500（非法 uuid）或 404，UI 弹出「请求失败」，但重试任务其实已入队——**恢复动作在用户侧表现为失败**。
- **测试为何没发现**：`panels.test.tsx` 的 mock 返回 `batchId`，与真实 API 不一致，测试在假契约上通过。
- **建议**：前端统一改用 `id`（或 API 同时返回 `batchId`）；补真实响应形状断言；批次重试后刷新失败不应覆盖“已入队”的成功提示。

#### F-03 部署端失败项重试缺少幂等键与审计，与根仓契约不一致

- **证据**
  - 根仓：`POST /api/items/{id}/retry` 强制 `Idempotency-Key`，用哈希 key 复用批次，并写 `sync.item.retry_requested` 审计（`apps/api/src/http/app.ts:432, 461`）。
  - 妙搭运行时：同一路由不校验 Idempotency-Key，每次 `randomUUID()` 新建批次，且**不写审计**（`rq-sys-miaoda/server/rqsys/http/app.ts:576-603`）。
  - 妙搭客户端：`retrySyncItem` 不发送 Idempotency-Key（`client/src/rqsys/api.ts:283`，`panels.tsx:427`）；根客户端发送（`apps/web/src/api.ts:228`）。
  - OpenAPI 明确该接口需要 `Idempotency-Key`（`specs/rq-sys-mvp/openapi.yaml`）。
- **影响**：线上双击/重复点击会制造多个重试批次与作业；人工重试无审计留痕，违反 Spec 04「manual actions attributable」；根仓与部署仓对同一契约行为不同。
- **建议**：部署端对齐根仓（校验键、复用批次、写审计），客户端补键；把 `http/app.ts` 从“整体声明为平台适配”的豁免中拆出共享路由语义，纳入对齐检查。

#### F-04 桌面端摘要栏与顶栏不吸顶（设计 8.2 明确要求吸顶）

- **证据**
  - 详情页滚动 700px 后顶栏 `top=-700`、摘要栏 `top=-492`；截图 `evidence/detail-scroll-700.png` 中两者均消失。
  - 将 `html/body/#root/.app-shell` 的 `overflow-x` 临时改为 `clip` 后，`topbar top=0`、`summary top=57`，立即恢复。
  - 规则位置：`apps/web/src/styles.css:1096` 与 `rq-sys-miaoda/client/src/rqsys/styles.css:1098`：
    `html, body, #root, .app-shell { max-width: 100%; overflow-x: hidden; }`
- **根因**：`overflow-x: hidden` 会把元素变成滚动容器，祖先链上的滚动容器使 `position: sticky` 相对非视口容器工作；桌面端也被影响。该行是 `4c9a3d9` 为修复手机横向溢出所加，`@media (max-width: 860px)` 内才是原本想要的“手机端不吸顶”。
- **影响**：任何详情页向下阅读时都失去摘要/操作入口，与 design.md 8.2 的直接要求冲突；长详情页尤其明显。
- **建议**：改用 `overflow-x: clip`（不创建滚动容器），或把 `hidden` 限定在移动端；补一条滚动吸顶的浏览器回归。

#### F-05 同标题去重规则与已确认的 V0.2 来源 ID 不变量冲突（快照 B 正在改，但未收口）

- **快照 A（已发布 `7d77dcf`）**：`apps/api/src/sync/service.ts:27-44` 的 `dedupeRequirementTitles` 只保留最早的同规范化标题记录，其余在导入前丢弃；MVP Spec 在同一次提交中被改成允许该行为（`specs/rq-sys-mvp/01-teambition-sync.md` 约第 26 行）。这与 `AGENTS.md`「never use title … for deduplication」和 V0.2-T15（2026-10-23 确认 G-ID：不同 TB ID 的同标题需求独立保留）直接冲突。
- **快照 B（评审期间工作树）**：已改为 `markDuplicateTitles`：所有记录都导入，晚出现的记录写 `duplicate_of_requirement_id` 指向最早记录，并新增迁移 `0007`、详情页“疑似重复/查看主需求”提示；这比“直接丢弃”更接近 V0.2-T15，但：
  - 评审中曾出现旧断言/测试替身失败（14:43–14:51），15:15 新提交后本地测试已全绿（root API 395/395、miaoda 106/106）；
  - 重复记录“不进入默认需求池、分析和 Base 推送”，是否满足 T15-AC03「可独立导入和追溯」和 T15-AC04「导入计数」仍需产品/规格确认；
  - 已提交（root `bcf207d` / miaoda `3a1e4fa`），但未发布、未做目标验证。
- **影响**：快照 A 下不同 TB ID 的同标题需求永远进不了需求池；快照 B 下它们被保留但默认隐藏，验收口径需明确。
- **建议**：先稳定快照 B 的重复链接实现与测试，再按 V0.2-T15 的 AC 逐条核对；不要在未确认前把它当作已解决。

#### F-35 当前源码无法安全发布：Online 缺少 0006/0007 迁移

- **证据**：当前 root `bcf207d` / miaoda `3a1e4fa` 的 repository 与 push 逻辑读取 `manual_owner_*`、`duplicate_of_requirement_id`、`last_pushed_owner_*`；Online `requirements` 仍为 34 列，上述列**均不存在**（`+db-table-get` 只读核实）。
- **影响**：若直接发布当前源码，所有读取需求/指标/详情/推送的请求都会因缺列返回 500；这正是本地在只应用 `0001`–`0005` 时出现的现象（`column "duplicate_of_requirement_id" does not exist`）。
- **建议**：先按项目迁移流程在目标库执行 `0006`、`0007`（并完成回填/验证），再发布兼容代码；发布前用只读 schema 检查确认列存在。迁移执行属于高风险操作，需用户明确授权。

### P2 — 中等

#### F-06 非法路径 ID 返回 500 而非 404

- `GET /api/requirements/not-a-real-id`、`/api/batches/not-a-uuid` → 500；合法但不存在的 uuid → 404。
- 影响：通知/分享链接失效时，详情页显示「无法载入需求详情」＋「An internal error occurred.（INTERNAL）」，而不是可理解的“需求不存在”。
- 位置：`apps/api/src/http/app.ts:231, 410`（直接拿路径参数查 uuid 列）；建议先做 UUID 校验并返回 404/400。

#### F-07 深色主题：5 个未定义 token（47 处引用）＋ 硬编码浅色

- 未定义：`--rq-text`（13 处）、`--rq-text-tertiary`（15）、`--rq-surface-muted`（9）、`--rq-text-secondary`（8）、`--rq-border-subtle`（2）；两仓 CSS 完全相同的 5 个缺失集合。
- 后果（实测计算值/截图）：
  - 总览待办数字 `.todo-value` 深色下为 `#1f2329`（近黑）→ 几乎不可见；
  - 需求池 `.status-hint` 背景 `#f7f8fa`、文字浅灰 → 对比度 2.18–3.24；
  - 表头 `thead th` 背景仍为浅色 `#f7f8fa`；
  - 搜索/筛选输入框 `background:#fff`，深色下形成刺眼白块。
- 位置：`apps/web/src/styles.css:788, 804, 841, 909-912, 954-961`；`rq-sys-miaoda/client/src/rqsys/styles.css` 相同。
- 说明：妙搭线上客户端没有主题切换（`client/src/rqsys/App.tsx` 无 theme 状态），所以深色问题目前主要影响根仓本地工作台；但只要平台或后续版本启用深色，同样会触发。
- 建议：补齐 5 个 token 的 light/dark 值（或移除遗留 token 改用已定义语义变量）；输入框/表头/提示条改用 `var(--rq-field/surface/subtle)`；增加深色截图回归。

#### F-08 手机端“使用指南”不可达

- `@media (max-width: 560px)` 将 `.topbar-actions > .icon-button` 全部隐藏（`apps/web/src/styles.css:710`），而“帮助”是唯一 Guide 入口（`App.tsx:248`，妙搭 `App.tsx:208`）；侧栏没有 Guide 项。
- 实测 390px：`a[aria-label="帮助"]` 为 `display:none`，`a[href*=guide]` 数量为 1 且不可见。
- 建议：手机上保留帮助入口，或在抽屉里增加“使用指南”；主题切换按钮可继续隐藏。

#### F-09 手机端需求池横向溢出（2298px / 390px）

- 390px 实测：`documentElement.scrollWidth = 2298`，body 为 390；隐藏 `.table-scroll` 后 html 立即回落到 390。
- 根因：表头最后一个 `<th><span class="sr-only">操作</span></th>`（`panels.tsx:1122`，妙搭 `1058`）使用绝对定位 `.sr-only`（`styles.css:361`），其包含块不是 `.table-scroll`，逃出横向裁剪，贡献了整页宽度。
- 影响：页面可以被横向拖动/程序滚动；手机浏览器可能出现整页横移；表内其他列（负责人/状态/时间）在 390px 下默认不可见，也没有横向滚动提示。
- 建议：给 `.table-scroll` 或 `th` 设 `position: relative`，或改用不产生绝对定位溢出的 sr-only 方案；手机端列表考虑改为卡片/两行式摘要，而非仅露出标题列。

#### F-10 错误反馈被显示成“成功”，且大量错误文案为英文

- 规则页校验失败：绿色 notice + 对勾（截图 `evidence/ego-rules-error-as-success.png`）；`RulesPanel.withFeedback` catch 走 `setNotice`，而 `notice-banner` 固定使用 `Check` 图标与 `role=status`（`apps/web/src/App.tsx:253, 343`）。
- 模块重名校验：显示红色「请求失败 功能模块名称不能重复。」——这是客户端校验，没有请求失败（`panels.tsx` 的 `submit` 走 `setLoadError`，`StateBanner` 固定前缀「请求失败」，`panels.tsx:33`）。
- 服务端错误原文直接进 UI：`An internal error occurred.`、`A dependency is unavailable.`、`Request validation failed.`、`Request failed (500)`。
- 影响：用户无法区分成功/失败与责任方；英文错误不可操作。
- 建议：区分 error / warning / success 三种 banner（图标、颜色、role=alert）；客户端校验就近显示字段级错误；错误码映射为中文可操作文案，原始 code 放 title/详情。

#### F-11 加载失败时保留旧行，摘要把它当新结果

- `load()` 失败只 `setLoadError`，不清空/标记旧 `rows`（`apps/web/src/panels.tsx:663-672`）；摘要继续显示「已加载 50 条（已应用 1 个筛选）」（`:861`）。
- 本次实测：搜索无结果返回 500 后，页面仍显示 50 条旧需求和旧摘要，容易让人误判筛选生效。
- 建议：错误时保留旧数据但标注“上次成功结果”，或清空表格并显示错误空态；摘要不要同时展示“已应用”与旧计数。

#### F-12 TB 状态显示原始 ID

- 详情页「TB 状态」显示 `6960a3b76586dfa001dc14c0`；来源只有 `taskflow_status_id` 时，`requirementSourceFacts` 回退展示该 ID（`apps/web/src/requirement-view.ts:266-273`，妙搭同文件）。
- 与 design.md 9.2「源端为空显示 — 并说明未提供」、以及页面自己的占位文案「工作台不推断状态名称」都不一致。
- 建议：只有名称时展示名称；只有 ID 时显示「—」+ title 提示，或服务端解析状态名后再展示。

#### F-13 API 不可用时来源条误报“尚未配置数据源”

- `App.tsx:256`（妙搭 `216`）仅在 loading 时区分，其它状态一律 `尚未配置数据源`；API 断开时同时显示「API 未连接」「未启用」「尚未配置数据源」。
- 实际配置存在（本地库 1 条来源）。建议 error 态显示「无法读取来源配置」并给重试入口。

#### F-14 无障碍：对比度、ARIA、可滚动区域键盘不可达

- axe（8 个页面，浅色）每页都有 `color-contrast` serious：导航分组标签 2.54:1（11px）、状态说明 3.24:1、详情摘要辅助文字 2.54:1、Guide 20 处；合计约 48 个节点。
- 总览 `.pipeline-help` 是 `span` 却带 `aria-label`（`aria-prohibited-attr`），无有效 role。
- 模块页表格滚动区域 `scrollable-region-focusable`（键盘无法聚焦滚动）。
- 建议：修复未定义 token/对比度；给说明图标加 `role="img"` 或改为按钮；给 `.table-scroll` 加 `tabindex=0` 与可访问名称。

#### F-15 同步批次进度不轮询，启动后数字不更新

- Spec 04 API 契约要求「Long-running sync returns a batch ID; the UI polls or subscribes to batch progress」；两仓均无 `setInterval`/轮询，仅在提交后 `loadData()` 一次（`App.tsx` `handleRunSync`），之后必须手动刷新。
- 影响：同步运行中用户看到的是提交瞬间的快照，容易以为没有进展。
- 建议：运行中批次按有界间隔轮询（如 5s，页面隐藏/批次终态停止），或在运行态显示显式刷新提示与“最近更新时间”。

#### F-16 负责人映射页只显示前 25 条，无分页/加载更多

- `MappingsPanel` 用 `listRequirements({ ownerState:"pending_mapping", limit:25 })`，没有 cursor 或加载更多（`panels.tsx:1172`）；目标环境文档记录 254 条待匹配，绝大多数在页面上不可见。
- 建议：补游标分页/加载更多，并在标题旁显示待匹配总数；或明确该页只处理“第一批”，给出跳转到需求池筛选的入口。

#### F-17 两仓 UI 行为漂移，现有对齐检查覆盖不到

- **快照 A**：部署端 `SourcesPanel` 没有 `ConnectionSelfCheck`（根仓 `panels.tsx:146`，Spec 04 要求 source settings 提供 connection self-check）；部署端无主题切换（根仓有）；部署端 `MappingsPanel` 的 `setOwner` 未传 `tbDisplayName`（根仓传），依赖服务端回退；部署端重试契约/审计差异见 F-03。
- **快照 B**：两仓都已同步手工负责人/重复链接改动，`check:alignment` 24/24 通过；但 `http/app.ts` 仍被整体声明为平台适配，F-03 这类路由语义漂移仍不会被发现。
- `check:alignment` 只比较共享 API 模块，没有 UI 行为对齐检查。
- 建议：为两仓 UI 建立可执行的“行为/文案/接口调用”契约测试（至少覆盖错误态、空态、重试、owner 写入、来源自检），或把 UI 也纳入共享代码；同时把 `http/app.ts` 从整体豁免拆成可校验的路由语义。

#### F-28 详情页身份与标题重复，首屏重点被稀释

- 进入详情后页面 H1 仍是「需求池」，面包屑也是「需求池」；摘要栏显示一次 3 行标题，L1「需求信息」里又用「TB 标题」整段重复一次，AI 区被推到 870px 以下（独立评审证据 `detail.png`）。
- 与 design.md 第 9 节「L1 首屏完整可见、L2 是 AI 建议」的分层意图有偏差：首屏应以这条需求的标题/负责人/四阶段/主操作为主，而不是重复列表页身份与同一标题。
- 建议：H1 使用需求标题或隐藏列表页 H1；L1 不再重复标题（摘要已承担）；确保首屏能看到 AI 第一张建议卡的开头。

#### F-29 AI 建议卡“卡片套卡片”、两列高低不齐且留白

- 七张建议卡被包在带边框的大卡里，两列高度不一致，右下出现约 150px 空白（`detail-scroll-700.png`）。
- 影响 L2 的扫读节奏：用户难以判断卡片之间的层级关系；空白让页面显得未完成。
- 建议：内外框二选一；同组卡片等高或改为单列「结论 / 理由 / 证据」；置信度与优先级并排。

#### F-30 手机抽屉没有显式关闭按钮

- 390px 抽屉（`ego-mobile-390-drawer.png`）只有背景遮罩可点、Esc 可关；手机上无 Esc，关闭入口不可发现。
- 建议：抽屉头部加关闭按钮；把主题/帮助入口移入抽屉底部，解决 F-08。

### P3 — 低影响 / 体验打磨

- **F-18 详情页打开/返回后焦点回到 BODY**：键盘用户失去位置；建议打开后聚焦详情标题或返回按钮，关闭后回到原行。
- **F-19 行内负责人动作重复**：未分配行的负责人单元格本身可点开分配，行尾又有「分配」按钮；可访问名称被拼成「待 待分配 分配」。建议保留一个主入口（design 8.1 只放行尾分配）。
- **F-20 小字号与行长**：CSS 中仍有 20 处 <12px 声明（`--rq-font-caption:12px` 的注释与实际不符）；详情标题每行约 52–55 字、L1 标题 55 字/行，标题行高 1.35 偏紧；建议正文 14–15px、限制阅读宽度约 60–70 字符、标题行高 ≥1.4。
- **F-21 Base 记录没有可打开链接**：详情只给复制记录 ID（`BaseRecordReference`）；Spec 04 要求 Base record link。若因凭据不下发浏览器而无法生成，需在规格/验收记录中明确为已接受限制，或服务端返回安全链接。
- **F-22 迁移前缀重复**：`database/migrations/0002_person_mapping_idempotency.sql` 与 `0002_single_source_config.sql` 共享 `0002`；每次 migrate 打印 warning，排序依赖完整文件名。建议重命名为 `0002a/0002b` 或下一个可用编号（不要改已应用文件名，可新增说明）。
- **F-23 验收记录互相矛盾/过期**：`RELEASE-CLOSEOUT.md` 顶部称 R1/R2/R3 全通过、MVP 生产可用，下面“当前结论”仍称未达到全量验收；`LOCAL-AND-TARGET-STATUS.md` 多个“supersedes”快照层次混乱；`OPEN-DECISIONS.md` D-11 称线上 schema 迁移未执行，但实际 Online 已有 `platform_requirement_id NOT NULL UNIQUE`。建议收敛为一份带日期的单一状态页，旧快照移入历史区。
- **F-24 客户端 bundle 偏大**：miaoda 生产构建 `index-*.js` 1,283 kB（gzip 400 kB），有 >500 kB chunk 警告；建议首屏拆包/按路由懒加载（非阻塞）。
- **F-25 审计日志只取 50 条无分页**：`AuditPanel` `limit:50`，无 cursor；更早记录只能靠筛选碰运气。建议与批次一致补游标。
- **F-26 总览搜索只有“前 25 条”的局部过滤**：总览「最近处理的需求」搜索只在 `requirements`（`/api/requirements?limit=25`）内过滤，再取前 5 条展示；搜索一个不在前 25 条的需求会显示「没有匹配的需求」，容易被误解为全库搜索。建议改为跳转需求池并带上 `title` 参数，或明确标注“在本页 25 条内筛选”。
- **F-27 状态样式不统一**：总览的 `StagePill`（带圆点）与需求池/详情的 `StageBadge`（soft chip）视觉语法不同，且 `StagePill` 没有把原始英文状态写进 `title`，与 design.md 10.3 的要求不一致。建议统一一种状态徽标组件。
- **F-31 禁用操作的解释离按钮太远**：详情页的「重试 AI 分析/Base 推送」禁用时只有 `title` 和摘要栏下方一句灰字说明；用户点击无反馈，不知道原因。建议在按钮旁用一行说明或 tooltip 组件，并把不可用原因与按钮同组。
- **F-32 同步记录里的内部值与空明细**：批次触发列显示截断的 `actorId`（本地为 `local-op`），失败摘要可能直接是技术原因或本地验收文案；批次明细 0 行时只有表头、没有空态（`ego-batch-detail-blank-id.png`）。建议 actor 显示姓名/系统，失败摘要给「原因 + 下一步」，明细空态明确“该批次在执行前失败，没有逐条记录”；本地测试数据造成的`验收构造…`文案不要进入产品截图/验收证据。
- **F-33 三套标题与行首色线**：每页同时有眉标、面包屑、H1；需求行首还有一条琥珀色边线与「待分配」重复表达同一状态。建议保留 H1 + 面包屑即可，删除装饰性眉标或只保留在总览；行首色线可删，状态已由徽标表达。
- **F-34 深色主按钮/徽标配色不统一**：深色下主按钮呈浅蓝底深字，徽标/危险色仍沿用亮色语义；新增的手工负责人/重复提示样式（`#fdecea`、`#fff4f2`、`#912018`）也是只定义亮色。若保留深色主题，需给这些新组件补 dark 值（与 F-07 一并处理）。

## 四、目标环境核查（只读）

| 项 | 结果 |
| --- | --- |
| 最新 Online release | `7699409141857750254`，`finished`，`error_logs=[]`，2026-10-22 16:41，commit `7d77dcf9a04374ea0b6babfd8dbb5a42d02d5162`（= 快照 A 的 miaoda HEAD） |
| 与当前仓库关系 | **目标落后于当前源码**：root HEAD `bcf207d`、miaoda HEAD `3a1e4fa`，目标仍为 `7d77dcf`；新提交自述“Implemented, not verified in target environment; 0006 must be migrated…before release” |
| Online URL | https://ecn8egz1lhkq.feishu.link/app/app_17fqkjwyx1u |
| 环境变量 | 10 个键（含 `BASE_APP_TOKEN`、`FEISHU_APP_SECRET` 等），无 `RQSYS_ENABLE_TEST_FIXTURES`；未读取值 |
| Online schema | `requirements` 34 列；`platform_requirement_id` 为 `text NOT NULL`、唯一约束 `requirements_platform_requirement_id_key` 存在；迁移 0006/0007 的列（`manual_owner_*`、`duplicate_of_requirement_id`、`last_pushed_owner_*`）**已核实不存在**（Online 仍为 34 列）；当前工作树代码依赖这些列，未执行迁移前不能发布 |
| 自动化 | `rqsysWeeklySyncRecovery`（cron，`enabled`）存在 |
| 未复验 | 登录后的 Online UI、目标库行数/计划开关、真实同步/AI/Base/通知链路；`+db-execute` 只读查询仍需 `--yes` 高风险确认，本轮未执行 |

结论：**发布侧元数据正常，但“生产可用”的运行时验收不能由本轮证据支持**；且发布版本包含 F-01、F-02、F-03、F-04 的代码，而当前工作树又尚未完成/未发布。

## 五、V0.2 状态

- `specs/rq-sys-v0.2/` 6 份 Spec、`issues/` 18 张 Ticket 均为 ready-for-agent；README 明确“尚未实施或目标验收”。
- **快照 A** 没有 V0.2 功能（仅有 `platform_requirement_id` 迁移）；本轮只验收 MVP 行为。
- **快照 B** 已开始实现手工指定负责人（0006）与同标题“重复链接”（0007），但未完成、测试未绿、未发布；RICE、Kano、六层人群、手工建单/编辑等仍未出现。
- V0.2 的验收清单应在其 Ticket 实施后单独执行；当前唯一直接冲突仍是 F-05（快照 A 为丢弃，快照 B 改为保留/链接，见 F-05）。

## 六、做得好的地方

- 列表/详情分离、URL 深链、筛选/分页/滚动位置保留：实测通过（浏览器前进后退、刷新、深链均保持上下文）。
- 空/错/加载态覆盖较全；API 断开后可恢复（「重试连接」恢复成功）。
- 危险操作有二次确认；秘密不下发浏览器；负责人选择有明确的名单为空提示。
- 测试基础好：快照 A 的 API 371、Web 78、miaoda 106 全绿；对齐/契约脚本存在；本地数据只读走查未污染。
- 快照 A 的 target release 与 miaoda `7d77dcf` 一致，部署元数据、schema、自动化均正常；当前工作树已领先该发布。

## 七、独立视觉评审

- 已按 oil-ui 的存量界面评审协议派发 1 个无业务上下文的子 Agent，仅依据截图、`design.md` 和截图工具 lint 提示评审，不打分、不改代码。
- 评审结论与主报告高度重合：摘要栏不吸顶、500 后展示旧结果、深色待办数字/浅色控件、手机整页横向溢出、校验失败画成成功、详情首屏重复 L1、行长/行高/字号、AI 卡片套卡、内部值外露、危险操作基本达标。
- 原文与会话记录：`review-20261023/visual-review.md`。
- 评审者的几条纯审美偏好（眉标、卡片套卡、行首色线）已降级并入 F-31–F-34，不作为阻断项。

## 八、建议修复顺序

0. **先收口快照 B**：让 root/miaoda 的测试替身与断言跟上新接口，恢复 root API、miaoda 路由全绿；确认 0006/0007 迁移在目标库执行后再发布；当前工作树在稳定前不要作为验收对象。
1. **F-01**（阻断，两仓一行级修复 + 无结果 HTTP 测试）
2. **F-02 + F-03**（恢复路径；前端契约 + 两仓路由对齐 + 审计 + 幂等测试）
3. **F-04**（吸顶；`overflow-x: clip` + 浏览器回归）
4. **F-05**（V0.2-T15；核对重复链接规则与 AC，再谈数据恢复/计数）
5. **F-06/F-07/F-08/F-09**（输入校验、深色、手机入口与溢出）
6. **F-10/F-11/F-12/F-13/F-14**（反馈语义、陈旧数据、状态展示、可访问性）
7. **F-15/F-16/F-17**（轮询、分页、两仓 UI 契约）
8. P3 打磨与验收记录收敛

## 九、本次未做/限制

- **评审期间仓库被并发修改**：13:15 后出现 root `1775738`、miaoda `01f3ccf` 及大量未提交改动（手工负责人、重复链接、测试调整），14:49–14:51 仍有写入；本轮没有把快照 B 当作验收对象，也没有回滚/修改这些改动。
- 未登录 Online 应用（需要飞书扫码）；未读取目标库行级数据（`--yes` 门禁）；未调用真实 TB/AI/Base/通知。
- 未在目标环境复验目标 UI 的移动端/深色/错误态；本地浏览器证据不等于目标环境证据。
- 独立视觉评审已执行（`review-20261023/visual-review.md`）；主 Agent 也按同一标准自查，未独立打分的项已在正文标注。
- 未修改任何业务代码；本地仅执行了 additive migrations（0003–0007，其中 0006/0007 来自评审期间工作树）并启动本地 API/Web 进行走查；未提交、未推送、未发布。

---

### 附：关键证据文件

| 证据 | 文件 |
| --- | --- |
| 空结果搜索 500 | `evidence/requirements-empty-error.png`、`evidence/ego-requirements-error-stale-rows.png` |
| 批次明细 ID 为空 | `evidence/ego-batch-detail-blank-id.png` |
| 详情滚动后顶栏/摘要消失 | `evidence/detail-scroll-700.png` |
| 详情首屏（TB 状态原始 ID） | `evidence/ego-detail-top-tb-status-id.png` |
| 深色总览 / 需求池 | `evidence/ego-dark-overview.png`、`evidence/ego-dark-requirements.png` |
| 手机需求池 / 详情 / 抽屉 | `evidence/ego-mobile-390-requirements.png`、`ego-mobile-390-detail.png`、`ego-mobile-390-drawer.png` |
| 规则校验错误显示为成功 | `evidence/ego-rules-error-as-success.png` |
| 删除确认框 | `evidence/ego-delete-dialog.png` |
| 桌面各页面 | `evidence/overview.png`、`requirements.png`、`detail.png`、`ego-sync-records.png`、`ego-sources.png` |
