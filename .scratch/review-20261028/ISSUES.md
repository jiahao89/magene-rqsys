# RQ-Sys 待解决问题清单

> 审查日期：2026-10-28。范围：根仓需求文档与代码结构（静态阅读，未运行测试；未逐文件读取 `rq-sys-miaoda/`，妙搭差异依据 `scripts/check-repo-alignment.mjs` 的声明推断）。

## 汇总

| 编号 | 优先级 | 类别 | 问题 |
|---|---|---|---|
| R-01 | P0 | 架构 | 根仓 pg 与妙搭 Drizzle 的仓储行为没有共同测试 |
| R-02 | P0 | 工程 | 没有 CI，typecheck/测试/对齐检查全靠手动 |
| R-03 | P1 | 需求 | 优先级公式与 PRD 冲突，D-08 未关闭 |
| R-04 | P1 | 需求 | 规范文档对"重复标题"的描述与代码不一致 |
| R-05 | P1 | 需求 | v0.2 范围过大，缺少分阶段验收 |
| R-06 | P1 | 文档 | 当前状态与踩坑记录只存在于未跟踪的 HANDOFF |
| R-07 | P1 | 文档 | README 过时，AGENTS.md 对测试要求自相矛盾 |
| R-08 | P1 | 代码 | `http/app.ts` 路由全部串在一个函数里 |
| R-09 | P1 | 代码 | `adapters/postgres/repositories.ts` 过大且存在超长行 |
| R-10 | P1 | 代码 | `apps/web/src/panels.tsx` 过大，已确认的拆分未执行 |
| R-11 | P1 | 工程 | 没有 lint / format 配置 |
| R-12 | P1 | 安全 | Teambition 网关密钥为空时不报错 |
| R-13 | P2 | 文档 | specs 状态类文档重复，mvp 与 v0.2 未归档区分 |
| R-14 | P2 | 仓库 | 构建产物、重复脚本、验证日志进入或堆积在仓库 |
| R-15 | P2 | 依赖 | `pg-mem` 未锁定版本 |
| R-16 | P2 | 数据库 | 迁移前缀重复只告警不拦截，种子数据与 schema 混放 |
| R-17 | P2 | 产品 | HANDOFF 遗留的 P2 体验问题未处理 |

---

## P0

### R-01 两仓仓储行为没有共同测试
- **位置**：`scripts/check-repo-alignment.mjs:54-88`；`apps/api/src/adapters/postgres/*`；妙搭 `adapters/postgres/drizzle-pool.ts`
- **问题**：`repositories.ts`、`sync-persistence.ts`、`analysis-run-repository.ts` 等 SQL 密集文件被声明为"允许差异"，对齐脚本不比对其行为。根仓测试使用 `pg` / pg-mem，无法发现 Drizzle 的 `$N` 参数拆分问题，此前已因此导致生产 503。
- **建议**：
  1. 以 `apps/api/src/ports/` 的接口为准，编写一套仓储行为契约测试，两仓分别注入 pg 实现和 Drizzle 实现运行。
  2. 根仓增加模拟妙搭 `$N` 拆分语义的 pool shim，部分仓储测试在 shim 上运行。
  3. 中期将共享模块（domain、analysis、contracts、priority-rule 等）抽成 workspace 包，替代手动同步加文本比对。
- **验收**：同一组契约用例在两仓均通过；在 shim 上重放 `$N` 未加 `::text` 的写法时测试失败。

### R-02 没有 CI
- **位置**：仓库根目录（不存在 `.github/workflows`）
- **问题**：typecheck、测试、`npm run check:alignment`、`git diff --check` 都依赖人工执行。
- **建议**：增加最小 CI：安装依赖 → typecheck → 根仓测试 → 对齐检查 → 迁移前缀检查（见 R-16）。
- **验收**：PR 上自动运行，任一步失败即阻止合并。

---

## P1：需求与文档

