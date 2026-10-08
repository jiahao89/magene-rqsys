# [done: 2026-10-08] 02 — 验证 Feishu Base 字段、Upsert 与自动化

## 结果
四项验收标准全部通过，实测证据与差异决策见 [`specs/rq-sys-mvp/FEISHU-BASE-POC.md`](../../../specs/rq-sys-mvp/FEISHU-BASE-POC.md)。POC 表 `tblxbyvbdLGVnLaO`（28 字段）与测试记录保留在测试 Base `OddqbqBeOamFjFsR5IXcJdjknmd` 供复核。

## 目标
确认测试 Base 中的字段、权限和自动化行为足以支持 MVP 推送及负责人通知。

## 范围
- 验证目标 Base/表/字段 ID、读写权限、记录查询和按 Teambition 项目 ID + 需求 ID 的 create-or-update。
- 验证负责人 person 字段的飞书用户标识写入、空负责人推送、读取 PM 字段快照及受控更新权限。
- 验证需求实质变化时读取并保存 PM 字段快照，再将 PM 状态重置为“待处理”；快照失败时不得覆盖既有记录。
- 验证负责人后续分配/变更时自动化触发、收件人和去重行为。

## 验收标准
- 有字段映射、权限矩阵和测试 Base 的真实写入/更新证据。
- 同一需求重复 Upsert 不产生重复记录。
- 无负责人也可推送；匹配/手动分配后按规则通知；Base 自动化失败不回滚成功推送。
- 明确自动化是否能满足通知触发和去重；不足处形成明确差异与产品/技术决策。

## 不在范围
把完整 28 字段模型迁入 Base，或让 Web 读取 Base PM 状态。
