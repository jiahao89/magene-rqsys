# 数据源页（多维表格收集表）验收结果

- 日期：2026-11-20
- 发版：`7710180789354646803`（commit `7d19d4d`，`error_logs: []`）
- 环境：线上 `ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`
- 基线：App 334 / TB 333 / 手工 1 / 多维表格 0 / 聊天粘贴 0（验收前后一致）
- 证据：[ds-01-page.png](ds-01-page.png)

## 结论

**核心功能 PASS，但有 3 项与 PRD §4.11 口径不一致（P3）**：卡片标题/结构、`recorded` 展示、`lastRunAt=null` 的空态文案。

| 判据 | 结论 | 说明 |
|---|---|---|
| DS1 只读结构 | **FAIL（P3）** | 卡片叫「多维表格来源」，PRD 要求「多维表格需求收集表」；无右侧「只读」状态 chip；说明文案与 PRD 不同 |
| DS2 地址 | PASS | 完整 URL + 「复制链接」+ 租户登录备注；URL 在 `<code>` 里，页面无地址输入框 |
| DS3 统计降级 | **FAIL（代码级）** | `lastRunAt=null` 时整行隐藏，PRD 要求显示「尚未运行」；`baseForm` 为 null/缺失时文案是「暂无同步记录或统计暂不可用。」，PRD 为「同步统计暂不可用」 |
| DS4 脱敏 | PASS | 页面文本与接口 JSON 扫描无 `rec[a-zA-Z0-9]{8,}` / `tbl…` / `fld…` / `?table=`；`lastError` 为 null 未展示 |
| DS5 只读无副作用 | PASS | 打开页面、点复制后 `source-counts` 仍 **334**，无 PATCH/POST，无调度变更 |
| DS6 两仓/门禁 | PASS（按前端报告） | Web 191/191、typecheck/build、alignment 36/36、arco、diff-check；妙搭 client 通过 |

## 逐项证据

### 1. 接口侧（`GET /api/ops/metrics`）

```json
{"metrics":{"baseForm":{
  "shareUrl":"https://aimagene.feishu.cn/share/base/shrcn6eOMLqHxXb302ggnGAyvvZ",
  "lastRunAt":"2026-11-20T09:16:32.488Z",
  "pages":1,"scanned":0,"skipped":0,"created":0,"recorded":0,
  "rejected":0,"writeBackFailed":0,"readFailed":false,"lastError":null}}}
```

- `shareUrl` 存在且等于配置值 ✓；泄漏扫描为空 ✓
- 但响应仍带 `pages/skipped/recorded` —— 接口层保留没问题，**页面不该展示**（见下）

### 2. 页面渲染（线上实测）

- 卡片标题：**多维表格来源**（PRD：多维表格需求收集表）；说明「收集表分享页与同步状态，只读；不展示 Base 表 ID 或记录 ID。」
- 来源地址：URL 文本 + 「复制链接」+「需在本租户内登录飞书后访问。」（PRD 固定文案：「需使用公司飞书登录（仅本租户可访问）。」）
- 同步规则：三行，内容与 PRD 等价但措辞不同（PRD 是固定文案原文）
- 最近一次同步：最后运行时间 `2026/11/20 17:16:32`、扫描行数 0、新建需求 0、**已收录 0**、校验失败 0、写回失败 0、读取失败 否；`lastError` 为 null 未展示
- 按钮：只有「复制链接」（+ TB 卡片的周计划与保存），无「立即同步 / 重试 / 暂停」✓

### 3. 三处偏差（建议一次对齐，P3）

1. **`已收录` 展示了 `recorded`**：`panels.tsx:293` 渲染 `stats.recorded`；PRD §4.11.4 明确「不展示 `pages` / `skipped` / `recorded` 等内部计数」。
2. **`lastRunAt` 为空时整行隐藏**：`panels.tsx:288` 是 `{stats.lastRunAt ? <div>…</div> : null}`；PRD 要求显示「尚未运行」。
3. **标题与状态 chip**：PRD 4.11.1 要求卡片头「多维表格需求收集表」+ 右侧「只读」chip + 指定说明；当前是「多维表格来源」+ 说明里带「只读」字样，没有 chip。

### 4. 证据受限项（不谎报线上 PASS）

- **「已复制」按钮态**：浏览器剪贴板权限弹窗拦住了自动化，没能稳定截到「已复制」；但剪贴板读到的内容等于展示地址，说明写入成功。按钮态由 `panels.test.tsx:302` 覆盖。
- **DS3 的 null 分支**：线上 `lastRunAt` 有值、`baseForm` 非 null，无法在线构造；以上结论基于代码走查 + 组件用例。

## 复验（发版 `7710185548342250732` / `ed8285d`）

| 项 | 实测 | 结论 |
|---|---|---|
| 卡片头 | h2「多维表格需求收集表」；说明「销售、售后等通过飞书收集表提交需求；系统自动同步到需求池，本页只读。」；右侧「只读」chip 存在 | PASS |
| 三个小块标题 | 来源地址 / 同步规则 / 最近一次同步 | PASS |
| 地址备注 | 「需使用公司飞书登录（仅本租户可访问）。」与 PRD 逐字一致 | PASS |
| 同步规则 | 整段与 PRD §4.11.3 固定文案逐字一致（含「提交不等于立即进池」） | PASS |
| 统计字段 | `dt` = 最后运行 / 扫描（0 行）/ 新建 / 校验失败 / 写回失败 / 读取失败；**「已收录」整项消失**，无 pages/skipped/recorded 标签 | PASS |
| `lastRunAt=null` | 代码 `panels.tsx:304` 显示「尚未运行」；字段缺失 `panels.tsx:311` 显示「同步统计暂不可用」；组件用例覆盖 | PASS（代码+单测，不记线上） |
| 无副作用 | 打开后 `source-counts` 仍 **334 / 333 / 1 / 0 / 0** | PASS |
| 本地组件测试 | `vitest run src/panels.test.tsx` **101/101** 通过 | PASS |

- 注：页面上仍出现「已收录」四个字，仅出现在 PRD 固定文案「回写「已收录 + 系统需求 ID」」里，不是统计项。
- 证据：[ds-03-aligned.png](ds-03-aligned.png)
