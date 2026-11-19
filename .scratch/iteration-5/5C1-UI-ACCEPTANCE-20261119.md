# 5c-1 目标环境验收（2026-11-19）

> 环境：release `7709748022443314457`（根仓 `766c91d` / 妙搭 `29d3241`，已带新环境变量）；验证时间 2026-11-19 13:40–14:05 +08。
> 方式：ego-browser 登录态操作线上需求池 + `lark-cli` 只读核对 Base；未创建/删除任何数据。
> 结论：**核心 UI 通过**；「聊天粘贴」徽标因线上 0 行无法目验（本地用例覆盖，记 PARTIAL）。顺带确认 5b 三行已处理完、5c-2「来源方式」在真实推送中生效。

## 1. 结果

| ID | 检查项 | 结果 | 证据 / 说明 |
| --- | --- | --- | --- |
| C1-01 | 来源下拉含全部 + 四值 | PASS | `5c1-03-source-options.png`：全部来源 / Teambition / Web 手工 / 多维表格 / 聊天粘贴；DOM 同步读到五项 |
| C1-02 | `?source=web_manual` 深链 | PASS | URL 保留；「已加载 1 条（已应用 1 个筛选）」；行徽标「手工」 |
| C1-03 | `?source=chat_paste` | PASS | 0 条，空态「没有匹配的需求」，筛选计数 1；`5c1-05-chatpaste.png` |
| C1-04 | `?source=base_form` | PASS | 2 条，徽标「多维表格」；`5c1-06-baseform.png` |
| C1-05 | `?source=teambition` | PASS | 25 条 + 「还有更多」，无来源徽标；`5c1-04-teambition.png` |
| C1-06 | 无 source 深链 | PASS | 25 条 + 「还有更多」，下拉显示「全部来源」；`5c1-07-all.png` |
| C1-07 | 下拉选择 + 点「筛选」 | PASS | 选「多维表格」→ 点筛选 → URL 变 `?source=base_form`、2 条、徽标正确；`5c1-11-ui-filter-baseform.png` |
| C1-08 | 清除筛选 | PASS | 点「清除筛选」→ URL 去掉 `?source=`、回到 25 条 + 更多、下拉回「全部来源」；`5c1-08-cleared.png` |
| C1-09 | TB 不挂徽标 | PASS | teambition 筛选下 `tbody .source-badge` 数量 0 |
| C1-10 | 手工徽标与 tooltip | PASS | 「手工」，title「来自 Web 收录 · 终端用户」 |
| C1-11 | 多维表格徽标 | PASS | 两行均「多维表格」，title「来自多维表格」 |
| C1-12 | 老数据按手工 | PASS | `RQ-000316`（创建 2026-11-02，5a.1 前）显示「手工」，未误标聊天粘贴 |
| C1-13 | 手工详情来源 | PASS | 详情「需求信息」右上「来自 Web 收录 · 终端用户」；`5c1-09-detail-manual.png` |
| C1-14 | 多维表格详情来源 | PASS | 详情「需求信息」右上「来自多维表格」；`5c1-10-detail-baseform.png`、`5c1-12-detail-baseform-334.png` |
| C1-15 | CSV 导出带筛选 | PASS | web_manual 筛选下点「导出 CSV」，文件 1 行数据；表头含「来源类型」，值 `web_manual`；`5c1-export-webmanual.csv` |
| C1-16 | 聊天粘贴徽标/详情 | **PARTIAL（无线上样本）** | 线上 chat_paste 0 行，无法目验；本地 `panels.test.tsx` 覆盖徽标「聊天粘贴」、筛选、详情「来自聊天粘贴 · 售后」 |
| C1-17 | 不加迁移 | PASS | 5c-1 未加迁移；仓库最新为 5b 的 `0029` |
| C1-18 | 列表/详情无回归 | PASS | 列表、筛选、清除、详情、导出均正常；未出现整页错误 |

