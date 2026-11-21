# 集团需求池 · 前端 UI 开发方案（方案 A）

> 状态：开发文档的 UI 部分（2026-11-21 按六条决定 + 五条补充定稿），供并入本轮集团需求池开发文档；未改代码。
> 方案 A：同一应用内做数据完全隔离的「集团池」，入口仍是现有地址，只在左侧菜单新增「集团需求池」。
> 产品池（现有业务）行为保持不变：请求不带 `pool` 时后端默认 `product`，现有页面与 URL 不变。

## 0. 已拍定口径（2026-11-21）

1. **跨池 UUID 一律 404**：带 `pool=group` 访问产品池 UUID（或反向）返回 404，不能是 200 空数据或对方数据。
2. **RQ 编号跨池全局唯一、不回收**：本次一并把 `MAX+1` 改为数据库序列（现有最大值初始化），两池共用全局编号；前端列表只展示编号，不参与生成，不需要分池逻辑。
3. **执行人名单为空 → 禁止启用同步**：数据源页禁用保存/启用并明确提示，服务端同样校验。
4. **集团池不显示来源 Tab、不显示来源徽标/色条**：集团池只有一个 Teambition 来源，列表直接展示；产品池完全不变。
5. **集合接口显式 `pool`，详情/写接口不传 `pool`**：列表、来源计数、导出、同步批次传 `pool=product|group`（缺省 `product`）；详情与全部写操作（编辑、负责人、评分、评估、重复判定、优先级、分析上下文、重试分析/推送）由服务端按需求 UUID 的 `source_config.pool` 推导，客户端不得附加 `pool`。
6. **审计本期不做分池筛选**：同步记录页只在「同步批次」页签提供池筛选，「审计日志」页签不提供，并在页面注明审计不支持按池筛选。

**补充口径（2026-11-21 二次定稿）**

7. **集团池页头条数**：请求 `GET /api/requirements/source-counts?pool=group`，只取 `all` 一个数字，不渲染五个来源 Tab；不为一个数字另开接口。
8. **404 分两层**：显式带 `pool` 且与归属不符 → 404；不带 `pool` → 200 返回 `detail.pool`，页面按当前路由 scope 守卫，`detail.pool` 与 scope 不一致时按 404 错误态展示。
9. **无来源徽标只限列表**：集团池列表不挂 TB 徽标/色条；详情照常显示来源「Teambition」，TB 字段标签（执行人、状态等）保留，不删。
10. **两个 UI 增量已定**：作业运维页加「产品池 / 集团池」切换；集团池详情标题旁显示「集团池」标签（仅 `pool=group`）。


## 1. 范围与前提

- 前端只负责「入口、展示、传参、隔离校验」；池隔离的最终保证在服务端 `pool` 作用域，前端不自行混排两份数据。
- 复用现有需求池、详情、数据源页、同步记录页组件，不复制一套页面、不新增设计系统。
- 本期不做：集团池专属仪表盘、跨池对比、跨池搜索、池切换器（顶部全局切换）——入口只有一个菜单项。
- 池标识统一使用 `pool: "product" | "group"`；缺省 `product`。
- 妙搭仓库 `client/src/rqsys/` 与根仓 `apps/web/src/` 同步修改，行为逐字一致（平台适配除外）。

## 2. 路由与菜单

### 2.1 页面与菜单

- `WorkbenchPage` 增加 `"GroupRequirements"`：
  - `pageSegments.GroupRequirements = "group-requirements"`，URL 为 `#group-requirements`；
  - `pagesBySegment` 自动得到反解；`readWorkbenchRoute` 命中后返回 `{ page: "GroupRequirements", tab: null }`。
- 左侧菜单「工作台」组内，在「需求池」之后插入「集团需求池」：
  - 图标建议 `Building2`（lucide，已依赖），备选 `Layers3`；
  - `pageTitles.GroupRequirements = "集团需求池"`；
  - 移动端抽屉菜单、键盘导航、`aria-current` 沿用现有 `navigationGroups` 渲染逻辑，无需额外代码。
