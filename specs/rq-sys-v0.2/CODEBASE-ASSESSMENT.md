# 当前代码勘查与结构方案（2026-10-23 已确认拆分）

> 代码观察快照：2026-10-22。文档发布：2026-10-23；本次未重跑代码验收。

本页允许给出具体代码位置用于核对快照；Spec和Ticket正文仅写模块职责/Interface与外部行为，避免将实现路径当长期契约。

## 已确认的代码基础

| 当前位置 | 2026-10-22 勘查时静态观察 | 采用方式 |
|---|---|---|
| `apps/api/src/domain/persistence.ts` | 需求有RQ编号，但sourceConfigId/TB ID必有；来源配置只支持TB | 扩展需求记录的来源分支；保留TB配置单例，不为手工数据伪造来源配置 |
| `apps/api/src/adapters/postgres/repositories.ts` | 平台号已有事务锁分配；setOwner只更新状态，不持久化传入人员身份 | 复用编号锁；补需求级分配持久化与历史，保留原TB人员映射用途 |
| `apps/api/src/http/app.ts` | 有列表/详情/owner/push/analysis retry，无手工创建/编辑；owner会upsert TB人员映射 | HTTP保持接入职责，新命令交给需求模块；手工/需求级分配不复用全局TB映射写入 |
| `apps/api/src/server.ts`与妙搭`server/rqsys/runtime.ts` | analysis/push handler读取TB source配置，空source会报错 | 共同的工作流/安全输入准备来源无关；启动、driver、fixture、worker生命周期保持适配 |
| `apps/api/src/pipeline/advance.ts` | 就绪依赖pull=synced，负责人取TB映射 | 来源收录就绪判定通用化；手工已收录和显式分配无需走TB查询 |
| `apps/api/src/base/client.ts`与`base/transport.ts` | 当前按TB ID查找，RQ号附加写；已有PM快照保护/类型处理 | 加平台键优先与旧行兼容，不新建第二个Base集成模块 |
| `apps/api/src/base/push-service.ts` | 旧owner从历史源快照和可变映射反推；通知含D-12，部分事件仅按源版本 | 增加稳定分配版本/历史；按当前Base负责人选人，分析事件含分析版本，覆盖分段写入重试 |
| `apps/api/src/analysis/contract.ts` | 已有PII过滤、证据检查、受控模块/整体置信度/UMSC，尚无人群 | 有版本地扩展，旧输出兼容；不把整条需求或人员词典发送模型 |
| `apps/api/src/analysis/priority-rule.ts`与`contracts/rules.ts` | 四维映射求和；阈值schema限制0–4；和PRD公式存在冲突 | 规则版本标识公式；产品确认前保留空优先级，不硬套成本C |
| `apps/api/src/sync/service.ts` | 2026-10-22 快照：当时 commit 按规范化标题丢弃不同 TB ID（**已被 2026-10-23 产品确认与 V02-T15 取代：现仅写 `duplicate_of_requirement_id` 提示，不删除、不合并**） | 与AGENTS冲突，单列15；2026-10-22 勘查时不改代码或历史数据；T15 已 implemented-local |
| `apps/web/src/panels.tsx` | 约1405行，混合需求池/详情/配置等功能 | 新需求表单/详情扩展按feature抽出，原panel保持组装入口；不全站重写 |
| `rq-sys-miaoda/client/src/rqsys/` | 有独立工作台与backendFetch/平台人员解析 | 业务视图/DTO与根仓对齐，平台请求前缀/人员SDK保留适配 |
| `scripts/check-repo-alignment.mjs` | 仅声明的shared严格比较；很多核心文件允许有平台差异 | 新业务模块加入shared；允许差异的路由/仓储也要执行同一行为契约用例，不能只靠分类通过 |
| `database/migrations/0004*`、`0005*` | 有先可空、再回填/约束的RQ编号迁移文件 | 不推断已在线执行；16先查目标实际状态，再兼容迁移 |

## 建议新增/收敛职责

下列是实施导航，具体文件数量由实现者按职责控制：

- `requirements`模块：需求命令（创建/编辑/幂等/事务）和来源无关的处理准备；内部组合已有仓储、分析、owner及push能力。对外接口覆盖完整收录/修改行为，避免每字段一个模块。
- `owner`模块：保留TB人员映射，新增需求级分配与分配版本；两者不能混成一张全局映射表。
- `contracts`：新增需求创建/编辑/确认标签与Beta执行校验，HTTP和前端DTO从唯一OpenAPI契约对齐。
- `analysis`：扩展受控类型/人群契约和旧输出读取；共享隐私过滤与provider，不分叉两个主分析引擎。
- `beta/rice`：独立输入、配置、结果与历史；`beta/kano`：独立材料、运行与报告。复用现有任务基础设施与外部provider，不新增自动调度。
- 前端`features/requirements`：新建/编辑、详情和Beta子视图；`api`保留通用请求/错误处理，妙搭继续经backendFetch及可信平台人员解析。
- 仓储仅在2026-10-22 勘查时需修改的需求/分配/Beta范围按对象提取，保留现有其他仓储；SQL/Drizzle两种driver不强行统一。

## 保持的架构

TypeScript模块化单体＋PostgreSQL＋既有worker/恢复机制＋React/HeroUI；根仓为规范源，妙搭仓为运行时投影。无需引入微服务、全量插件连接器、事件总线平台、CQRS框架或RAG基础设施。

## 可复用验证基础

- 根仓HTTP负责人/主应用、pipeline推进、sync orchestrator、Base push及真实PostgreSQL集成用例。
- 前端需求面板/详情刷新/路由/深链用例。
- 妙搭scripts中的controller-route、sync-analysis-routing、base-push、worker-drain、analysis-redaction等行为用例。
- 2026-10-22 勘查时仅读取上述用例及代码，没有执行它们；本页不是新一次MVP全量验收报告。
