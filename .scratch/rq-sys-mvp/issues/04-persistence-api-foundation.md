# [blocked] 04 — 持久化领域模型与服务端 API 基础

## 目标
建立可持久追踪同步、分析、映射、推送和审计的服务端数据/接口基础，供后续纵向切片复用。

## 当前工作区已有基础
- PostgreSQL 初始 DDL：`database/migrations/0001_initial.sql`
- API 契约：`specs/rq-sys-mvp/openapi.yaml`
- TypeScript API/Teambition 适配器骨架：`apps/api/`

以上仅是平台中立的本地骨架，不代表妙搭数据库、身份、调度或后台任务已验证；完成本票仍须通过 Ticket 00 的目标环境门槛。

## 范围
- 按 Spec 00 建模 source config、batch/item、requirement map/snapshot、analysis version、person map、PM snapshot、workflow history/audit。
- 使用 Ticket 00 验证过的妙搭持久化方案；约束唯一键为 Teambition project ID + requirement ID。
- 提供带权限校验和安全错误的服务端 API 骨架；凭据只由服务端读取。
- 记录状态迁移，不允许 AI 建议覆盖人工确认字段。

## 验收标准
- 数据对象及字段所有权与 Spec 00 一致，重复写入具备幂等约束。
- API 错误不回显密钥、个人敏感信息或 provider 原始敏感响应。
- 写操作能审计 actor、对象、动作、结果与时间。
- 数据库与部署配置基于 Ticket 00 的实测结论，不假设本地文件长期持久。

## Blocked by
Ticket 00 remains a blocker for target Miaoda implementation and acceptance. Per user-approved scope, local platform-neutral API/schema work may proceed without claiming the MVP ticket complete.

## Local evidence (2026-10-08)
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm test` passed: 3 tests, 0 failures. Tests cover current liveness/readiness behavior and explicit 501 for an unimplemented product endpoint; business CRUD APIs remain unimplemented.
- Local runtime check: `GET /api/health` returned HTTP 200 with `{"status":"ok","service":"rq-sys-api"}`. `GET /api/health/ready` returned HTTP 503 with `{"status":"not_ready","reason":"database_unavailable_or_not_configured"}` because no local DATABASE_URL/.env is configured.
- Added local-only deployment guidance at `deployment/MIAODA-LOCAL-AND-TARGET-RUNBOOK.md` and expanded `.env.example` with server-side placeholder variables. No secret values were added.
- No target Miaoda DB, identity, scheduler, or background task was configured or tested. No deploy/release or target write was performed.

## Approved partial scope
User approved proceeding with platform-neutral local code for Ticket 04 and the pure-code components of Ticket 08 while Ticket 00 and Spark write authorization remain blocked. Target-environment acceptance remains blocked.

## Local implementation evidence (2026-10-08)
- 持久化领域模型落地：`apps/api/src/domain/persistence.ts` 与 DDL 13 张表一一对应的 TS record 类型（source config、sync batch/item、requirement、source snapshot、analysis run、person mapping、pm snapshot、base push run、module dictionary、priority rule、pipeline job、audit event），可空列统一 `| null`，唯一性约束以注释对齐 DDL。
- 状态迁移规则落地：`apps/api/src/domain/transitions.ts` 定义 pull/analysis/owner/push 合法迁移表与 `canTransition`/`assertTransition`；`applyAutoOwnerSuggestion` 保证自动映射不覆盖 `manually_mapped`；`isPushEligible` 保证低置信/缺优先级/首轮 AI 失败不阻塞合格推送。
- 安全错误 envelope 落地：`apps/api/src/http/errors.ts` 错误码注册表（与 openapi 错误契约对齐）、`redactSecrets` 输出前脱敏密钥/Bearer/联系方式（保留 UUID 资源标识符）、`safeProviderError` 保证 provider 原始错误永不回显；`http/app.ts` 501 路由已接入统一 envelope。
- 持久化 repository 端口落地：`apps/api/src/application/repositories.ts` 覆盖 13 张表的切片所需操作（含幂等读取、租约 claim、追加只读）；`contracts/pipeline.ts` 补齐 openapi 请求体/查询参数 zod schemas。
- 验证：`npm run typecheck`、`npm test`（62 测试通过，0 失败）、`npm run build` 全部通过。新增测试覆盖状态迁移合法性、AI 不覆盖人工字段、推送资格不变量、密钥脱敏与 provider 错误不回显。
- 边界：业务 CRUD HTTP handlers、身份 provider、PostgreSQL repository 实现仍由对应 tickets 在 Ticket 00 验证后实现；本票目标验收保持 blocked。

## Review and fix evidence (2026-10-08)
- 双轴代码审查后补齐错误契约：openapi.yaml components 新增 Error schema（{error:{code,message}}）与各错误响应 content（BadRequest/Unauthorized/Forbidden/NotFound/Conflict/InternalError/RouteNotImplemented/ServiceUnavailable），PUT sources/{id} 与 PUT requirements/{id}/owner 接线 401/403。
- contracts/pipeline.ts 严格度与契约对齐：移除契约没有的 minLength/min(1)（tbUserId/tbDisplayName/cursor/entityId），since/until 用 `z.iso.datetime({ offset: true })` 接受 date-time 允许的偏移量。
- audit 事件模型合并为单一 DDL 对齐形状（AuditEventRecord），消除 audit/event.ts 与 application/repositories.ts 的双轨抽象。
