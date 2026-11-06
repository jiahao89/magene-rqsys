# PR-07 PM 决策闭环与单一入口

> 批次：2026-11-06 生产就绪（PR）
> **Status**：`closed-by-decision`（PRD-15）
> **优先级**：P1
> **创建**：2026-11-06；基线：root `5490d75`

## 背景 / 目标

PM 处理状态只在 Base，Web 不回读；Web 没有「待我处理/已处理/超期」队列，没有决策记录（结论、优先级决定、负责人、目标版本、暂不处理理由），也没有状态流转与提醒。日常主循环「收到→判断→决策→推动→复盘」断成两段；D-02「PM 数据放 Base 还是 Web/DB」未决。

## 范围

- **先决策再实施**：二选一并写 ADR——① Base 为唯一 PM 工作台：提供视图模板、字段/权限 SOP，Web 只读汇总；② Web 补最小决策闭环（处理状态/结论/负责人/目标版本/暂不处理理由/超期提醒，Base 镜像或停更）。
- 按选定路径实现最小闭环：至少提供「我负责/我关注」队列 + 超期提醒。
- 若改变「Web 不回读 PM 状态」边界，需正式修订 PRD/OPEN-DECISIONS 并留决策记录。
- 涉及：`specs/rq-sys-mvp/OPEN-DECISIONS.md`（D-02）、`00-foundation-and-data-contract.md`、`apps/web/src/panels.tsx`、Base 视图/字段或新表迁移。

## 验收标准（未取得目标环境证据前不得宣称完成）

- [ ] D-02 决策 ADR 落库（选 Base/Web/混合；理由、影响、PRD 修订清单）。
- [ ] 按选定路径完成最小闭环：队列可用、决策字段可写、状态可流转。
- [ ] 「我负责/我关注」队列 + 超期提醒在目标环境可用。
- [ ] 权限与审计：谁改了什么可追溯；与 PR-08 角色方案一致。
- [ ] 若越界「不回读」边界，PRD/OPEN-DECISIONS 已同步修订。
- [ ] 目标环境验证；未取得证据不得标完成。

## 不在范围

- 完整需求生命周期（规划/方案/版本/研发/验收，PR-13 P2-1）；报表与导出（PR-10）；评论/@（PR-13 P2-5）。

## 依赖 / 阻塞

- **blocked-on-decision**：D-02 归属决策（产品 + PM Leader）；决策后实现工作可转为 ready-for-agent。

## 证据引用

- `/tmp/rq-verify/pm-gaps.md` P1-3（第 138–143 行）。
- `specs/rq-sys-mvp/OPEN-DECISIONS.md:8`（D-02）、`:10`（D-04）。
- `specs/rq-sys-mvp/00-foundation-and-data-contract.md:65`（PM processing in Base only）。
- `apps/web/src/panels.tsx:1073`（不读 PM 状态）；`docs/2026-10-21-rq-sys-v0.2-prd.md:449`（不回读边界）、`:487`（生命周期 Roadmap）。

## 决策（2026-11-06，PRD-15）

维持 D-02：Base 为唯一 PM 处理面；Web 不读取/回写 PM 状态，仅提供分析/运维视图与深链。本票不再实施；如未来改变需新 ADR。
