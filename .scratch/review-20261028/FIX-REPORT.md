# 第一档修复记录

> 日期：2026-10-28。范围：用户确认的第一档（R-07、R-04、R-13、R-14、R-15、R-12）。
> 基线：HEAD `15a3bae`（核实期间由 `af289b2` 前进两笔：`788a42d` analysis run 持久化 provider/model、`15a3bae` 记录自定义模型端点可达性阻塞）。
> 未提交、未推送、未发布；`rq-sys-miaoda/` 已同步改动，同样未提交。

## 变更清单

| 条目 | 文件 | 改动 |
|---|---|---|
| R-07 | `README.md` | 重写现状与布局：新增 Current status / Repository layout / 两仓关系；删除“只暴露 health”“尚不能部署到妙搭”等过时描述；补充 V0.2 与部署 runbook 入口 |
| R-07 | `AGENTS.md` | 布局补 `apps/web/`、`rq-sys-miaoda/`；`design.md` 条目改为 D-08 已决（HeroUI v3）；测试口径统一为“行为变更需跑相关测试 + 完成前跑门禁”；Commands 补 `check:alignment` / `check:contract` |
| R-04 | `specs/rq-sys-v0.2/CODEBASE-ASSESSMENT.md:20` | 该行标注“2026-10-22 快照，已被 2026-10-23 产品确认与 V02-T15 取代：现仅写 `duplicate_of_requirement_id` 提示，不删除、不合并” |
| R-13 | `.scratch/rq-sys-v0.2/issues/README.md` | 修正「当前状态」与表格自相矛盾的一句：T19–T24（含 T23/T24）均为 `target-verified`，合成数据已清理 |
| R-14 | `.gitignore` | 新增 `*.tsbuildinfo`、`.scratch/**/*.log` |
| R-14 | `apps/web/tsconfig.tsbuildinfo` | `git rm --cached` 取消跟踪（文件仍在本地，现被忽略；`npm run build` 会重建） |
| R-14 | `skills/teambition/scripts/generate.py`、`scripts/generate_docx.py` | 删除与 `weekly_report/` 完全重复的两份脚本；`scripts/teambition_api.py` 保留（被 `scripts/contract-matrix.mjs` 与 `TEAMBITION-LIVE-POC.md` 引用） |
| R-15 | `apps/api/package.json`、`package-lock.json` | 移除未使用的 `pg-mem`（`--package-lock-only --offline` 更新 lock：精确删除 pg-mem 及 35 个传递依赖，无其他改动） |
| R-12 | `apps/api/src/adapters/teambition/client.ts` | fail-closed 错误信息带上缺失的环境变量键名（`TEAMBITION_GATEWAY_URL` / `GATEWAY_API_KEY`），不打印值 |
| R-12 | `apps/api/src/adapters/teambition/client.test.ts` | 新增 2 个单测：缺 URL / 缺 key 时构造即抛错且消息含对应变量名 |
| R-12 | `apps/api/src/server.ts` | 启动时不再静默吞掉构造异常，改为 `stderr` 输出具体原因（不阻断启动） |
| R-12（两仓同步） | `rq-sys-miaoda/server/rqsys/adapters/teambition/client.ts`、`runtime.ts`、`server.ts` | 同步相同的行为与日志；保持两仓对齐 |

## 验证结果（根仓）

| 检查 | 结果 |
|---|---|
| `npm run typecheck`（API + Web） | 通过（exit 0） |
| `node --import=tsx --test apps/api/src/adapters/teambition/client.test.ts` | 7/7 通过（含 2 个新增用例） |
| `npm --workspace @rq-sys/api test`（全量） | 462/462 通过，0 失败 |
| `npm run build` | 通过（API tsc + Web Vite，exit 0） |
| `npm run check:alignment` | 通过：44 模块逐字一致，28/28 共享逻辑一致，无未声明漂移 |
| `git diff --check` | 通过（无空白错误） |

以上检查完成后（2026-10-28 14:13），工作区出现**并发会话**的未提交改动 `analysis/provider.ts`（两仓，AI temperature 支持，用于 Claude Sonnet 5.x 兼容网关），不属于本次修改，我未触碰。为确认组合状态，14:13:59 复跑：`typecheck` 通过、API 测试 462/462、`check:alignment` 通过、`git diff --check` 通过。

## 未做 / 留待后续

