# 2026-11-16 代码审查问题核实

针对“G1 无通知 / ID 类型 / /api/feishu/users 503 / v3 未实现”四项反馈逐条核实。

## 1. G1 人工分配无通知：真实缺陷，已修复并目标验证

根因（与假设一致）：
- Q1 空负责人推送成功后 `last_pushed_owner` 被清空；下次人工分配时旧快照里的 TB 执行人没有映射，`resolvePreviousPushOwner` 返回 `unknown`；
- `unknown` 不满足 `owner_assigned`（需要 none）也不满足 `owner_changed`（需要 known），通知被静默吞掉；
- 当时 Base 执行人写入成功、四个通知字段为空；审计无 `notification_write_failed`，排除写入失败。

修复：
- `computeNotification` 在 `previousOwner.kind === unknown` 时，以 Base 行当前负责人兜底（读不到才算 unknown）；空→有人能正确判为 `owner_assigned`；
- 新增单测“空负责人推送后、旧 TB 执行人无映射，再人工分配仍通知”；
- 目标环境验证（2026-11-16 12:53）：RQ-000323 人工分配后 Base `系统通知类型=已分配负责人`、事件 ID/收件人写入，飞书收到「需求通知：…已分配负责人」卡片（IM 搜索可查）。测试后已恢复需求与 Base 状态。

## 2. 人员绑定 ID 类型：生产 Miaoda 路径正确；根 Web 本地路径已修

- 妙搭客户端使用 `PlatformFeishuBinder`：平台通讯录搜索 → `/api/feishu/users/resolve` → 返回 **user_id**；生产绑定路径没有用错类型。
- 根 `apps/web` 的 `FeishuAccountBinder` 确实固定提交 `open_id`（本地开发路径）；已改为：搜索候选返回 `user_id` 时优先保存 `user_id`，否则回落 `open_id`（POC）。
- 线上 `person_mappings` 活跃记录全部为 `user_id`；仅 2 条 inactive 历史记录仍是 `open_id`，不影响负责人下拉。
- 之前 1254066 来自手工 API 用 `open_id` 直接分配，不是当前妙搭 UI 路径。

## 3. `/api/feishu/users` 503：真实但妙搭 UI 不调用

- Miaoda controller 只注入 `feishuUserSelections`，没有 `feishuUsers`，因此该端点返回 503；
- 该端点是根 Web/本地（`FEISHU_USER_ACCESS_TOKEN` 通讯录搜索）使用的路径；妙搭客户端的绑定组件使用平台通讯录 + `/api/feishu/users/resolve`，已核实 `rq-sys-miaoda/client/src/rqsys/panels.tsx` 使用 `PlatformFeishuBinder`。
- 结论：对当前生产 UI 无影响；若要让妙搭也暴露 `/api/feishu/users`，需平台侧提供按关键字搜索用户的 server SDK（当前 `AuthNPaasService` 只有按 ID 查询/转换）。

## 4. v3 规则：当前代码已实现（阈值可配置），但并非严格排名分位

- `priority-rule.ts` 现有 `umsc_weighted_v2` 与 `umsc_weighted_v3` 两个分支；v3 从规则 JSON 读取阈值（当前 p0=10 / p1=7.8 / p2=6），不再硬编码 45/25/10；v2 分支才固定 45/25/10。
- 线上已发布 rule v3（id `5fd4bbe2-d41f-4287-bc62-25d2319252b6`），330 条已重算采纳，G2 已通过。
- 仍存在的差距：v3 目前是**一次性阈值校准**，不是严格的“活跃池排名 + 5%/15%/30% 配额”自动重排；基准为模拟 PM（Top20 16/20=80%），不是真实 PM 判断。自动重排/严格配额需确认口径后实施。

## 目标验证边界

- 通知修复已在目标环境验证（Base 字段 + IM 卡片实收）；
- 测试对 RQ-000323 的临时负责人/通知字段已清理，需求恢复 `pending_mapping`/`pushed`，Base 执行人与通知字段为空。
