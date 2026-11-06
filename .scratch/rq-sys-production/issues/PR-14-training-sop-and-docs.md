# PR-14 上线培训、角色 SOP 与文档同步

> 批次：2026-11-06 生产就绪（PR）
> **Status**：`ready-for-agent`
> **优先级**：P1
> **创建**：2026-11-06

## 背景 / 目标

App 内有《使用指南》，但缺少按角色的操作 SOP、培训材料与反馈入口；同时历史文档多处落后于实现（HeroUI/旧 ticket 数量/旧验收状态）。目标：让 10–15 人试点在第一周能按同一套流程使用，并保证文档与当前实现一致。

## 范围

- 角色 SOP：PM Leader（每日 10 分钟清单、每周同步与优先级终审、异常升级）、执行 PM、管理员、只读观察者各 1 页。
- 30 分钟培训材料（录屏/演示数据清单）与首周答疑记录。
- 反馈入口（应用内说明或群）与发布说明维护机制。
- 文档对齐：`specs/rq-sys-mvp/README.md`、`LOCAL-AND-TARGET-STATUS.md`、`RELEASE-CLOSEOUT.md`、`.scratch` 索引与当前实现（Arco/优先级分诊/生产就绪票）一致。

## 验收标准（需人工确认，不以代码合并代替）

- [ ] 四个角色 SOP 各有可执行清单与责任人。
- [ ] 完成一次 30 分钟培训并留录屏/参会记录。
- [ ] 试点群/反馈入口建立，首周反馈有记录与处理结论。
- [ ] 文档状态页单一可信：日期 + owner + release/commit + 证据；历史快照明确标注归档。
- [ ] 发布说明（每次上线）模板与归档位置确定。

## 不在范围

生命周期全链路、多来源、协作评论（PR-13 路线）。

## 证据引用

- `/tmp/rq-verify/pm-gaps.md` P1-9；`/tmp/rq-verify/ops-readiness-gaps.md` P0-5（状态文档自相矛盾）。
- `apps/web/src/panels.tsx` GuidePanel；`deployment/TARGET-ACCEPTANCE-CHECKLIST.md`（仍写 2026-10-13 版本）。
