# 全量验收报告 · 2026-11-21

- 目标版本：release `7710528651390373056` / commit `27bc755`
  - 版本判定证据：线上资源 `client/assets/index-Ca3Td-dx.js` 的静态路径含 `27bc755303f7645287b8cd528334cdba72f50130`，与 commit 一致
- 环境：线上 `https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`（ego-browser 租户会话）
- 方式：**只读**。未创建需求、未提交表单、未触发同步/分析/评估/推送、未修改 Base、未删除任何数据
- 基线（开跑）与收尾（16:45）一致：
  - 产品池 `source-counts` = **334 / TB 333 / 手工 1 / 多维表格 0 / 聊天粘贴 0**
  - 集团池 = **191**（TB 191）
  - 评估表：产品 RQ-000335、集团 RQ-000526 的 `assessments` 均 `{items:[]}`（0 行）
  - 产品 Base `数据表` = **334**；集团 Base `集团需求池` = **191**

## 结论

**A–L 共 12 块：11 块 PASS，1 块 FAIL（I 块中的 1 个 P2 链接缺陷；数据层全部 PASS）。** 另有 4 项观察、2 类未验证（相似提示正例、IM 实收）。

无新增缺陷涉及数据写入或跨池串数据；两池数据、Base 表、编号区间完全隔离。

---

## A 产品池列表 / 筛选 / 来源 Tab / 导出 / 条数 — PASS

| 项 | 实测 | 结论 |
|---|---|---|
| 五个来源 Tab 与顺序 | 全部来源 / Teambition / 多维表格 / 手工 / 聊天粘贴，与 PRD 一致 | PASS |
| 计数 | 334 / 333 / 0 / 1 / 0 | PASS |
| Tab 过滤 | 点「手工」→ 1 行、URL `?source=web_manual`、行徽标「手工 · 终端用户」 | PASS |
| 来源过滤 API | `source=web_manual` 1 条；`base_form` 0；`chat_paste` 0；`pool=group&source=web_manual` 0 | PASS |
| 导出 CSV | 表头 + **334** 数据行；集团池导出表头 + **191** 数据行 | PASS |
| 创建入口 | 「新建需求」「从聊天粘贴」均在 | PASS |

证据：`evidence/A-01-product-list.png`、`evidence/A-02-overview.png`、`evidence/export-product.csv`、`evidence/export-group.csv`

## B 详情（四来源字段 / 编辑 / 负责人 / 重复处理 / 相似提示）— PASS（相似提示 BLOCKED）

| 项 | 实测 | 结论 |
|---|---|---|
| TB 详情（RQ-000335） | 9 个 TB 标签；标题/描述/提出人/执行人/状态/TB链接/创建时间齐全；「来自 Teambition」 | PASS |
| 手工详情（RQ-000316） | 只显示标题/描述/「来自手工录入 · 终端用户」；**无**执行人/状态/TB链接等 TB 字段；有「编辑需求」 | PASS |
| 负责人 | 「分配 / 变更负责人」入口在（未执行写入） | PASS（读态） |
| 重复处理 | 详情含「重复处理 · 人工判定」，含确认重复/确认非重复/忽略（未执行） | PASS（读态） |
| 相似需求提示正例 | 两池 `duplicates` 均为 0，无可复现数据；未造数 | **BLOCKED** |

证据：`evidence/B-01-tb-detail.png`、`evidence/B-02-manual-detail.png`、`evidence/product-requirements-all.json`

## C 新建（手工 + 聊天粘贴 + 校验）— PASS

| 项 | 实测 | 结论 |
|---|---|---|
| 手工表单控件 | 标题*/来源渠道*/产品型号/需求类型/功能模块/边界限制/来源链接/描述* 齐全 | PASS |
| 空提交校验 | 提示「请填写标题、需求描述，并选择来源渠道。」；无数据产生（仍 334、列表 25 条） | PASS |
| 聊天粘贴面板 | 输入计数 `0/20000`、「整理成需求草稿」、取消；未提交、未调用 intake-draft | PASS |

证据：`evidence/C-01-create-validation.png`、`evidence/C-02-chat-paste-panel.png`

## D AI 分析与评分 — PASS

