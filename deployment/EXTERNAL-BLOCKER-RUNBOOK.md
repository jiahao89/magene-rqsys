# 外部阻塞项处置手册（Executable Runbook）

本文件只为**需要外部凭据、平台权限或人工决策**的阻塞项提供可执行步骤。
本地可修复项已在代码中解决，不在本文件范围内。

每个条目给出：现状证据 → **无需凭据即可执行的检查** → 需要谁做什么 → 完成判据。
所有命令都在仓库根目录 `/Users/jacko/Projects/RQ-Sys` 下执行。

---

## B-1　Miaoda Dev 编辑器合并未完成、预览代码过旧（阻塞 E2E 的第一颗钉子）

### 现状证据（2026-10-11 回溯）

- `403` 是服务端真实返回的；但「角色校验由服务端强制执行」是**客户端硬编码文案**。
- 该文案位于 `rq-sys-miaoda` 的 `client/src/rqsys/panels.tsx`，存在于**未发布**提交：
  `1deb70d`、`5e6dbc3`、`ae4c452`、`6773cc4`、`be2d20a`、`b2ea3d8`。
- 已发布 `87a2444` 已改文案为「飞书平台或集成服务拒绝了此请求（code）…」。
- **服务端任何提交都没有 RQ-Sys 角色逻辑**：`87a2444` 的 `server/rqsys/http/app.ts` 中
  `forbid|role` 计数为 `0`；root 仓从未包含该字符串。

**结论**：这不是平台 ACL 决策，而是 dev preview 运行了旧客户端构建。当前目标是先安全完成分歧编辑器的合并，对齐并发布已验证远端 `c226862`；只对齐到 `87a2444` 不会包含当前项目名来源表单和后续修复。

### 无需凭据即可执行的检查（已实跑，2026-10-11）

在本机用本地身份 seam 直接探测 `POST /api/sources`，确认该端点不存在角色门禁：

```sh
cd apps/api
PORT=8789 RQSYS_LOCAL_IDENTITY=local-operator node --env-file=../../.env --import=tsx src/server.ts &

# 无身份 → 401（不是 403）
curl -sS -o /dev/stdout -w "\n%{http_code}\n" -X POST -H "content-type: application/json" \
  -d '{"projectName":"室外产品-码表软固件需求池","enabled":false,"schedule":{"enabled":false,"weekday":1,"time":"09:00","timezone":"Asia/Shanghai"}}' \
  http://127.0.0.1:8789/api/sources

# 有身份但未配置网关 → 503 DEPENDENCY_UNAVAILABLE（同样不是 403）
curl -sS -o /dev/stdout -w "\n%{http_code}\n" -X POST -H "content-type: application/json" \
  -H "x-rqsys-platform-user-id: local-operator" \
  -d '{"projectName":"室外产品-码表软固件需求池","enabled":false,"schedule":{"enabled":false,"weekday":1,"time":"09:00","timezone":"Asia/Shanghai"}}' \
  http://127.0.0.1:8789/api/sources
```

**实测结果**：`401 UNAUTHORIZED`（无身份）与 `503 DEPENDENCY_UNAVAILABLE`（有身份、缺网关）。
端点存在、可达，且**只对身份与依赖状态做出反应，从不因角色返回 403**。
这从代码行为上印证了 B-1 的结论：目标环境那个 403 不是应用角色门禁。

### 无需凭据即可执行的仓库检查

```sh
# 1) 确认发布 commit 与其服务端确实没有角色逻辑
git -C rq-sys-miaoda log --oneline -1                 # 期望：sprint/default 在 c226862
git -C rq-sys-miaoda grep -c "forbid\|role" 87a2444 -- server/rqsys/http/app.ts
# 期望输出：无匹配 / 0

# 2) 确认该误导文案只存在于旧提交
git -C rq-sys-miaoda log --oneline -S "角色校验由服务端" -- client/src/rqsys/panels.tsx

# 3) 确认当前工作区文案已是新版本
git -C rq-sys-miaoda grep -n "飞书平台或集成服务拒绝" -- client/src/rqsys/panels.tsx
```

