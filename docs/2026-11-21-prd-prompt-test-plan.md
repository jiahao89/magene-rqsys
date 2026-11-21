# PRD 提示词生成 · S3 测试计划

- 日期：2026-11-21
- 依据：[2026-11-21-prd-prompt-spec.md](</Volumes/Files/A_Projects/RQ-Sys/docs/2026-11-21-prd-prompt-spec.md>)（PP1–PP10）
- 范围：`requirement_prd_prompts`（迁移 0032）、`POST/GET /api/requirements/{id}/prd-prompts`、详情「PRD 提示词」块
- 不做：不写 Base、不发通知、不改需求/评估/分析；不测模板降级（规格明确不做）

## 1. 分层与证据要求

| 层 | 环境 | 覆盖 | 是否算线上证据 |
|---|---|---|---|
| L1 契约/单测 | 本机 | 校验规则、错误码、事件 ID、skill 同源、SQL 契约 | 否 |
| L2 集成（stub 供应商） | 本机 | 成功/失败/超时/非法输出/单飞/限流/PII 掩码 | 否（stub 可断言模型入参） |
| L3 目标环境（真模型） | 线上 | 成功生成、版本化、UI、复制、无副作用、跨池 | **是** |

- L2 必须能捕获并断言**发给模型的 messages**（PII 掩码、提出人不在、调研结论在）。
- L3 只跑「成功路径 + 版本化 + UI/复制」，失败路径不拿线上供应商做实验。

**契约（2026-11-21 后端口径）**：`POST` 201 返回裸对象 `{id, version, status, output, promptVersion, model, investigationNotes, assessmentVersion, errorCode, createdAt, completedAt}`；`GET` 返回 `{items}`（同结构，按 version DESC）。该接口 **没有 `pool` 参数**，池由需求 UUID 推导，跨池不返回 404。

## 2. 测试数据与清理

| 项 | 取值 |
|---|---|
| 需求 | **RQ-000316**（`验收测试：手工录入需求（可忽略）`，UUID `85837f43-1cd0-423b-9413-fe274e4ae8a1`），产品池、手工来源、已推送，适合做样例 |
| 评估 | 先为它生成 1 条成功评估（1 次模型调用），记录 `assessmentId/version` |
| 提示词 | 生成 2 次（空调研结论 1 次 + 带调研结论 1 次），2 次模型调用 |
| 成本 | 线上共 3 次模型调用，执行前单独报备 |
| 清理 | 无删除接口，需 DB 写权限：`DELETE FROM requirement_prd_prompts WHERE requirement_id='85837f43-…'; DELETE FROM requirement_assessments WHERE requirement_id='85837f43-…';` 由 Chief/后端执行，测试复核 `GET` 返回 `items: []`、评估列表为空 |
| 基线 | 执行前后：需求 334、Base 334、评估表与提示词表行数；集团池 191 不动 |

## 3. 用例（按 PP 映射）

### PP1 入口与前置

| ID | 场景 | 方法 | 期望 |
|---|---|---|---|
| S3-01 | 无成功评估时生成 | L2 API | 409 `ASSESSMENT_REQUIRED`；**不创建版本**（表行数不变） |
| S3-02 | 无成功评估时 UI | L1 组件 | 块禁用 + 「先生成需求评估」+ 跳转；按钮不可点 |
| S3-03 | 打开详情/切版本 | L1 + L3 | 不自动调用模型（网络无 POST）；无自动复制 |

### PP2 输入

| ID | 场景 | 方法 | 期望 |
|---|---|---|---|
| S3-04 | 调研结论 0 字 | L2 | 201；输出第 9 章含「调研结论未回填」，关键未知进 `openQuestions` |
| S3-05 | 8,000 字 | L1 | 通过 |
| S3-06 | 8,001 字 | L1 | 400；不创建版本；输入保留（前端） |
| S3-07 | PII 掩码 | L2 | stub 收到的 messages 中手机号/邮箱/姓名已掩码；提出人不在 messages 中 |
| S3-08 | 指定 assessmentId | L2 | 不存在/不属于该需求/非 succeeded → 400 或 409；不创建版本 |

### PP3/PP4 输出契约与质量

| ID | 场景 | 方法 | 期望 |
|---|---|---|---|
| S3-09 | 合规输出 | L2 | 201；10 个二级标题齐全且顺序一致；`prompt` 1,500–8,000 字；`assumptions` 每条以「假设：」开头；无额外字段 |
| S3-10 | 非法输出 | L2 stub | 三种：非 JSON、缺章节、多字段 → `failed/invalid_output`；POST 返回 503 或明确错误；**不返回半成品** |
| S3-11 | 内容质量抽查 | L3 | 覆盖事实/分析/评估/调研结论；无编造数字/规格/成本/周期；`hold` 评估先写暂缓条件（用 stub 构造 hold 场景） |

