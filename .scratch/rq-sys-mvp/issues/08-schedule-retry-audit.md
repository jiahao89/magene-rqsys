# [implemented-not-target-verified] 08 — 每周定时同步、重试与审计

## 目标
把已验证的手动流程可靠地交给妙搭调度，并支持故障恢复和操作追溯。

## 范围
- 配置每周同步时区和时间，支持启停和手动触发。具体执行时间由部署配置明确，不硬编码本地时区。
- 任务持久化，进程重启后可安全恢复；防止同一来源并发重复任务。
- 对同步、分析和 Base 推送提供各自独立重试；不重跑/回滚已成功阶段。
- 展示安全错误、重试记录、actor、时间、阶段、对象和结果。

## 验收标准
- 目标妙搭环境中实际触发至少一次周任务并提供运行证据。
- 重启/超时/单阶段失败后可重试且幂等；不会重复建 Base 记录或重复批次。
- 分析首轮终态后推送可继续，后续分析重试不阻塞。
- 用户可区分源同步、AI 分析、Base 推送三类状态；不显示无法证实的 Base PM 状态回读。

## Target verification remains
Ticket 00’s target scheduler POC and Tickets 05–07’s vertical slices remain prerequisites for target acceptance. Per user-approved scope, the platform-neutral scheduler/retry/audit worker code may be implemented and tested locally first.

## Approved partial scope and local evidence (2026-10-08)
- User approved local-only development of pure-code scheduling, retry, and audit modules while target Miaoda remains unverified. Do not represent this as configured or running in Miaoda.
- Local runtime is not durable without a configured PostgreSQL database; no DATABASE_URL/.env is configured in this workspace. Local liveness passed and readiness correctly returned HTTP 503.
- No target schedule, background worker, retry execution, or target-environment audit persistence has been implemented or verified yet. Target acceptance remains blocked.

## Local implementation evidence (2026-10-08, commit c80a711)
- Platform-neutral modules implemented and pushed: `apps/api/src/jobs/`（作业状态类型、claim/lease 决策纯函数、幂等键生成、内存存储适配器）、`apps/api/src/scheduler/`（显式时区 due 窗口计算、调度幂等键）、`apps/api/src/retry/`（阶段重试策略、错误分类、有界指数退避）、`apps/api/src/audit/`（zod 事件 schema、safe-detail 白名单脱敏、追加只读存储）、`apps/api/src/ports/`（clock/storage/execution 端口与确定性测试适配器）。
- 6 个不变量全部有测试覆盖，47 个测试通过（`npm test`），`npm run typecheck` 与 `npm run build` 通过。
- 不变量覆盖：每源一个活跃 run 且同幂等键不重复创建；重试只针对失败阶段并保留先前成功结果；过期 lease 可回收、有效 lease 内并发 claim 被拒绝；退避确定且有界；审计捕获 actor/action/object/outcome/timestamp 并脱敏密钥/联系方式/原始载荷；调度必须显式时区，非法时区/时间抛错而非静默回退。
- 边界：以上为本地纯代码验证，调度器/worker/重试引擎/审计持久化均未接入妙搭；目标接线与验收仍 blocked on Ticket 00。

## Review and fix evidence (2026-10-08)
- 双轴代码审查（Standards/Spec，基线 b46594b..94d1bc6）后完成修复：审计事件模型合并为单一 DDL 对齐形状（actorId/eventType/entityType/entityId/result/safeDetails/occurredAt，result 与 CHECK 枚举对齐，消除双轨抽象与词汇漂移）。
- 不变量 1 补全：claim 决策新增同 (sourceConfigId, teambitionRequirementId) 身份活跃互斥——不同幂等键（如新调度窗口或手动触发）在已有活跃 run 时不再创建重复工作；终态 run 同键拒绝、新键（下一窗口）可建新 run。
- 其他修复：contracts/pipeline.ts 严格度与 openapi 对齐（去掉契约没有的 minLength、`z.iso.datetime({ offset: true })` 接受偏移量）；scheduler/due.ts 窗口起点改用窗口时刻的时区偏移换算（跨夏令时回退边界不再偏移 1 小时，新增回归测试）；删除 scheduler/idempotency.ts 中间层与 in-memory-storage 死代码；jobs 层词汇与持久层对齐（sourceConfigId/teambitionRequirementId/queued/owner）；提取 lease 到期计算重复；统一 randomUUID 导入。
- 修复后 67 个测试全部通过，typecheck/build 通过。

## Latest local status (2026-10-10)

The earlier 2026-10-08 statement that scheduling/worker/retry/audit were not wired is historical and superseded for local code. PostgreSQL jobs, worker dispatch, fencing, source schedule calculation, retry APIs, safe audit persistence and local polling are implemented and locally verified. Local polling is development-only; durable Miaoda automation, restart/recovery and audit persistence are not target-verified under Tickets 00/09.