### 需要谁做什么

1. 安全完成 Miaoda 编辑器的 merge 到 `origin/sprint/default` `c226862`：
   - **保留** `.env` 与 `server/database/schema.ts`；绝不读取或提交 `.env` 内容；
   - 仅以 `git status --short` 和 `git diff --cached --name-only` 核对暂存清单；若 `.env` 已暂存，只执行 `git restore --staged .env`，保留工作区文件；
   - 不要执行会丢弃未提交改动的 `reset --hard` / `checkout .`。
2. 跑 app 仓 route tests、lint、typecheck、production build 与 `git diff --check`，检查无凭据后提交/推送；通过受支持且遵循 `--yes` 门禁的路径发布 `c226862`。当前 `release-create` CLI 不支持该标志时，不得绕过门禁。
3. 重新加载 dev preview，确认来源表单只需项目名称且默认 `室外产品-码表软固件需求池`；创建 schedule-disabled 来源，确认项目和任务类型解析成功。

### 完成判据

- Dev preview 运行与 `c226862` 对齐的发布代码并显示新版表单；
- `POST /api/sources` 成功创建来源（不再返回 403）；
- 来源解析到批准的 Teambition 项目，且**未抓取任何真实需求行**。

### 若对齐后仍返回 403

此时才需要考虑外部授权：按新文案核查**飞书平台/集成资源授权**与**运行代码与发布 commit 是否一致**，
而不是应用角色矩阵。不要把 403 当作需要新增应用角色的信号。

---

## B-1b　目标 source setup 尚未验收；本地项目解析能力已在独立流程通过

早前一次本地 harness 以项目名创建来源成功，并解析到批准的 Teambition 项目和需求类型；本轮没有从当前 workbench 验证 source setup。
刷新本地 workbench 后 API 返回空数据，因此不能据早前 harness 证明当前 local UI 与 API 使用同一持久库。

目标 Miaoda runtime 的来源创建仍需在发布代码对齐后，以项目名称和停用计划创建来源；不得触发真实需求同步。

**完成判据**：注入网关配置后，`POST /api/sources` 返回 `201`，且解析出的项目为
`室外产品-码表软固件需求池`、未抓取任何真实需求行。

---

## B-2　Teambition 返回 311 行 vs UI 显示 `311/314`

### 2026-10-11 实测结论（部分关闭，count-only 重核）

使用 app 仓库 `.env.local` 中的网关配置发起只读 GET；凭据未输出，任务内容没有写入本地数据库、发送给模型或写入 Base：

| 查询 | 结果 |
|---|---|
| `getProjectScenarioFieldConfigs?project_id=<PID>` | 4 种任务类型：需求、任务、执行用例、日程 |
| 按任务类型调用 `getProjectTasks` | 需求 **311**；任务 **23**；执行用例 **0**；日程 **0**；合计 **334** |
| 不带 `scenariofield_config_id` 调用 `getProjectTasks` | **23** 行（默认返回“任务”类型，不是项目总数） |
| 需求类型记录 `id` 唯一且非空 | **311/311**，无缺失 |
| 需求类型状态分布（`taskflow_status_id`） | 307 / 2 / 1 / 1（四个状态，**不含完成/归档过滤**） |
| `page` / `limit` / `page_size` 参数 | HTTP **500**（网关不支持分页参数） |

**可以确定的部分**：代码侧没有施加完成/归档过滤（311 行覆盖全部四个状态），
`id` 全部唯一非空，且分页参数不被网关接受——因此**没有证据表明 311 是被截断的结果**。

**仍未解释的部分**：UI 的 `311/314`。API 四种类型计数合计 334，不能把 UI 的 314 解释为项目总记录数；需求类型仍是 311 条，而 UI 分母多 3。没有 UI 端筛选/计数定义，也没有可用的分页或未过滤总数接口，因此差异仍无法归因。

### 现状证据

