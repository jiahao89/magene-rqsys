# 我的需求 / 逻辑删除 / 回收站 线上验收

- 日期：2026-11-25 18:07–18:25
- 线上入口：https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u
- 发布：release `7712047961203510522`，妙搭 `568ca91`，CI `45591135736`（全部通过）
- 身份：贾浩，妙搭 actor `1868660374748201`，飞书 `user_id 99f56141`
- 全程只用本人名下真实需求，未造数；删除后全部还原

## 基线与结论

| 项 | 验收基线 | 实测 | 结论 |
|---|---|---|---|
| 我的需求总数 | **140**（产品 124 · 集团 16，含已压制 0） | **140** | PASS |
| 删除后 | **139**（产品 123 · 集团 15） | **139** | PASS |
| 还原后 | **140**（产品 124 · 集团 16） | **140** | PASS |
| Base | 0 差异 | 产品 335 行 / 集团 191 行，**双池 0 差异** | PASS |

原计划按 187（产品 123 + 集团 63 + 手工 1）验收，该数字是未按 `source_config` 和负责人唯一性规则计算的错误基线，已作废；更正说明见「问题 A」。

我的需求 140 的构成（只读 SQL，口径同 `mineCounts`）：

- 产品池 124 = 121 条 TB 执行人映射 + 2 条产品池手工负责人 + 1 条无来源手工（RQ-000316）
- 集团池 16（全部是 TB 执行人映射；集团池 8 人名单合计 191，贾浩名下就是 16 条）
- 已压制 0

## 逐项结果

### 1. 入口与数量 — PASS

- 左侧菜单「我的需求」→ `#my-requirements`；首页看板卡链接 `href="/app/app_17fqkjwyx1u#my-requirements"`，点击后同一地址。
- 刷新后仍在 `#my-requirements`，数字仍是 140。
- Tab：产品需求池 **124**、集团需求池 **16**；页头「含已压制 · 共 140 条」，与 `/api/requirements/mine/counts`（`{product:124, group:16, total:140, suppressed:0}`）和 SQL 一致。
- 证据：`evidence/m-01-my-requirements.png`

### 2. 删除产品池一条 — PASS（按 140 基线）

- 目标：RQ-000296「更高精度的地图需求」（`4ea40ace-…`，产品池，Base 行 `recvxDsIxufjxg`，删除前 `processingState=active`）。
- 二次确认文案：「移入回收站？这条需求会从需求池隐藏，但不会被物理删除；可在回收站还原。飞书 Base 中的历史行会保留，不会删除或改动。」按钮「取消 / 移入回收站」。
- 删除后：列表「共 139 条」，计数 139（产品 123 · 集团 15）。
- 回收站出现 RQ-000296：池「产品池」、来源 Teambition、删除时间 2026/11/25 18:14:17、删除前处理状态「活跃」。
- 证据：`evidence/m-02-delete-confirm.png`、`evidence/m-03-recycle-bin.png`

### 3. 同步不复活 — PASS（核心）

- 手动同步批次 `f90ff330-476a-4455-958b-af133b370e57`（product，manual）：总数 334 / 成功 334 / 失败 0 / 名单外跳过 0，18:15:51 → 18:16:16，**25.6 秒**。
- 该需求同步前后：`deleted_at=2026-11-25T18:14:17.307+08:00`、`deleted_by=1868660374748201` 保留；`updated_at` 仍是删除时刻 `18:14:17.512`；`analysis_state=analyzed`、`source_version=1` 未变；该需求 `analysis_runs` 仍 7 条（未被重新分析）；列表搜不到、121/124 计数不变。
- 同批次里该需求条目状态 `succeeded`（跳过后计成功，见「观察 C」）。
- Base：同步前后产品 Base 335 行全量比对 **0 差异**（added/removed/changed 全空），没有新增需求。

### 4. 回收站聚合两池 — PASS

