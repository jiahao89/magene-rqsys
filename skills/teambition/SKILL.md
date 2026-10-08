---
name: teambition
label: Teambition项目管理
description: |
  获取 Teambition 项目管理平台的数据，包括项目、任务、缺陷、迭代、成员等信息。
  触发场景：
  - 用户询问 Teambition 项目进展
  - 查询某个项目的任务或缺陷列表
  - 获取迭代/冲刺进度
  - 查看团队成员分工
  - 任何与 Teambition 项目数据相关的查询
---

# Teambition 项目管理

通过内部 API 网关访问 Teambition 数据。

## 配置

| 参数 | 值 |
|------|-----|
| API 地址 | 经 `TEAMBITION_GATEWAY_URL` 环境变量配置（内网网关，不写入仓库） |
| 认证方式 | Bearer Token（`GATEWAY_API_KEY` 环境变量，运行前必须配置） |

## 快速使用

```bash
# 列出所有项目
python scripts/teambition_api.py get_projects

# 项目详情
python scripts/teambition_api.py get_project <project_id>

# 项目任务（推荐 — 自动关联姓名、状态、迭代）
python scripts/teambition_api.py get_tasks_by_name <project_id> --names "任务"

# 项目缺陷
python scripts/teambition_api.py get_tasks_by_name <project_id> --names "缺陷"

# 完整缺陷（含关联信息）
python scripts/teambition_api.py get_full_bugs <project_id>

# 迭代列表
python scripts/teambition_api.py get_sprints <project_id>

# 组织成员
python scripts/teambition_api.py get_members

# 任务活动日志（可追溯父子任务关系）
python scripts/teambition_api.py get_task_activity <task_id>

# 批量任务活动日志
python scripts/teambition_api.py get_tasks_activity <task_id1>,<task_id2>
```

> 硬件项目的任务类型名称不同（如 `"任务-(硬件项目)"`），先用 `get_scenariofield_configs <project_id>` 查看实际名称。

## 所有命令

| 命令 | 功能 | 关键参数 | 返回 |
|------|------|----------|------|
| `get_members` | 组织成员 | — | `{user_id: {name, employee_number, title}}` |
| `get_projects` | 所有项目 | — | `{project_id: {name, uniqueIdPrefix, ...}}` |
| `get_project <id>` | 项目详情 | project_id | 项目完整字段 |
| `get_custom_fields <id>` | 自定义字段配置 | project_id | `{field_id: field_name}` |
| `get_scenariofield_configs <id>` | 任务类型配置 | project_id | `{config_id: config_name}` |
| `get_task_flows <id>` | 任务流列表 | project_id | `{taskflow_id: taskflow_name}` |
| `get_task_flow_status <ids>` | 任务流状态 | taskflow_ids（逗号分隔） | `{status_id: status_name}` |
| `get_bug_groups <id>` | 缺陷分组 | project_id | `[{id, name}]` |
| `get_sprints <id>` | 迭代列表 | project_id | `{sprint_id: {id, name, startdate, duedate}}` |
| `get_tasks <id>` | 任务列表（原始） | project_id, `--scenariofield_config_id`, `--include-archived` | 任务记录列表（ID 引用），默认排除已归档 |
| `get_tasks_by_name <id>` ⭐ | 任务列表（推荐） | project_id, `--names`, `--sprintIds`, `--bugGroupIds`, `--limit`, `--include-archived` | 结构化任务（含姓名、状态、迭代） |
| `get_bugs <id>` | 缺陷列表 | project_id, `--scenariofield_config_id`, `--sprintIds`, `--bugGroupIds` | 缺陷记录列表 |
| `get_full_bugs <id>` | 完整缺陷 | project_id, `--scenariofield_config_id`, `--sprintIds`, `--bugGroupIds`, `--limit` | 含执行者、状态、迭代的缺陷 |
| `get_task_activity <task_id>` | 任务活动日志 | task_id | `[{id, content, created, ancestor}]` |
| `get_tasks_activity <task_ids>` | 批量任务活动日志 | task_ids（逗号分隔） | `{task_id: [{id, content, created}]}` |

## 常用查询场景

### 查询今日完成任务

Teambition API **没有全局活动日志接口**，`get_task_activity` 只能按单个任务查询。因此查询"今天完成了哪些任务"的**正确方法**是：