- 只读查询返回 311 条“需求”记录，`id` 唯一且非空；另有 23 条“任务”记录；UI 显示 `311/314`。
- skill 的 `getProjectTasks` 包装器返回单个数组，**不暴露分页控制**，无法判断网关是否截断。
- 当前 shell 没有导出网关变量；已通过 app 仓库 `.env.local` 做只读 count-only 查询，没有重新同步数据，也没有向用户索取凭据。

### 前置条件

后续要继续调查，需要 Teambition UI 中 `311/314` 的具体计数标签/筛选状态，或由网关所有者提供未过滤总数/分页契约。现有本地只读查询凭据已可用，不需重新提供密钥。Agent 不写平台环境变量。

### 无需凭据即可执行的检查

```sh
# 1) 确认当前 shell 是否已有网关配置（不打印取值）
node -e 'console.log({url: !!process.env.TEAMBITION_GATEWAY_URL, key: !!process.env.GATEWAY_API_KEY})'

# 2) 确认客户端没有分页控制 —— 这正是无法判断"是否被截断"的原因
grep -nE "hasMore|nextCursor|page|limit" apps/api/src/adapters/teambition/client.ts
# 期望：无输出。若有输出，说明分页能力已补齐，本节结论需重评。
```

### 需要谁做什么

1. 网关所有者提供 URL 与凭据（或直接在受信服务端环境注入）。
2. 用**只读**调用核对三件事：分页契约（是否存在 `page`/`limit`/`cursor`）、未过滤总数、以及
   被过滤掉的状态分布。
3. 若确认为网关截断或存在默认过滤，据实修正导入策略；若 314 包含 3 条不可见行，需明确其状态。

### 完成判据

- 能解释 `311` 与 `314` 的差异来源（分页截断 / 状态过滤 / 权限可见性）；
- 代码侧确认未施加完成/归档过滤；
- 结论写入 `specs/rq-sys-mvp/TEAMBITION-LIVE-POC.md`。

### 风险

在差异查清前**不得启用真实周同步**——否则可能长期漏导 3 条需求而不自知。

---

## B-3　`AI_API_KEY` —— workbench/runtime secret wiring mismatch（2026-10-11）

### 2026-10-11 实测结论（未关闭）

当前 synthetic fixture 的 workbench 分析状态为 `failed_retryable`，安全错误摘要为 `AI provider authentication failed`。随后直接从 `rq-sys-miaoda/.env.local` 读取配置并调用 DeepSeek 默认 URL/model，固定合成样例返回结构化结果且 schema 校验通过；摘要为 `confidence=中`、`priority=null`。这证明该本地 key/provider 配对有效，但不证明 workbench API 进程或 Miaoda Dev runtime 加载了同一 secret。
本轮没有打印或修改任何密钥；发送给模型的只有固定虚构需求文本。

workbench 的认证失败和直接 provider smoke 成功来自不同运行进程/环境；不能据此推断目标 Dev secret 已正确加载，也不能断言 key 本身失效。

### 历史现状证据（保留）

- 更早一次本地 smoke 返回 `SMOKE-FAIL auth_error`；本轮使用 app `.env.local` 的新直连 smoke 已成功。
- 目标 runtime 是否加载密钥、能否出网，仍未验证；当前只有本地 provider 路径成功。

### 无需凭据即可执行的检查

```sh
# 确认请求体已做 PII 掩码、且不含姓名/用户 ID/凭据（不需要有效密钥）
node --import=tsx --test apps/api/src/analysis/analysis.test.ts
# 期望：outbound payload 断言通过

# 确认 provider 默认指向与配置来源（不打印密钥值）
grep -n "AI_BASE_URL\|AI_MODEL\|deepseek" apps/api/src/analysis/provider.ts | head
```

### 需要谁做什么

1. 确认 workbench/Dev runtime 使用与已验证 key/provider 配对一致的 secret，检查部署环境和运行进程加载路径；只核对变量是否存在及调用结果，不输出值。
2. 仅用固定 synthetic fixture 在该 runtime 重试分析，确认 DeepSeek 返回结构化、schema 校验通过的结果。

### 完成判据