- 再删集团池 RQ-000499「生物传感器扩展性」（`3ecfac69-…`，Base `reczz28cESCb9M13`）。
- 回收站两行，按删除时间倒序：集团池 18:18:10 → 产品池 18:14:17；池标签分别为「集团池」「产品池」，来源均 Teambition，删除前状态均「活跃」。
- 翻页：UI 只有 2 行不触发分页，用接口 `limit=1` + 游标连查两页验证——第 1 页「生物传感器扩展性」（有 nextCursor）→ 第 2 页「更高精度的地图需求」（无 nextCursor），不重不漏。
- 证据：`evidence/m-04-group-delete-confirm.png`、`evidence/m-05-recycle-two-pools.png`

### 5. 还原 — PASS

- 两条均从回收站「还原」，无二次确认；提示「已还原」。
- 还原后两条记录：`deleted_at/deleted_by` 为 null，`processing_state=active`、`pull=synced`、`analysis=analyzed`、`push=pushed`，`source_version` 未变（1 / 3）。
- 计数回到 140（产品 124 · 集团 16），回收站「已加载 0 条 / 回收站是空的」。
- 审计 4 条：`requirement.deleted` ×2（18:14:17、18:18:10）、`requirement.restored` ×2（18:18:49、18:18:51），均 succeeded，safe_details 带 pool / sourceVersion / processingState。
- 证据：`evidence/m-07-recycle-empty.png`

### 6. 删除态只读 — PASS

- 打开已删除的集团需求详情（`?stage=recycle&requirement=…`）：标记「已删除」「集团池」，显示删除时间与删除前处理状态；按钮只有「返回 / 还原需求 / 刷新」，没有编辑、负责人、重复判定、分析、评估、提示词等入口；另有只读说明「编辑、负责人、重复判定、AI 分析、评估、提示词、评分与 Base 推送均已停止」。
- 接口：`PATCH /api/requirements/{id}` → **409 `REQUIREMENT_DELETED`**「该需求已删除，请先在回收站还原后再操作。」，标题未被改写；重复 `DELETE` → 200 `replayed:true`，不重复写审计。
- `GET` 详情 `canRestore=true`。
- 证据：`evidence/m-06-deleted-detail.png`

## 问题与观察

### A. 验收基线更正：140（原 187 作废，非缺陷）

按 `mineCounts` 口径（人工负责人优先，否则唯一活跃 TB 执行人映射；含已压制、不含已删除）：产品 124、集团 16、合计 140。产品 124 = 121 条 TB 执行人映射 + 2 条产品池手工 + 1 条无来源手工（RQ-000316）；**集团池实际 16 条，不是 63**（集团池 191 条按 8 人分布：史东升 46、盛永帮 31、王赵云 24、李晨璐 24、毕梓浩 23、贾浩 16、兰诣伟 16、刘媛媛 11）。

原 187（产品 123 + 集团 63 + 手工 1）错在直接用原始 SQL 数 `executor_user_id` 命中人数，没有按 `source_config` 关联，也没有套「人工负责人优先、无人工负责人时要求唯一活跃映射」。该数字已作废，不得再用于验收。后续统一按 **140 / 删除 139 / 还原 140** 核对。

### B. 「我的需求」集团 Tab 的池标签错标「产品池」（真实 UI 缺陷，P2）

- 现象：`?stage=mine&pool=group#my-requirements` 下 16 行全部显示「产品池」徽标（应为「集团池」）；产品 Tab 也显示「产品池」（正确）。
- 证据：`evidence/m-08-group-tab-poolchip.png`
- 根因：线上妙搭 `server/rqsys/http/app.ts` 的 `requirementListPayload` 只在 `pool === "all"`（回收站聚合）时附加 `pool` 字段；`/api/requirements/mine?pool=group` 响应项没有 `pool`，前端 `poolChip(undefined)` 缺省渲染成「产品池」。根仓 `apps/api/src/http/app.ts` 同名函数已改成**无条件**附加 `pool`，两仓在此处行为不一致（`npm run check:alignment` 判为已声明差异，未拦截）。
- 建议：把根仓实现镜像到妙搭（回收站已证明 `pool` 字段可用），或在 `poolChip` 缺省时回退到当前 Tab 的池。属显示错误，不影响数据；未自行改动。

