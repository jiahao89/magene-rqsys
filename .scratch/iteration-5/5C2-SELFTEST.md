# 5c-2 Base「来源方式」自测清单与目标环境 BLOCKED 清单（2026-11-19）

> 依据：`docs/2026-11-19-iteration-5-requirements-analysis.md` §3.2/§4（5c-2 判据）；用户 2026-11-19 要求「先设计开发计划，再完成剩余功能开发和自测」；Chief 2026-11-19 定的 Base 字段与通知口径。
> 当前状态：Base 字段已建（`fldyflUEVv`），后端 5c-2 代码进行中；本地自测等代码落地后执行，目标环境项全部 BLOCKED。

## 0. 映射口径（单一事实来源）

| `source_type` | `source_payload.intakeOrigin` | Base「来源方式」 |
| --- | --- | --- |
| `teambition` | — | `Teambition` |
| `web_manual` | `chat_paste` | `聊天粘贴` |
| `web_manual` | 其他/缺失 | `Web 手工` |
| `base_form` | — | `多维表格` |
| 其他/未知 | — | 不写（`null`），不报错 |

- 字段：Base「数据表」单选字段 **`来源方式`**，字段 ID `fldyflUEVv`，四个选项字符串必须与上表逐字一致。
- 未配置 `BASE_FIELDS_JSON` 中的来源字段 → 推送不写该字段、**不报错**；配置了但字段值算不出来 → 同样不写。
- 单选写入形态：字符串，不是数组（飞书单选按字符串写）。
- **不变式**：推送与回填都只写「来源方式」；绝不写「系统通知事件ID」（`系统通知事件ID`）或任何 PM 字段。
- 通知：工作流 `wkfMnsnvaDS4Auj4` 只监听「系统通知事件ID」，且忽略 `openAPIBatchUpdate`、`pasteUpdate`、`appendImport`、`automationBatchUpdate`；只写来源方式不会通知 PM，**无需停用工作流**。
- 历史行：5a.1 之前的 `web_manual` 没有 `intakeOrigin`，无法区分「聊天粘贴」与「手工」，按 5c-1 同一口径写 `Web 手工`（残余误标风险在 §3 记录，不冒充可回溯）。

## 1. 本地自测项（代码就绪后执行）