- 合成数据的模型调用成功返回并结构化校验通过；
- 目标 runtime 亦成功（该部分属 Ticket 09 验收范围）。

---

## B-4　P3 与 Base 单选项的策略冲突（需要产品决策）

### 现状证据

- 规则 schema 允许产出 `P0–P3`；线上 `AI优先级建议` 字段只有 `P0/P1/P2`。
- 代码已保证：被单选项拒绝的取值**不写入、不伪造降级值，但会记录**
  （`omittedFields` + 审计 `reason=omitted_fields:…`）。
- 因此不会再静默丢失，但**仍未决定** P3 该如何处理。

### 需要谁决策

二选一，并记录到 `OPEN-DECISIONS.md`：

1. **不发布能产出 P3 的规则**（当前默认姿势）——保持 Base 字段不变；或
2. **给 Base 字段补 P3 选项**，再发布可能产出 P3 的规则。

### 无需凭据即可执行的检查

```sh
node --import=tsx --test apps/api/src/base/client.test.ts        # 含 P3 省略可见性断言
node --import=tsx --test apps/api/src/base/push-service.test.ts  # 含审计记录断言
```

---

## B-5　模块词典与优先级规则仍为空（需要产品内容）

### 现状证据

线上「分类规则」页只读确认：无模块词典版本、无优先级规则版本。符合“默认为空”的既定策略。

### 需要谁提供

- 产品模块分类（可参照 POC Base 已有的 `需求澄清`、`方案设计`、`缺陷修复`、`其他`）；
- U/M/S/C 评分表与阈值（用于 P0–P3 映射）。

### 完成判据

- 词典与规则各发布一个版本；
- 发布前确认新增模块已**同时**加入 Base 字段与 `BASE_FIELDS_JSON.selectOptions.module`
  （代码会对不在白名单内的取值记录省略，但不会替你补选项）。

---

## B-6　POC app-token Base 访问和负责人通知已验证；发布 runtime 待验收

### 最新验证（2026-10-11）

- 官方 Bitable v1 `records` API 在 app 凭据下返回 HTTP 200 / `code: 0`；精确复合过滤唯一命中固定 synthetic fixture，项目键与 fixture ID 均匹配。旧 `base/v3` 查询是 app-token 场景的错误路径，已从两仓共享 adapter 移除；本地回归覆盖精确过滤、无命中、重复键失败关闭和安全错误摘要。
- 负责人字段在 POC Base 中为空；仅对固定 synthetic row 将其设为当前登录用户。编辑器的“同时发送通知”选项保持关闭。POC automation run log 显示“监控执行人字段变更”和“发送分配通知”步骤均成功，收件人为当前用户。
- 这验证了 POC Base app-token API 与 Base automation 本身；不证明发布版 Miaoda runtime 调用同一版本代码。刷新本地 workbench 后 API 又显示空 workspace，故从 fixture 同步到 Base 的持久端到端链路尚未闭合。

### 早期失败证据（2026-10-11，本轮之前；已被后续 API 回读修正）

开发者后台已核对 Dev 实际使用的应用「固件需求池」：`bitable:app`（查看、评论、编辑和管理多维表格）与 `bitable:app:readonly` 均显示“已开通”，页面显示“当前修改均已发布”。因此此前把问题直接归因于缺少 `bitable:app` 是错误的，不应再次申请这两项权限。

用户确认后，已在隔离测试 Base「TB同步测试(可删除)」的「… → 更多 → 添加应用」中将「固件需求池」设为“可编辑”并提交。界面显示“App added”，且“已添加应用”列表列出该应用和“Can edit”。未授权生产 Base「TB需求池」。

此前（POC Base 应用访问授权补齐之前）用 Dev 应用凭据换取 tenant token 后的直接 API 结果：

| 调用 | 结果 |
|---|---|
| `GET /open-apis/bitable/v1/apps/{app}/tables/{tbl}/fields` | HTTP **403**, code **91403** Forbidden |
| `GET /open-apis/bitable/v1/apps/{app}/tables/{tbl}/records` | HTTP **403**, code **91403** Forbidden |
| `GET /open-apis/base/v3/bases/{app}/tables/{tbl}/records` | HTTP **400**, code **99991672**，提示缺少 Base API scope；历史记录未保留完整 scope 清单 |

