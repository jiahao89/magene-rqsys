# 04: 最小新建需求贯通AI与Base

**What to build:** 用户填写标题、描述、渠道后获得平台编号，并自动进入AI→空负责人Base推送；同请求重试仍为同一条需求。

**Blocked by:** 03 按平台编号复用Base旧TB行并安全切换

**Status:** implemented-local（2026-10-25：POST 收录路由 + 事务化审计 + 幂等回执契约 + 两端表单，两仓全量验证；目标链路验收按 16 执行）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S01](../../../specs/rq-sys-v0.2/01-manual-intake-and-edit.md)、[V02-S03](../../../specs/rq-sys-v0.2/03-base-and-notifications.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T04-AC01：需求池有可用新建入口，只要求标题、描述和渠道；四段提示不变成额外必填。
- [x] V02-T04-AC02：可信登录actor、服务端时间、来源类型web_manual及RQ编号由系统生成；客户端身份/编号无效。
- [x] V02-T04-AC03：同一次提交保留幂等键；同actor/操作/键同payload返回同一结果，同键不同payload明确冲突。
- [x] V02-T04-AC04：需求、首快照、审计、回执与分析作业原子提交；入队失败不留下已收录却永久无任务的需求。
- [x] V02-T04-AC05：首次AI成功/失败/超时终态后均能继续无负责人Base推送；来源配置为空不触发TB依赖错误。
- [x] V02-T04-AC06：列表/详情正确显示已收录、AI和推送独立状态及平台编号，手工需求无TB地址、无伪同步批次。
- [x] V02-T04-AC07：同标题另一次有效创建允许独立需求；重复同幂等请求不多占编号或多建Base行。
- [x] V02-T04-AC08：表单有等待、错误恢复、成功详情和键盘可操作状态；新界面按需求功能局部拆出，遵循现有设计系统。

## Verification

应用API＋真实仓储/worker＋受控AI/Base贯通，UI提交及失败重试；目标链路16独立验收。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 契约：`RequirementIntakeSchema`（标题/描述/固定六渠道枚举）+ OpenAPI POST /api/requirements（201/200 重放/400/409/503）。
- 仓储：审计 intake.created 移入创建事务（两仓 SQL 镜像）；重放返回真实平台编号。
- 路由：POST /api/requirements（两仓）——actorFor 鉴权、幂等键校验、请求哈希绑定、回执命中优先、创建失败 503。
- 前端：`createRequirement` API（默认 backendFetch/键可注入）+ `IntakeForm`（两仓同构）挂载需求池；失败重试复用同一幂等键、成功后刷新列表并打开详情。
- 测试：root app.test +2（服务端 actor/同键同内容重放/同键异内容 409；缺键/未知渠道/缺描述 400）、集成 +1 断言（事务内审计行）、Web +2（提交载荷与键、失败重试键不变）；妙搭路由 +1（创建+服务端 actor+同键重放）。
- 验证：root typecheck/API **424**/Web **81**/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 **109**/build:prod/eslint 全绿。
- 未做（按最小切片）：创建时选择模块/负责人（T06）、编辑（T07）、补充上下文字段（T05）。
