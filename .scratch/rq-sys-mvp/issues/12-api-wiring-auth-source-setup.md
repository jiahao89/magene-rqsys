# [ready-for-agent] 12 — API 接线、角色校验与数据源初始化

## 目标

让现有 API contract、repository 和规则页面真正接通，并确保所有写操作在服务端按角色授权。此票只实现平台中立的接口与策略；妙搭身份 provider 仍须通过 Ticket 00 验证。

## 依据

- `specs/rq-sys-mvp/00-foundation-and-data-contract.md`
- `specs/rq-sys-mvp/04-workbench.md`
- `specs/rq-sys-mvp/OPEN-DECISIONS.md` D-04、D-08、D-09
- `specs/rq-sys-mvp/openapi.yaml`

## 范围

- 修复规则 API 与 PostgreSQL repository 的接口命名/装配不一致，确保模块词典的读取、建草稿、发布，以及优先级规则 API 能通过生产装配访问。
- 在服务端统一执行角色授权：来源配置/规则发布等管理操作按 Spec 04 的角色表控制；手动同步、负责人映射和重试按角色表控制。不能只靠隐藏 Web 控件。
- 保留可注入的 `IdentityProvider` seam；用测试身份验证角色行为，不实现未经验证的妙搭身份接入。
- 补齐首个来源的受控创建/初始化路径，使管理员可配置单一 Teambition 项目、字段映射、产品组负责人名单和周计划；配置 API 不回显凭据。
- 同步 OpenAPI 与 Zod 请求/响应及 401/403/404/409 等错误声明；规则发布和审计写入失败时保持可恢复且一致。

## 验收标准

- 由真实 server composition 装配的词典 API 可完成 list → create draft → publish；不出现 dependency unavailable。
- 无身份请求返回 401；身份存在但角色不足的直接 API 写请求返回 403；有权角色成功。所有规则、来源、映射、同步、重试写端点都有对应覆盖。
- 首次配置后可从 API 读取唯一来源配置；字段只接受 Spec/PRD 允许的白名单。
- API 不返回秘密值；错误响应不泄漏 provider 原始错误或个人敏感数据。
- OpenAPI 契约与 Zod 验证一致；审计失败不能留下“已发布但无审计”的不一致成功状态。
- 覆盖新增行为的 API/contract tests 通过，`npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

## 不在范围

- 接通妙搭身份、发布应用、改变妙搭权限或执行外部写入（Ticket 00/10/11/09）。
- 扩展完整 28 字段需求模型或新增未批准的角色。
