# Teambition 数据源只读核对记录

- 核对日期：2026-10-08
- 方式：项目内 `skills/teambition` 技能，经内部 Teambition API 网关只读查询
- 查询范围：项目元数据、任务类型、自定义字段定义、需求记录结构；未输出需求正文、用户姓名或个人字段值

## 已实测

| 项目 | 结果 |
|---|---|
| 项目 | `需求收集与管理`，project ID `674e77e9ee4037da9d4b9f8e` |
| 任务类型 | 5 种；需求类型名称为 `需求`，配置 ID `674e7a7e5f95a1404621bb4c` |
| 需求记录 | 此次只读查询返回 1,285 条（含归档记录） |
| 标准字段 | `id`, `unique_id`, `content`, `creator_id`, `executor_id`, `taskflow_status_id`, `scenariofield_config_id`, `created`, `startdate`, `duedate`, `sprint_id`, `custom_fields` |
| 更新时间 | 此响应没有 `updated` / `modified` 字段 |
| 自定义字段结构 | `custom_fields` 是 JSON 编码的数组，元素含 `_customfieldid`, `type`, `value`, `values` |
| 字段配置 | 项目配置了 114 个自定义字段；实际需求只填充其中一部分 |

部分与 MVP 字段语义接近的配置（仅作为候选映射，仍需产品确认语义和允许同步范围）：

| TB 字段 | Field ID | TB 类型 | 初步用途 |
|---|---|---|---|
| 需求描述 | `674e7c2ceed2e651764a0d6f` | rtf | 描述候选 |
| 期望结果 | `674e8d321f580fe19bee3a32` | rtf | 验收/预期结果候选 |
| 需求提出人 | `68be4f5f4f5b7255e6fda8d6` | lookup | 提出人候选，需确认 lookup 值解析方式 |
| 需求分类 | `674e7a7e5f95a1404621bb40` | commongroup | 来源分类；不等同于 AI 模块建议 |
| 需求类型 | `674e7bab5f95a1404621c2f0` | dropDown | 来源类型候选 |

技能接口的 `get_tasks` 当前没有分页参数，且脚本会在本地按状态过滤已完成任务。同步服务需调用原始任务列表接口并保留全部项目需求，不能沿用默认归档过滤。此次完整列表规模为 1,285 条，后续仍需确认网关限额、超时和增长后的分页/分批策略。

## 数据库和同步设计结论

1. 唯一业务键使用 `(source_project_id, teambition_requirement_id)`；源 `id` 是字符串。`unique_id` 仅作为来源附加字段，不作为主键。
2. 因响应中没有可用更新时间，首版采用整项目拉取、字段 allowlist 标准化、规范化 JSON SHA-256 比较。unchanged 不生成新版本；变化后追加源快照。
3. 数据库不为 114 个自定义字段逐一建列。经批准的字段映射存入 `source_configs.field_map`；映射字段进入规范化投影，其他字段不进入 AI 输入或 Base 写入。
4. 当前响应未观察到来源 URL 或附件字段。它们保持可空，映射前须确认 API 是否有其他接口，不能自行拼接链接或当作已支持。
5. 原始负责人/提出人 ID 与其显示姓名分开存储。AI 请求从源投影构造，必须排除姓名、用户 ID 和联系方式。

## 尚未验证

- `id` 跨时间稳定性、已删除记录的发现方式、更新/删除事件。
- 更新时间过滤、API 分页、网关限流和批量上限。
- 自定义 lookup / RTF 字段完整值形态及附件引用接口。
- 妙搭部署环境访问 Teambition 网关及凭据注入方式。