- 顶栏面包屑与页面标题自动显示「集团需求池」。

### 2.2 URL 与深链

- 列表：`#group-requirements` + 现有筛选参数（`title/owner/pull/ownerState/analysis/push/processingState/priority/sort/batch/from/to`；集团池不含 `source`，因为没有来源 Tab/来源筛选），参数名与产品池一致。
- 详情深链：`#group-requirements?requirement=<uuid>`，与产品池共用 `readRequirementDeepLink`；刷新/前进后退应回到集团池详情。
- 从菜单切到「集团需求池」时清除 `requirement`（沿用 `workbenchUrl` 现有行为）；筛选参数建议重置为默认，避免把产品池筛选带到集团池（实现时由 `workbenchUrl(..., "GroupRequirements")` 生成不带筛选的 URL，或在 `RequirementsPanel` 外层按 `scope` 判断是否读取 URL 筛选）。
- 产品池 URL、深链、导出、分页均不变。

### 2.3 页面挂载

- `SecondaryContent` 增加分支：
  - `page === "GroupRequirements"` → `<RequirementsPanel scope="group" onRefresh={onRefresh} initialRequirementId={deepLinkRequirementId} />`。
- 现有 `page === "Requirements"` 分支保持不变（不传 `scope`，默认 `product`）。
- 详情分支同样带 `expectedPool`：产品池详情为 `product`、集团池详情为 `group`，用于 `detail.pool` 守卫。

## 3. 需求池页复用（`RequirementsPanel`）

### 3.1 组件改造

- 新增可选 prop：`scope?: "product" | "group"`（默认 `"product"`）。
- 页面标题仍由 `App` 的 `pageTitles` 决定，组件内不写死「需求池」文案。
- 集合类请求显式带 `pool`：
  - 列表：`listRequirements({ ...filters, pool })`
  - 来源计数：`getRequirementSourceCounts(pool)`；集团池只读取 `all` 用于页头条数，不使用其余五个来源计数
  - 导出：`exportRequirementsCsv({ ...filters, pool })`
- **详情与写操作不传 `pool`**：`getRequirement(id)`、评估、评分、负责人、重复判定、优先级覆盖、分析上下文、重试分析、重试推送、人工编辑等全部按需求 UUID 由服务端从 `source_config.pool` 推导；前端 API 封装不提供 pool 参数，避免越权面。
- `scope` 用于三类前端行为：① 集合请求的 `pool` 取值；② 本页 UI 差异（集团池隐藏来源 Tab/徽标、页头条数、详情池标签）；③ 详情守卫的期望池。
- `RequirementDetailPage` 接收 `expectedPool`（来自路由 scope）：详情响应返回 `detail.pool`；二者不一致时**不渲染详情**，直接展示现有错误态（「无法载入需求详情 / 请求的资源不存在或已被删除」），不自动跳转、不探测其他池。服务端 404（显式带 `pool` 的跨池访问）走同一错误态。

### 3.2 列表与筛选

- 表格、筛选、分页、排序、批量、导出、键盘流、空态/错误态全部复用现有实现。
- **来源 Tab：集团池不渲染**。集团池只有一个 Teambition 来源，五个来源 Tab 没有意义；「更多筛选」里的来源控件也不渲染。
- **页头条数**：集团池标题「集团需求池」旁显示本池条数（`source-counts?pool=group` 的 `all`），加载失败时隐藏数字、不报错、不影响列表。
- **来源徽标/色条：集团池不渲染**（仅列表）。列表行只显示标题/负责人/状态/时间等通用列，不挂 TB 徽标、不挂来源色条、不显示「来源渠道」徽标；产品池完全不变。详情页不受影响（见 §3.3）。
- 集团池列表仍展示全局唯一的 RQ 编号（编号由服务端全局序列生成，前端不参与、不做分池处理）。
- 空池文案沿用现有 `table-empty`（「没有匹配的需求」），不新增页面级空态。

### 3.3 详情页