| ID | 检查项 | 期望 | 方式 / 证据 | 状态 |
| --- | --- | --- | --- | --- |
| C2-01 | 四类来源映射 | 四条规则逐条命中；未知来源返回 `null`，不抛错 | 单测（映射函数） | 待代码 |
| C2-02 | `web_manual` 无 `intakeOrigin` | 返回 `Web 手工`（含 5a.1 前历史行） | 单测 | 待代码 |
| C2-03 | 配置字段名 | `BASE_FIELDS_JSON` 配了来源字段 → payload 使用该字段名；未配置 → payload 不含该字段且推送成功 | 单测（client/push） | 待代码 |
| C2-04 | 配置异常 | `BASE_FIELDS_JSON` 非法/缺段 → 回落默认，不因来源字段报错 | 单测（parseBaseFields） | 待代码 |
| C2-05 | 单选形态 | 写入值是字符串且属于四个选项；金额/数组形态不出现 | 单测（fake Base 捕获 payload） | 待代码 |
| C2-06 | 推送四类 | `teambition`/`web_manual`/`chat_paste`/`base_form` 各推一条，来源方式分别正确 | push-service 单测 | 待代码 |
| C2-07 | 不碰通知与 PM | 推送 payload 不含 `系统通知事件ID`；PM/快照字段集合与改动前一致 | push-service 单测（字段集合断言） | 待代码 |
| C2-08 | 失败重试/幂等 | 首次失败重试仍写来源方式；重复推送不产生第二行、不重复写 | push-service 既有重试/幂等用例 + 新增断言 | 待代码 |
| C2-09 | `base_form` 路径 | 5b 收集表创建的需求（`source_type='base_form'`）推送写 `多维表格`；未配置来源字段时仍成功 | push-service 单测（fake 需求记录） | 待代码 |
| C2-10 | 映射不漂移 | 推送与回填脚本调用同一个映射 helper，不允许两套判定 | 代码审查 + 单测引用同一 export | 待代码 |
| C2-B01 | 回填分页 | 用 `GET /api/requirements?limit=50&cursor=...` 读完全部 333 行，无重复、无漏页 | 回填脚本 dry-run（fake API） | 待代码 |
| C2-B02 | 对照表内容 | 至少含 `platformRequirementId`、`sourceType`、`intakeOrigin`、`来源方式`、`baseRecordId`、`状态`；不输出描述正文/PII | dry-run 输出 CSV/JSON 抽查 | 待代码 |
| C2-B03 | 计数对账 | app 行数、Base 行数、matched/unmatched/duplicate/unknown 都有计数；当前基线均为 333 | dry-run 报告 | 待代码 |
| C2-B04 | dry-run 零写入 | fake Base 的 update 调用数为 0；真实模式只调读接口 | 单测/脚本断言 | 待代码 |
| C2-B05 | 字段预检 | 校验 `fldyflUEVv` 存在、单选、四选项精确匹配；不通过即中止且不写 | 单测（fake Base 返回异常 schema） | 待代码 |
| C2-B06 | 可重复 | 同一输入连续跑两次，输出与计数一致；不产生写操作 | dry-run 两次 diff | 待代码 |
| C2-B07 | 历史行策略 | 无 `intakeOrigin` 的 `web_manual` 写 `Web 手工`；数量与理由进报告；不静默混入未知 | dry-run 报告 + 单测 | 待代码 |
| C2-E01 | execute 只写一个字段 | 批量 ≤50，update payload 只有来源方式；绝不写通知/PM 字段 | fake Base 断言 | 待代码 |
| C2-E02 | execute 幂等 | 已正确的行不重复写；第二次执行 0 writes | fake Base 计数 | 待代码 |
| C2-E03 | execute 失败处理 | 单行失败记录并继续/中止策略明确；退出码非 0；可安全重跑 | fake Base 注入失败 | 待代码 |
| C2-E04 | 读回校验 | 写后读回值等于四个选项之一；不一致列入报告 | fake Base 读回 | 待代码 |
| C2-E05 | 执行闸门 | 未先出 dry-run 或未显式 `--execute` 时拒绝写；预检失败拒绝执行 | CLI 参数测试 | 待代码 |

## 2. 回填脚本专项（目标环境执行前的本地验证）

后端交付回填脚本后，先按这组跑；脚本名以实际交付为准（建议 `scripts/rqsys-base-source-backfill.mjs`）。

```bash
# 只读对照，不写 Base
node scripts/rqsys-base-source-backfill.mjs --dry-run \
  --out .scratch/iteration-5/backfill-dryrun.csv

# 目标执行（仅在 dry-run 经 Chief 确认后；分批 50）
node scripts/rqsys-base-source-backfill.mjs --execute --batch-size 50 \
  --out .scratch/iteration-5/backfill-execute.csv
```

dry-run 报告必须回答：总行数、可判定行、将写入行、已正确行、Base 缺行、app 缺行、重复行、未知来源、历史无 `intakeOrigin` 行；并附「来源方式分布」四类计数。执行后必须能对同一批行读回核对，且 PM 字段零改动。

## 3. 残余风险与口径提醒

- **历史聊天行误标**：5a.1 之前的 `web_manual` 无 `intakeOrigin`，按 `Web 手工` 回填会把极少数旧聊天行标成手工。Chief 2026-11-19 已拍板**不按 cutoff 留空**，统一写 `Web 手工`（与 5c-1 前端口径一致）；误标风险登记，不冒充可回溯。
- **Base 行匹配键**：按「系统需求 ID」(`platformRequirementId`, `RQ-xxxxxx`) 对行；若 Base 侧该列有空值/重复，必须进报告，不得猜行。
- **通知验证**：工作流只监听系统通知字段是 Chief 已核过的事实；执行回填时仍要抽查自动化运行记录，确认为 0 触发，不能只凭配置推断。
- **字段选项漂移**：Base 选项若被改名/删除，预检必须失败退出；不要静默写入非法选项。

## 4. 门禁命令（代码就绪后跑，实际数记到证据）

