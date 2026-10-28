# RQ-Sys V0.2 Tickets

> 拆分已于2026-10-23由用户确认并发布至本地 tracker；2026-10-27 用户确认评分v2并新增T19–T22，共24张 Ticket。**原18张V0.2范围已收口**：01–08、10–15 为 implemented-local，09、16–18 为 target-verified；**评分v2扩展T19–T22均为target-verified**（合成RQ-000343已验证并清理）。T16 AC05 按用户确认使用正式 Base 验收；AC06 的 PM 快照失败路径采用本地故障注入，负责人变更通知由获批准的测试收件人确认送达。多 weekday 周计划已实现并发布，目标配置为周一/三/五 09:00；恢复触发器已于 2026-10-28 09:04 启用；09:00窗口scheduled批次于09:43:34迟到执行、315/315成功。评分v2目标验证与清理已完成；T23 详情摘要评分卡与 AI 评分分析整合已完成目标验证并清理；T24 总览优先级分级统计已完成目标只读验证。详见[验证报告](../verification-20261026/VERIFICATION-REPORT.md)。

## 使用方式

1. 阅读[V0.2 PRD](../../../docs/2026-10-21-rq-sys-v0.2-prd.md)、[Spec索引](../../../specs/rq-sys-v0.2/README.md)、相关编号Spec和[决策门槛](../../../specs/rq-sys-v0.2/DECISIONS-AND-GATES.md)。
2. 只领取代码前置已完成且Execution gate满足的任务。ready-for-agent不表示依赖已经满足。
3. 每张任务完成其schema/API/UI/行为验证及两仓对齐；更新本票Status和本索引行，附证据。未取得目标证据时标记“已实现，未在目标环境验证”。
4. GitHub是代码源，任务仍在本地Markdown管理；旧MVP任务不关闭、不重编号。

## Ticket list

| ID | 任务 | Status | Blocked by | 分支 |
|---|---|---|---|---|
| V02-T01 | [收敛共同工作流入口并保持TB行为](01-workflow-prefactor.md) | implemented-local | — | 核心 |
| V02-T02 | [扩展统一来源身份并读回现有TB记录](02-unified-source-expand.md) | implemented-local | 01 | 核心 |
| V02-T03 | [按平台编号复用Base旧TB行并安全切换](03-platform-base-key.md) | implemented-local | 02 | 核心 |
| V02-T04 | [最小新建需求贯通AI与Base](04-manual-intake-minimal.md) | implemented-local | 03 | 核心 |
| V02-T05 | [补齐精简需求上下文并展示来源](05-manual-definition-context.md) | implemented-local | 04 | 核心 |
| V02-T06 | [需求级选择模块与负责人并通知分配人](06-direct-owner-and-module.md) | implemented-local | 04 | 核心 |
| V02-T07 | [手工编辑需求保留版本并安全更新Base](07-manual-edit-versioning.md) | implemented-local | 04 | 核心 |
| V02-T08 | [主AI增加需求类型与六层人群建议](08-analysis-audience-contract.md) | implemented-local | 02 | 核心 |
| V02-T09 | [PM修改人群并保留人工确认](09-audience-confirmation.md) | target-verified（多选/空集/AI 重跑保留/版本审计/无 Base 副作用均已在目标复核） | 08 | 核心 |
| V02-T10 | [确认并实现版本化U/M/S/C规则](10-priority-rule-calibration.md) | implemented-local | — | 规则条件 |
| V02-T11 | [详情Beta入口保存RICE人工草稿](11-rice-beta-draft.md) | implemented-local | 02 | Beta |
| V02-T12 | [RICE按获批量纲计算并保留版本](12-rice-configured-score.md) | implemented-local | 11 | Beta |
| V02-T13 | [Kano选择获批访谈资料版本](13-kano-evidence-snapshots.md) | implemented-local | 02 | Beta |
| V02-T14 | [手动Kano生成证据化假设报告](14-kano-report.md) | implemented-local | 08、13 | Beta |
| V02-T15 | [对齐同标题不同TB ID的保留规则](15-source-id-invariant.md) | implemented-local | — | 核心 |
| V02-T16 | [核心V0.2兼容迁移与目标验收](16-core-target-acceptance.md) | target-verified（AC01–10 全部通过；AC05 正式 Base 例外，AC06 含 A→B、重复静默、PM 快照失败本地注入与史东升送达确认） | 05、06、07、09、15 | 验收 |
| V02-T17 | [RICE与Kano Beta独立目标验收](17-beta-target-acceptance.md) | target-verified（Kano 真实模型运行+报告抽检通过；2026-10-26 目标 UI RICE=120 与 Kano 报告点检完成） | 12、14、16 | 验收 |
| V02-T18 | [获批U/M/S/C规则目标验收](18-priority-target-acceptance.md) | target-verified（规则 v1→P2 落 Base 回读通过；2026-10-26 AC01–06 按证据补勾） | 10、16 | 验收 |
| V02-T19 | [AI评分契约与U/M/S/C v2计算规则](19-score-contract-and-rule-v2.md) | target-verified | — | 评分v2 |
| V02-T20 | [PM修改单项评分与α](20-score-manual-edit.md) | target-verified | 19 | 评分v2 |
| V02-T21 | [评分详情与人工编辑UI](21-score-detail-ui.md) | target-verified | 19、20 | 评分v2 |
| V02-T22 | [评分v2目标环境验收](22-score-target-acceptance.md) | target-verified（合成RQ-000343已清理） | 19、20、21、G-DEPLOY | 验收 |
| V02-T23 | [详情摘要评分卡与 AI 评分分析整合](23-detail-score-analysis-ui.md) | target-verified（合成RQ-000343已清理） | 21、22 | 评分v2 |
| V02-T24 | [总览页优先级分级统计与规则展示](24-overview-priority-distribution.md) | target-verified（只读指标回读） | 19、20、23 | 评分v2 |