- 完全复用现有详情：需求信息、AI 分析、需求评估、评分、优先级、负责人、重复处理（集团池是 TB 来源，保留）、推送、审计历史。
- **池标签**：`detail.pool === "group"` 时在详情标题旁显示「集团池」标签；产品池不显示。这是池标识，不是来源徽标。
- **来源展示不变**：详情仍显示来源「Teambition」，TB 字段标签（执行人、状态、提出人等）保留；「无来源徽标」只约束列表行。
- 写操作（改负责人、评分、优先级、重复判定、评估、重试分析/推送、编辑）全部作用于当前需求，**请求不携带 `pool`**；池归属由服务端按 UUID 推导。
- 跨池详情防护分两层：
  - 服务端显式带 `pool` 的跨池访问 → **404**；
  - 客户端不传 `pool` 时服务端返回 200 + `detail.pool`；若 `detail.pool` 与当前路由 scope 不一致（例如在集团池页打开产品池 UUID），前端**按 404 错误态展示**，不渲染详情、不跳转、不探测其他池。
- RQ 编号为跨池全局唯一且不回收；详情页只展示服务端编号，不添加池前缀或分池编号。

## 4. 数据源与计划页（`SourcesPanel`）

### 4.1 现状问题

- 现在 `SourcesPanel` 用 `sources[0]` 假设只有一个来源，保存/更新/自检都围绕单条配置。
- 方案 A 后 `GET /api/sources` 返回两条（产品池 + 集团池，均 `provider=teambition`），必须按 `pool` 分组渲染。

### 4.2 页面结构

- 同一页面纵向两张卡片，产品池在上、集团池在下；移动端单列。
- 抽出现有表单为内部组件 `SourceConfigCard`（项目名称、启用同步、周计划、保存、连接自检），由 `pool` 参数决定：
  - 标题：产品池「产品需求池（Teambition）」；集团池「集团需求池（Teambition）」；
  - 保存按钮文案沿用「保存更新 / 创建来源」；
  - 保存后只刷新对应池的配置，另一张卡片不受影响。
- 产品池卡片内容与现有完全一致（默认项目、周计划、自检）。
- 集团池卡片新增：
  - **执行人名单**：多值标签输入（Arco `Select mode="multiple"` + 允许自定义输入），1–20 个姓名，提交前去空格、去重、去空项；标签可删除。
  - 姓名 → TB user_id 由**服务端解析**（前端不做人员查询）；保存时任一姓名未解析 → 接口 400 并返回未解析名单，前端在卡片内提示「以下执行人未解析到 Teambition 账号：…」，保留输入、不标记保存成功。
  - 固定说明：「任一执行人在名单内即同步；不处理执行人变更；名单为空不能启用同步。」
  - 名单为空时：保存与「启用同步」均禁用，并提示「请至少填写 1 个执行人后再启用同步」；不允许「保存即启用」。后端仍需同样校验（双保险）；历史配置若名单为空，卡片显示警告且同步保持关闭。
  - 项目名称默认「需求收集与管理」（可编辑，与产品池一致；实际项目/类型 ID 仍由服务端解析）。
  - 启用同步、周计划（星期多选、HH:MM、Asia/Shanghai）与产品池控件一致。
  - 不展示 Base 表 ID、record ID、环境变量名/值。
- 空态：
  - 未配置集团池来源时，集团池卡片显示「尚未配置集团需求池数据源」+「创建来源」，不隐藏卡片（让入口可发现）。
  - 来源列表加载失败仍只降级本页，不影响其他页面。

### 4.3 接口需求

- `SourceConfig` 增加 `pool`；创建/更新 body 带 `pool`（缺省 `product`）。
- 集团池配置字段：`executorAllowlist`。写请求提交**姓名数组**（1–20，trim/去重/去空项）；服务端解析后落 `[{userId,name}]`。读接口返回给前端展示的形态待后端确认——建议统一返回展示名数组（或 `{name}` 列表），避免前端为两种形状分支。
- `GET /api/sources` 返回两条配置；前端按 `pool` 分组，不再用 `sources[0]`。
- 多来源后，`checkScheduleHealth` 等单来源自检需要按池分别计算。

