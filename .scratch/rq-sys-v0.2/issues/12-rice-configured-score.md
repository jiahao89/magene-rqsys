# 12: RICE按获批量纲计算并保留版本

**What to build:** 产品组配置周期、单位和映射后，完整人工输入能得到可复算RICE分数及历史。

**Blocked by:** 11 详情Beta入口保存RICE人工草稿

**Status:** implemented-local（2026-10-25：用户授权按“简单好用”定 rice-v1 量纲——Reach 人次/月、Impact 三档 1/2/3、Confidence 百分比 0–100、Effort 人周；计算 R×I×(C/100)÷E 保留 1 位小数；两仓全量验证）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S04](../../../specs/rq-sys-v0.2/04-rice-beta.md)

**Execution gate:** G-RICE：产品组确认周期/单位/档位后启用正式计算；未确认仍可交付11的草稿功能。

## Acceptance criteria

- [x] V02-T12-AC01：显式维护版本化Reach周期/单位、Impact映射、Confidence表示和Effort单位；不得假定常见档位已获批。
- [x] V02-T12-AC02：使用R×I×归一化C÷E，百分比转0到1，E必须大于0。
- [x] V02-T12-AC03：缺项、非法/非有限值、非法档位或量纲不一致显示待补充/配置错误，不输出NaN/Infinity或0分兜底。
- [x] V02-T12-AC04：记录输入、计算值、配置版本、需求来源版本及actor；保留旧版本解释能力。
- [x] V02-T12-AC05：配置或需求变化不自动重算旧评分，提示人工复核。
- [x] V02-T12-AC06：不改变主P0–P3、AI建议、Base投影和通知；不增加正式跨需求排名。

## Verification

手工可复算案例通过评分读写接口验证，覆盖百分比、投入零/负值、配置更新及Beta隔离。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 共享模块 `beta/rice.ts`（SHARED 对齐 28/28）：rice-v1 常量/单位/三档 Impact/computeRiceScore。
- 路由 GET /rice-draft：状态 已计算/待补充，返回 score、configVersion、units、impactLevels（PUT/存储不变——数值以字符串存，历史兼容）。
- 前端（两客户端）：数值输入（人次/月、%）、Impact 三档下拉、人周；保存后显示 RICE 分数与配置版本。
- 测试：rice 单测（3 手工复算+8 非法拒绝）、HTTP（200×3×0.8÷4=120 已计算+configVersion）。
- 验证：root typecheck/API **443**/Web 81/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 **114**/build:prod 全绿。
- 明确不做（简单好用边界）：跨需求排名、多套档位配置后台。
