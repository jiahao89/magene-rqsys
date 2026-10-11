# [implemented-not-target-verified] 16 — Web 数据源配置与同步批次工作台

## 目标

让管理员/操作员能在 Web 查看并维护唯一产品组来源，发起手动同步，查看真实批次状态和失败明细。

## 依据

- `specs/rq-sys-mvp/04-workbench.md`
- `specs/rq-sys-mvp/01-teambition-sync.md`
- `specs/rq-sys-mvp/05-platform-reliability-security.md`
- `design.md`（HeroUI v3 + Tailwind 基线；新增页面遵循现有项目样式）

## 范围

- 在现有 Overview、Sources、Batches 页面基础上补齐缺失交互，不重做已有 API-backed 页面。
- Source 页面支持读取/创建/更新一个专用 Teambition 项目：客户端仅维护项目名称（默认 `室外产品-码表软固件需求池`）和周计划/启用状态；服务端解析项目 ID、需求类型 ID并保留内部 mapping。客户端不编辑负责人名单、字段映射或凭据。
- 支持手动全量同步，显示返回的 batch ID，并从服务端刷新真实进度。
- 批次列表/详情显示触发者、触发方式、时间、总数、成功/失败数、逐条错误与允许的重试动作；数据不得来自 mock counter。
- 显示 loading、empty、partial failure、permission denied、API error 等可恢复状态。

## 验收标准

- Source 创建/更新保存后重新读取仍一致；字段超出 allowlist 时服务端拒绝。
- 手动同步使用幂等键，重复点击/请求不制造重复批次；UI 只在 API 接受后显示已提交。
- 批次数据与服务端持久化状态一致；单条失败时成功项可见且不被隐藏。
- 无身份/无角色时，页面显示可理解的权限状态，不假报操作成功。
- 对当前页面行为及新增流程有组件/API mock contract tests；运行页面连接本地 API 可手动核验。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

## Target verification remains

Miaoda真实身份、调度和目标应用发布由 Tickets 00/09 验收。

## Latest local implementation evidence (2026-10-11)

- 来源表单默认项目名为 `室外产品-码表软固件需求池`；客户端只提交项目名称、启用状态和周计划，不要求录入内部 ID，也不暴露 owner/field map。默认周计划为周一 09:00 `Asia/Shanghai`，保持未启用，等待目标调度验收。
- 新建来源会持久化已解析配置、周计划、负责人名单、字段映射与审计事件；妙搭 app 的来源创建也已修正为写入完整配置，不再丢弃这些设置。
- root Web 创建/更新表单有 API mock contract 覆盖；主仓 Web 21 项测试通过。妙搭 app 路由测试覆盖来源创建请求和 Postgres 参数持久化；`test:rqsys-route` 24/24 通过。
- 妙搭 app `type:check`、`lint`、`build:prod` 通过；目标身份、线上来源写入、手动同步与周调度仍未验收。

### Spec 04 缺口补齐（2026-10-11，本轮）

- **Dashboard「下次同步 + 调度健康」已实现**：新增 `apps/web/src/schedule.ts`（纯函数 `checkScheduleHealth` / `nextRunAt` / `describeCountdown` / `formatInZone`）与 `SchedulerHealthPanel`。按来源已保存的周计划与业务时区计算下次计划时刻，三种不可用原因分别展示（未配置 / 未启用 / 配置非法），时区非法时明确报错而不回退机器本地时区。卡片文案固定声明「不代表目标环境已执行」，不宣称调度器已运行。
- **Source「连接自检」已实现**：新增 `ConnectionSelfCheck` 展示三项已保存配置（项目名称、周计划合法性、同步开关），并明确说明服务端凭据（Teambition 网关 / AI / 飞书 Base）不下发浏览器、其有效性以实际批次与推送结果为准。**只展示配置完整性，不显示任何凭据值，也不输出「凭据有效/无效」结论。** 注意：Spec 04 提到的凭证 self-check 目前**没有对应 API 契约**（`openapi.yaml` 未定义该端点），因此未实现服务端连通性探测；如需真正的凭据校验需先补契约。
- **需求详情 Base 记录引用已改进**：`baseRecordId` 从纯文本改为可复制的引用块，并声明 PM 处理状态与通知送达需在飞书 Base 查看。**未渲染可点击链接**：Base 记录 URL 需要 app token，而凭据按约束不下发浏览器；工作台也不得暗示已读回 PM 状态。
- 403 提示文案已按当前访问模型修正为「服务端拒绝」，不再声称存在本地角色矩阵（决策为登录即可用，无应用角色）。
- 新增/更新测试：`schedule.test.ts` 9 项（含夏令时边界、非法时区、非法时间格式），`App.test.tsx` 3 项新增（服务端 403 原样暴露、计划已配置展示、非法时区不猜测），`panels.test.tsx` 4 项新增（自检不宣称凭据有效、读取已保存计划、Base 引用可复制且不伪造链接）。Web 测试 21 → 36 项全通过；`npm run typecheck`、`npm run build`、`git diff --check` 均通过。
- 仍在服务端/目标环境范围：凭据连通性 self-check 的服务端实现、Miaoda 真实身份、目标调度触发与恢复、线上来源写入。
