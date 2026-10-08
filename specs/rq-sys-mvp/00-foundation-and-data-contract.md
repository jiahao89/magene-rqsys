# Spec 00 — Foundation and Data Contract

Status: [ready-for-agent] for the current MVP contract. The full 28-field requirements model is explicitly deferred.

## Problem and outcome

The system currently spans Teambition, an application database, Feishu Base, AI, and a Web workbench. Each field and state must have one owner so repeated syncs, AI reruns, and PM edits do not overwrite each other.

The MVP provides a traceable requirement record and a narrow Base collaboration view. It is not the full 需求处理流程 lifecycle system.

## Actors

- System administrator: configures the source project, schedule, credentials, and owner names.
- PM Leader: triggers sync, resolves owner mappings, reviews module/rule configuration, and can retry.
- Designated operator: triggers sync, maps owners, and retries within permission.
- PM / stakeholder: reviews and updates PM-owned fields in Base.
- Scheduler / integration workers: run sync, AI, push, and notification-triggering updates.

## User stories

1. As a system administrator, I want every stored field to have an owner and overwrite rule, so that integrations cannot erase human decisions.
2. As a PM Leader, I want AI suggestions and confirmed PM values stored separately, so that a rerun cannot replace a human decision.
3. As an operator, I want every batch and per-requirement transition to be auditable, so that failures can be diagnosed and retried safely.
4. As a PM, I want Base to show the collaboration fields relevant to the MVP, so that I can process pushed requirements without treating Base as the full domain database.

## Domain objects

| Object | Authoritative storage | Minimum contents |
|---|---|---|
| Source configuration | Application database | Teambition project ID/name, enabled state, weekly schedule, owner-name list |
| Sync batch | Application database | Trigger type, actor, start/end, status, counts, error summary |
| Sync item | Application database | Batch, source requirement key, action, stage, error code/detail, Base record ID |
| Requirement map | Application database | Project ID + requirement ID, Base record ID, source snapshot/hash/version, independent pipeline states |
| Analysis result | Application database | Requirement key, attempt/version, state, structured payload, model/prompt/dictionary/rule versions, timestamps |
| Person map | Application database | Optional TB user ID, TB display name, Feishu user identity, match method, active state |
| PM current values | Feishu Base | PM status, confirmed module/priority, handler, handled time, structured note |
| PM history snapshot | Application database | Prior PM status/confirmed values/handler/structured note, snapshot time and source version |
| Pipeline history / audit | Application database | Actor, object, transition/action, timestamp, result and safe error details |
| Module dictionary / rule configuration | Application database | Versioned controlled modules and published priority rules |

The current requirement identifier in the MVP is the Teambition requirement ID scoped by project ID. If the actual Teambition object cannot provide a stable ID, implementation must stop at the integration POC and return with a product decision; do not invent a title-based key.

## Field ownership

| Field group | Source | Can be overwritten by later sync? |
|---|---|---|
| Teambition source facts | Teambition | Yes, only corresponding source-owned fields |
| AI recommendations | Analysis service | On a new analysis version only |
| Person mapping | Mapping workflow / operator | Only by matching or explicit operator selection rules |
| PM confirmation and processing | Feishu Base in this MVP | No; source sync never writes these fields directly |
| Workflow and batch states | Application database | By state-machine transitions only |
| PM snapshots / audit | Application database | Append-only |

The technical design’s proposed Base fields are an MVP projection, not the complete upstream field dictionary. The full upstream model contains 28 fields; adding it requires a separate field-mapping spec and a decision on which system owns each field.

## State contract

| Dimension | Values | Meaning |
|---|---|---|
| TB pull | 待同步 / 同步中 / 已同步 / 失败 | 已同步 means source snapshot was saved, not that Base was written |
| AI analysis | 待分析 / 分析中 / 已分析 / 分析失败待重试 | AI status is independent of push status |
| Owner matching | 待匹配 / 自动匹配 / 人工指定 / 无需匹配 | 无需匹配 applies when TB has no owner |
| Base push | 待推送 / 推送中 / 已推送 / 失败 | 已推送 means Base create/update succeeded |
| PM processing | 待处理 / 已采纳 / 已调整 / 暂不处理 | Maintained in Base only; not read back by Web |
| Batch | 执行中 / 成功 / 部分失败 / 失败 | One failed item does not roll back successful items |

## Change classification

Substantive fields: title, description, scope, acceptance criteria, and attachment reference. A substantive change requires a pre-update snapshot of PM status, confirmed fields, handler, and structured note; after a successful snapshot, update source/AI fields, retain the prior PM values as history, and set PM status to 待处理. If the snapshot cannot be read, do not mutate the existing Base record or its PM fields; fail that item and continue the batch.

Metadata-only changes: owner, source status, and timestamps. Handle them by their own rules; do not reset PM processing.

## Out of scope

- Managing all 28 upstream requirement-definition fields.
- Full execution lifecycle from planning through release and validation.
- Base-native comment history ingestion.
- PM decisions, plan dates, solution plans, and release versions as Web-owned records.
- Two-way synchronization of PM status or notification delivery into Web.
- Replacing Teambition as the source of original facts.
