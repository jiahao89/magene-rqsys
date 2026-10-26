# RQ-Sys V0.2 Tickets

> 拆分已于2026-10-23由用户确认并发布至本地tracker。共18张Ticket；**全部完成**（2026-10-25）：01-15 implemented-local、16-18 target-verified。T16-AC05/AC06 的登录态交互点检（建单/指派）留用户统一验证。

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
| V02-T09 | [PM修改人群并保留人工确认](09-audience-confirmation.md) | implemented-local | 08 | 核心 |
| V02-T10 | [确认并实现版本化U/M/S/C规则](10-priority-rule-calibration.md) | implemented-local | — | 规则条件 |
| V02-T11 | [详情Beta入口保存RICE人工草稿](11-rice-beta-draft.md) | implemented-local | 02 | Beta |
| V02-T12 | [RICE按获批量纲计算并保留版本](12-rice-configured-score.md) | implemented-local | 11 | Beta |
| V02-T13 | [Kano选择获批访谈资料版本](13-kano-evidence-snapshots.md) | implemented-local | 02 | Beta |
| V02-T14 | [手动Kano生成证据化假设报告](14-kano-report.md) | implemented-local | 08、13 | Beta |
| V02-T15 | [对齐同标题不同TB ID的保留规则](15-source-id-invariant.md) | implemented-local | — | 核心 |
| V02-T16 | [核心V0.2兼容迁移与目标验收](16-core-target-acceptance.md) | target-verified（迁移+发布+读回完成；2026-10-26 登录态点检发现 F-09 Base 幂等缺陷，AC05/06 待修复发布后复验） | 05、06、07、09、15 | 验收 |
| V02-T17 | [RICE与Kano Beta独立目标验收](17-beta-target-acceptance.md) | target-verified（Kano 真实模型运行+报告抽检通过；2026-10-26 目标 UI RICE=120 与 Kano 报告点检完成） | 12、14、16 | 验收 |
| V02-T18 | [获批U/M/S/C规则目标验收](18-priority-target-acceptance.md) | target-verified（规则 v1→P2 落 Base 回读通过） | 10、16 | 验收 |

## 当前可领取的前沿

- **核心链路 01-09 与 15 全部 implemented-local（2026-10-24/25）**。**18 张工单全部收口（2026-10-25）：01-15 implemented-local、16/17/18 target-verified。2026-10-26 登录态目标点检发现并本地修复阻断缺陷 F-09（限流装饰器漏转发平台键查找，手工需求重复推送新建 Base 行）；T16 AC05/06 待修复发布后复验，详见 [验证报告](../verification-20261026/VERIFICATION-REPORT.md)。**
- **15** 已于 2026-10-23 实现为"同标题仅提示、独立处理"（implemented-local；AC04 计数拆分与 AC06 联合回归待后续票补齐，正式结论汇合到 16）。
- **10** 规则确认包已备（见票内链接）；新算法实施仍等待 PM Leader 确认输入、公式、阈值和校准案例。
- 02完成后，08、11、13可与03→04分支独立推进；实际开发先协调共享契约和仓储的文件归属。

## 依赖顺序

核心：01→02→03→04；04后05/06/07，02后08→09，汇合独立15到16。

Beta：02→11→12；02→13与08汇合到14；12/14与16汇合到17。

规则：10与16汇合到18；未批准新公式时核心可继续空优先级交付。

## 产品和目标门槛

来源ID原则和Web录入模块/Base确认模块的归属已确认。U/M/S/C公式、RICE量纲、获批去标识访谈资料以及目标环境写入授权尚需按[门槛表](../../../specs/rq-sys-v0.2/DECISIONS-AND-GATES.md)处理，不能将本次同意拆分解释为这些参数或生产发布已获批。

## 追踪与证据

[Spec索引](../../../specs/rq-sys-v0.2/README.md)、各票稳定AC编号及[历史审阅包的PRD追踪表](../review/README.md)共同提供追踪。历史草案不作为当前状态；本目录与票内状态同步。机器可读依赖见[manifest.json](manifest.json)。

本次文档发布只检查文件、链接、Spec章节、AC数量、状态和依赖无环，不作为代码测试、功能实现或线上验收证据。