```bash
# 根仓 API（重点：base/client、push-service、回填脚本相关）
node --import=tsx --test \
  apps/api/src/base/client.test.ts \
  apps/api/src/base/push-service.test.ts \
  apps/api/src/base/transport.test.ts

# 全量（59 条 PG ENOENT 属已知本机限制）
npm --workspace @rq-sys/api run test
npm --workspace @rq-sys/web run test
npm run typecheck && npm run build
npm run check:alignment && npm run check:migrations
git diff --check

# 妙搭镜像（服务端共享模块有改动时）
cd rq-sys-miaoda && npm run type:check:server && npm run type:check:client && npm run test:rqsys-route
```

判据：本轮新增用例全过；既有 base push 用例不回归；`check:alignment` 36/36；5c-2 **不新增迁移**（0029 属于 5b，已在代码侧，但目标环境未应用）；`git diff --check` 干净。

## 5. 目标环境 BLOCKED 清单

| ID | 项 | 为什么 BLOCKED | 需要什么 | 退出判据 |
| --- | --- | --- | --- | --- |
| T-01 | 应用 0029 到目标库 | 无目标库执行工具 | 0029 迁移执行（应用库） | `schema_migrations` 到 0029；`source_type='base_form'` 可写 |
| T-02 | 目标环境配置 `BASE_FIELDS_JSON` | 平台环境变量需管理员写入 | 在线上配置来源字段映射（字段名 `来源方式`） | 线上推送 payload 出现该字段 |
| T-03 | Base 字段核对 | 需真实 Base 字段元数据 | 读 `fldyflUEVv`：单选、四选项逐字一致 | 元数据核对通过 |
| T-04 | 通知零触发核对 | 需线上自动化运行记录 | 回填窗口内查 `wkfMnsnvaDS4Auj4` 运行历史 | 0 条因来源方式触发的通知 |
| T-05 | 新推送冒烟（四类来源） | 需目标库 + Base + 可清理的测试需求 | 造 1 条 TB/手工/聊天/收集表来源需求并推送 | 四类来源方式写入正确、PM 字段不变 |
| T-06 | 历史回填 dry-run | 需线上 API 读权限 + Base 读权限 | 跑 dry-run，导出对照表 | 333 行对账，异常行全部列明 |
| T-07 | 历史回填 execute | 写 Base，需授权 + dry-run 确认 | 分批 50 只写来源方式 | 可判定行全部写入；PM 字段零改动；通知 0 |
| T-08 | 5b 三行验收 | 需 0029 + 收集表 + 应用库/Base 写权限 | 按 §4 建 3 行跑同步 | 2 行创建并回写、1 行校验失败；模块映射两分支正确；清理后归零 |
| T-09 | 20 段线上回归 | 每段写 `intake.*`，无清库工具 | 清库工具 + 20 段执行 | 报告产出；审计清零、`chatIntake` 回 0/0 |
| T-10 | 5c-1 目标验收 | 需线上真实数据（333 行） | 看聊天粘贴徽标/筛选、老数据按手工 | 四类筛选命中正确、老数据不误标 |
| T-11 | 发版 | 以上未完成 | 统一提交 + 发版流程 | release `finished`、错误日志 0 |
| T-12 | 本机 59 条 PG 契约用例 | 本机无 Postgres | CI 的 Postgres service 或本地 PG | 59 条全绿（非 5c-2 缺陷） |

## 6. 执行顺序

1. 后端 5c-2 代码 + 回填 dry-run 脚本落地，报「代码就绪」。
2. 我跑 §1 本地项与 §4 门禁，出「本地自测结果」；K 区/PG 契约等本机限制单列。
3. Chief 侧准备 T-01～T-04（0029、`BASE_FIELDS_JSON`、字段/工作流核对）。
4. 跑 T-06 dry-run，出对照表；Chief/用户确认口径后执行 T-07。
5. 再做 T-08（5b 三行）、T-09（20 段）、T-10（5c-1）；清理；T-11 发版。

## 7. 证据登记

- 本地用例输出：`.scratch/iteration-5/evidence/<日期>/`
- 回填对照表：`.scratch/iteration-5/backfill-dryrun-<日期>.csv`
- 目标环境结果：等工具到位后补，不预填。