### R-03 优先级公式未定
- **位置**：`apps/api/src/analysis/priority-rule.ts`；`apps/api/src/contracts/rules.ts`；`specs/rq-sys-v0.2/CODEBASE-ASSESSMENT.md:19`
- **问题**：当前规则为四维映射求和、阈值 schema 限制 0–4，与 PRD 公式冲突；目前以"优先级为空"兜底。AGENTS.md 另注明 D-08 解决前不得使用 design.md。
- **建议**：将"优先级公式"和 D-08 列为 v0.2 阻塞项，由产品拍板后再写入规则版本；决策结果记录到 OPEN-DECISIONS / DECISIONS-AND-GATES。
- **验收**：决策文档状态为已关闭，规则版本与 PRD 公式一致，有对应单测。

### R-04 重复标题语义文档与代码不一致
- **位置**：`specs/rq-sys-v0.2/CODEBASE-ASSESSMENT.md:20`；`.scratch/rq-sys-mvp/HANDOFF.md` 补5 与补8/补9；`apps/api/src/sync/service.ts:42-66`
- **问题**：评估文档称 sync"按规范化标题丢弃不同 TB ID"；现行代码只设置 `duplicate_of` 提示，符合 AGENTS.md。HANDOFF 前后描述互相矛盾。
- **建议**：在过时条目上标注"已被取代"并指向现行规则，避免后续实现按旧文档回退。
- **验收**：所有文档对重复标题的描述统一为"仅提示，不丢弃、不合并"。

### R-05 v0.2 范围过大
- **位置**：`specs/rq-sys-v0.2/`
- **问题**：手工收录、需求级分配、人群、RICE、Kano、多来源在同一版本内推进，单次发布影响面大。
- **建议**：拆成两个里程碑：M1"手工收录 + 需求级分配"（改核心数据模型）；M2"RICE / Kano"（相对独立的 beta 功能）。每个里程碑单独验收、单独发布。
- **验收**：specs 中有里程碑划分和各自的验收清单。

### R-06 关键状态信息不在版本控制中
- **位置**：`.scratch/rq-sys-mvp/HANDOFF.md`（未跟踪）
- **问题**：当前系统状态、事故复盘、踩坑记录只在未跟踪文件中；文档里写有真实资源 ID（Base token/表、应用 ID、用户 ID）；PRD 修订号（rev 60）只记录在飞书。
- **建议**：踩坑记录整理进 `deployment/` runbook 或 AGENTS.md 并提交；资源 ID 改为引用环境变量键名；specs 中记录对应的 PRD 修订号和日期。
- **验收**：新成员不依赖 `.scratch` 即可了解当前状态；已提交文档中不含真实资源 ID。

### R-07 README 过时，AGENTS.md 自相矛盾
- **位置**：`README.md`；`AGENTS.md`；`agent.md`
- **问题**：README 仍写"只暴露 health 接口""尚不能部署到妙搭"，与线上现状不符。AGENTS.md 一处写"仅在要求时运行测试"，另一处写"声明完成前必须运行 typecheck 和全量测试"。`agent.md` 只有 4 行指向 AGENTS.md，属于冗余入口。
- **建议**：重写 README 的现状和架构部分（含两仓关系）；统一 AGENTS.md 的测试规则；确认 `agent.md` 是否仍有必要保留。
- **验收**：README 与当前部署状态一致；AGENTS.md 中测试要求只有一种说法。

---

## P1：代码与工程

### R-08 `http/app.ts` 路由集中
- **位置**：`apps/api/src/http/app.ts`（854 行，约 42 处 `method === ... && url.pathname ===` / 正则匹配）
- **建议**：按资源拆分路由模块（sources / requirements / scoring / team / batches / audit / overview），用一张路由表注册；不必引入 Web 框架。
- **验收**：`app.ts` 只负责组装与错误处理；现有 HTTP 测试不改断言即通过。

### R-09 `repositories.ts` 过大且有超长行
- **位置**：`apps/api/src/adapters/postgres/repositories.ts`（771 行、14 个仓储类；61 行超过 300 字符，最长 2790 字符，如 `:104-107`、`:399-408` 整个类写在一行）
- **建议**：每个仓储一个文件，`PostgresRepositories` 保留为聚合入口；拆分前先格式化。注意同步更新对齐脚本中的文件声明。
- **验收**：单文件不超过约 300 行；无超长行；测试全部通过。

