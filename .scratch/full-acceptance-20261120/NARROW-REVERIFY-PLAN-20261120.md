# 窄复验计划（修复后）

- 日期：2026-11-20
- 触发：Chief 定「修完只复验对应块，不重跑全量」
- 范围：块 2 的 F1（手工详情创建时间）、块 5 的 F2（非 409 失败后历史不刷新）+ F1（60000→65000）、chat_paste 详情补验
- 不做：不重跑 Base 链路、不重跑全量门禁、不碰评估历史回填（下轮）

## 0. 环境与通道（已确认）

- 目标环境：`https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u`，租户会话已登录（ego-browser space 10）
- API base：`/app/app_17fqkjwyx1u/api`；CSRF 头 `X-Suda-Csrf-Token: window.csrfToken`；创建需求另需 `Idempotency-Key`
- 只读探针：`GET /app/app_17fqkjwyx1u/api/requirements/source-counts` → **334 / TB 333 / 手工 1 / 多维表格 0 / 聊天粘贴 0**
- 校验探针：`POST /api/requirements` 传非法 `sourceChannel` → **400 VALIDATION_FAILED**（未写数据）

## 1. 发版识别（修复是否真的上线）

- 线上静态资源路径带 commit 前缀：发版前为
  `.../app_17fqkjwyx1u/3422425af3912a0ca1aaf140f96d65e2447315d6/client/assets/index-DHJIcWL7.js`
- 发版前产物内评估超时是 `window.setTimeout(()=>r.abort(),6e4)`（=60000，F1 现场证据，已留存）
- 复验条件：资源前缀不再是 `3422425af3…`，且新 chunk 内出现 `65e3`（=65000）且评估调用不再用 `6e4`
- 取 chunk：浏览器 `performance.getEntriesByType("resource")`，或 curl 静态域名 `lf-miaoda-static.feishucdn.com`

## 2. 块 2 · F1 手工详情创建时间

| 步 | 动作 | 预期 |
|---|---|---|
| 1 | `GET /api/requirements/{RQ-000316 id}` | DTO 含 `createdAt`（四种来源同返回），值非空 |
| 2 | 打开 RQ-000316 详情 | 底部「创建时间」显示具体时间，不再「未填写」 |
| 3 | 对照 `created_at` 与页面显示（时区） | 一致；不出现 `source.createdAt` 兜底 |

RQ-000316 手工需求 id：`85837f43-1cd0-423b-9413-fe274e4ae8a1`

## 3. 块 5 · F2 失败版本可见 + F1 超时边界

| 步 | 动作 | 预期 |
|---|---|---|
| 1 | 代码/产物复核 `panels.tsx` 评估错误分支 | 非 409 也 `load(true)`（或合并 failed 行） |
| 2 | 前端新增的 503 单测 | 存在且通过；本地 `vitest run` 定向跑 |
| 3 | 线上 409 路径（同一需求并发两次生成） | 第二个 409，历史刷新，无重复版本 |
| 4 | 产物内超时常量 | `65e3`，无评估处 `6e4` |

说明：真实 `analysis_failure`/`timeout` 在生产不可控触发，线上只验 409 + 产物/单测；真失败路径以单测 + 代码走查为准，如实标注，不记线上 PASS。

## 4. chat_paste 详情补验（造数，已获 Chief 授权）

- 创建：`POST /api/requirements`，body
  `{title:"[验收] 聊天粘贴来源详情校验", description:"…", sourceChannel:"售后", intakeOrigin:"chat_paste", proposerName:"验收测试待删"}`
- 预期落库：`source_type=web_manual` + `source_payload.intakeOrigin=chat_paste`；`source-counts.chat_paste` **0→1**
- 详情应显示：标题/描述/提出人；**无** TB 字段（执行人、状态、链接、创建/更新时间等）；来源「来自聊天粘贴…」；来源徽标紫色；「编辑需求」入口（web_manual 口径）；评估区空态
- Base：来源方式应为「聊天粘贴」；不写「系统通知事件ID」，**不发 PM 通知**
- 清理：验完报 Chief，由后端删 App 行 + Base 行；基线回 334/333/0/1/0
- 约束：建之前/之后在群里报时间与标题，避免与后端数据一致性核对撞车

## 5. 交付物

- 本文件 + 复验结果写入 `NARROW-REVERIFY-RESULT-20261120.md`
- 截图：`rv-01-manual-createdat.png`、`rv-02-chatpaste-detail.png`、`rv-03-chatpaste-base-source-method.png`
- 矩阵 §块 2 / §块 5 与总体结论按复验结果更新
