# 03: 按平台编号复用Base旧TB行并安全切换

**What to build:** 已有TB需求再次推送仍更新原Base行，逐步补平台键；后续无TB ID的需求也能用平台键创建。

**Blocked by:** 02 扩展统一来源身份并读回现有TB记录

**Status:** implemented-local（2026-10-24：双键解析/冲突结局/手工行可空 TB 键两仓落地并全量验证；目标 Base 切换与回填核对按 16 执行，未在目标环境验证）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S03](../../../specs/rq-sys-v0.2/03-base-and-notifications.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T03-AC01：Base先按平台编号定位，兼容窗口内TB才可按旧TB ID查唯一旧行并补平台编号。
- [x] V02-T03-AC02：两种键或已存recordId冲突/多行匹配时返回可追溯冲突，不新建或自动合并。
- [x] V02-T03-AC03：兼容切换不重置PM字段、不重编号、不发送仅因迁移产生的通知。
- [x] V02-T03-AC04：迁移和超时恢复先对账再决定创建；正常重放复用recordId。不能把Base无唯一约束的行为标为无条件exactly-once。
- [x] V02-T03-AC05：Base输入允许手工来源TB字段为空，TB地址只对TB需求生成或使用已验证规则。
- [x] V02-T03-AC06：源字段/平台字段/AI字段/PM字段映射分组清晰，保留模块单选省略及ID类型处理。
- [x] V02-T03-AC07：记录扩展、回填核对、停止旧writer、切换键与后续清理的可恢复顺序；本ticket只实施代码和本地证明。
- [x] V02-T03-AC08：根仓/妙搭使用同一键契约并通过平台键命中、旧行兼容、冲突和超时重放用例。

## Verification

真实push模块＋受控Base适配器；验证外部字段、原recordId和PM值。目标Base变更按16执行。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-24 实施记录

- transport：findByPlatformKey（Bitable v1 精确过滤，page_size=2 多行即冲突）；findByRequirementKey 多行改抛 BaseKeyConflictError；keyFields 可选 platformRequirementId。
- client：resolveExisting 双键解析（平台优先→TB 兼容→冲突）；BasePushInput.requirementId 可空（手工行跳过 TB 字段写入与 TB 查询）；findCurrentOwner 改用双键。
- push-service：TB 键可空传递；BaseKeyConflictError → denied 审计 + failed 运行记录 + conflict 结局（worker 终态跳过，数据修复后可手动重试）。
- 组合根：两仓 keyFields 注入「需求平台ID」。
- 测试：root client 26（+6：平台命中/兼容回填/双冲突/手工行/超时重放）、push-service 40（+2：冲突结局、手工行键传递）、transport 10（+1 平台过滤与多行冲突；1 处旧文案断言更新）；妙搭路由 108（1 处旧文案断言更新）。
- 验证：root typecheck/API 422/Web 79/build/对齐无未声明漂移/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 108/build:prod 全绿。
- 目标侧待办（16）：旧 TB 行平台键回填核对、全行带键后收窄 TB 兼容查询、POC 回读；本票未触碰目标 Base。
