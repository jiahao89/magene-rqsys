# RQ-Sys MVP 剩余开发任务 — Agent 执行说明

请在 RQ-Sys 项目中按下述要求完成 MVP 剩余开发。此文件可作为 Agent 的直接任务输入。

## 项目目标

交付当前批准范围内的 MVP：从 Teambition 拉取需求，保存源数据，执行可追溯的 AI 分析，按负责人规则推送到飞书多维表格，并通过 Web 工作台查看状态和处理失败。产品行为以 Feishu MVP PRD revision 60 为准；技术文档与 PRD 冲突时遵循 PRD。

## 开始前必须检查

1. 阅读根目录 `AGENTS.md`、`CONTEXT.md`、`specs/rq-sys-mvp/README.md`、`specs/rq-sys-mvp/OPEN-DECISIONS.md`，以及本次要做的编号 Spec 和 Ticket。改 API 时同时核对 `specs/rq-sys-mvp/openapi.yaml`；编辑 tickets 前重读 `.scratch/rq-sys-mvp/issues/README.md`。
2. 检查当前分支、`git status` 和未提交改动。保留所有已有改动，不得 reset、clean、覆盖或顺手整理无关文件。
3. GitHub 仓库是代码源头。确认当前 checkout 和妙搭之间的同步/发布关系；不要把本地验证描述成妙搭验收。
4. 逐项对照 Ticket 验收标准实现，不扩展到完整 28 字段需求流程。

## 执行顺序

Ticket 12 和 Ticket 13 可以先分别实现；之后按依赖顺序继续：

1. **Ticket 12 — API 接线、角色校验与数据源初始化**：修复规则 repository/API 接线，补全服务端角色授权和受控来源初始化路径。妙搭身份 provider 仍保持未实现，直到目标能力验证。
2. **Ticket 13 — AI 输出语义、优先级边界与隐私**：修正优先级和 AI 输出契约，确保未发布有效校准规则时 P0–P3 留空，并保护模型输入中的个人信息。
3. **Ticket 14 — 闭合分析到飞书 Base 推送链路**：首次分析成功/失败/超时终态后继续推送；正确处理负责人、AI 字段、Base record ID、实质变更快照和人工映射顺序。
4. **Ticket 15 — Pipeline 幂等、重试与 Worker 租约安全**：修复失败推送重试、入队失败恢复和 worker fencing，避免重复副作用或错误完成。
5. **Ticket 16 — Web 数据源配置与同步批次工作台**：完成来源维护、手动同步、真实批次进度和失败项处理。
6. **Ticket 17 — Web 需求详情、负责人映射与审计工作台**：完成需求筛选/详情、映射、分阶段重试和审计读取。

Ticket 文件是详细范围和验收标准的权威依据：

- `.scratch/rq-sys-mvp/issues/12-api-wiring-auth-source-setup.md`
- `.scratch/rq-sys-mvp/issues/13-ai-semantics-priority-privacy.md`
- `.scratch/rq-sys-mvp/issues/14-analysis-to-base-push-closure.md`
- `.scratch/rq-sys-mvp/issues/15-pipeline-retry-and-worker-safety.md`
- `.scratch/rq-sys-mvp/issues/16-web-source-and-batch-workbench.md`
- `.scratch/rq-sys-mvp/issues/17-web-requirement-mapping-audit-workbench.md`

## 必须遵守的产品与技术边界

- Teambition 是源事实的权威来源；应用数据库保存源快照、工作流状态、AI 版本、负责人映射、审计和重试状态；飞书 Base 保存 MVP 需要的 PM 处理字段。
- 同步唯一键为 `(Teambition project ID, Teambition requirement ID)`。不得用标题或不稳定字段去重。
- 拉取、AI 分析、负责人匹配和 Base 推送状态互相独立。AI 失败、低置信度、优先级为空不阻止符合负责人规则的需求继续推送。
- TB 无负责人时可以空负责人推送；TB 有负责人但未匹配时，应等待人工映射。空/未匹配 TB 负责人不得清除 Base 中已手动指定的负责人。
- AI 建议与 PM 确认字段分开保存。实质源变更时，先保存 Base PM 字段快照；快照读取失败，不得修改现有 Base 记录。
- 仅处理 PRD 和已验证字段映射允许的字段。不要把未批准的 AI 结果或完整 28 字段写入 Base。
- 不向 AI provider 发送负责人/提出人姓名、用户 ID、联系方式、附件内容、凭据或无关项目数据。模型请求仅使用 Spec 02 允许的最小字段。
- 保留 Teambition adapter 的服务端默认 API key fallback 和 `GATEWAY_API_KEY` 覆盖方式；不得打印、回传或打包凭据。
- 所有角色校验必须发生在服务端。身份 provider 继续通过接口隔离，不得伪造“妙搭身份已接通”。

## 妙搭和外部环境限制

- 不部署、不创建发布、不写妙搭环境变量、不改妙搭数据库、不变更协作者或权限。
- `spark:app:read` / `spark:app:write` 和目标妙搭运行时能力尚未验收。真实 Feishu Base 通知、妙搭身份、数据库、后台任务和周调度都必须标为“待目标环境验证”。
- 本地可使用 stub/fake adapter 验证业务逻辑。没有明确授权的测试凭据时，不调用真实 AI provider，不向真实干系人发送通知。
- 不将 mock、单元测试或本地构建描述为真实端到端验收。

## 完成时的交付

1. 按项目约定完成实现，不提交或推送 Git，除非用户另外明确要求。
2. 对本次行为改动运行相关测试、`npm run typecheck`、`npm run build` 和 `git diff --check`；如果某项受环境阻塞，说明具体原因和未验证范围。
3. 更新对应 Ticket 与 `.scratch/rq-sys-mvp/issues/README.md` 的状态和本地证据，保持二者一致；没有目标环境证据时不得把 Ticket 09 或 MVP 标记为完成。
4. 最终汇报：完成的 Ticket、主要改动文件、验证结果、仍被外部环境阻塞的工作，以及明确未做的目标环境验收。

## 本次推荐认领

可以先分配两个相互独立的起始任务：Ticket 12 与 Ticket 13。完成并 review 后，再依赖顺序认领 Ticket 14–17。最终目标环境验收继续由 Ticket 09 负责，并等待 Ticket 00、10、11 的外部门槛解除。