RQ-000335：综合分 6.00 / P2 / v1 AI 建议 / 低置信度；U/M/S/C 九项输入、α、公式、置信度理由、证据引用、模块与类型建议、人群标签、整体置信度理由齐全；「重新分析」入口在（未触发调用）。

证据：`evidence/B-01-tb-detail.png`

## E 需求评估与 Investigation — PASS（只读空态）

- 详情「需求评估 · AI 建议 · 按需生成」：背景 0/2000、目标 0/1000、使用场景 0/2000 三个输入 +「生成评估」
- 空态：「还没有评估结果。补充背景、目标或使用场景后生成第一版。」
- `GET /api/requirements/{id}/assessments`：产品与集团样例均 `{items:[]}` → 未自动生成、评估表 0 行
- 未点击生成（避免模型调用）

证据：`evidence/req-group-assessments.json`、`evidence/B-01-tb-detail.png`

## F 数据源页 — PASS

- 三块纵向：产品需求池（上）→ 集团需求池（下）→ 多维表格需求收集表（只读），无页内 Tab
- 集团卡：项目「需求收集与管理」、**8 人名单全部展示**（刘媛媛/史东升/李晨璐/毕梓浩/盛永帮/贾浩/王赵云/兰诣伟）、`当前 8/20`、无 `wanying qi`、空名单禁用提示
- 产品周计划：周一/周三/周五 09:00 Asia/Shanghai；集团卡定时同步显示「未启用」
- 收集表卡：分享地址、只读标识、30 分钟同步规则、最近一次同步 2026/11/21 15:44:24（扫描 0 行）

证据：`evidence/F-01-datasource.png`

## G 同步与批次 — PASS

- 产品池 14 个批次全部 `succeeded`；集团池 3 个批次全部 `succeeded`，每批 `totalCount 191 / succeeded 191 / filteredCount 1106`
- 批次表含「池」列；池筛选只有「产品池 / 集团池」两选，无「全部」；页面注明审计日志不支持按池筛选
- 集团批次详情：`已完成 · 集团池 · 总数 191 · 成功 191 · 失败 0 · 名单外跳过 1106`
- 产品批次详情：`已完成 · 产品池 · 总数 333 · …`，**不显示**名单外跳过

证据：`evidence/G-01-sync-records-product.png`、`evidence/G-02-sync-records-group.png`、`evidence/G-03-batch-detail-group.png`、`evidence/batches-group.json`

## H 集团池 UI 与三层 404 — PASS

| 项 | 实测 | 结论 |
|---|---|---|
| 页头 | 「集团需求池共 191 条」 | PASS |
| 无来源 Tab/徽标 | `button.source-tab` = 0、`.source-badge` = 0 | PASS |
| 无新建入口 | 列表无「新建需求 / 从聊天粘贴」；产品池两按钮仍在 | PASS |
| 详情池标签 | 标题旁「集团池」；TB 字段与「来自 Teambition」保留 | PASS |
| API 跨池 | 集团 UUID 不带 pool → 200 `pool:group`；集团 UUID+`pool=product` → **404**；产品 UUID+`pool=group` → **404**；未知 UUID → 404 | PASS |
| UI 深链守卫 | `?requirement=<产品UUID>#group-requirements` → 「无法载入需求详情 / 请求的资源不存在或已被删除。」，原标题 0 次 | PASS |
| 切池守卫 | 产品详情 → 点「集团需求池」→ 404 错误态、原标题消失 | PASS |
| 切回恢复 | 切回「需求池」→ 原详情恢复、无 404 | PASS |

证据：`evidence/H-01-group-list.png` … `evidence/H-05-switch-back-restored.png`、`evidence/api-probe-01.json`

## I Base 推送与两表隔离 — **FAIL（P2 链接缺陷）**，数据层 PASS