1. **拉取全量任务**：对项目**所有任务类型**使用 `--include-archived` 获取完整列表
2. **识别已完成任务**：筛选当前状态为"已完成"的任务（注意不同任务流有不同"已完成"状态 ID）
3. **批量查询活动日志**：对已完成任务使用 `get_tasks_activity` 批量查询，筛选当天 `created` 且 `content` 含 `taskflowstatus.*已完成` 的记录

```bash
# 步骤 1: 获取所有任务类型
python scripts/teambition_api.py get_scenariofield_configs <project_id>

# 步骤 2: 对每个类型拉取含归档的完整任务列表
python scripts/teambition_api.py get_tasks <project_id> \
  --scenariofield_config_id <config_id> --include-archived

# 步骤 3: 对已完成任务批量查询活动日志（逗号分隔多个 ID）
python scripts/teambition_api.py get_tasks_activity <task_id1>,<task_id2>,...
```

**关键注意事项**：
- **必须查所有任务类型**（如"任务-(硬件项目)"、"任务（交付物）-(硬件项目)"等），不同任务流有独立的"已完成"状态 ID
- **必须实时拉取**，不要使用缓存的任务数据（状态可能已变更）
- **不要仅凭当前状态判断**：状态为"已完成"只能说明曾经完成过，需查活动日志确认具体完成时间

### 查询延期任务

```bash
# 获取原始任务（含 duedate 字段）
python scripts/teambition_api.py get_tasks <project_id> \
  --scenariofield_config_id <config_id> --include-archived

# 筛选 duedate < now 且 taskflow_status 非"已完成"
```

> `get_tasks` 返回含 `duedate`/`startdate` 字段，`get_tasks_by_name` 不含这两个字段。

### 获取迭代进度

```bash
# 先查迭代
python scripts/teambition_api.py get_sprints <project_id>
# 按 sprintIds 过滤任务
python scripts/teambition_api.py get_tasks_by_name <project_id> \
  --names "任务-(硬件项目)" --sprintIds "<sprint_id>"
```

### `get_tasks_by_name` ⭐ 推荐

按任务类型名称查询，返回结构化数据，**无需手动关联 ID**。

```bash
python scripts/teambition_api.py get_tasks_by_name <project_id> --names "任务,缺陷"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--names` | 是 | 任务类型名称，逗号分隔 |
| `--sprintIds` | 否 | 限定迭代 ID，逗号分隔 |
| `--bugGroupIds` | 否 | 限定缺陷分组 ID，逗号分隔 |
| `--limit` | 否 | 条数限制（默认 100） |

返回字段：`id`, `content`, `created`, `creater` `{name, title}`, `executor` `{name, title}`, `taskflow_status`, `sprint`

### `get_tasks` — 原始任务列表

按配置 ID 获取原始任务记录，返回 ID 引用需手动关联。**未指定 `--scenariofield_config_id` 时自动使用名称为"任务"的配置**。适用于需要 `custom_fields` 等原始字段的场景。

### `get_bugs` — 缺陷列表

获取项目缺陷。**未指定 `--scenariofield_config_id` 时自动使用名称为"缺陷"的配置**。

### `get_full_bugs` — 完整缺陷

内部自动聚合成员、迭代、任务流数据，返回字段同 `get_tasks_by_name`。

### `get_task_activity` — 任务活动日志

返回单个任务的活动日志列表，可通过 `ancestor` 字段追溯父子任务关系。返回字段：`id`, `content`, `created`, `ancestor`。

### `get_tasks_activity` — 批量任务活动日志

批量获取多个任务的活动日志，是 `get_task_activity` 的批量版本。

```bash
python scripts/teambition_api.py get_tasks_activity <task_id1>,<task_id2>,<task_id3>
```

**返回**: 字典，Key 为任务 ID，Value 为该任务的活动日志列表（包含 `id`, `content`, `created`）。传入空值时返回 `{}`。

### `get_sprints` — 迭代列表

返回包含完整迭代信息（名称、开始/截止日期）的字典。

### 归档过滤

`get_tasks` 和 `get_tasks_by_name` 默认排除已归档（已完成）的任务，仅返回活跃任务。如需包含已归档任务，使用 `--include-archived` 标志：

```bash
# 默认：排除已归档任务
python scripts/teambition_api.py get_tasks <project_id>

# 包含已归档任务
python scripts/teambition_api.py get_tasks <project_id> --include-archived
```

