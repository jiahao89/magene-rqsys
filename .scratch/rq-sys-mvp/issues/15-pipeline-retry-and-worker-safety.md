# [blocked: 12, 14] 15 — Pipeline 幂等、重试与 Worker 租约安全

## 目标

确保同步、分析和 Base 推送作业在失败、并发和 worker 重启时可安全恢复，不丢任务、不重复副作用，也不让过期 worker 覆盖新执行结果。

## 依据

- `specs/rq-sys-mvp/05-platform-reliability-security.md`
- `specs/rq-sys-mvp/00-foundation-and-data-contract.md`
- `specs/rq-sys-mvp/01-teambition-sync.md`

## 范围

- 修复 pipeline job 认领与完成协议：持久化 claim token/attempt 或等效 fencing 信息，complete/reschedule 必须匹配当前有效 claim；过期 worker 不得提交结果。
- 修复失败 Base push 的幂等重试：同一个业务版本的已失败记录必须允许安全重试；不能将失败记录短路为 pushed，也不能产生重复 Base 行。
- 修复 sync batch 已建但 job 入队失败的恢复路径；重复相同幂等请求应能找回或重新排入同一可恢复批次，而不制造孤儿批次/重复批次。
- 将已有平台中立 due-job 生成接入 worker 执行边界，确保显式时区/周窗口产生的 job 可入队并幂等执行；本地轮询只作开发验证，不代表妙搭生产调度已接通。
- 所有阶段独立保留已成功结果；重试只重跑失败阶段，并对 actor、attempt、阶段、时间和安全错误做审计。
- 对同一 source 的活跃同步保持可靠互斥；不能只依赖 Web 前端禁用按钮。

## 验收标准

- 模拟 worker A 租约过期、worker B 重新认领后，A 的迟到 complete/reschedule 被拒绝且不覆盖 B 的状态。
- Base 首次失败后重试可成功；重复请求返回真实最终状态，不将 failed 误报成 pushed，不重复创建记录。
- 入队暂时失败后使用相同幂等键重试可恢复；数据库中无永久 running 且无对应 job 的批次。
- 分析失败/超时后，首次分析终态仍可继续推送；分析重试不会重跑已成功的同步或重复推送。
- 新增 job/repository/API 测试覆盖竞争与故障场景；有数据库实现的路径提供可运行集成验证说明，不连接未授权的外部数据库。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

## Blocked by

Tickets 12、14。妙搭 worker/scheduler 的实际耐久性验证属于 Tickets 00/09。