### PP5 版本化

| ID | 场景 | 方法 | 期望 |
|---|---|---|---|
| S3-12 | 连续生成两次 | L2 | v1、v2 两行；v1 的 output/inputs 不变；`(requirement_id, version)` 唯一 |
| S3-13 | 版本历史 | L2 + L3 | GET 按 version DESC；切 v1 展示 v1 结果并回填 v1 的 `investigationNotes`；旧版本只读 |
| S3-14 | 失败版本保留 | L2 | 失败行 status=failed、output=null、error_code 正确；后续成功生成 v3 不影响 v1/v2 |

### PP6 失败与单飞

| ID | 场景 | 方法 | 期望 |
|---|---|---|---|
| S3-15 | 并发两次 POST | L2 | 一个 201、一个 409 `PRD_PROMPT_IN_PROGRESS`；只 1 个版本 |
| S3-16 | running 超 2 分钟 | L2 假时钟 | 转 `failed/timeout`；可重试 |
| S3-17 | 供应商 5xx | L2 stub | 503；落 `failed/provider_error`；保留输入 |
| S3-18 | 超时 | L2（缩短 `PRD_PROMPT_TIMEOUT_MS`） | 落 `failed/timeout`；不产生半成品；前端 95s 提示 |
| S3-19 | 限流 | L2 | 第 3 次/分钟 → 429 + `Retry-After`；不创建版本 |
| S3-20 | 重试 | L2 | 失败后再 POST 生成新版本；旧失败版本保留 |

### PP1–PP10 交叉：跨池与安全

| ID | 场景 | 方法 | 期望 |
|---|---|---|---|
| S3-21 | 产品 UUID 带 `?pool=group` / `?pool=product` / 不带 | L2/L3 | **结果一致**（201/响应体相同）；该接口无 `pool` 参数，按 UUID 推导 |
| S3-22 | 集团 UUID 带任意 `?pool` | L2 | **结果一致**（同样 201）；集团池只读约束不受影响 |
| S3-23 | 不存在的 UUID | L2 | 404 `NOT_FOUND` |
| S3-24 | 输出安全 | L2/L3 | 无 PII/密钥/Base ID/record ID/裸 URL；无提出人 |
| S3-25 | 无副作用 | L3 | 只新增 `requirement_prd_prompts` 行；需求、评估、分析、Base 两表、通知事件计数不变 |
| S3-26 | skill 同源 | L1 | 服务端 system prompt 规范化后与 `skills/prd-prompt/SKILL.md` 一致；`promptVersion=rq-prd-prompt-v1` 落库 |

### PP8 复制 / PP10 门禁

| ID | 场景 | 方法 | 期望 |
|---|---|---|---|
| S3-27 | 复制 | L1 + L3 | 复制内容与 `output.prompt` 逐字一致；剪贴板不可用时选中降级 |
| S3-28 | 门禁 | 两仓 | typecheck/build/API 全量/Web/alignment/arco/migrations/diff-check；非 ENOENT 失败 0 |

## 4. L3 目标环境执行顺序（约 30 分钟）

1. 记基线：需求 334 / 集团 191 / Base 334、191 / 评估表 0 / 提示词表 0。
2. 为 RQ-000316 生成 1 条评估（1 次模型调用）→ 校验 `succeeded`，记 `assessmentId`。
3. 生成 PRD 提示词（空调研结论）→ 201，校验 10 章、长度、`promptVersion`；截图 UI。
4. 带调研结论再生成一次 → v2；切 v1 校验回填；复制校验。
5. 打开详情不点按钮 → 确认无新请求（网络面板）。
6. 复核无副作用：需求/评估/分析/Base/通知不变；只多 1 行评估 + 2 行提示词。
7. 清理：交给 Chief/后端执行 §2 SQL；测试复核 GET 空、评估空、计数回基线。

## 5. 判据

- L1/L2 全绿（非 ENOENT 失败 0）；
- L3 的 S3-01/03/09/12/13/21/24/25/27 全部通过；
- 测试数据清理后：需求 334 / 集团 191 / Base 334、191 / 评估 0 / 提示词 0；
- 输出如实区分「stub 覆盖」与「线上真跑」。

## 6. 风险与备注

- 线上 3 次模型调用需单独报备，评估/提示词表无删除接口，清理依赖 DB 权限。
- 集团的 PRD 提示词可用性（S3-23）只做 API 级验证，不在集团详情点生成（集团池保持只读）。
- 若后端先落 S1、前端未就绪，L3 的 UI/复制项（S3-02/13/27）顺延到 S2 完成后补跑。