### R-10 `panels.tsx` 过大
- **位置**：`apps/web/src/panels.tsx`（1695 行，12 个导出面板；评估时约 1405 行，仍在增长）
- **问题**：CODEBASE-ASSESSMENT 已确认按 feature 抽出，但尚未执行。
- **建议**：按 `features/<name>/` 拆分（需求池、需求详情、评分、人员、模块、批次、映射、审计、指南），`panels.tsx` 只做组装。
- **验收**：web 测试通过；新功能不再写入 `panels.tsx`。

### R-11 没有 lint / format
- **位置**：仓库根目录（只有 `tsconfig.base.json`）
- **建议**：引入 Prettier 与 ESLint，根 `package.json` 增加 `lint`、`format`、`typecheck` 脚本，并接入 R-02 的 CI。格式化单独提交一次，与逻辑改动分开。
- **验收**：CI 中 lint 通过；R-09 中提到的超长行消失。

### R-12 网关密钥为空时不报错
- **位置**：`apps/api/src/adapters/teambition/client.ts:6,70`
- **问题**：默认值为空字符串（没有硬编码泄露），但为空时仍会发出请求，错误表现为上游鉴权失败，难以定位。
- **建议**：密钥为空时在启动或首次调用时直接失败，返回明确错误码。
- **验收**：未配置密钥时有对应单测，错误信息指向缺失的环境变量键名。

---

## P2

### R-13 specs 文档重复
- **位置**：`specs/rq-sys-mvp/`（约 25 份）、`specs/rq-sys-v0.2/`（12 份）
- **问题**：LOCAL-AND-TARGET-STATUS、RELEASE-CLOSEOUT、NOTIFICATION-* 三份等状态文档内容重叠。
- **建议**：每个版本只保留一份状态文档；MVP 已完成内容归档到 `specs/archive/`。

### R-14 仓库卫生
- `apps/web/tsconfig.tsbuildinfo` 是构建产物，应移出版本控制并加入 `.gitignore`。
- `skills/teambition/scripts/generate.py` 与 `skills/teambition/weekly_report/generate.py` 完全相同，保留一份。
- `.scratch/` 有 121 个已提交文件，另有大量未跟踪验证日志（如 `.scratch/rq-sys-v0.2/verification-20261026/*.log`）。建议 `.gitignore` 增加 `.scratch/**/*.log`，验证结论写入 specs，原始日志不入库。
- `.agents/skills` 下 80 个第三方 skill 文件已提交，确认是否需要入库；若需要，注明来源与版本。

### R-15 `pg-mem` 未锁版本
- **位置**：`apps/api/package.json`（`^3.0.14`）
- **问题**：与 AGENTS.md 的锁定版本规定不符，测试结果可能随依赖升级变化。
- **建议**：改为精确版本。

### R-16 迁移规范
- **位置**：`database/migrations/`；`apps/api/src/db/migrate.ts:36`
- **问题**：两个 `0002_*` 已上线，不能改名；`migrate.ts` 对重复前缀只告警。`0003_team_directory_seed`、`0017_seed_umsc_rule_v1` 等种子数据与 schema 迁移混放；`0008_fix_team_directory_name` 属于修补种子的迁移。
- **建议**：CI 中对新增重复前缀直接失败（已上线的 0002 加白名单）；之后的种子数据单独存放和执行。

### R-17 遗留产品体验问题（来自 HANDOFF）
- 需求编号格式不统一：`REQ-<长ID>` 与 `RQ-000001` 并存。
- 文案写"自动刷新"，实际没有轮询。
- `.rules-table` 为死 CSS。
- Base 直达链接未通过环境变量配置。
- 列表分页提示缺失。

---

## 建议执行顺序

1. R-01、R-02：契约测试、`$N` shim、最小 CI。
2. R-03、R-04、R-06、R-07：关闭优先级决策，修正过时文档，HANDOFF 关键内容入库。
3. R-11 后接 R-09、R-08、R-10：先格式化，再做机械拆分（不改行为），每个文件单独一个 PR。
4. R-12、R-05：密钥 fail closed；v0.2 拆里程碑。
5. R-13 至 R-17：卫生与体验项，可穿插进行。
