# 集团需求池 · 开发与测试计划（方案 A）

日期：2026-11-21
范围：同一应用内新增数据完全隔离的「集团池」；入口仍是当前地址，左侧菜单新增「集团需求池」。
本文只定方案与计划，不含代码改动。UI 细节见前端文档：[2026-11-21-group-pool-ui-plan.md](2026-11-21-group-pool-ui-plan.md)。

## 1. 已拍定的口径

**六条基础决定**

1. 跨池 UUID 固定返回 **404**；200 + 空数组、200 + 对方数据都算失败。
2. RQ 编号**跨池全局唯一且不回收**：迁移建 sequence，用现有最大值初始化，生成逻辑改为 `nextval`，替换 `MAX+1`。
3. 执行人名单为空 → **禁止启用同步**（保存/启用都拒绝）。
4. 集团池**不显示来源 Tab、来源徽标**；只有 TB 一个来源，列表直接展示。产品池完全不变。
5. 集合接口（列表/计数/导出/批次）显式 `pool=product|group`，缺省 `product`；详情与所有写接口**不传 `pool`**，由需求 UUID 推导归属。
6. 审计本期**不做分池筛选**；同步记录页只按批次池筛选，页面注明审计不支持。

**补充决定**

7. 数据源页两张卡**纵向排列**，不用 Tab。
8. 执行人名单用自由文本标签，1–20 个、去空格去重。
9. 批次详情显示池标签。
10. **总览页不动，只算产品池**；集团池只在自己的页面标题旁显示条数。两池数字不混。
11. Base：同一 Base 应用下新建独立「集团需求池 PM 表」，字段结构与现有 PM 表一致、各自演进；通知工作流独立一条、只看新表。
12. 集团池通知的兜底收件人（无负责人时通知谁）**待用户拍**；未配置前集团池不回落现有 PM Leader，避免跨池通知。

## 2. P0 只读核对结论（2026-11-21）

### 2.1 目标项目

| 项 | 值 |
|---|---|
| 项目名 | 需求收集与管理 |
| 项目 ID | `674e77e9ee4037da9d4b9f8e` |
| uniqueId 前缀 | `XQ` |
| 任务类型 | 取「需求」配置 `674e7a7e5f95a1404621bb4c`（同项目另有「需求1」） |
| 任务总量 | **1,297** 条（该任务类型，只读拉取） |
| 有自定义字段的任务 | 1,294 |

### 2.2 9 人执行人名单核对

当前产品池 `owner_names` 的 9 人：刘媛媛、史东升、李晨璐、毕梓浩、盛永帮、贾浩、王赵云、兰诣伟、wanying qi。

- **8/9 在 TB 组织成员目录中解析到 user_id**：王赵云 24 条、盛永帮 31、史东升 46、毕梓浩 23、兰诣伟 16、李晨璐 24、贾浩 16、刘媛媛 11。
- 合计 **191 / 1,297** 条任务命中（按 `executor_id`）。这就是首次同步的预估量，不是 1,297。
- **`wanying qi` 在组织成员目录中查不到**（含大小写/去空格/拼音变体都无结果）。**这是启用前的阻塞项**：必须拿到该成员的 TB user_id，否则她的需求会被静默过滤掉。
- TB 任务当前只有单个 `executor_id` 字段，没有多执行人数组；“任一执行人在名单”在 P1 先落成“该 executor 在名单内”；若后续发现多执行人字段，再按数组任一命中扩展。

### 2.3 字段核对（新项目 vs 现有映射）

**关键事实：当前产品池线上 `source_configs.field_map` 是空对象，现有 334 条 TB 需求实际只有标题，名称/描述/提出人/类型/模块都为 null。** 所以“照搬现有 field_map”不可行——集团池必须新建自己的映射。