- **R-01 仓储契约测试**、**R-02 最小 CI**：第二档（CI 里并入 R-16 的迁移前缀检查）。
- **R-11 格式化 → R-09/R-08/R-10 拆分**：第三档，需两仓同步窗口。
- **R-06 HANDOFF 入库/脱敏**：等你决定 HANDOFF 是否入库、内部资源 ID 是否保留。
- **R-03 残留守卫**：v2 规则生效时仍可通过 `POST /api/rules/priority` + publish 发布 v1 规则覆盖 v2；未在本次授权范围，建议随第二档处理。
- **R-17 小修**（编号统一、详情自动刷新文案、审计页分页提示、死 CSS）：未在本档授权范围。
- `.scratch` 下除 `*.log` 外仍有未跟踪的原始证据（`e2e/`、`target-readonly/`、`*.png` 等，23 项）。是否需要整体忽略或只保留汇总，待你定。
- `agent.md`（4 行指路文件）未删除，仍指向 AGENTS.md；如需删除请告知。

## 注意事项

- 根仓改动均未提交；删除类改动已进入暂存区（`git rm`），修改类改动未暂存。
- 妙搭仓 `rq-sys-miaoda/` 有 4 个未提交改动：其中 3 个是本次同步（client/runtime/server），另 1 个是并发会话的 `analysis/provider.ts`（AI temperature）。发布前需在该仓跑 typecheck / lint / build / route tests，并走 `sprint/default` 的发布门禁；本次**未**做目标环境验证，不能据此声称目标环境行为变化已生效。
- `GATEWAY_API_KEY` 缺失时的新行为：启动仍可继续（不阻断），但 `stderr` 会明确输出缺少 `TEAMBITION_GATEWAY_URL` / `GATEWAY_API_KEY`；不再生成空凭据请求（该 fail-closed 行为原本就存在）。

---

# 第二档修复（R-02 / R-16 / R-01）与后续小修（R-03 / R-17）

> 执行时间：2026-10-28 14:20–14:50。仍未提交、未推送、未发布。

## 变更清单

| 条目 | 文件 | 改动 |
|---|---|---|
| R-16 | `scripts/check-migrations.mjs`（新增） | 迁移文件名检查：新增重复前缀直接失败；历史上线的 `0002`（2 个文件）白名单且校验白名单与现状一致；缺口仅告警 |
| R-16 | `package.json`、`AGENTS.md` | 新增 `npm run check:migrations` 脚本与命令说明 |
| R-02 | `.github/workflows/ci.yml`（新增） | 最小 CI：checkout → npm ci → typecheck → check:migrations → npm test（API+Web）→ check:alignment（无 `rq-sys-miaoda/` 时明确跳过）→ 空白检查；带 postgres:16 service 供数据库测试 |
| R-01 | `apps/api/src/adapters/postgres/repository-contract.test.ts`（新增） | 仓储行为契约测试：`TextOrderPlaceholderPool` 模拟妙搭 Drizzle 的“按 SQL 文本顺序重绑 `$N`”语义；5 组契约用例分别跑 `pg` 与 `drizzle-text-order` 两种模式；另加复现事故的负向用例 |
| R-03 | `apps/api/src/http/app.ts` | 规则发布守卫：v2 公式生效时拒绝发布 v1 形态规则（409），防止优先级回退到未校准的四维求和 |
| R-03 | `apps/api/src/http/rules.test.ts`、`specs/rq-sys-mvp/openapi.yaml` | 新增守卫用例（13 个规则测试全过）；409 契约描述补充该情形 |
| R-17 | `apps/web/src/App.tsx`、`panels.tsx`、`api.ts` | 列表/映射行编号统一优先 `platformRequirementId`（RQ-000001），缺失才退回 `REQ-<TB ID>` |
| R-17 | `apps/web/src/panels.tsx` | 详情页推送两项文案改为“完成后刷新详情可看到最新状态”（详情无轮询）；审计页补“已加载最近 50 条”分页提示 |
| R-17 | `apps/web/src/styles.css` | 删除无 DOM 引用的 `.rules-table` 死样式 |
| R-01（妙搭侧） | `rq-sys-miaoda/scripts/rqsys-repository-contract.test.cjs`（新增）、`rq-sys-miaoda/package.json` | 同一组仓储契约用例跑在真实 PostgreSQL + 真实 `createDrizzlePostgresPool` 传输层上；新增 `test:rqsys-contract` 脚本 |