## 5. 同步记录页与作业运维页

### 5.1 同步记录页（`SyncRecordsPanel`）

- 顶部增加池筛选（Arco Radio/Segmented）：「全部 / 产品池 / 集团池」，默认「全部」。
- 同步批次页签：
  - `GET /api/batches?pool=...`；切换池时清空已加载批次、游标回第一页；
  - 「加载更多」沿用当前池；
  - 「全部」视图下每行增加池标签（复用 `status-chip`：「产品 / 集团」），避免混淆；
  - **批次详情也显示池标签**（决定 9）：详情头部与列表行同一视觉；
  - 集团池批次详情显示「名单外跳过 N」（批次 `filteredCount`），产品池不显示该行；字段缺失时隐藏，不报错。
- 审计日志页签：
  - **本期不提供池筛选，也不传 `pool`**；页签内注明「审计日志暂不支持按池筛选，可按对象 ID 查询」。
  - 批次筛选状态不影响审计页签；切到审计页签时不请求带 pool 的审计接口。
- 池筛选不做 URL 持久化；刷新回到「全部」。

### 5.2 作业运维页（`OpsPanel`）

- 增加「产品池 / 集团池」分段控件，默认产品池；切换时按 `pool` 重新拉 `GET /api/ops/metrics?pool=` 与 `GET /api/ops/jobs?pool=`（与现有 `days`、`limit` 参数组合），并重置作业列表。
- 产品池视图与现状完全一致（含多维表格收集表同步卡片 `baseForm`）。
- 集团池视图只展示集团池的指标与作业；`baseForm` 是产品池收集表的同步统计，集团池为空时不渲染该卡片（沿用现有「无数据不渲染」逻辑）。
- 池切换状态不做 URL 持久化，刷新回到产品池；接口失败沿用现有 `StateBanner` 降级，不整页报错。
- 总览页（`Overview`）按决定不改，只算产品池。

## 6. 前端需要的 API 契约清单

| 能力 | 接口 | 前端传参 |
|---|---|---|
| 需求列表 | `GET /api/requirements` | `pool`（缺省 product） |
| 来源计数 | `GET /api/requirements/source-counts` | `pool`；集团池只读取 `all` 作为页头条数 |
| 导出 | `GET /api/requirements/export` | `pool` |
| 需求详情 | `GET /api/requirements/:id` | **不传 `pool`**，服务端按 UUID 推导；响应 `pool` 用于页面守卫（与 scope 不符按 404 展示）；显式带 `pool` 跨池 → 404 |
| 详情子资源/写操作 | 现有各端点 | **不传 `pool`**，服务端按 UUID 推导 |
| 来源配置列表 | `GET /api/sources` | 响应含 `pool` |
| 来源创建/更新 | `POST/PUT /api/sources` | body 含 `pool`、`executorAllowlist`（姓名数组） |
| 同步批次 | `GET /api/batches` | `pool`；响应含 `pool`、`filteredCount` |
| 运维指标 | `GET /api/ops/metrics` | `pool`（缺省 product） |
| 运维作业 | `GET /api/ops/jobs` | `pool`（缺省 product） |
| 审计日志 | `GET /api/audit` | **不传 `pool`**（本期不支持分池筛选） |

- 所有 `pool` 取值 `product | group`；非法值后端 400。
- 不新增前端本地存储的池状态；页面由路由决定池。

## 7. 改动文件清单（前端）

根仓 `apps/web/src/`，妙搭镜像 `rq-sys-miaoda/client/src/rqsys/`：

