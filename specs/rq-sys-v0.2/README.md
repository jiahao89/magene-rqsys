# RQ-Sys V0.2 Spec 索引

> 状态：target-verified（V02-S06评分v2于2026-10-28完成目标验收；合成RQ-000343已清理）。用户于 **2026-10-23** 确认测试接缝与7份Spec、22张Ticket拆分；**2026-10-27** 确认评分v2，新增V02-S06及T19–T22。
> 此状态表示规格已确认；任务实施、产品参数确认和目标环境验收分别记录，功能尚未因此标记完成。

## 工作流和要解决的问题

TB同步和Web新建需求汇入统一需求池，复用保存版本 → 主AI → 负责人 → Base → 通知。主优先级继续使用U/M/S/C；RICE/Kano位于详情次级Beta入口，手动运行并与主流程隔离。

## 产品与代码基线

- [V0.2 PRD](../../docs/2026-10-21-rq-sys-v0.2-prd.md)：2026-10-27 修订稿；评分 v2 的公式、阈值、α 和人工改分口径已由用户确认。RICE/Kano 等其它参数仍按各自门槛。
- [MVP规格](../rq-sys-mvp/README.md)与当前MVP PRD控制未被V0.2明确扩展的行为；[当前领域词汇](../../CONTEXT.md)与[UI规范](../../design.md)继续适用。
- 代码勘查快照：根仓main `a3e7b5fa556fd28412ceea3e6a3627e519c139a1`；妙搭sprint/default `7d77dcf9a04374ea0b6babfd8dbb5a42d02d5162`。此为2026-10-22静态观察，不代表当前Online或远端状态。
- [Tickets索引](../../.scratch/rq-sys-v0.2/issues/README.md)：22张本地任务（18张原V0.2 + 4张评分v2扩展），带依赖、验收条件与执行门槛。原MVP tickets保留原状态。

## 规格目录

| ID | 文件 | 负责的问题 |
|---|---|---|
| V02-S00 | [00-unified-requirement-foundation](00-unified-requirement-foundation.md) | 统一需求身份、来源、数据归属与共同模块职责 |
| V02-S01 | [01-manual-intake-and-edit](01-manual-intake-and-edit.md) | Web新建、编辑、需求级模块与负责人 |
| V02-S02 | [02-main-analysis-and-audience](02-main-analysis-and-audience.md) | 主AI、六层人群与版本化U/M/S/C规则 |
| V02-S03 | [03-base-and-notifications](03-base-and-notifications.md) | 平台键兼容迁移、Base字段保护与通知 |
| V02-S04 | [04-rice-beta](04-rice-beta.md) | 可选RICE人工草稿、配置与确定性计算 |
| V02-S05 | [05-kano-beta](05-kano-beta.md) | Kano访谈证据、手动运行与AI假设报告 |
| V02-S06 | [06-ai-scoring-and-priority](06-ai-scoring-and-priority.md) | AI直接评分、九项输入+α、v2公式与人工改分 |

## 实施前按需阅读

- 修改数据结构/模块职责：[代码勘查与结构方案](CODEBASE-ASSESSMENT.md)、[字段归属](FIELD-OWNERSHIP.md)。
- 修改API/状态：[契约与状态方案](CONTRACT-AND-STATES.md)。业务API的唯一契约仍是[现有OpenAPI](../rq-sys-mvp/openapi.yaml)，实施时增量更新；本目录没有并行API真相源。
- 领取条件任务、目标迁移/发布：[决策与门槛](DECISIONS-AND-GATES.md)。

## 已确认的解释

1. 不同来源ID的同标题需求独立保留；来源去重与请求幂等负责不同问题。现有标题过滤偏差由V02-T15单独修正。
2. Web保存录入模块，AI保存建议，Base持有PM确认模块和业务处理值；手工需求级分配不污染全局TB人员映射。
3. U/M/S/C 评分 v2 已由用户于 2026-10-27 确认：AI 直接给九项输入和 α，PM 可改单项/α；综合分与 P0–P3 由服务端按固定公式计算。旧 v1 求和规则保留历史兼容；规则未发布时优先级仍留空，RICE/Kano 不参与主评分。
4. 兼容迁移先扩展/核对回填，再停止旧writer并切Base平台键；开启手工来源前两仓与worker都须理解新契约。

## 已确认的测试接缝

主接缝使用现有受保护应用HTTP入口，配真实仓储和正常worker，在既有外部AI/Base适配处提供受控实现，验证最终需求、快照、状态、Base投影及通知事件。数据库约束/锁/并发另用真实PostgreSQL独立schema验证，UI沿用实际表单与详情入口。

目标妙搭、模型、POC Base独立回读和测试账号收件分别留证；根仓本地测试不代替目标验收。每张功能任务自行完成相关本地验证与双仓对齐，16–18与22汇合目标证据。

## 范围与发布条件

核心发布、Beta、v1新规则与评分v2分别验收：核心16不依赖可选Beta17、v1规则18或评分v2（T19–T22）。公式参数见V02-S06；RICE单位/档位、资料批准与实际目标写入授权未决时，按门槛记录，不伪造配置或验收通过。

## 审阅和来源记录

- [已确认的历史审阅包](../../.scratch/rq-sys-v0.2/review/README.md)保留原草案作为追溯；当前规格以本目录为准。
- [需求处理流程](https://aimagene.feishu.cn/wiki/JEyLwBYOziz0bPknDSgcjhuTn9g)
- [六层人群模型](https://aimagene.feishu.cn/wiki/F3Rkwm32OifrYlkIXe2cT8JQntf)
- [访谈总结](https://aimagene.feishu.cn/wiki/Qp5Xwo5U6iDpRckjjFecYy9FnPe)

本次仅发布本地规划文档与任务入口；实际开发和目标环境操作由对应任务及项目授权约束控制。