| 目标字段 | 新项目字段 | 字段 ID | 覆盖（全量） | 结论 |
|---|---|---|---|---|
| 标题 | `content`（任务字段） | — | 1,297/1,297 | 直接可用 |
| 描述 | 需求描述（rtf/text） | `674e7c2ceed2e651764a0d6f` | 1,290/1,297 | 直接可用，沿用现有 rtf→文本归一化 |
| 执行人 | `executor_id`（任务字段） | — | 1,297/1,297 | 用于名单过滤与负责人映射 |
| 状态 | `taskflow_status_id`（任务字段） | — | 1,297/1,297 | 存原始状态 ID；名称解析接口只读探测返回空，P1 再确认 |
| 提出人 | 需求提出人（user 字段） | `68be4f5f4f5b7255e6fda8d6` | 1,059/1,297 | 直接可用，取展示名 |
| 需求类型 | 需求类型 / 需求类别 | `674e7bab5f95a1404621c2f0` / `6a0133d8df4c64454bfe9471` | 700 / 240 | **值不匹配 8 类枚举**（需求与建议/体验/Bug/小优化；不及格体验/新功能需求）→ P1 先留 null，原文进 `source_payload`，映射表待产品定 |
| 功能模块 | 未找到 | — | 0 | `所属产品` 0 条；`关联产品的具体信息` 是产品型号不是模块 → P1 留 null，AI 仍用共享词典建议 |
| 约束/链接 | 无专用字段 | — | — | `材料补充` 33 条是附件；无补充链接/约束字段 → 留 null，附件只存引用、不进模型 |
| 产品型号（附加） | 关联产品的具体信息 | `6755a2581f580fe19bfaf70f` | 1,202/1,297 | 映射到 `productModel` |
| 需求来源（附加） | 需求来源 | `674e8f3ff867e816bda49f59` | 见样本 | 用户反馈 / 信息池需求，可进 `source_payload`，不做渠道枚举 |

**P0 结论**：六个核心字段（标题/描述/执行人/状态/提出人/产品型号）可落；类型、模块、约束三项**无 1:1 映射**，P1 按“留空 + 原文保留”处理，不猜标签。字段映射必须为集团池单独配置，不复用产品池。

## 3. 数据模型与迁移 0031

下一个迁移号：**0031_group_pool.sql**（当前最新 0030）。

```sql
ALTER TABLE source_configs
  ADD COLUMN pool text NOT NULL DEFAULT 'product'
  CHECK (pool IN ('product','group'));

-- 执行人名单：保存解析后的 TB user_id + 展示名；未解析成功的名字在 API 层直接 400，不落库。
ALTER TABLE source_configs
  ADD COLUMN executor_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(executor_allowlist) = 'array');

-- 推翻 D-09（单来源唯一）：同一 provider 允许产品/集团各一条。
DROP INDEX IF EXISTS source_configs_singleton_idx;
CREATE UNIQUE INDEX source_configs_provider_pool_idx
  ON source_configs (provider, pool);

-- RQ 全局编号：建序列并用现有最大号初始化（is_called=false → 下一次 nextval = max+1）。
CREATE SEQUENCE IF NOT EXISTS requirement_platform_id_seq;
SELECT setval(
  'requirement_platform_id_seq',
  COALESCE((SELECT MAX(SUBSTRING(platform_requirement_id FROM 4)::bigint)
              FROM requirements
             WHERE platform_requirement_id ~ '^RQ-[0-9]+$'), 0) + 1,
  false
);
```

- `pool` 默认 `product`，现有行零变化；D-09 的变更需要同步写决策记录（推翻单来源约束）。
- `executor_allowlist` 为空 + `enabled=true` 时，API 返回 400；数据库不加硬 CHECK（历史空名单需可保存为关闭态）。
- 集团池 Base 表、字段、通知工作流由 Chief 建；后端只接配置，不建表。
- 回滚见 §9。

## 4. 编号生成改造（全局唯一、不回收）