| 项 | 实测 | 结论 |
|---|---|---|
| 产品 Base 不变 | `GRnEbo…/数据表` = **334**，与 App 334 一致 | PASS |
| 集团 Base 独立 | `HZ6NbvXKJa0o5Qs4hgQcSoirnde / 集团需求池` = **191**，与 App 191 一致 | PASS |
| 编号区间 | 产品 RQ-000001–000335（334 个唯一）；集团 RQ-000336–000526（191 个唯一）；**无交集** | PASS |
| TB 需求 ID | 两表无交集；记录 ID 与应用 `baseRecordId` 1:1 全部命中 | PASS |
| 集团 TB链接 | **191 / 191 非空**，值形如 `[https://teambition.magene.cn/task/<id>](https://teambition.magene.cn/task/<id>)` | PASS |
| 来源方式 | 集团 191×Teambition；产品 333×Teambition + 1×Web 手工 | PASS |
| 通知工作流 | 集团 Base `wkfKg2RfYO5vkTEd`「RQ-Sys 集团需求通知」**enabled**；监听「系统通知事件ID」，忽略 pasteUpdate/automationBatchUpdate/appendImport/openAPIBatchUpdate | PASS |
| 通知触发证据 | 集团表 **11 条** `系统通知事件ID` 非空（均为 `owner_changed:<需求UUID>:…`），说明工作流触发链路可执行；IM 实收未验证 | 部分 |
| **集团详情 Base 链接** | 「在飞书 Base 中打开」指向 **产品表** `…/base/GRnEbo…?table=tbl6Gfi0KJ2a1llK&record=…`，而记录实际在集团表 `…/base/HZ6Nb…?table=tblNVlrwYOPU5kuz&record=…` | **FAIL（P2）** |

**P2-1 详情**：`baseRecordUrl` 由单一环境变量 `RQSYS_BASE_RECORD_URL_TEMPLATE` 生成，不区分池；当前模板是产品池的 app/table。集团池 191 条详情全部受影响，点「在飞书 Base 中打开」会落到产品表且查不到该 record（已核对：集团 record id 在产品表中 0 命中，在集团表 1 命中）。数据本身未写错表。
建议：模板按池配置（group 用 `GROUP_BASE_APP_TOKEN` / `GROUP_BASE_TABLE_ID` 组装），或详情按 `detail.pool` 选择模板。

证据：`evidence/I-01-group-base-link.png`、`evidence/base-product.ndjson`、`evidence/base-group.ndjson`、`evidence/req-group-detail.json`

## J 运维页池切换与指标 — PASS（含 2 项观察）

- 池切换在位；产品：同步 100% (3/3)、分析 73.3% (11/15)、推送 100% (703/703)、低置信 81.8%；集团：同步 100% (3/3)、分析 97.9% (191/195)、推送 94.8% (746/787)、低置信 33.5%
- 产品池「没有失败作业」；集团池列出 41 条 failed `base_push`（`max_attempts_reached`）
- 负责人/重复/评分分布、多维表格同步统计均正常显示

证据：`evidence/J-01-ops-product.png`、`evidence/J-02-ops-group.png`、`evidence/ops-jobs-group.json`

## K 工程门禁 — PASS（PG 受限）

| 门禁 | 结果 |
|---|---|
| root `typecheck` | 通过 |
| root `build` | 通过 |
| API 用例 | **702**，通过 **641**，失败 **61**（全部为无本机 PG 的 `connect ENOENT …/.s.PGSQL.5432`；**非 ENOENT = 0**） |
| Web 用例 | **211 / 211** 通过 |
| alignment | 36/36 共用逻辑一致、59 模块逐字一致、无未声明漂移 |
| arco / migrations / `git diff --check` | 均通过 |
| `check:contract` | 3 通过 / **1 失败（同样为 ENOENT）** / 1 警告 / 3 跳过 |

**仓库状态观察**：根仓工作区不干净——`specs/rq-sys-mvp/openapi.yaml` 有 **+114 行未提交**（`/api/ops/gates`、`/api/ops/gates/{id}` 文档）。线上已在跑该功能（运维页「上线 Gate」），但 release commit `2ea70fd` 的契约文件里没有它；下次从干净检出构建会缺这段契约。

证据：`evidence/gates/gates.log`、`evidence/gates/web-contract.log`

## L 数据一致性 — PASS

- App 产品 334 ↔ Base 334：平台 ID 集合完全一致（onlyApp 0 / onlyBase 0）
- App 集团 191 ↔ Base 191：同上；`baseRecordId` 与 Base `record_id` 全部 1:1 命中（孤儿 0）
- TB 需求 ID 两池无交集；`duplicates` 0、已压制 0
- 产品 Base「TB链接」0/334 为已知历史缺口（本轮不修，不计缺陷）

证据：`evidence/product-requirements-all.json`、`evidence/group-requirements-all.json`、`evidence/base-*.ndjson`

