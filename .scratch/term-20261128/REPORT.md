# 「压制」术语替换（方案 A）

- 日期：2026-11-28
- 提交：根仓 `5c7d545`（已推，CI run `46118509177`）、妙搭 `3a21a05`（已推 `e5f3bd1..3a21a05`）
- 范围：只改面向用户的文案与对应断言；枚举值、`processingState=suppressed`、接口字段名、注释里的内部说明一律未动

## 文案对照（已生效）

| 位置 | 改前 | 改后 |
|---|---|---|
| 状态标签（列表角标、详情、筛选） | 已压制（重复） | **已判定重复** |
| 状态标签 | 已压制（忽略） | **已忽略** |
| 重复处理视图 | 已压制重复 | **已排除** |
| 总览「需求总数」提示 | 已压制 N 条不计入 | **已排除 N 条，不参与分析与推送** |
| 我的需求（页头说明 + 列表摘要） | 含已压制 | **含已排除** |
| 我的需求（首页卡副文案） | （含已压制） | **（含已排除）** |
| 运维页重复指标 | 重复：已压制 N · 疑似 M | **重复：已判定重复 N · 疑似 M** |
| 详情提示/按钮 title/aria-label/sr-only | 已被压制、已压制需求… | **已被排除、已排除需求…** |

## 实测（本地构建 + mock 数据，1440 / 1000）

| 页面 | 实测文本 |
|---|---|
| 总览 | `已排除 12 条，不参与分析与推送` |
| 需求池（处理视图） | `全部 / 仅活跃 / 已排除`；深链 `?processingState=suppressed` 仍生效，列表 2 条 |
| 需求池（角标） | `已判定重复`、`已忽略` 各一条 |
| 我的需求 | `含已排除 · 共 140 条` |
| 运维 | `重复：已判定重复 12 · 疑似 5；评分：AI 建议 300 · 人工修改 36 · 采用 AI 291（采纳率 97%）` |
| 全页面 | `document.body.innerText` 不再出现「压制」 |

## 门禁

| 检查 | 结果 |
|---|---|
| 根仓 web 单测 | **263/263**（含更新后的「含已排除」「已忽略」断言） |
| 根仓 typecheck / build | 通过 |
| `check:arco-styles` | 通过 |
| `check:alignment` | 12/12 共用文件一致，无未声明漂移 |
| `git diff --check` | 通过 |
| 妙搭 client 测试 | **29/29** |
| 妙搭 client typecheck | 通过 |
| 两仓三处页面文件 | 文案逐字一致（App.tsx 仅保留声明过的平台差异） |

## 证据

- `term-1440-suppressed-view.png` — 1440，处理视图「已排除」选中，两行角标「已判定重复」「已忽略」
- `term-1000-suppressed-view.png` — 1000，同上，无整页横向溢出（`scrollWidth=985`）
- `term-1440-overview.png` — 总览提示
- `term-1440-requirements.png` — 需求池默认视图与处理视图
- `term-1440-my-requirements.png` — 我的需求「含已排除」
- `term-1440-ops.png` — 运维页「重复：已判定重复」

## 备注

- 内部标识未动：`suppressed_duplicate` / `suppressed_ignored` / `processingState=suppressed`，无需迁移。
- 另发现：`docs/rq-sys-workflow-and-scoring.html`（工作区未跟踪）里两处「压制」也已顺手改成「排除」，但该文件本身没有提交。
- Chief 评审提的「滚动提示被删」「数据源卡 align 改回 stretch」两条，在当前 HEAD 已恢复：`styles.css` 的 `.table-scroll .arco-table-content-inner` 滚动条规则在（本次 1000 截图中可见底部滚动条），`sources-page.tsx:135` 也仍是 `align="start"`。运维页标题「运营指标」与侧栏「作业运维」不一致仍在，属命名口径，等定稿再改。
