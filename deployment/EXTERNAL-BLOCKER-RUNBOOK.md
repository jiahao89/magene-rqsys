# 外部阻塞项处置手册（Executable Runbook）

本文件只为**需要外部凭据、平台权限或人工决策**的阻塞项提供可执行步骤。
本地可修复项已在代码中解决，不在本文件范围内。

每个条目给出：现状证据 → **无需凭据即可执行的检查** → 需要谁做什么 → 完成判据。
所有命令都在仓库根目录 `/Users/jacko/Projects/RQ-Sys` 下执行。

---

## B-1　Miaoda dev 工作区未对齐已发布 commit（阻塞 E2E 的第一颗钉子）

### 现状证据（2026-10-11 回溯）

- `403` 是服务端真实返回的；但「角色校验由服务端强制执行」是**客户端硬编码文案**。
- 该文案位于 `rq-sys-miaoda` 的 `client/src/rqsys/panels.tsx`，存在于**未发布**提交：
  `1deb70d`、`5e6dbc3`、`ae4c452`、`6773cc4`、`be2d20a`、`b2ea3d8`。
- 已发布 `87a2444` 已改文案为「飞书平台或集成服务拒绝了此请求（code）…」。
- **服务端任何提交都没有 RQ-Sys 角色逻辑**：`87a2444` 的 `server/rqsys/http/app.ts` 中
  `forbid|role` 计数为 `0`；root 仓从未包含该字符串。

**结论**：这不是平台 ACL 决策，而是 dev preview 运行了旧客户端构建。

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
git -C rq-sys-miaoda log --oneline -1                 # 期望：sprint/default 在 87a2444
git -C rq-sys-miaoda grep -c "forbid\|role" 87a2444 -- server/rqsys/http/app.ts
# 期望输出：无匹配 / 0

# 2) 确认该误导文案只存在于旧提交
git -C rq-sys-miaoda log --oneline -S "角色校验由服务端" -- client/src/rqsys/panels.tsx

# 3) 确认当前工作区文案已是新版本
git -C rq-sys-miaoda grep -n "飞书平台或集成服务拒绝" -- client/src/rqsys/panels.tsx
```

### 需要谁做什么

1. 在 Miaoda 编辑器中把 dev 工作区对齐到 `87a2444`：
   - **保留**该工作区既有的未提交 `.env` 与 `server/database/schema.ts` 改动（不要 checkout 覆盖）；
   - 不要执行会丢弃未提交改动的 `reset --hard` / `checkout .`。
2. 重新加载 dev preview，确认来源表单是「只填项目名称」的新版本（不是旧的 ID/字段映射表单）。
3. 重试创建来源：项目名称默认 `室外产品-码表软固件需求池`，**周计划保持关闭**。

### 完成判据

- dev preview 显示新版表单；
- `POST /api/sources` 成功创建来源（不再返回 403）；
- 来源解析到批准的 Teambition 项目，且**未抓取任何真实需求行**。

### 若对齐后仍返回 403

此时才需要考虑外部授权：按新文案核查**飞书平台/集成资源授权**与**运行代码与发布 commit 是否一致**，
而不是应用角色矩阵。不要把 403 当作需要新增应用角色的信号。

---

## B-1b　本地也无法创建来源：缺同一份网关凭据

创建来源需要服务端按项目名解析 Teambition 项目。本机 `.env` 未配置 `TEAMBITION_GATEWAY_URL`，
因此 `POST /api/sources` 返回 `503 DEPENDENCY_UNAVAILABLE: Teambition 项目自动识别尚未配置。`

**与 B-2 是同一个外部依赖**：网关 URL + 凭据。在拿到它之前，本地与目标环境都无法完成来源创建，
只能验证到"端点存在、身份门禁正常、依赖缺失时如实报错"为止。

**完成判据**：注入网关配置后，`POST /api/sources` 返回 `201`，且解析出的项目为
`室外产品-码表软固件需求池`、未抓取任何真实需求行。

---

## B-2　Teambition 返回 311 行 vs UI 显示 `311/314`

### 现状证据

- 只读查询返回 311 条记录，`id` 唯一且非空；UI 显示 `311/314`。
- skill 的 `getProjectTasks` 包装器返回单个数组，**不暴露分页控制**，无法判断网关是否截断。

### 前置条件

需要网关所有者提供 `TEAMBITION_GATEWAY_URL` 与凭据（`GATEWAY_API_KEY`）。
Agent 不写平台环境变量；只准备清单并读取结果。

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

## B-3　`AI_API_KEY` 失效，任何环境都未成功推理

### 现状证据

- 本地 provider 冒烟返回 `SMOKE-FAIL auth_error`（本地 key 已失效）。
- 目标 runtime 是否加载密钥、能否出网，从未验证过；没有任何一次成功的模型调用。

### 无需凭据即可执行的检查

```sh
# 确认请求体已做 PII 掩码、且不含姓名/用户 ID/凭据（不需要有效密钥）
node --import=tsx --test apps/api/src/analysis/analysis.test.ts
# 期望：outbound payload 断言通过

# 确认 provider 默认指向与配置来源（不打印密钥值）
grep -n "AI_BASE_URL\|AI_MODEL\|deepseek" apps/api/src/analysis/provider.ts | head
```

### 需要谁做什么

1. 轮换或确认一个有效的服务端 `AI_API_KEY`（本地 `.env` 与妙搭 dev/online 分别处理）。
2. 由管理员在受信服务端 Secret UI 注入；Agent 不写平台环境变量。
3. 用**合成非 PII 数据**跑一次冒烟，确认真实推理可用。

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

## 附：一键回归

```sh
# 两仓差异是否仍全部已分类（无未声明漂移）
node scripts/check-repo-alignment.mjs

# root 全量
npm run typecheck && npm run test && npm run build && git diff --check

# app 仓
cd rq-sys-miaoda && npm run test:rqsys-route && npm run type:check && npm run lint && npm run build:prod
```
