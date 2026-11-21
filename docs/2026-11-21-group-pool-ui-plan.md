# 集团需求池 · 前端 UI 开发方案（方案 A）

> 状态：开发文档的 UI 部分，供并入本轮集团需求池开发文档；未改代码。
> 方案 A：同一应用内做数据完全隔离的「集团池」，入口仍是现有地址，只在左侧菜单新增「集团需求池」。
> 产品池（现有业务）行为保持不变：请求不带 `pool` 时后端默认 `product`，现有页面与 URL 不变。

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

- 列表：`#group-requirements` + 现有筛选参数（`title/owner/pull/ownerState/analysis/push/processingState/priority/source/sort/batch/from/to`），参数名不变。
- 详情深链：`#group-requirements?requirement=<uuid>`，与产品池共用 `readRequirementDeepLink`；刷新/前进后退应回到集团池详情。
- 从菜单切到「集团需求池」时清除 `requirement`（沿用 `workbenchUrl` 现有行为）；筛选参数建议重置为默认，避免把产品池筛选带到集团池（实现时由 `workbenchUrl(..., "GroupRequirements")` 生成不带筛选的 URL，或在 `RequirementsPanel` 外层按 `scope` 判断是否读取 URL 筛选）。
- 产品池 URL、深链、导出、分页均不变。

### 2.3 页面挂载

- `SecondaryContent` 增加分支：
  - `page === "GroupRequirements"` → `<RequirementsPanel scope="group" onRefresh={onRefresh} initialRequirementId={deepLinkRequirementId} />`。
- 现有 `page === "Requirements"` 分支保持不变（不传 `scope`，默认 `product`）。

## 3. 需求池页复用（`RequirementsPanel`）

### 3.1 组件改造

- 新增可选 prop：`scope?: "product" | "group"`（默认 `"product"`）。
- 页面标题仍由 `App` 的 `pageTitles` 决定，组件内不写死「需求池」文案。
- 组件内所有数据请求统一经一个作用域参数：
  - 列表：`listRequirements({ ...filters, pool })`
  - 来源计数：`getRequirementSourceCounts(pool)`
  - 导出：`exportRequirementsCsv({ ...filters, pool })`
  - 详情：`getRequirement(id, { pool })`
  - 详情子资源（评估、评分、负责人、重复判定、优先级覆盖、分析上下文、重试分析、重试推送、人工编辑等）：按后端最终契约携带 `pool`。**建议显式传**，即使后端可从需求 UUID 推导，前端显式传可作为越权防护；若后端定为推导，前端只在列表/计数/导出/创建传 `pool`。
- `RequirementDetailPage` 及其子区块通过 props/context 拿到 `pool`，避免每个子组件各自读全局。
- 推荐用一个轻量 `PoolScopeContext`（`{ pool: "product" | "group" }`）包住整个面板；`api.ts` 的池相关函数显式接收 `pool`，不依赖隐式全局。

### 3.2 列表与筛选

- 表格、筛选、分页、排序、批量、导出、键盘流、空态/错误态全部复用现有实现。
- 来源 Tab：集团池初期只有 Teambition 有数据，其他来源计数为 0。建议集团池仍显示五个 Tab（计数接口 `?pool=group` 返回真实 0），与产品池行为一致，减少分支；若产品确认「集团池只显示 TB」，则 `scope=group` 时只渲染「全部来源 / Teambition」两个 Tab，并同步隐藏工具栏来源筛选的相关项。
- 行徽标/色条/来源说明沿用现有规则；集团池页面上下文已说明池身份，不新增「集团」行徽标。
- 空池文案沿用现有 `table-empty`（「没有匹配的需求」），不新增页面级空态。

### 3.3 详情页

- 完全复用现有详情：需求信息、AI 分析、需求评估、评分、优先级、负责人、重复处理（集团池是 TB 来源，保留）、推送、审计历史。
- 写操作（改负责人、评分、优先级、重复判定、评估、重试分析/推送、编辑）全部作用于当前需求；请求带 `pool`（按第 3.1 约定）。
- 跨池详情防护：集团池页面打开产品池 UUID（或反向）时，服务端应返回 404/403；前端展示现有详情错误态，不自动跳转。

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
  - 固定说明：「任一执行人在名单内即同步；不处理执行人变更；名单为空不能启用同步。」
  - 名单为空时：保存/启用同步按钮禁用并提示「请至少填写 1 个执行人」；后端仍需同样校验（双保险）。
  - 项目名称默认「需求收集与管理」（可编辑，与产品池一致；实际项目/类型 ID 仍由服务端解析）。
  - 启用同步、周计划（星期多选、HH:MM、Asia/Shanghai）与产品池控件一致。
  - 不展示 Base 表 ID、record ID、环境变量名/值。
- 空态：
  - 未配置集团池来源时，集团池卡片显示「尚未配置集团需求池数据源」+「创建来源」，不隐藏卡片（让入口可发现）。
  - 来源列表加载失败仍只降级本页，不影响其他页面。

### 4.3 接口需求

