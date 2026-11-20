# RQ-000334 测试数据清理前后证据（2026-11-19）

> 对象：多维表格收集表测试需求 **RQ-000334《【base】多维表格测试需求》**。
> 结论：删除前证据已留档；删除后按 §4 复核。测试数据按用户规则清理，不留。

## 1. 删除前（18:46 左右）

### 应用侧

`GET /api/requirements/source-counts`（[01-source-counts-before.json](01-source-counts-before.json)）：

```json
{"teambition":332,"web_manual":1,"base_form":1,"chat_paste":0,"all":334}
```

- 需求 UUID：`3760aa2e-afd0-450d-9e5c-c54356054425`
- `sourceType=base_form`，`source.formRecordId=reczz28bV06qZinH`
- `platformRequirementId=RQ-000334`
- 流水线：`collected → analyzed → not_required → pushed`
- `analysisContext=null`、`ownerName=null`、`lastPushedAt=2026-11-19T10:41:32.944Z`
- 完整响应：[07-requirement-rq334.json](07-requirement-rq334.json)

UI：

- 全部来源 334 / Teambition 332 / 多维表格 1 / 手工 1 / 聊天粘贴 0：[01-all-tab-334.png](01-all-tab-334.png)
- 多维表格筛选命中 1 行，行内「多维表格·售后」徽标与蓝色色条：[02-baseform-tab-1.png](02-baseform-tab-1.png)
- 详情页来源行「来自多维表格 · 售后」：[03-detail-rq334.png](03-detail-rq334.png)
- 详情底部「来源 多维表格｜来源渠道 售后｜提出人 贾浩」：[04-detail-source.png](04-detail-source.png)

### Base 收集表（tbliQ1fQPFzQHkEM）

1 行，record `reczz28bV06qZinH`（[05-base-collection-row-before.json](05-base-collection-row-before.json)）：

- 标题：`【base】多维表格测试需求`
- 同步状态：`已收录`
- 系统需求 ID：`RQ-000334`
- 同步时间：`2026-11-19T18:41:02.385+08:00`
- 来源渠道：`售后`；需求类型：`新增功能`；产品型号：`C706`
- 提出人：`贾浩`；同步说明：`null`

### PM 数据表（tbl6Gfi0KJ2a1llK）

record `reczz28bVUAHwW6P`（[06-base-pm-row-before.json](06-base-pm-row-before.json)）：

- 需求平台 ID：`RQ-000334`
- 标题：`【base】多维表格测试需求`
- AI 优先级建议：`P3`
- 推送状态：`已推送`
- 来源方式：`多维表格`
- 系统通知事件ID：`null`（未误发通知）
- 系统需求链接：`...?requirement=3760aa2e-afd0-450d-9e5c-c54356054425`

## 2. 删除范围（按应用库 + 收集表 + PM 表三处）

- 应用库：需求 `3760aa2e-afd0-450d-9e5c-c54356054425` 及其快照 / 分析 / 推送 / 评分 / 作业 / 关联审计行。
- 收集表：record `reczz28bV06qZinH`。
- PM 数据表：record `reczz28bVUAHwW6P`。
- 只删本轮 RQ-000334，不动其余 333 条 Teambition/手工数据。

## 3. 删除后复核（2026-11-20 09:30 完成）

- [x] `GET /api/requirements/source-counts` = `{teambition:333, web_manual:1, base_form:0, chat_paste:0, all:334}`（[09-source-counts-after.json](09-source-counts-after.json)）
- [x] `GET /api/requirements?source=base_form` 返回空列表；旧 UUID 详情接口 404（[10-api-after.json](10-api-after.json)）
- [x] 需求池「多维表格」Tab = 0，空列表「没有匹配的需求」，不报错（[08-baseform-tab-0.png](08-baseform-tab-0.png)）
- [x] 收集表 0 行；PM 表 334 行；`RQ-000334` 0 行（[11-base-after.json](11-base-after.json)）
- [x] 应用库总 334、`base_form` 0；派生行全 0、无孤儿（后端事务复核：audit 4 / jobs 2 / push 1 / analysis 1 / snapshot 1 / score 1 / requirement 1 已删）
- [x] 审计/作业：`GET /api/audit?entityId=3760aa2e-afd0-450d-9e5c-c54356054425` 返回 0 条；`/api/ops/jobs` 无 failed/stuck（[12-ops-after.json](12-ops-after.json)）
- [ ] 为这条需求挂的监控：由 Chief 确认撤掉

### 基线说明

清理前（18:46）总 334 = TB 332 + 手工 1 + 多维表格 1。

今早 **09:15:40** 计划同步新增了一条真实 TB 需求 **RQ-000335**，所以清理前的最新基线是 **335**；删掉测试行后回到 **334 = TB 333 + 手工 1**。

因此 `source-counts` 的通过值是 **334/333/0/1/0**，不是旧脚本里的 333/332/0/1/0。`RQ-000334` 号已空出属正常。

## 4. 备注

- 本轮只做只读证据采集（浏览器 `page.fetch` + `lark-cli` 只读命令），未执行删除。
- 删除和 SQL 复核由后端/Chief 执行；测试按 §3 做目标环境复核。
- Base `+record-get` 对已删除的 record_id 会返回全 null 占位（`ok:true`），不能用它判断存在性；以 `+record-list` 计数和 `需求平台ID` 过滤为准。