## 当前状态

- 原 V0.2 18 张 Ticket 均已收口；评分v2扩展 T19–T24（含 T23 详情摘要评分卡、T24 总览优先级分级统计）均为 `target-verified`，合成数据已清理。状态与验收证据以本表和各票为准。
- 定时任务为运营配置，不作为 MVP 验收强关联项。多 weekday 已实现并发布（迁移 `0018`，release `7701156473946443015 / a603fed`）：Online 来源现为 **周一/周三/周五 09:00 Asia/Shanghai**，`weekdays=[1,3,5]`；恢复触发器 `rqsysWeeklySyncRecovery` 按方案 2 于 **2026-10-28 09:04** 启用（用户确认窗口 09:00–09:30）；09:40 复核首轮 scheduled 批次。配置更新后队列 0 queued/running，作业/批次未增加，未触发 scheduled 同步。
- 其他跟踪项：F-11 飞书 Base filter 曾出现瞬时 1254607，恢复重试后成功；F-08 前端包体仍有拆包优化空间；最近快照中的未映射负责人需求按现有流程待处理。详见[验证报告](../verification-20261026/VERIFICATION-REPORT.md)。
- 后续新增功能或改变已确认口径时，先更新 PRD/Spec/门槛，再新增 Ticket；不要沿用本页的历史依赖顺序当作待办状态。

## 依赖顺序

核心：01→02→03→04；04后05/06/07，02后08→09，汇合独立15到16。

Beta：02→11→12；02→13与08汇合到14；12/14与16汇合到17。

规则：10与16汇合到18；评分v2：19→20→21，22在19–21完成后按G-DEPLOY执行目标验收；v2不改变原18张的收口状态。

## 产品和目标门槛

V0.2 当前决定和执行例外已记入[门槛表](../../../specs/rq-sys-v0.2/DECISIONS-AND-GATES.md)及对应 Ticket：U/M/S/C 规则 v1 按用户授权的“简单好用”口径确认；2026-10-27 用户进一步确认评分v2（AI直接评分、PM可改单项/α、固定公式和阈值见V02-S06），G-UMSC产品阻塞已解除。RICE 量纲、Kano 资料与报告边界见 T12–T14；T16 记录了正式 Base 验收例外及目标测试收件确认。后续若治理要求增加独立审批或改变规则，需新建决策记录，不能把历史草案中的“待确认”直接当作当前阻塞项。

## 追踪与证据

[Spec索引](../../../specs/rq-sys-v0.2/README.md)、各票稳定AC编号及[历史审阅包的PRD追踪表](../review/README.md)共同提供追踪。历史草案不作为当前状态；本目录与票内状态同步。机器可读依赖见[manifest.json](manifest.json)。

本次文档发布只检查文件、链接、Spec章节、AC数量、状态和依赖无环，不作为代码测试、功能实现或线上验收证据。
