# [blocked: 02, 05, 06] 07 — 负责人映射与 Feishu Base 推送纵向切片

## 目标
将每条需求按负责人映射与字段所有权规则 Upsert 到 Feishu Base，处理后续负责人分配/变更通知。

## 范围
- 优先按 TB user ID 匹配；无 ID 时仅在姓名唯一时自动匹配；无法解析时支持操作员手动映射。
- TB 无负责人时允许推送空负责人；空值/未匹配不清空 Base 已手动分配的负责人。
- 按项目 ID + 需求 ID Upsert；源字段按 allowlist 更新，保护 PM 字段。实质变更先读快照，成功后重置 PM 状态为“待处理”。
- 映射到负责人后按 Base 自动化发送通知；TB 负责人后来变更且可映射时更新 Base 负责人并通知新负责人。

## 验收标准
- Base push 状态真实显示待推送、推送中、已推送、失败。
- 同一需求重试不重复建行；低置信度、空优先级或 AI 首次失败均不阻止推送。
- 实质变更快照读取失败时，不改写 Base 既有记录和 PM 字段。
- “通知已配置/触发”与“通知已送达”语义明确，不以 Base Upsert 成功冒充送达成功。

## Blocked by
Ticket 02（Base schema/权限/automation 实测）和 Ticket 05。分析状态按 Spec 02/05 的服务端契约处理；AI 失败、低置信度或优先级留空不应成为推送阻塞项。

## 本地实现与真实环境冒烟证据（2026-10-09）
- 推送链路代码完成：`base/client.ts`（FeishuBasePushAdapter：复合键 upsert、PM 快照守卫、空负责人不清空 Base 人工值、PM 字段配置映射）、`base/transport.ts`（FeishuBitableClient：bitable v1 CRUD + base/v3 复合键过滤）、`base/push-service.ts`（HTTP 与 worker 共用的执行核心：幂等重放、合法状态迁移、负责人解析推进、审计）、HTTP push handler + worker base_push handler 接线。
- **真实环境冒烟通过**（lark-cli 代理 fetch/托管凭证，对 Ticket 02 测试 Base）：读（base/v3 复合键精确命中 + bitable 命名字段读取）、写（创建/delta 更新/删除全链路）、adapter 全流程（首推创建 → 实质变化 → PM 快照 + 状态重置 → 读回零污染 → 清理）全部通过；写入不触碰执行人字段即不触发通知自动化。
- **发现并修复两个真实缺陷**：① bitable v1 records/search 在非 advanced 表上过滤条件被忽略（返回全表）——复合键查询改用 base/v3（POC 验证过的格式）；② Date 字段写入要求 unix 毫秒时间戳。
- **事故与处置**：初版过滤缺陷导致冒烟误删 POC 测试记录 recvxrwaGzPGJd；已按删除前快照恢复为 recvxwGs5Js0PA（已知字段忠实还原，文本值以「（已恢复）」标记）并以修复后的搜索验证命中。详见 FEISHU-BASE-POC.md 事故记录。
- 边界：真实调用通过 lark-cli 托管凭证代理完成；adapter 自身的凭证注入（FEISHU_APP_ID/SECRET + BASE_APP_TOKEN/TABLE_ID）待工单 00/W7 在目标环境验证；目标验收保持 blocked on 00。
