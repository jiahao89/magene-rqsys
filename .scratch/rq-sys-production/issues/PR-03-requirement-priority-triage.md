# PR-03 需求池优先级分诊

> 批次：2026-11-06 生产就绪（PR）
> **Status**：`implemented-local`（2026-11-06，未目标环境验证）
> **优先级**：P0
> **创建**：2026-11-06；基线：root `5490d75`

## 背景 / 目标

需求池列表没有优先级/模块/人群列，查询参数也没有对应筛选与排序；总览分级卡只读、不能下钻；PM 无法按优先级分诊、批量确认。目标：把「按 P 排期」变成可操作界面（两端行为一致），并扩展 API 契约。

## 范围

- 需求池列表增加优先级、模块、人群列；支持按 `priority`/`module`/`audience` 筛选与排序（按 P、更新时间等）。
- 总览优先级分级卡可点击下钻到带筛选的需求列表。
- ~~批量选择 + 批量确认~~（随 PR-04 取消；PM 终审在 Base 进行，见 PRD-15/18）。
- API/OpenAPI 扩展：`apps/api/src/contracts/pipeline.ts` 查询参数、`specs/rq-sys-mvp/openapi.yaml`、两端 DTO 对齐。
- `apps/web/src/panels.tsx` 与 `rq-sys-miaoda/client/src/rqsys/panels.tsx` 行为一致；测试更新。

## 验收标准（未取得目标环境证据前不得宣称完成）

- [x] 列表展示优先级列与 P0–P3 筛选；`sort=priority_asc` 分诊排序（单页 100 条、不分页）本地实现。
- [ ] 总览分级卡下钻后列表筛选条件正确、可返回。
- ~~批量确认~~（已取消：PM 终审在 Base，Web 不写回；见 PRD-18）。
- [x] OpenAPI（priority/sort 参数、Requirement.executorName）与 `contracts/pipeline.ts` 更新，Web/Miaoda 两端行为一致（check:alignment 通过）。
- [x] 本地测试通过：API 552/552、Web 115/115、妙搭路由 116/116；typecheck/build/check:alignment/`git diff --check` 通过。
- [ ] 目标环境（online）列表/筛选/排序/下钻/批量确认实际可用（未取得证据不得标完成）。

## 不在范围

- 人工优先级写入 Base、通知（PR-04）；阈值/规则改动（PR-02）；生命周期状态（PR-07/PR-13）。

## 依赖 / 阻塞

- 无决策前置（ready-for-agent）；批量确认若要直接持久化人工优先级，需 PR-04 的决策与接口先定。
- PR-04 落地后可把「批量确认」扩展为「批量写入 Base 投影」。

## 证据引用

- `/tmp/rq-verify/pm-gaps.md` P0-2（第 82、92–93、99–100 行）。
- `apps/web/src/panels.tsx:1782-1860`（列表列无优先级）；`apps/api/src/contracts/pipeline.ts:36-50`（无 priority/module/audience 参数）。
- `docs/2026-10-21-rq-sys-v0.2-prd.md:379-388`（总览分级口径）。
- `specs/rq-sys-v0.2/DECISIONS-AND-GATES.md`（D-02 归属未决，但本票不改数据归属）。

## 实施记录（2026-11-06，implemented-local）

已完成：
- API：`GET /api/requirements` 新增 `priority`（P0–P3，按 `COALESCE(priority_override, sv.priority)` 过滤）与 `sort=priority_asc`；分诊模式按 P0→P3 排序、单页最多 100 条、忽略游标（`nextCursor=null`）；默认模式保持 created_at 游标分页。
- OpenAPI：新增 priority/sort 查询参数；Requirement schema 增加 `executorName`（用于待匹配负责人分组）。
- Web/Miaoda：需求池增加「优先级」列（人工覆盖带 `*` 与浮层说明）、更多筛选中的优先级筛选与排序选择；分诊视图提示与「加载更多」抑制；URL 深链支持 `priority`/`sort`。
- 单元测试：contracts 参数校验、repository SQL/参数、Web URL 契约、Web API 查询串。
未完成（需保持票打开）：总览分级卡下钻、模块/人群筛选、批量确认（依赖 PR-04 决策）、目标环境验证。

## 目标环境验证（2026-11-06，release `7704997761057361172`，commit `8d07753`）

- 线上需求池表头出现「优先级」列；P2 筛选返回 7 条，全部 `effectivePriority=P2`，URL 为 `?priority=P2`。
- 深链 `?sort=priority_asc#requirements`：摘要显示「分诊视图：按生效优先级 P0 → P3 排序，单页最多 100 条（不分页）」；首屏 100 条中 P2×7 在前、P3×93 在后，顺序正确。
- 直接 API 校验：`GET /api/requirements?sort=priority_asc&limit=100` → 200、`nextCursor=null`、优先级有序；`priority=P2` → 7 条全 P2。
- 发布 `status=finished`、`error_logs=[]`；发布后 10 分钟线上 error=0。
- 未覆盖：总览分级卡下钻、模块/人群筛选（仍在票内）；批量确认已取消（PRD-18）。