计数观察：Teambition 25 + 更多（分页）、Web 手工 1、多维表格 2、聊天粘贴 0；未直接得出 332/333 总量，列表分页不做总数断言。

## 2. 顺带确认的目标环境事实

### 5b 三行验收（Base 收集表 + 应用库）

| 收集表行 | 功能模块（输入） | 同步状态 | 系统需求 ID | 同步说明 |
| --- | --- | --- | --- | --- |
| 强光下屏幕看不清 | `导航（路线/离线/位置点）` | 已收录 | `RQ-000334` | （空） |
| 骑行记录按月份导出 | `电池` | 已收录 | `RQ-000335` | 模块未识别：电池 |
| 空标题 | （空） | 校验失败 | （空） | 标题为空（title_missing） |

- 应用库 `source_type='base_form'` 共 **2 行、2 个不同 `source_external_id`**，没有重复建；两条均已 `analyzed` + `pushed`。
- 模块映射两分支都对：`RQ-000334` 的 `intake_module` = `导航（路线/离线/位置点）`（词典规范名）；`RQ-000335` 的 `intake_module` 为空，`source_payload.intakeModuleRaw='电池'`、`moduleUnrecognized=true`。
- 两条已推送 Base「数据表」：`来源方式` 均为 **多维表格**，`系统通知事件ID` 均为 **null**（未触发通知）。
- 运维页可见：「多维表格同步：扫描 3 行 · 已收录 2 · 校验失败 1 · 写回失败 0 · 读取失败 否 · 最近 2026/11/19 13:44:04」。
- 证据：`5b-intake-table.json`、`5b-module-mapping.json`、`5b-idempotency.json`、`5b-pushed-rows.json`、`5b-ops-page.png`。

### 5c-2 推送写入

两条 5b 需求是回填之后新创建的，其 Base「来源方式=多维表格」只能来自推送写入 → **线上 `BASE_FIELDS_JSON` 的 `sourceMethod` 已生效，base_form 推送映射通过**。Teambition / Web 手工 / 聊天粘贴三类尚未各做一次真实推送冒烟。

## 3. 发现与建议

1. **聊天粘贴徽标无线上样本（PARTIAL）**：5a 验收数据已清，当前 chat_paste 0 行。要目验只能创建一条聊天粘贴需求，会产生需求 + `intake.*` 审计，需清理；建议留到下一次有清理窗口时做，或接受本地用例证据。
2. **CSV「来源类型」列是底层 `source_type`（OBS/P3）**：聊天粘贴导出时该列仍是 `web_manual`，文件里分不出「手工」和「聊天粘贴」。若 PM 要据此归档，建议后续加一列 `intakeOrigin`；本轮不作为 5c-1 失败。
3. **5b 测试数据仍在**：`RQ-000334/335`、收集表 3 行、Base 数据表 2 行；功能已验证，清理未做。清理时应用库与 Base 两侧都要删，并按 L 流程复查总数。
4. **调度曾延迟**：Chief 早前观察到 tick 未跑，但运维页显示最近一次收集表同步在 **13:44:04**（扫描 3 / 收录 2 / 校验失败 1），两条需求随后创建并推送——说明是延迟执行，不是逻辑缺失；「为什么延迟、是否稳定」仍归后端排查，不影响本次功能证据。

## 4. 证据文件

- 截图：`5c1-03-source-options.png`、`5c1-04-teambition.png`、`5c1-05-chatpaste.png`、`5c1-06-baseform.png`、`5c1-07-all.png`、`5c1-08-cleared.png`、`5c1-09-detail-manual.png`、`5c1-10-detail-baseform.png`、`5c1-11-ui-filter-baseform.png`、`5c1-12-detail-baseform-334.png`
- CSV：`5c1-export-webmanual.csv`
- 5b：`5b-intake-table.json`、`5b-module-mapping.json`、`5b-idempotency.json`、`5b-pushed-rows.json`
- 目录：`.scratch/iteration-5/evidence/20261119/`