- `workbench-routing.ts`：`WorkbenchPage` 增加 `GroupRequirements`、`pageSegments`、`pageTitles` 由 App 维护。
- `App.tsx`：`navigationGroups` 菜单项、`pageTitles`、`SecondaryContent` 分支。
- `panels.tsx`：
  - `RequirementsPanel` 增加 `scope`（集团池不渲染来源 Tab/徽标，集合请求带 `pool`、页头取 `source-counts.all`；详情/写接口不带；详情按 `detail.pool` 守卫）；
  - `RequirementDetailPage` 接收 `expectedPool`：不符按 404 错误态；`pool=group` 时标题旁显示「集团池」标签；TB 字段标签保留；
  - `SourcesPanel` 拆 `SourceConfigCard`，按 `pool` 渲染两张卡；未解析姓名 400 的提示；
  - `SyncRecordsPanel` 增加池筛选（仅批次页签），`BatchesPanel` 接收 `pool`；批次详情加池标签与 `filteredCount`；`AuditPanel` 不接收 `pool`；
  - `OpsPanel` 增加产品池/集团池切换，`getOpsMetrics`/`getOpsJobs` 带 `pool`。
- `api.ts`：`pool` 参数、`SourceConfig.pool`、`executorAllowlist: string[]`（读接口返回展示名）、`BatchSummary/BatchDetail.pool`、`BatchDetail.filteredCount`、`RequirementDetail.pool`、ops 接口 `pool`。
- `requirements-url.ts`：需求池筛选参数不变；如同步记录页需要深链，再单独加参数（默认不做）。
- 测试：`requirements-routing`/`App.test`（菜单与深链）、`panels.test`（池隔离请求参数、详情池守卫、页头计数、两卡保存互不影响、执行人名单校验、同步记录筛选、批次池标签与 `filteredCount`、运维池切换）。
- 样式：复用现有 `panel`/`status-chip`/`rules-form`；池标签复用 `status-chip`，不新增设计系统。

## 8. UI 测试计划

1. **菜单与路由**：集团需求池菜单可见、点击进入 `#group-requirements`、active 态正确；移动端抽屉可用；面包屑正确；`?requirement=` 深链直达集团池详情；前进/后退正常。
2. **池隔离**：
   - 集团池列表/导出/批次请求带 `pool=group`；产品池不传或传 `product`；
   - 详情与写操作请求**不得出现 `pool` 参数**（mock 断言 URL 不含 pool）；显式 404 时显示错误态，不泄漏内容；
   - **详情池守卫**：集团池路由下 mock 详情返回 `pool: "product"` → 不渲染详情、展示 404 错误态、不追加其他池请求；产品池路由下返回 `pool: "group"` 同理；
   - 集团池只请求 `source-counts?pool=group` 并只读 `all`：页头显示「共 N 条」，不渲染来源 Tab；计数失败隐藏数字、不报错；
   - 集团池列表不渲染来源徽标/色条；详情仍显示「Teambition」来源与 TB 字段标签，`pool=group` 时标题旁有「集团池」标签；产品池无该标签。
3. **数据源页**：两张卡片独立保存、互不覆盖；集团池执行人名单为空时保存/启用均禁用并提示；名单去空格/去重、1/20 可存、21 拒绝；未解析姓名 400 时卡片内列出未解析名单且保留输入；未配置时卡片显示创建入口；产品池现有行为回归。
4. **同步记录页**：仅批次页签有池筛选，切换重置游标与列表；「全部」视图池标签正确、批次详情也带池标签；集团池批次显示「名单外跳过 N」，产品池不显示；审计页签无池筛选并显示说明。
5. **作业运维页**：默认产品池且与现状一致；切到集团池后 `ops/metrics`、`ops/jobs` 均带 `pool=group` 并重拉；`baseForm` 为空时不渲染该卡片；切回产品池恢复；接口失败只降级本页。
6. **回归**：现有产品池的列表/筛选/详情/评估/R8 相似需求/数据源多维表格只读卡/同步记录/运维页不受影响；两仓行为一致；typecheck/build/alignment 通过。

## 9. 待确认项（UI）

无。全部口径已拍定（含集团页条数取 `all`、404 两层、集团池详情标签、运维页池切换、列表无来源徽标而详情保留 TB 字段标签），等待后端接口形态落定后按本文开工。