## 验证结果（合并工作区，2026-10-28 14:49）

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过（exit 0） |
| API 全量测试 | **477/477** 通过（含新增契约 11 个、规则守卫 1 个） |
| Web 全量测试 | **90/90** 通过（首轮全量运行出现 1 次 5 秒超时，单独重跑该文件 37/37、全量重跑 90/90 通过，判定为并发负载下的偶发超时） |
| `npm run build` | 通过 |
| `npm run check:alignment` | 通过（44 模块一致、28/28 共享逻辑、无未声明漂移） |
| `npm run check:migrations` | 通过（20 个迁移文件、19 个前缀；0002 白名单） |
| `git diff --check` | 通过 |
| `cd rq-sys-miaoda && npm run test:rqsys-contract` | **6/6** 通过（真实 PostgreSQL + 真实 Drizzle 传输层，含复现事故的传输层用例） |
| `cd rq-sys-miaoda && npm run test:rqsys-route`（既有套件回归） | **115/115** 通过 |

## 说明与遗留

- **R-01 已补齐（妙搭侧）**：`rq-sys-miaoda/scripts/rqsys-repository-contract.test.cjs` 把同一组仓储用例跑在真实 PostgreSQL + 真实 `createDrizzlePostgresPool`（Drizzle 传输层）上，并额外用一个用例证明该传输层能复现 2026-10-22 的重占位符失败（原生 pg 通过，Drizzle 语义报 `could not determine data type of parameter`）。运行：`cd rq-sys-miaoda && npm run test:rqsys-contract`（先 `build:server`）。
  - 前置：可连接的 PostgreSQL（`RQSYS_CONTRACT_DATABASE_URL`，或标准工作区根仓 `.env` 的 `DATABASE_URL`）与根仓迁移目录（默认 `<repo>/../database/migrations`，可用 `RQSYS_CONTRACT_MIGRATIONS_DIR` 覆盖）。缺任一条件时 6 个用例**显式 skip 并打印原因**，不会静默通过。
  - 用例在临时 schema 上应用根仓全部 SQL 迁移，结束后 drop schema；不接触目标环境正式库。cursor 分页用例仍只在根仓跑（游标编解码是 root-only 模块）。
  - 注意：传输层会把驱动错误包成 `Failed query: …`，原始 PostgreSQL 错误在 `cause` 里；断言同时检查两者。
- **R-02 说明**：CI 尚未在 GitHub 实际运行（需要提交后观察）。CI checkout 不含 `rq-sys-miaoda/`（被根仓 gitignore），对齐门禁在 CI 中必然跳过；两仓对齐仍需在双仓环境本地执行。YAML 已用解析器校验。
- **R-16 说明**：种子/修补迁移（`0003_team_directory_seed`、`0017_seed_umsc_rule_v1`、`0008_fix_team_directory_name`）仍与 schema 迁移混放；按 AGENTS.md「不重写已应用迁移」本次不动，留待新增迁移机制从新前缀开始拆。
- **并发会话（重要）**：工作期间另一会话连续提交 `6b1e9cb`、`aa9dacf`、`1450dc4`、`9255902`、`abe760f`（temperature、fenced JSON、null proposedScore 等），并修改 `analysis/scoring.ts` / `scoring.test.ts`（本次未触碰）。其中 `6b1e9cb` 和 `9255902` 的 pre-commit add 两次把 R-14 的**暂存删除**卷入其提交，随后 `aa9dacf` / `abe760f` 又把文件恢复回 HEAD。为避免继续互相覆盖，本次最终状态改为**不暂存**的工作区删除（` D`）：`apps/web/tsconfig.tsbuildinfo`、`skills/teambition/scripts/generate.py`、`skills/teambition/scripts/generate_docx.py`。请在其会话空闲后与其他改动一起提交；若再次被恢复，重跑 `rm -f apps/web/tsconfig.tsbuildinfo skills/teambition/scripts/generate.py skills/teambition/scripts/generate_docx.py` 后再提交。上述验证均在该合并工作区上执行，全部通过。
- **未做（第三档/决策项）**：R-06 HANDOFF 入库与脱敏（待你决定）；R-11 格式化 + R-09/R-08/R-10 拆分（需两仓同步窗口）。
- **妙搭仓当前未提交改动（发布前需一并处理）**：`server/rqsys/adapters/teambition/client.ts`、`runtime.ts`、`server.ts`（第一档同步）、`package.json`（新增 `test:rqsys-contract`）、`scripts/rqsys-repository-contract.test.cjs`（新增）。发布前在该仓跑 `type:check` / `lint` / `build` / `test:rqsys-route` / `test:rqsys-contract`，并走 `sprint/default` 发布门禁；本次未做目标环境验证。
