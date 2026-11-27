# 2026-11-26 回归报告（release 7712404150509161735 / 妙搭 190b64d / 0035）

- 环境：线上 https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u
- 发布：release `7712404150509161735`，妙搭 `190b64d`，CI `45788698555`，入口 302
- 身份：贾浩（妙搭 actor `1868660374748201`，飞书 `99f56141`）
- 调用：**5 次**（预算 3，超 2：分析首次契约失败重跑 1 次 + 同步带出的真实新需求分析 1 次）

## 0. 前置（0035）

| 检查 | 结果 |
|---|---|
| `requirement_prd_prompts.created_by` | 存在 |
| `requirement_assessments_single_running` / `requirement_prd_prompts_single_running` | 2 个都存在 |
| `requirements_title_search_idx` | 已删 |
| 触发器短路 | `rq_apply_requirement_resolution` 函数体含 `NEW.source_config_id IS NULL` 分支 |
| running 行 | 评估 0、提示词 0（迁移前后一致） |
| 迁移后的清理 UPDATE | 命中 0 行（线上当时无并发 running） |

## 1. AI 统一客户端（openai-http）

- 分析 RQ-000316「重新分析」（force）：
  - **v10 失败** `failed_retryable` / `safe_error_code=analysis_failure`，耗时 9.3s，原因：`scoring.basis: unknown basis keys: strategy.roadmap_note_placeholder`（模型多吐了一个 basis 键；basis 校验与提示词均非本批改动）。
  - 重跑 **v11 成功** `analyzed`、`provider=deepseek`、`model=deepseek-flash`、8.8s（17:16:16.558→17:16:25.324），审计 `analysis.terminal succeeded`，随后 `base.push succeeded`。
  - 失败 v10 无 `analysis.terminal` 审计：因当时 `push_state=pushed` 且 `analysisStatus!==analyzed`，advance 提前返回；错误原因在 `analysis_runs.safe_error_code/safe_error_summary` 与运维「分析失败码」可见（既有设计）。
- 评估：见第 2 组，v1 `succeeded`、`deepseek-flash`、14.9s、`error_detail=null`、`created_by` 正确。
- PRD 提示词：见第 3 组，v1 `succeeded`、`deepseek-flash`、32.0s、`created_by` 正确、输出通过结构化契约（4,981 字符）。

## 2. 评估限流 + 单飞

同一需求**并发 4 个** POST `/assessments`：

| 状态 | 数量 | 细节 |
|---|---|---|
| 201 | 1 | v1 `succeeded`，14.9s |
| 409 `ASSESSMENT_IN_PROGRESS` | 2 | 0.6s |
| 429 `RATE_LIMITED` | 1 | `Retry-After: 60`，0.5s |

- 只新增 1 条评估行，无第二条 `running`，无额外模型调用；60 秒后列表正常。

## 3. PRD 提示词单飞

并发 2 个 POST `/prd-prompts`（页面 evaluate 15s 超时，状态码从平台日志补证）：

- 日志：`POST …/prd-prompts` **201**、`duration_ms=31958`；另一条 **409 `PRD_PROMPT_IN_PROGRESS`**、`duration_ms=404`。
- 库：仅 1 条 v1 `succeeded`，`created_by=1868660374748201`，输出 4,981 字符，无 running。

## 4. 删除 / 回收站

- 基线 140（124/16）；删产品 RQ-000296 → 列表 139、回收站（产品池/活跃/17:27:12）。
- 手动同步 `11f1b97e-5426-4a90-b83b-6bf2a5da9781`：**335/335/0，45s**；该行 `deleted_at`/`deleted_by` 保留、`updated_at` 仍 17:27:13.0695、`analysis_runs` 仍 7 条、列表搜不到 → **不复活、不重分析**。
- 再删集团 RQ-000499 → 回收站两行倒序（集团池 17:30:37、产品池 17:27:12），`limit=1` 游标两页不重不漏。
- 还原两条 → 回 `active`、回收站空；`PATCH` 删除态 → 409 `REQUIREMENT_DELETED`，标题未被改。
- **同步带出真实新需求 RQ-000528**（TB 真实数据，执行人 李晨璐，`da4ba937…`）：自动分析（1 次调用）并推送 Base，新增 1 行。

## 5. 我的需求 + 负责人只读核对