---

## 缺陷清单

| 编号 | 级别 | 描述 | 影响 | 建议 |
|---|---|---|---|---|
| P2-1 | P2 | 集团池详情「在飞书 Base 中打开」指向产品池表/表 ID，记录不在该表 | 191 条集团详情链接不可用（数据未受影响） | `baseRecordUrl` 模板按池配置；补一条 group 链接断言 |

## 观察项（不计 FAIL）

1. **集团池 41 条历史失败作业**：15:06–15:21 的 `base_push` 失败（URL 字段写入问题窗口）已重试成功——191 条需求 `lastPushedAt` 15:24–15:33 全部「已推送」，批次 191/191。运维页「推送成功率 94.8%」是**尝试**口径，不是最终状态。建议清理或标注「已恢复」。
2. **「上线 Gate」区块**：部署版本已在产品池/集团池运维页显示 G1–G8；集团视图下 G1 仍说「已推送 334 条」（产品口径），且该功能 openapi 未提交。与本轮 12 块无关，但发版口径需对齐。
3. **集团池定时同步未启用**：来源 `enabled=true`，但周计划为空，3 次批次均为手动触发（actor 18686603）。验收期如此设计可以接受，上线前需确认是否开启。
4. `GET /api/health/ready` 迁移状态返回 `migration_state_unavailable`（平台不暴露迁移记录），与既有说明一致。

## 未验证（不判 PASS/FAIL）

- **相似需求提示正例**：线上两池 `duplicates` 均为 0，按「不造数」要求未创建，无法复现弹层。
- **IM 实收**：集团通知工作流有 11 次 `owner_changed` 事件写入，但未验证飞书消息实际送达。
- **PG 集成/契约用例**：61 条 ENOENT + `check:contract` 1 条 ENOENT，需要可连 PG。
- **所有写路径**：编辑、负责人变更、评估生成、同步触发、推送重试均按只读要求未执行。

## 证据索引

- 接口原始响应：`evidence/api-probe-01.json`、`evidence/overview.json`、`evidence/sources.json`、`evidence/batches-*.json`、`evidence/ops-*.json`
- 两池全量列表：`evidence/product-requirements-all.json`（334）、`evidence/group-requirements-all.json`（191）
- Base 全量导出：`evidence/base-product.ndjson`（334）、`evidence/base-group.ndjson`（191）
- 导出 CSV：`evidence/export-product.csv`、`evidence/export-group.csv`
- 截图：`evidence/A-*`、`B-*`、`C-*`、`F-*`、`G-*`、`H-*`、`I-*`、`J-*`
- 门禁日志：`evidence/gates/gates.log`、`evidence/gates/web-contract.log`

---

## P2-1 修复复验（release `7710540750535281963` / 妙搭 `052c77b` / 根仓 `07b2dab`）

| 项 | 实测 | 结论 |
|---|---|---|
| 集团详情 Base 链接 | RQ-000526 → `https://aimagene.feishu.cn/base/HZ6NbvXKJa0o5Qs4hgQcSoirnde?table=tblNVlrwYOPU5kuz&record=reczz28cESCbAMwo`；该 record 在集团表命中 1 次、产品表 0 次 | **PASS（P2-1 已修）** |
| 产品详情 Base 链接回归 | RQ-000335 → `…/base/GRnEboCIga7Omas8RwgcDmmgnib?table=tbl6Gfi0KJ2a1llK&record=reczz28bkO8tDeYC`，record 在产品表命中 | PASS |
| 集团运维页隐藏 Gate | `#ops` 切集团池：无「上线 Gate」、无 G1–G8 | PASS |
| 产品运维页保留 Gate | 产品池：Gate + G1–G8 正常 | PASS |
| 池指标口径 | `ops/metrics` 产品 `push 333/333/0 100%`、集团 `191/191/0 100%`；UI 同样 333/333、191/191 | PASS |
| 遗留观察 | 集团运维页「失败作业」仍列出 41 条历史 `base_push`（`max_attempts_reached`），与 100% 成功率并存；属历史明细未清理，非数据缺陷 | OBS |

证据：`evidence/I-02-group-base-link-fixed.png`、`evidence/J-03-ops-group-no-gate.png`、`evidence/J-04-ops-product-gate.png`