`bitable` v1 的早期 `91403` 与应用尚未加入目标 Base 的文档应用列表一致；授权后，本轮重新测试已成功。`base/v3` 查重也已从代码移除，不再需要为此端点寻找 scope。Miaoda Dev 预览曾可访问；本轮刷新本地工作台时显示无来源、0 需求，与 POC Base 中已有 synthetic row 不一致，尚未通过同一 app runtime 建立端到端关联。

**影响**：`base/v3` app-token lookup 失败问题已修复；目标 published runtime 的 push 仍需在代码对齐后重跑。此前 lark-cli user-identity smoke 与本轮 app-token API probe 属于不同证据，不能互相替代。

### 当前状态与下一步

1. 在目标发布 runtime 对齐最新验证代码后，使用安全 fixture 重跑 app-mediated upsert、幂等更新及 PM 字段保护。
2. 验证目标 app 处理器触发 POC Base 的已验证负责人自动化；收件人仍仅限当前用户。
3. 发布版本 readback 当前受 `open.feishu.cn` DNS 故障阻断；不得用未授权 alternate write path 绕过 Spark 写入门禁。

**已确认不需要重复做的事**：再次开通 `bitable:app` / `bitable:app:readonly`；再次发布当前权限版本；向正式生产 Base 授予权限。

### 完成判据

- 官方 `bitable/v1` records lookup 在 app 凭据下返回 HTTP 200 / `code: 0`，精确复合键唯一命中；已由本轮 POC readback 验证。
- 固定 synthetic row 的 owner-assignment automation trigger 和通知发送步骤均成功，且收件人只有当前用户；已由 POC automation run log 验证。
- 之后在最新发布 Miaoda runtime 中重复 upsert/幂等更新/PM 字段保护，建立目标 runtime 的证据；尚未完成。

Base 文档授权和 POC API/自动化已验证；这些结果仍不等于发布 Miaoda runtime 端到端验收完成。

---

## B-7　AI 分析对「只有标题」的需求偶发校验失败

### 现状证据（2026-10-11 实测）

同一输入（`title="海外码表地图问题"`，无描述/范围/验收标准）重复调用：
一次成功（`facts=[{text,evidence}]`），一次失败并记录：

```
AI provider returned invalid or unsupported analysis output
  (facts.1.evidence: Too small: expected string to have >=1 characters; ...)
AI provider returned invalid or unsupported analysis output
  (Analysis evidence does not occur in source text)
```

原因是模型偶发返回空 `evidence`，或引用了原文中不存在的片段；校验规则见
`apps/api/src/analysis/contract.ts`（`facts[].evidence` 至少 1 字符、`evidence` 至少 1 条）
与 `apps/api/src/analysis/provider.ts`（evidence 必须出现于源文本）。

**影响是有限的**：按既定不变量，分析失败**不阻塞**推送——实测中该需求仍推进到
`owner_state=not_required` 并触发了 Base 推送。但每次失败会消耗最多 5 次重试，而输入完全相同，
重试对确定性校验失败没有意义。

### 需要谁决策

1. 保持现状（可接受：不阻塞主链路，仅产生噪声与少量重试开销）；或
2. 放宽/区分校验（例如允许空 evidence 时降级为 `待分类` + 低置信度，而不是判失败）；或
3. 对「确定性校验失败」不再重试，避免无意义重试。

### 无需凭据即可执行的检查

```sh
node --import=tsx --test apps/api/src/analysis/analysis.test.ts
```

---

## 附：一键回归

```sh
# 两仓差异是否仍全部已分类（无未声明漂移）
node scripts/check-repo-alignment.mjs

# root 全量
npm run typecheck && npm run test && npm run build && git diff --check

# app 仓
cd rq-sys-miaoda && npm run test:rqsys-route && npm run type:check && npm run lint && npm run build:prod
```
