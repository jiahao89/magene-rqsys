# RQ-Sys MVP 数据库与接口基线

状态：本地开发骨架；PostgreSQL DDL 与 API 契约已落地。妙搭数据库、认证上下文、后台任务和外部网络需目标租户 POC 通过后才能作为部署结论。

## 设计边界

- Teambition 是来源事实的权威系统；飞书 Base 负责本 MVP 的 PM 协作字段和通知自动化。
- RQ-Sys PostgreSQL 保存工作流、来源快照、AI 版本、映射、PM 变更快照和审计。
- 需求唯一键为项目 ID + Teambition `id`。不使用标题或 `unique_id` 去重。
- 源更新时间未在当前接口响应中出现，首版整项目拉取并比较规范化哈希。
- 只处理当前 PRD 批准并配置在字段映射中的 TB 字段。其余自定义字段不建列、不发给 AI、不写入 Base。
- 目标数据库暂按 PostgreSQL 设计；本地 SQLite 不作为妙搭生产持久化方案。

## 目录

```text
apps/api/src/
  adapters/postgres/       PostgreSQL 连接适配器
  adapters/teambition/     TB 原始类型、字段 allowlist 和规范化
  application/             用例端口
  domain/                  工作流状态及领域类型
  http/                    HTTP 入口
  db/                      SQL migration runner
database/migrations/       PostgreSQL DDL
specs/rq-sys-mvp/openapi.yaml  OpenAPI 3.1 契约
```

## 数据对象

| 表 | 用途 | 关键约束 |
|---|---|---|
| `source_configs` | 单项目 TB 来源、需求类型、周计划、负责人名单和字段映射 | project + requirement type 唯一；凭据不落库 |
| `sync_batches` | 手动/定时批次、发起人、幂等键、汇总结果 | source + idempotency key 唯一 |
| `requirements` | 当前规范化需求和 pull/AI/owner/push 独立状态 | source + TB requirement ID 唯一 |
| `sync_items` | 批次内逐条结果及错误 | batch + TB requirement ID 唯一 |
| `source_snapshots` | 只追加来源版本和 allowlist payload | requirement + version 唯一 |
| `analysis_runs` | 结构化 AI 输出、版本、provider/prompt/dictionary/rule provenance | requirement + analysis version 唯一 |
| `person_mappings` | TB user ID/唯一姓名到 Feishu identity 的映射 | 名称不设唯一约束；有歧义时不自动匹配 |
| `pm_snapshots` | 实质变化推送前保存的 Base PM 字段快照 | 只追加；快照读取失败时不覆盖 Base |
| `base_push_runs` | 每次 Base 新建/更新尝试及结果 | push version 与幂等键唯一 |
| `module_dictionary_versions` | 受控模块字典版本 | 发布状态和版本留痕 |
| `priority_rule_versions` | 历史案例校准后的规则版本 | 未发布时 priority 为空 |
| `pipeline_jobs` | 可恢复的同步/AI/推送后台任务 | dedupe key 唯一，租约与重试字段持久化 |
| `audit_events` | 操作和状态变化审计 | 安全字段白名单，禁止凭据/原始 provider 错误 |

DDL：[`../../database/migrations/0001_initial.sql`](../../database/migrations/0001_initial.sql)。所有外部 ID 使用 `text`，避免假设固定数字类型或丢失前导零。源 payload 是按字段映射生成的 allowlist JSON，不存储整条 114 字段原始记录。应用使用 `crypto.randomUUID()` 生成主键，不要求数据库扩展。

## API 分层

HTTP 路径与现有 Spec 保持一致，公共健康检查除外。所有业务 API 需要 Feishu 登录；actor 由 Miaoda 服务端注入的 `req.userContext.userId` 提供。MVP 不实现应用角色矩阵，登录用户均可使用全部功能。部署后仍须验证未登录请求会被拒绝、已登录请求能正确注入 actor。

| API | 作用 | 幂等/权限要点 |
|---|---|---|
| `GET /api/health` | 存活探针 | 不访问数据库 |
| `GET /api/health/ready` | 数据库就绪探针 | 不返回连接串或异常详情 |
| `GET /api/sources` / `PUT /api/sources/{id}` | 来源配置 | 管理员写；响应不回显凭据 |
| `POST /api/sync/run` | 创建手动批次并排队 | `Idempotency-Key` 必填；返回 batch ID |
| `GET /api/batches` / `GET /api/batches/{id}` | 批次和逐项进度 | 读取权限按项目授权 |
| `POST /api/items/{id}/retry` | 重试失败项目 | 只重试失败阶段，复用源需求键 |
| `GET /api/requirements` / `GET /api/requirements/{id}` | 需求池与详情 | 独立返回四阶段状态 |
| `PUT /api/requirements/{id}/owner` | 保存人工负责人映射并允许推送 | 操作人和 mapping 变更写审计 |
| `POST /api/analysis/{id}/retry` | 新建 AI 分析版本 | 不覆盖人工字段，不阻塞推送 |
| `GET /api/audit` | 审计查询 | 不返回 token、联系方式或 provider 原始响应 |

完整请求/响应、状态枚举和错误契约见 [`openapi.yaml`](./openapi.yaml)。

## 运行与部署边界

- 本地：Node.js 22+、PostgreSQL、`npm run dev:api`。
- 数据库迁移：`npm run db:migrate`；migration 采用事务并记录 `schema_migrations`。
- 当前 HTTP server 仅实现 health/ready；业务 API 的契约已定，但 handlers、身份认证、队列、TB/Base/AI provider 仍由对应 tickets 实现。
- 妙搭数据库/驱动、应用函数入口、身份上下文、调度器、后台任务与密钥存储待 Ticket 00 实测。通过后再写 platform adapter，不把本地 Node 运行等同于妙搭验证。
