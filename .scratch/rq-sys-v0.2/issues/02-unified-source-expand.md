# 02: 扩展统一来源身份并读回现有TB记录

**What to build:** 现有需求可看到来源类型和稳定平台编号，数据结构允许手工来源；所有既有TB记录、版本和关联完整保留。

**Blocked by:** 01 收敛共同工作流入口并保持TB行为

**Status:** implemented-local（2026-10-24：迁移 0009 + 两仓实现 + 全量本地验证；目标环境迁移/发布留给 16，未执行）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T02-AC01：新增迁移扩展来源类型、手工可空TB字段、业务渠道/最小上下文字段及来源分支约束；来源配置仍只管理TB项目。
- [x] V02-T02-AC02：TB来源仍按原项目内TB ID唯一；手工来源不需要来源配置、不使用假TB ID或fake sync batch。
- [x] V02-T02-AC03：平台编号复用同一事务分配机制，跨TB/手工不碰撞，不重编号旧记录；回填只处理缺失值。
- [x] V02-T02-AC04：建立创建/编辑请求幂等回执与可靠提交事务能力，预留需求级分配版本和人工标签的独立保存能力。
- [x] V02-T02-AC05：列表/详情DTO采用加法兼容返回来源类型/收录状态，TB显示已同步；手工预留已收录语义，无TB链接兜底拼接。
- [x] V02-T02-AC06：现有UI可读新增字段，未知可选值正常展示；混合来源分页、负责人检索、统计与fixture排除不依赖首条来源配置，手工空TB ID不漏计，旧深链保持。
- [x] V02-T02-AC07：先扩展和验证约束，后续切片再开启手工写入；根SQL迁移和妙搭schema契约对应，不改已应用迁移。
- [x] V02-T02-AC08：同步更新唯一业务OpenAPI及两仓执行契约；记录旧运行时兼容范围和回滚限制。

## Verification

真实本地PostgreSQL升级前后TB样本对比、同一编号分配器并发用例、API/列表读回；目标迁移留给16。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-24 实施记录

- 迁移：`0009_extend_requirement_source.sql`（source_type/source_channel/可空 TB 身份/分支 CHECK/pull collected/回执表）；本地库与集成 schema 均验证。
- 代码：persistence/workflow/transitions/test-fixture/push-service/owner-recheck/processing（SHARED 镜像）+ 两仓 repositories（mapper、统计修正、手工收录事务方法）+ 两仓 app.ts（DTO+空源守卫）+ 妙搭 schema.ts。
- 前端：两客户端 collected=已收录 标签与筛选、手工行"手工"角标、详情来源注记动态化、API 类型加法。
- 验证：root typecheck/API **413**/Web 79/build/对齐 **26/26**/契约 20 通过/`diff --check` 全绿；妙搭 type:check/路由 **108**/build:prod/eslint 全绿；集成测试新增 2 例（事务收录+幂等重放+共享编号+统计含手工行；分支约束+同标题手工独立）。
