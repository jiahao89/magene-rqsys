# [implemented-not-target-verified] 12 — API 接线、登录校验与数据源初始化

## 目标

让现有 API contract、repository 和规则页面真正接通。所有 API 必须要求有效飞书登录；登录后不做 RQ-Sys 角色或用户权限区分。服务端 actor 仅取妙搭可信 user context，不接受客户端身份头。

## 依据

- `specs/rq-sys-mvp/00-foundation-and-data-contract.md`
- `specs/rq-sys-mvp/04-workbench.md`
- `specs/rq-sys-mvp/OPEN-DECISIONS.md` D-04、D-08、D-09
- `specs/rq-sys-mvp/openapi.yaml`

## 范围

- 修复规则 API 与 PostgreSQL repository 的接口命名/装配不一致，确保模块词典的读取、建草稿、发布，以及优先级规则 API 能通过生产装配访问。
- 接入 `@NeedLogin()` 并验证可信 `req.userContext.userId`；禁止客户端身份头覆盖 actor。
- 所有已登录用户可调用读写端点；未登录请求返回 401。飞书通讯录/Base 的平台侧 scope 与权限仍按平台授权处理。
- 补齐首个来源的受控创建/初始化路径，使管理员只需维护 Teambition 项目名称（默认 `室外产品-码表软固件需求池`）及周计划；服务端解析项目/需求类型 ID。字段映射与负责人映射仅作为服务端配置，不暴露为客户端输入；配置 API 不回显凭据。
- 同步 OpenAPI 与 Zod 请求/响应及 401/403/404/409 等错误声明；规则发布和审计写入失败时保持可恢复且一致。

## 验收标准

- 由真实 server composition 装配的词典 API 可完成 list → create draft → publish；不出现 dependency unavailable。
- 无身份请求返回 401；任意可信登录用户可调用读写端点；伪造身份头不改变 actor。所有规则、来源、映射、同步、重试写端点都有对应覆盖。
- 首次配置后可从 API 读取唯一来源配置；字段只接受 Spec/PRD 允许的白名单。
- API 不返回秘密值；错误响应不泄漏 provider 原始错误或个人敏感数据。
- OpenAPI 契约与 Zod 验证一致；审计失败不能留下“已发布但无审计”的不一致成功状态。
- 覆盖新增行为的 API/contract tests 通过，`npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

## 不在范围

- 配置飞书平台 scope、发布应用或执行目标环境写入（Ticket 00/10/11/09）。
- 扩展完整 28 字段需求模型或引入 RQ-Sys app 角色/用户权限。
