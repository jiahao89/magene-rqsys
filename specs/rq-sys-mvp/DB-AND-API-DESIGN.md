# RQ-Sys 数据库与接口基线

状态：产品核心 API、PostgreSQL 迁移（`0001`–`0034`，共 24 张业务表）与妙搭运行时适配均已实现并在线上运行；本地测试仍不能等同于目标妙搭环境验证（见 `AGENTS.md`）。

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
| `source_configs` | 双池 TB 来源（`pool`: `product` 产品池 / `group` 集团池）、需求类型、周计划、产品组人员名单（产品池用于 Web 筛选、模块分工与人员→飞书绑定，不缩小同步范围）、集团池执行人白名单（`executor_allowlist`，仅集团池过滤）和字段映射 | `(provider, pool)` 唯一（迁移 `0031` 替代原单例索引）；凭据不落库 |
| `sync_batches` | 手动/定时批次、发起人、幂等键、汇总结果 | source + idempotency key 唯一 |
| `requirements` | 当前规范化需求和 pull/AI/owner/push 独立状态；逐条人工负责人（`manual_owner_*`，优先于 TB 执行人映射，迁移 0006/0007）、最近一次成功推送的负责人（用于负责人变更事件）、同标题疑似重复提示（`duplicate_of_requirement_id`；仅提示，不自动隔离、不删除，仍按自身来源 ID 处理） | source + TB requirement ID 唯一 |
| `sync_items` | 批次内逐条结果及错误 | batch + TB requirement ID 唯一 |
| `source_snapshots` | 只追加来源版本和 allowlist payload | requirement + version 唯一 |
| `analysis_runs` | 结构化 AI 输出、版本、provider/prompt/dictionary/rule provenance | requirement + analysis version 唯一 |
| `person_mappings` | TB user ID/唯一姓名到 Feishu identity 的映射（人员页新绑定以 `teambition_user_id` 为空、按规范化姓名的 `unique_name` 行表达，改绑沿用原行；同一姓名同飞书账号只保留一条活跃映射） | 名称不设唯一约束；有歧义时不自动匹配 |
| `pm_snapshots` | 实质变化推送前保存的 Base PM 字段快照 | 只追加；快照读取失败时不覆盖 Base |
| `base_push_runs` | 每次 Base 新建/更新尝试及结果 | push version 与幂等键唯一 |
| `module_dictionary_versions` | 受控模块字典版本 | 发布状态和版本留痕 |
| `priority_rule_versions` | 历史案例校准后的规则版本 | 未发布时 priority 为空 |
| `pipeline_jobs` | 可恢复的同步/AI/推送后台任务 | dedupe key 唯一，租约与重试字段持久化 |
| `audit_events` | 操作和状态变化审计 | 安全字段白名单，禁止凭据/原始 provider 错误 |

DDL：[`../../database/migrations/`](../../database/migrations/)（初始表见 `0001_initial.sql`，后续增量迁移覆盖 V0.2 统一来源/评分 v2/RICE/Kano、重复判定 `0022`、系统标志 `0028`、收集表来源 `0029`、需求评估 `0030`/`0033`、集团双池 `0031`、PRD 提示词 `0032`、我的需求与回收站 `0034`）。所有外部 ID 使用 `text`，避免假设固定数字类型或丢失前导零。源 payload 是按字段映射生成的 allowlist JSON，不存储整条 114 字段原始记录。应用使用 `crypto.randomUUID()` 生成主键，不要求数据库扩展。

## API 分层

HTTP 路径与现有 Spec 保持一致，公共健康检查除外。所有业务 API 需要 Feishu 登录；actor 由 Miaoda 服务端注入的 `req.userContext.userId` 提供。MVP 不实现应用角色矩阵（D-04 / PRD-16），登录用户均可使用全部功能；仅回收站删除/还原按记录负责人/删除人做数据归属校验（PRD-33）。部署后仍须验证未登录请求会被拒绝、已登录请求能正确注入 actor。

| API | 作用 | 幂等/权限要点 |
|---|---|---|
| `GET /api/health` | 存活探针 | 不访问数据库 |
| `GET /api/health/ready` | 数据库就绪探针 | 不返回连接串或异常详情 |
| `GET /api/sources` / `POST /api/sources` / `PUT /api/sources/{id}` | 来源配置（支持 `product`/`group` 双池） | 登录租户用户可写（无应用角色矩阵）；响应不回显凭据 |
| `POST /api/sync/run` | 创建手动批次并排队 | `Idempotency-Key` 必填；返回 batch ID |
| `GET /api/batches` / `GET /api/batches/{id}` | 批次和逐项进度 | 列表按 `pool` 隔离；详情按 UUID 推导 |
| `POST /api/items/{id}/retry` | 重试失败项目 | 只重试失败阶段，复用源需求键 |
| `GET /api/requirements` / `GET /api/requirements/{id}` | 需求池与详情 | 独立返回四阶段状态；集合按 `pool` 隔离，跨池详情 404 |
| `PUT /api/requirements/{id}/owner` | 只把负责人存到该需求本身（`requirements.manual_owner_*`，永不写 person_mappings），入队推送；单条改派不影响同 TB 执行人的其他需求 | 操作人和负责人变更写审计 |
| `DELETE /api/requirements/{id}/owner` | 清除逐条人工负责人，按 TB 执行人映射恢复默认负责人（或 pending/not_required），有默认负责人时入队推送 | 操作人和清除写审计 |
| `PUT` / `DELETE /api/people/{name}/feishu` | 人员页维护到飞书账号的绑定 | 按规范化姓名维护活跃映射；不改写 TB/飞书，不改已推送 Base 行 |
| `POST /api/analysis/{id}/retry` | 新建 AI 分析版本 | 不覆盖人工字段，不阻塞推送 |
| `GET /api/audit` | 审计查询 | 不返回 token、联系方式或 provider 原始响应 |

完整请求/响应（含 V0.2 手工录入/编辑、人群/评分/RICE/Kano、评估、PRD 提示词、我的需求/回收站与运维端点）、状态枚举和错误契约见 [`openapi.yaml`](./openapi.yaml)。

## 运行与部署边界

- 本地：Node.js 22+、PostgreSQL、`npm run dev:api`。
- 数据库迁移：`npm run db:migrate`；migration 采用事务并记录 `schema_migrations`。
- 业务 HTTP handlers、身份适配、队列、TB/Base/AI provider 均已在根仓 `apps/api` 与妙搭仓 `rq-sys-miaoda/server/rqsys` 落地并经 `npm run check:alignment` 守护。
- 本地 PostgreSQL 与单元测试不替代目标妙搭环境验证；任何发布与外部写入仍遵循 `AGENTS.md` 中的目标环境验证门禁。