现状：`SELECT MAX(...)+1` + advisory lock，删掉最大号后会复用（验收期间 RQ-000336 已发生两次复用）。

改造：

- 生成处改为 `SELECT nextval('requirement_platform_id_seq')`，格式仍 `RQ-%06d`；去掉该路径的 `MAX+1` 查询与 advisory lock（`nextval` 本身原子）。
- 现有编号不变；迁移后的下一条 = 当前最大值 + 1。
- 序列允许空洞（并发/回滚），**不允许复用**；这正是不回收的语义。
- 并发用例：N 个并发 upsert → N 个不同编号；删除最大号后再建 → 新号 = 删除前最大值 + 1。

## 5. 接口与作用域

### 5.1 集合接口（显式 pool，默认 product）

| 接口 | 变更 |
|---|---|
| `GET /api/requirements` | 新增 `pool=product\|group`，缺省 product；SQL join `source_configs` 过滤 |
| `GET /api/requirements/source-counts` | 同上；集团池前端不请求（无 Tab），但接口仍支持以便排查 |
| `GET /api/requirements/export` | 同上，CSV 只含该池 |
| `GET /api/batches` | 同上；批次 DTO 增加 `pool`，详情/列表展示池标签 |
| `GET /api/overview/metrics` | **固定 product**，不接收 pool；SQL 增加 product 过滤，避免集团池数据混入 |
| `GET /api/ops/metrics`、`/api/ops/jobs` | 新增 `pool` 缺省 product，运维/作业按池查看 |
| `GET /api/audit` | 不接收/不使用 pool（本期明确不支持） |

### 5.2 详情与写接口（不传 pool，UUID 推导）

- 详情、编辑、负责人、优先级覆盖、评分、评估、重复判定、分析上下文、重试分析/推送：客户端**不传 `pool`**。
- 服务端按 `requirements.source_config_id → source_configs.pool` 推导；跨池访问测试走“显式带 `pool`”时固定 **404**（不返回 200 空数据/对方数据），不泄露存在性。
- 详情 DTO 增加 `pool` 字段供前端显示/路由判断（只读）。

### 5.3 来源配置接口

- `SourceConfigUpdateSchema` 增加：
  - `pool: "product" | "group"`（创建时必填；更新时不可改池）
  - `executorAllowlist: string[]`（仅 group；1–20 个名字，trim/去重）
- 名称→TB user_id 在服务端解析；有任一未解析 → 400，响应列出未解析名字；全部解析后落 `[{userId,name}]`。
- `enabled=true` 且 group 名单为空 → 400。
- 数据源 DTO 返回 `pool` 与 `executorAllowlist`（只读展示），不返回 Base 表 ID/record ID。

## 6. 拉取与执行人过滤

- 仍走现有全项目拉取（`getProjectTasks`，按 `scenariofield_config_id`），在进入归一化前过滤。
- **新任务**：`executor_id ∈ allowlist` 才收录；名单外直接跳过，不计失败。
- **已在池内的需求**：继续同步更新，不受当前执行人是否仍在名单影响；否则执行人一变就会被 `source_missing_since` 误标为移除。用户已拍“不处理执行人变更”，实现上必须保证**不误删/不误标**。
- `seenTeambitionIds` 必须包含“已在池内但本次被名单过滤”的任务，避免全量同步把它们标成缺失。
- 空名单 + 启用：保存即 400；运行时再兜底一层——跳过同步并写审计 `sync.filtered_empty_allowlist`，不拉全项目。
- 批次统计：新增 `filteredCount`（名单外跳过数），便于运维判断名单是否过窄；不改 job_type。
- 首轮预计 191 条（8 人）；第 9 人 ID 补齐后重算。

## 7. Base 推送与通知分池

