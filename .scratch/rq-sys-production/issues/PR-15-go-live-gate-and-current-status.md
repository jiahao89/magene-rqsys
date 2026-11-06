# PR-15 唯一上线 Gate 与当前状态页

> 批次：2026-11-06 生产就绪（PR）
> **Status**：`ready-for-agent`
> **优先级**：P0（go-live 判据）
> **创建**：2026-11-06

## 背景 / 目标

上线验收清单停留在 2026-10-13 的 POC 口径（仅测试 Base、周计划关闭、合成数据），与当前真实状态（321 真实需求、定时同步启用、真实 Base 推送）冲突；多份状态文档结论互相覆盖。目标：建立唯一可信的「当前状态页 + go-live gate」，作为是否宣布正式上线的唯一判据。

## 范围

- 新增 `deployment/PRODUCTION-GO-LIVE-CHECKLIST.md`：P0/P1 全部验收项、目标环境证据链接、通过日期、owner。
- 新增/替换单一 `CURRENT-STATUS.md`：环境、release/commit、数据量、定时/通知状态、最近验证、已知风险；历史文档标注归档。
- 每次发布更新 release↔commit↔环境变量版本与回读结果。
- 与 PRD 增补 §9 的 gate 对齐。

## 验收标准

- [ ] 新状态页有当前 release/commit、证据与更新时间，且无自相矛盾结论。
- [ ] Go-live checklist 覆盖 PR-01…PR-14 的 P0 项；每项有目标环境证据（非本地测试）。
- [ ] 历史验收文档明确标为归档或删除冲突结论。
- [ ] 用户/产品负责人确认该 checklist 为唯一上线判据。

## 不在范围

具体功能实现（由各票承担）。

## 证据引用

- `/tmp/rq-verify/ops-readiness-gaps.md` P0-5；`deployment/TARGET-ACCEPTANCE-CHECKLIST.md:4`；`specs/rq-sys-mvp/RELEASE-CLOSEOUT.md` 与 `LOCAL-AND-TARGET-STATUS.md` 结论冲突。
- `docs/2026-11-06-rq-sys-production-readiness-prd.md` §9。
