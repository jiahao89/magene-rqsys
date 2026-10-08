# [blocked: 00, 05, 06, 07] 08 — 每周定时同步、重试与审计

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

## Blocked by
Ticket 00’s target scheduler POC and Tickets 05–07’s vertical slices remain prerequisites for target acceptance. Per user-approved scope, the platform-neutral scheduler/retry/audit worker code may be implemented and tested locally first.

## Approved partial scope and local evidence (2026-10-08)
- User approved local-only development of pure-code scheduling, retry, and audit modules while target Miaoda remains unverified. Do not represent this as configured or running in Miaoda.
- Local runtime is not durable without a configured PostgreSQL database; no DATABASE_URL/.env is configured in this workspace. Local liveness passed and readiness correctly returned HTTP 503.
- No target schedule, background worker, retry execution, or target-environment audit persistence has been implemented or verified yet. Target acceptance remains blocked.