- 产品池沿用现有 `BASE_APP_TOKEN` / `BASE_TABLE_ID` / `BASE_FIELDS_JSON` / `RQSYS_PM_LEADER_USER_ID`。
- 集团池新增独立 env：`GROUP_BASE_APP_TOKEN`、`GROUP_BASE_TABLE_ID`、`GROUP_BASE_FIELDS_JSON`、`GROUP_RQSYS_PM_LEADER_USER_ID`。
- 组合根按 pool 选择 push runner；**集团池缺配置时推送失败并记 `base_config_missing`，绝不回落到产品池表**。
- 通知工作流是 Base 表自身的属性：集团新表单独一条，只看新表的通知字段；代码不跨表写。
- 兜底收件人：未配置前集团池不做 PM Leader 回落（无收件人则静默），等用户拍定后再配 env。
- 模块词典全局唯一、只读共享（线上 v7/53），不复制、不按池分叉；AI 建议照常使用。

## 8. UI 摘要（详见前端文档）

- 左侧「工作台 → 需求池」后新增「集团需求池」，hash `#group-requirements`；深链 `?requirement=<uuid>`；产品池 URL 不变。
- 集团池不渲染五来源 Tab/徽标，不请求 source-counts；详情/写操作不传 pool。
- 数据源页两张卡纵向：产品池在上、集团池在下；集团卡有执行人名单标签，空名单禁用保存/启用。
- 同步记录页按批次池筛选，详情带池标签；审计页注明暂不支持按池筛选。
- 总览页不含集团池；集团池页标题旁显示本池条数。

## 9. 测试计划

**隔离（最高风险）**

1. 列表：product 默认看不到集团数据；group 只看集团。
2. `source-counts` / 导出：同一 pool 内一致，跨池不混。
3. 总览固定 product；`ops/metrics`、`ops/jobs` 按 pool。
4. 详情/写接口显式带 `pool` → 404；产品 UUID 不返回集团数据，反之亦然。
5. 批次列表/详情带 pool；审计不按池过滤（页面有说明）。
6. Base：集团推送只写新表，产品表行数不变；通知字段只写对应池。
7. 词典：两池读同一 published 版本。

**编号**

8. 跨池全局唯一；删最大号后不复用；迁移后现有编号不变、下一条 = max+1；并发不重号。

**执行人过滤**

9. 名单内新任务收录；名单外不收录；混合执行人按命中；空名单禁止启用；执行人迁出名单后存量不误删/不误标 missing。

**字段映射**

10. 描述、提出人、产品型号落位；类型/模块/约束按 P1 口径留空且原文进 `source_payload`。

**回归**

11. 现有 334 / TB 333 / 手工 1 / 多维表格 0 / 聊天粘贴 0 基线不变；产品池页面、导出、详情、写操作全部照旧。

## 10. 回滚方案

- 代码回滚：先停用集团来源（`enabled=false`），再回滚应用版本。
- 数据回滚（如必须）：删除集团来源及其需求/批次/派生行（按 `source_config_id` 精确删），确认产品池计数回 334。
- 结构回滚：先确保每个 provider 只剩一条来源，再 `DROP INDEX source_configs_provider_pool_idx`、重建 `source_configs_singleton_idx`；`pool`/`executor_allowlist` 列可保留（默认值不影响旧代码），需要时再 drop。
- `requirement_platform_id_seq` 保留不删：即使回滚到 `MAX+1`，保留序列不会改变行为；删序列反而有重置编号的风险。

## 11. 待确认 / 阻塞

1. **`wanying qi` 的 TB user_id 未解析**——阻塞集团池启用；需要该成员的准确账号。
2. 集团池通知兜底收件人（默认不回落产品 PM Leader，等用户拍）。
3. 集团 Base 表/字段/通知工作流由 Chief 建；`GROUP_BASE_*` env 需在 dev/online 配置。
4. 需求类型/功能模块/约束三项的最终映射规则（P1 先留 null + 原文保留，不猜）。
5. 状态名称解析接口当前返回空，P1 确认展示是否需要名称（不影响过滤与推送）。