### C. 观察：被跳过的已删除行在同步批次里计为 succeeded

- 批次 334/334 成功、`filteredCount=0`，其中 1 条是已删除被整条跳过、未 upsert、未重新分析（数据正确）。
- 产品口径（2026-11-25）：保持计入 `succeeded`，不挪到 `filteredCount`；`filteredCount` 继续只表示集团池名单外过滤，避免语义混淆。若以后运营页要单列「因删除跳过 N 条」，另加 `skippedDeleted` 字段，本期不做。

## 清理与复核

- Base：产品 335 行、集团 191 行，与本轮开始快照全量比对 **0 差异**（同步后、结束时两次比对均 0）。
- 需求：526 live / 0 deleted（删除两条已全部还原），无残留测试数据、无造数。
- `analysis_runs`：1628 条，与开始前一致，本轮 0 次模型调用。
- 审计：仅新增 4 条生命周期事件（2 删 2 还原），重复删除/越权路径无多余审计。
- `requirement_assessments` 仍 1 行（需求 `2c4fe5c3…`，13:35 生成，非本轮产生，未动）；`requirement_prd_prompts` 0 行。
- 随手发现：`GET /api/requirements?deleted=true&pool=all` 返回 400 VALIDATION_FAILED（回收站接口不接受显式 `pool=all`，不传即可聚合两池）；UI 未受影响，记录备查。

## 证据清单

- `evidence/m-01-my-requirements.png` 我的需求页（140 / 124 · 16）
- `evidence/m-02-delete-confirm.png` 删除二次确认
- `evidence/m-03-recycle-bin.png` 删除后回收站
- `evidence/m-04-group-delete-confirm.png` 集团池删除确认
- `evidence/m-05-recycle-two-pools.png` 回收站两池聚合
- `evidence/m-06-deleted-detail.png` 删除态详情（只读）
- `evidence/m-07-recycle-empty.png` 还原后回收站空
- `evidence/m-08-group-tab-poolchip.png` 集团 Tab 池标签错误现场

## 附件

- `base-product-before.json` / `base-product-after-sync.json` / `base-product-final.json`（产品 Base 335 行）
- `base-group-before.json` / `base-group-final.json`（集团 Base 191 行）
- `base_full.py` 全量导出与比对脚本（复用 `full-acceptance-20261121/base_tool.py` 凭据）

## 补丁复验（release `7712054509455559930`，妙搭 `84fed37`）

只复验问题 B，其余五项不重跑。

| 项 | 结果 |
|---|---|
| `GET /api/requirements/mine?pool=group&limit=100` | 16 条，**16/16 带 `pool` 且等于 `group`**，缺失 0、错值 0 |
| `GET /api/requirements/mine?pool=product&limit=100` | 首页 100 条，**100/100 带 `pool` 且等于 `product`**，缺失 0、错值 0 |
| 集团 Tab UI | 已加载 16 条，徽标「集团池」16/16 |
| 产品 Tab UI | 已加载 25 条（首屏），徽标「产品池」25/25；Tab 计数仍 124 / 16 |
| 按行 Base 深链 | 集团行 → 集团 Base `HZ6NbvXKJa0o5Qs4hgQcSoirnde` / `tblNVlrwYOPU5kuz`；产品行 → 产品 Base `GRnEboCIga7Omas8RwgcDmmgnib` / `tbl6Gfi0KJ2a1llK`；详情接口同样按行取模板 |

结论：问题 B 已修复，无回归迹象。证据：`evidence/m-09-group-tab-fixed.png`、`evidence/m-10-product-tab-fixed.png`。