这些事项已在 2026-10-08 下午的 Ticket 01 POC 补充实测中验证或关闭，见 [Ticket 01 POC 补充实测](#ticket-01-poc-补充实测2026-10-08-下午) 一节。

## Ticket 01 POC 补充实测（2026-10-08 下午）

- 方式：`.scratch/rq-sys-mvp/poc/tb_gateway_probe.py` 只读探测；原始证据：`.scratch/rq-sys-mvp/poc/teambition-poc-probe.json`
- 全部请求为只读 GET/已有查询端点；输出仅含计数、状态码与值形态，未记录需求正文、姓名或个人字段值

### 拉取与幂等键

| 验证项 | 实测结果 |
|---|---|
| 全量拉取 | HTTP 200，1,285 条，约 1.8–2.6s/次（3 次全量探测） |
| 需求 ID | 全部 24 位 hex 字符串，1,285 条内唯一，无空值 |
| 重复拉取 ID 稳定性 | 间隔 20s 两次拉取 ID 集合完全一致（0 增 0 减） |
| `unique_id` | 整数值（float 类型），min 1 / max 1,466 / 现存 1,285 条 → 存在约 181 个缺口，与历史删除记录一致；不作为键 |
| `(project_id, requirement_id)` 幂等键 | 成立；跨周稳定性保持为每次同步的持续观察项 |

### 分页、排序与更新时间筛选

| 参数组合 | 实测结果 |
|---|---|
| `page`/`pageSize`（1/10、2/10） | HTTP 500，不支持 |
| `limit`/`offset`（10/10） | HTTP 500，不支持 |
| `count`、`pageSize` 单独传入 | HTTP 500，不支持 |
| `orderBy`/`order`、`updatedFrom`/`updatedTo`、`modifiedFrom` | HTTP 500，不支持 |

结论：网关 `getProjectTasks` 对未知查询参数直接返回 500，无任何服务端分页、排序或更新时间筛选。增量判断必须走整项目拉取 + allowlist 规范化 + 规范化 JSON SHA-256 比较（与现有设计一致）。1,285 条规模下单次全量约 2.3s，当前规模可接受；规模显著增长后再评估分批策略。

### 错误行为

| 场景 | 实测结果 | 设计含义 |
|---|---|---|
| 无效 `project_id`（不存在的 24 位 hex） | **HTTP 200 + 空数组** | 同步服务必须先经 `getProject` 校验项目存在，否则会静默导入空集 |
| 无效 `scenariofield_config_id` | HTTP 200 + 空数组 | 同上；启动/同步前校验 config ID |
| 缺失 `project_id` | HTTP 500 `Internal Server Error` | 客户端必须校验必填参数 |
| 无效 API key | HTTP 403 `{detail: "Could not validate API Key"}` | 401/403 归类为凭据错误，不重试 |
| 未知端点 | HTTP 404 `{error}` | 正常错误归类 |

### 限流与性能初探

- 6 次连发元数据请求全部 200（49–186ms），无 429；本强度下未观察到限流行为
- 全量拉取 1,829–2,543ms；当前规模下整批拉取可行，更大并发/规模下的限流阈值保持观察项

### 字段映射表（PRD 范围字段逐项，1,285 条实测）

| PRD 字段 | TB API 来源 | 类型/形态 | 空值实测 | 结论 |
|---|---|---|---|---|
| 需求 ID | `id` | 24-hex 字符串 | 0 空 | ✅ 已映射，幂等键组成部分 |
| 项目/来源 | 配置注入 `project_id` | 字符串 | — | ✅ 配置项，非记录字段 |
| 标题 | `content` | 字符串 | 0 空 | ✅ 已映射 |
| 描述 | 自定义字段 `需求描述`(rtf) `value[0].meta.html` | dict{html,url,uploadip?,attachments?} | 372 null + 7 缺失 | ✅ 已映射；见归一化注意 |
| 验收标准 | 自定义字段 `期望结果`(rtf) `value[0].meta.html` | 同上 | 11 null + 349 缺失 | ✅ 已映射 |
| 范围 (scope) | 无对应 API 字段 | — | — | ❌ 不可用，保持可空，不得推断 |
| 提出人 | 自定义字段 `需求提出人`(lookup) `value[]` | 对象数组，元素 keys=`_id,title,thumburl,meta`；`meta`={userid,avatarurl}；可多人（实测 2 条为 10 人） | 519 缺失 + 空值 | ✅ 已映射；ID/姓名分离存储 |
| 执行人/负责人 | `executor_id` + `getMembers` 映射姓名 | 字符串 ID | 35 空（无负责人） | ✅ 已映射；35 条无负责人需求必须可推送 |
| 创建者 | `creator_id` | 字符串 ID | 0 空 | ✅ 已映射 |
| 来源状态 | `taskflow_status_id` + `getProjectTaskFlowStatus` | 字符串 ID | — | ✅ 已映射（以 ID 为准，不依赖终端渲染名称） |
| 创建时间 | `created` | ISO 时间字符串 | — | ✅ 已映射 |
| 更新时间 | 响应中无 `updated`/`modified` 字段 | — | — | ❌ 不可用；增量判断走全量 + 哈希比较 |
| 来源 URL | 无顶层 URL 字段；rtf `meta.url` 存在 | dict 键含 `url` | — | ⚠️ 语义未确认（疑似上传源 IP/URL），不得自行拼接链接 |
| 附件引用 | rtf `meta.attachments` 键存在于部分描述/验收值 | dict 键 | 描述 211 条、验收 36 条含 attachments 键 | ⚠️ 存在引用入口但内部结构未逐项验证；保持可空 + 引用语义，附件内容不入模型 |
| 需求分类（来源） | 自定义字段 `需求分类`(commongroup) | 数组 | 916 缺失，369 存在但恒为空数组 | ⚠️ 本项目当前不可用为源信号 |
| 需求类型（来源） | 自定义字段 `需求类型`(dropDown) `value[0]={_id,title}`、`values[0]`=标签字符串 | 对象+字符串 | 581 缺失 + 4 空 | ✅ 可映射（若获批进入 `field_map`） |
| 获批自定义字段 | `custom_fields` JSON 数组，元素 `{_customfieldid, type, value, values}` | — | 1,285/1,285 解析成功 | ✅ 仅 allowlist 字段进入投影 |

### 归一化注意（新发现）

1. **`custom_fields` 可含同一 `_customfieldid` 的重复条目**：293 条任务存在重复（共 293 条多余条目）。归一化必须按 `_customfieldid` 去重后再取值。
2. rtf 值主体在 `value[0].meta.html`；`meta.url`/`meta.uploadip` 语义未确认，不入投影。
3. lookup 多人值：保留数组并逐人拆分 ID/姓名；`meta.userid` 可用于提出人 ID。
4. commongroup（需求分类）在本项目恒空，不得作为分类信号；AI 模块建议独立产生（与 CONTEXT.md 一致）。
5. `unique_id` 是整数序列且有缺口，证明历史删除发生过；删除检测仍无 API，保持为同步侧观察项。

### Ticket 01 门槛状态

- ✅ 已关闭：应用授权、项目查询、需求列表契约、稳定 ID（会话内）、全量导入范围、重复同步判断方式、错误行为、限流初探、字段映射表
- ⏳ 保持开启（持续观察/后续 POC）：
  - 需求 ID 跨周稳定性（建议每次同步记录 ID 集合差异并告警）
  - 删除记录的发现方式（无删除事件 API，靠 unique_id 缺口与全量比对）
  - rtf `meta.attachments` 内部结构与 `meta.url` 语义
  - 网关在更高并发/更大规模下的限流阈值
  - 妙搭部署环境访问 Teambition 网关及凭据注入方式（归 Ticket 00）