- 首页卡与页面：**140**（产品 124 · 集团 16，含已压制 0），双 Tab、刷新保持。
- 产品 Tab 25 行全部「产品池」；集团 Tab 16 行全部「集团池」。
- 负责人快照核对：发版前 478 条 `manually_mapped`（3 条有负责人列、475 条没有）；同步后 **0 条执行人变更、0 条状态变化** → 本轮**无变更样本、未触发**，不能据此给线上证据。

## 6. 数据源页

- Base 链接：产品 `GRnEboCIga7Omas8RwgcDmmgnib`、集团 `HZ6NbvXKJa0o5Qs4hgQcSoirnde`，均 `https://`，复制按钮 aria-label 正确，页面无 `record=`。
- 收集表卡片文案「只读 / 同步已暂停 / 历史值」都在；「最近同步」取本池最新批次（17:27:27 成功）。
- 本轮未改保存链路，未重跑「不改值保存」；链接渲染改动已验证。

## 7. 安全链接 safe-url

- 接口：`PATCH` `supplementUrl=javascript:alert(1)` → **400 VALIDATION_FAILED**；`https://user:pass@example.com/x` → **400**；DB 未变（`supplement_url=null`、`source_version=1`、`updated_at` 不变）。
- 前端：手工录入「来源链接」填 `javascript:alert(1)` 提交 → 提示「来源链接需以 http:// 或 https:// 开头，且不能包含账号密码。」，未创建需求。

## 8. 其他

- `GET /api/health` 登录态 200 `{status:ok}`；`/api/health/ready` 200 `{status:ready,database:connected}`，`migrations.upToDate=null`（平台不暴露 `schema_migrations`，属已知）。
- 匿名访问 `/api/health`、`/api/requirements` 均 302 到飞书登录 → `@NeedLogin()` 生效。
- 空搜索 `q=zzz-no-such-20261126` → 200 空页。
- 同步单飞：已有运行中批次时再 POST `/api/sync/run` → **409 CONFLICT**，线上只有 1 个 running 批次；UI 第二次点击提示「当前状态不允许此操作」。
- 作业运维：两池可见；迁移显示「无法读取应用迁移记录（平台管理），期望 0035」；7 天同步 100%（7/7）、分析 64.3%（9/14）、推送 100%（7/7）；失败码 `provider_error×4`（11-20 旧）+ `analysis_failure×1`（本次 v10）。
- Kano：前置不满足，跳过。

## 清理与最终基线

- 评估删除 1 行、提示词删除 1 行（`rows_affected=1/1`）。
- Base：产品 336（+1 = RQ-000528 真实新需求）、集团 191；除此之外**全表 0 差异**。RQ-000316 行已还原：`AI分析版本=7`、`最后推送时间=1794801625241`、`系统通知事件ID=…av7`。
- DB：需求 **527 live / 0 deleted**（产品 335 TB + 1 手工、集团 191）；我的需求仍 140；评估 1 行（历史行，未动）、提示词 0；running 0；open jobs 0；`analysis_runs` 1631。

## 问题与观察

1. **分析首次契约失败**（`strategy.roadmap_note_placeholder`）：非本批代码改动，属模型输出抖动；重跑成功。建议观察是否复现。
2. **同步带出真实新需求 RQ-000528**：已正常分析和推送，Base +1 行；建议保留（真实 TB 数据，非造数）。
3. 失败分析在「已推送」状态下不写 `analysis.terminal` 审计（既有设计），错误只在 DB/运维指标可见；是否补审计请产品定。
4. 评估限流为进程内滑动窗口：单实例验证通过；多实例下每实例独立计数，未做集群验证。
5. 本轮调用 5 次超预算，原因见文首；RQ-000316 的重新分析触发过一次 Base 通知事件（收件人为用户本人贾浩），事件字段已还原。

## 证据

- `evidence/r-01-reanalyze-confirm.png`、`r-01b-reanalyze-pop.png`、`r-02-analysis-v11.png`
- `evidence/r-03-recycle-two-pools.png`
- `evidence/r-04-my-requirements-group.png`
- `evidence/r-05-sources.png`
- `evidence/r-06-safeurl-ui.png`
- `evidence/r-07-ops.png`
- `base-product-before.json` / `base-product-after-sync.json` / `base-product-final.json`、`base-group-before.json` / `base-group-final.json`
- `owner-state-before.json`（478 条负责人快照）