> 过滤原理：通过任务流状态名称识别"已完成"类状态。由于 Teambition API 不直接暴露 `isArchived` 字段，此为最佳近似过滤。

## 常见陷阱

### 状态名称编码

`get_task_flow_status` 返回的状态名称可能因终端编码问题显示乱码。**始终传入 `$env:PYTHONIOENCODING='utf-8'`**，且优先以状态 ID 而非显示名称做判断：

```powershell
# 正确写法 — 设置编码后查询
$env:PYTHONIOENCODING='utf-8'
python scripts/teambition_api.py get_task_flow_status <ids>

# 输出中常见状态 ID 对照（硬参考，避免依赖终端编码）：
#   69d777307b8709475155a991 → 未开始
#   69d777307b8709475155a992 → 已完成
#   69d777307b8709475155a994 → 进行中
#   69d777307b8709475155a9c5 → 待验证
```

> 每个项目/任务流的状态 ID 不同，以上仅为示例。确认状态含义时，应同时检查 ID 和原始 JSON 输出，不要仅凭终端渲染的中文判断。

### 幽灵子任务（API 返回但 UI 不显示）

`getProjectTasks` 会返回通过任务拆解自动生成的子任务。这些任务在 Teambition UI 的主列表/甘特图中不可见，但 API 会原样返回，导致查询结果比用户预期多。

**识别方法**：通过 `get_task_activity` 查看任务的 `ancestor` 字段——幽灵子任务的活动日志中会包含父任务引用：

```json
{
  "content": "{\"task\":{...},\"ancestor\":{\"_id\":\"<parent_task_id>\",...}}",
  "created": "..."
}
```

**过滤方法**：对查询结果按任务名去重时，优先保留创建时间最早、活动日志**不含** `ancestor` 的条目。同名但创建时间较晚且有 `ancestor` 引用的通常是幽灵子任务，应从结果中排除。

> 在上次查询中，5/27 的两个"电子详细设计""结构详细设计"即为幽灵子任务——它们是 5/26 同名任务拆解后的自动副本，不显示在 UI 中。

## 原始任务字段（`get_tasks` 返回）

| 字段 | 说明 |
|------|------|
| `id` | 任务 ID |
| `content` | 任务标题 |
| `executor_id` | 执行者 ID → `get_members` 映射 |
| `creator_id` | 创建者 ID → `get_members` 映射 |
| `custom_fields` | 自定义字段（JSON 字符串）→ `get_custom_fields` 解析 |
| `sprint_id` | 迭代 ID → `get_sprints` 映射 |
| `scenariofield_config_id` | 任务类型配置 ID |
| `taskflow_status_id` | 任务流状态 ID → `get_task_flow_status` 映射 |
| `created` | 创建时间 |

> 返回字段中**不包含 `parentTaskId`**，父子任务关系需通过 `get_task_activity` 的活动日志中 `ancestor` 字段追溯。

## 周报生成 ⭐

自动生成项目周报（Word 文档），包含四个板块：本周已完成、延期任务、进展更新详情、下周截止。

```bash
# 1. 生成周报 JSON 数据
python weekly_report/generate.py <project_id> \
  --week-start 2026-05-18 \
  --project-name "KY/KY01" \
  --primary-config <config_id> \
  --output output/report.json

# 2. 生成 Word 文档
python weekly_report/generate_docx.py output/report.json \
  --template "XX项目周报-TB版.docx" \
  --output output/周报.docx
```

| 参数 | 说明 |
|------|------|
| `--week-start` | 周一日期，默认上周一 |
| `--project-name` | 项目名称（周报标题用） |
| `--primary-config` | 主任务配置 ID，用于延期任务筛选。若自动检测不准，手动指定 |
| `--template` | Word 模板路径，默认项目根目录 `XX项目周报-TB版.docx` |

### 生成规则

| 规则 | 说明 |
|------|------|
| 排除阶段容器 | 立项/计划/EVT/DVT/PVT/量产爬坡 |
| 排除依赖通知 | `taskflowstatusname` ≠ 实际完成 |
| 排除瞬态完成 | 最终状态非"已完成"不计入 |
| 排除已归档 | `isarchived` 的任务自动排除 |
| 延期仅取主配置 | 避免模板残留配置的幽灵任务 |