- `SourceConfig` 增加 `pool`；创建/更新 body 带 `pool`（缺省 `product`）。
- 集团池配置字段：`executorAllowlist: string[]`（字段名以最终契约为准）。
- `GET /api/sources` 返回两条配置；前端按 `pool` 分组，不再用 `sources[0]`。
- 多来源后，`checkScheduleHealth` 等单来源自检需要按池分别计算。

## 5. 同步记录页（`SyncRecordsPanel`）

- 顶部增加池筛选（Arco Radio/Segmented）：「全部 / 产品池 / 集团池」，默认「全部」。
- 同步批次页签：
  - `GET /api/batches?pool=...`；切换池时清空已加载批次、游标回第一页；
  - 「加载更多」沿用当前池；
  - 「全部」视图下每行增加池标签（复用 `status-chip`：「产品 / 集团」），避免混淆。
- 审计日志页签：
  - 优先 `GET /api/audit?pool=...`；若后端本期不支持，则只在批次页签提供池筛选，审计页签隐藏池筛选并在文档标注限制（按对象 ID 仍可查）。
- 池筛选不做 URL 持久化；刷新回到「全部」。

## 6. 前端需要的 API 契约清单

| 能力 | 接口 | 前端传参 |
|---|---|---|
| 需求列表 | `GET /api/requirements` | `pool`（缺省 product） |
| 来源计数 | `GET /api/requirements/source-counts` | `pool` |
| 导出 | `GET /api/requirements/export` | `pool` |
| 需求详情 | `GET /api/requirements/:id` | `pool`（建议） |
| 详情子资源/写操作 | 现有各端点 | `pool`（契约待定，见 3.1） |
| 来源配置列表 | `GET /api/sources` | 响应含 `pool` |
| 来源创建/更新 | `POST/PUT /api/sources` | body 含 `pool`、`executorAllowlist` |
| 同步批次 | `GET /api/batches` | `pool` |
| 审计日志 | `GET /api/audit` | `pool`（可选，见 5） |

- 所有 `pool` 取值 `product | group`；非法值后端 400。
- 不新增前端本地存储的池状态；页面由路由决定池。

## 7. 改动文件清单（前端）

根仓 `apps/web/src/`，妙搭镜像 `rq-sys-miaoda/client/src/rqsys/`：

- `workbench-routing.ts`：`WorkbenchPage` 增加 `GroupRequirements`、`pageSegments`、`pageTitles` 由 App 维护。
- `App.tsx`：`navigationGroups` 菜单项、`pageTitles`、`SecondaryContent` 分支。
- `panels.tsx`：
  - `RequirementsPanel` 增加 `scope` 与 `PoolScopeContext`；
  - `SourcesPanel` 拆 `SourceConfigCard`，按 `pool` 渲染两张卡；
  - `SyncRecordsPanel` 增加池筛选，`BatchesPanel`/`AuditPanel` 接收 `pool`。
- `api.ts`：`pool` 参数、`SourceConfig.pool`、`executorAllowlist` 类型。
- `requirements-url.ts`：需求池筛选参数不变；如同步记录页需要深链，再单独加参数（默认不做）。
- 测试：`requirements-routing`/`App.test`（菜单与深链）、`panels.test`（池隔离请求参数、两卡保存互不影响、执行人名单校验、同步记录筛选）。
- 样式：复用现有 `panel`/`status-chip`/`rules-form`；池标签复用 `status-chip`，不新增设计系统。

## 8. UI 测试计划

1. **菜单与路由**：集团需求池菜单可见、点击进入 `#group-requirements`、active 态正确；移动端抽屉可用；面包屑正确；`?requirement=` 深链直达集团池详情；前进/后退正常。
2. **池隔离**：
   - 集团池列表/计数/导出/详情请求均带 `pool=group`；产品池不传或传 `product`；
   - mock 两个池返回不同数据，断言页面不混排；
   - 跨池详情（产品池页面带集团 UUID）显示错误态，不泄漏内容。
3. **数据源页**：两张卡片独立保存、互不覆盖；集团池执行人名单空值禁用保存并提示；名单去空格/去重；未配置时卡片显示创建入口；产品池现有行为回归。
4. **同步记录页**：池筛选切换重置游标与列表；「全部」视图池标签正确；审计池筛选（若支持）与批次一致。
5. **回归**：现有产品池的列表/筛选/详情/评估/R8 相似需求/数据源多维表格只读卡/同步记录不受影响；两仓行为一致；typecheck/build/alignment 通过。

## 9. 待确认项（UI）

1. 集团池是否需要来源 Tab（建议保留五 Tab，计数 0）。
2. 数据源页两卡纵向排列还是页内 Tab（建议纵向，减少切换）。
3. 详情/写接口的 `pool` 传递方式：显式参数 vs 需求 UUID 推导（建议显式）。
4. 审计日志是否支持 `pool` 过滤（不支持则本期只批次页签筛选）。
5. 执行人名单输入形态：无 TB 人员选择接口前，先用自由文本标签；后续如加 TB 人员搜索再升级。
6. 同步记录「全部」视图的池标签是否需要在批次详情内也显示（建议显示）。
