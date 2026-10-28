# ISSUES.md 核实报告

> 核实日期：2026-10-28。方法：只读静态核对（git 状态、文件与行号、精确计数），未运行测试/build，未修改任何代码。
> 基线：root `af289b2` + 工作区未提交改动（`apps/api/src/analysis/service.ts` +2 行，见文末「基线注意」）。
> 求证对象：`.scratch/review-20261028/ISSUES.md` 的 17 项（R-01 ~ R-17）。

## 总体结论

| 结论分档 | 条目 | 数量 |
|---|---|---|
| 事实成立、建议修 | R-01、R-02、R-06、R-07、R-08、R-09、R-10、R-11、R-14、R-16 | 10 |
| 部分成立、需纠偏后小修 | R-04、R-13、R-17 | 3 |
| 描述不准确或不成立（不应按原文排期） | R-03、R-05、R-12 | 3 |
| 事实成立但理由不符、应换方案 | R-15 | 1 |

三点系统性偏差（比单条错误更值得注意）：

1. **把 2026-10-22 的勘查快照当作当前状态**。`CODEBASE-ASSESSMENT.md` 开篇就写明「代码观察快照：2026-10-22；本次未重跑代码验收」，但 R-03、R-04、R-10 以及 R-08/R-09 的行数都直接引用该快照，未复核当前代码。R-03 因此把已关闭的决策当成未决项，R-04 把已修正的行为当成现行实现。
2. **数字普遍有 1–5% 偏差**：app.ts 854→实际 866；repositories.ts 771→813；.scratch 已跟踪 121→122；specs-mvp 约 25→23。不影响结论，但说明是人工目测计数，citation 时应校正。
3. **两条结论性错误**：R-03（决策已定且已目标验收）、R-12（代码中已有 fail fast，且两仓都有）。这两项如果照原样排期，会做无用的返工甚至改坏现有防护。

---

## 逐条核实

### R-01 两仓 pg 与 Drizzle 的仓储行为没有共同测试

- **判定：成立，保留 P0，建议排期。**
- 证据：
  - `scripts/check-repo-alignment.mjs:50-52` 把 `adapters/postgres/repositories.ts`、`analysis-run-repository.ts`、`sync-persistence.ts` 列入 `DECLARED`（允许差异）；脚本 `:120-146` 对 `DECLARED` 文件只统计"确有差异/恰好一致"，**不做行为比对**。
  - 差异根源可证实：`rq-sys-miaoda/server/rqsys/adapters/postgres/drizzle-pool.ts:66-77` 按 SQL 文本出现顺序逐次重绑 `$N`（同一 `$N` 出现两次 ⇒ 绑定两个参数），与 node-postgres 按编号绑定不同。
  - 事故有仓库内证据：`.scratch/rq-sys-mvp/HANDOFF.md:112-117`、`:185-186` 记录 2026-10-22 线上分配负责人 503，根因即"重复 `$3` 被拆成两个参数、无类型上下文"，并明确写「只有 root 的 `pg` 测试通过不算数」。
  - 现有测试确实只覆盖 root：`apps/api/src/adapters/postgres/repositories.integration.test.ts`、`apps/api/src/http/auth-source.test.ts` 用真实 `pg`；`pg-mem` 全仓无引用（见 R-15）。
- 纠偏：ISSUES 说"根仓测试使用 `pg` / pg-mem"——pg-mem 实际未被使用；说"无法发现 `$N` 参数拆分问题"成立，但更准确的机制是"按文本顺序重绑"，不是"参数拆分"这么笼统。
- 补充：这个方向在 `specs/rq-sys-v0.2/CODEBASE-ASSESSMENT.md:23` 已被认可（"允许差异的路由/仓储也要执行同一行为契约用例，不能只靠分类通过"），并非新发现，缺的是落地。
- 建议：契约测试优先于 shim（契约测试能直接在两仓跑同一组用例）；shim 作为根仓的补充，不要只做 shim。成本：契约测试框架约 1–2 人日，之后每加一个仓储用例是增量。

### R-02 没有 CI

- **判定：成立，P1，建议尽快做。**
- 证据：`.github` 不存在；根 `package.json` 只有 `typecheck/build/test/check:alignment/check:contract` 等本地脚本，无 lint/format/husky；仓库内无 GitLab CI 等其他配置。
- 需要人工执行的检查：typecheck（root `package.json:9`）、test（`:10`）、check:alignment（`:12`）、check:contract（`:13`）、`git diff --check`（无脚本，靠 AGENTS.md:76 约束）。
- 纠偏：CI 只能覆盖根仓（GitHub 是代码源、妙搭仓独立发布）；不要承诺 CI 能防住 `$N` 这类目标环境问题（那是 R-01 的职责）。
- 建议最小 CI：install → typecheck → root tests → check:alignment → 迁移前缀检查（R-16）。成本：约 0.5 人日。

### R-03 优先级公式与 PRD 冲突，D-08 未关闭

- **判定：不成立/已过时；不应按原文排期。**（但留一个真实小残留，见末段）
- 证据：
  1. 评分 v2 已由用户 **2026-10-27** 确认：`specs/rq-sys-v0.2/DECISIONS-AND-GATES.md:7`（G-UMSC 2026-10-27 更新，"用户确认评分v2…无产品阻塞；T19–T22已于2026-10-28目标验收"）。
  2. 实现已落地：`apps/api/src/analysis/scoring.ts:82` `SCORING_THRESHOLDS = { p0: 45, p1: 25, p2: 10 }`，`:115` `computeUmcScore`；`database/migrations/0019_scoring_v2.sql` 写入 `formulaType: umsc_weighted_v2` 规则并退休非 v2 的已发布规则；`apps/api/src/analysis/priority-rule.ts:38-49` 优先走 v2。
  3. 规格已目标验收：`specs/rq-sys-v0.2/06-ai-scoring-and-priority.md:3`「状态：target-verified（2026-10-28 目标验收通过）」。
  4. D-08 是 **UI 组件库**决策，与优先级公式无关，且 **2026-10-08 已决定**（`specs/rq-sys-mvp/OPEN-DECISIONS.md:14`：HeroUI v3 + Tailwind 已采纳并推送基线）。ISSUES 把 D-08 拉进来是概念混淆。
  5. 旧 v1 求和规则按设计保留历史兼容（`priority-rule.ts:50-80`；`06` spec 同述），"四维映射求和 + 阈值 0–4"是 v1 的**历史兼容分支**，不是当前主路径。
- 真实残留（值得单独修，但优先级低）：`apps/api/src/contracts/rules.ts:45-59` 的 `POST /api/rules/priority` 仍只接受 v1 形态（thresholds 0–4），且 `repositories.ts:712-713` 的 `publish` 会把当前 published 规则全部 retired。即：**理论上仍可通过「高级设置」创建并发布一条 v1 规则，把已确认的 v2 覆盖掉**，服务端无守卫、UI 仍暴露入口。建议：v2 存在时禁止发布 v1 形态规则（或在 UI 标注"仅历史兼容"）。
- 另：`AGENTS.md:17` 仍写「do not build production UI until D-08 is resolved」——D-08 已决且 UI 已上线，这句是过时表述，归入 R-07 一并修。
- 结论：把 R-03 从"未决阻塞"改为「已关闭 + 上述小残留 + AGENTS 过时句」。

### R-04 重复标题语义文档与代码不一致

- **判定：部分成立（范围比描述小得多）。**
- 证据：
  - 现行代码只做提示：`apps/api/src/sync/service.ts:30-66` `requirementTitleKey` / `markDuplicateTitles`，注释明写「同标题只做"疑似重复"标注……不删除、不改写 Base」。符合 AGENTS.md 的"identity 用来源 ID"不变式。
  - `specs/rq-sys-v0.2/CODEBASE-ASSESSMENT.md:20` 写「最新commit按规范化标题丢弃不同TB ID」——这是 2026-10-22 的**快照描述**，同一行后半句已写「与AGENTS冲突，单列15；2026-10-22 勘查时不改代码或历史数据」。而 T15 状态已是 `implemented-local`（`.scratch/rq-sys-v0.2/issues/README.md:30`），v0.2 README:37 与 G-ID 也写的是"独立保留"。
  - HANDOFF 不是"前后矛盾"，是时间演进且已自我推翻：`HANDOFF.md:119-129`（补5，丢标题）、`:158`（补8，改为全部导入+标记）、`:172-181`（补9，产品确认"仅提示"，移除拦截）。
- 建议：只改 `CODEBASE-ASSESSMENT.md:20` 一行，加"（已被 2026-10-23 产品确认取代：仅提示，见 V02-T15）"。成本 <10 分钟。不必动其他文档。

### R-05 v0.2 范围过大

- **判定：部分成立；"缺少分阶段验收"不成立，不建议按原文拆里程碑。**
- 证据：v0.2 确实是 7 份 spec + 24 张 ticket（`specs/rq-sys-v0.2/` 12 份文件；`issues/README.md` 24 张）；但验收已分批且已执行：
  - `specs/rq-sys-v0.2/README.md:50`「核心发布、Beta、v1新规则与评分v2分别验收」；
  - `DECISIONS-AND-GATES.md:26`「核心16、Beta17、v1规则18与评分v2（T19–T22）分别给结论……不能把未验证项算作通过」；
  - 事实状态：核心 T01–T16、Beta T11–T17、评分 v2 T19–T24 已分别 target-verified（tickets README 表格）。
- 结论：RICE/Kano 已隔离在详情次级 Beta 入口、手动运行、不参与主评分，发布风险已被架构隔离；再拆"M1/M2 里程碑"属于返工式文档整理，收益低于 R-01/R-02。若担心发布风险，更实际的动作是**默认隐藏 Beta 入口的开关**，而不是重写规格。

### R-06 当前状态与踩坑记录只在未跟踪的 HANDOFF

- **判定：成立，建议修（但需用户决策）。**
- 证据：
  - `git ls-files` 不含 `.scratch/rq-sys-mvp/HANDOFF.md`（确认未跟踪，201 行）。
  - 含真实资源 ID：`HANDOFF.md:31-40`——妙搭 app `app_17fqkjwyx1u`、公网地址、正式 Base token `GRnEboCIga7Omas8RwgcDmmgnib` / table `tbl6Gfi0KJ2a1llK`、通知工作流 `wkfMnsnvaDS4Auj4`、PM Leader user_id。
  - 已提交文档中也有 ID（所以"已提交文档中不含真实资源 ID"这条验收标准目前不成立）：`specs/rq-sys-mvp/FEISHU-BASE-POC.md:11,15`、`specs/rq-sys-mvp/LOCAL-AND-TARGET-STATUS.md:8,44`。
- 纠偏：子断言"PRD rev 60 只记录在飞书"**不成立**——`AGENTS.md:6`、`specs/rq-sys-mvp/README.md:11`、`OPEN-DECISIONS.md:21` 都有 revision 60。
- 建议：把"踩坑 + 当前状态 + 运维基线"整理进已提交的 `deployment/` 或 docs runbook；Base token/app ID 换成环境变量键名（`BASE_APP_TOKEN` 等）；HANDOFF 本身要么脱敏后入库，要么明确保留为本地文件并加 README 指向。成本：0.5–1 人日，**是否把内部 ID 入库需要你拍板**。

### R-07 README 过时，AGENTS.md 测试要求矛盾

- **判定：成立，建议优先修（低成本、直接影响后续 agent 行为）。**
- 证据：
  - `README.md:17`：「The skeleton currently exposes `GET /api/health` and `GET /api/health/ready`……The local server is not yet a deployable Miaoda application.」与已上线事实矛盾（HANDOFF 记录 2026-10-22/23 多次 release、线上 302 到飞书登录，`HANDOFF.md:23-24,163-167,175`）。
  - `AGENTS.md:57`「Run tests only when the user or ticket explicitly asks for them.」 vs `AGENTS.md:76`「Run typecheck, relevant/full tests, build, and `git diff --check` before claiming local completion.」——同一文件两种口径。
  - `agent.md` 仅 4 行，纯指路到 AGENTS.md（冗余入口，可删或保留，无技术风险）。
  - `AGENTS.md:17` D-08 表述过时（见 R-03）。
- 建议：README 重写"现状/架构/两仓关系/部署态"三节；AGENTS 合并测试规则为一条（例如：默认按需、声称完成前必须 typecheck+build+相关测试）；删或保留 agent.md 由你定。成本约 0.5 人日。

### R-08 http/app.ts 路由集中

- **判定：成立（数字需校正），建议排期，不是紧急项。**
- 证据（精确命令与输出）：
  - `wc -l apps/api/src/http/app.ts` → **866**（ISSUES 说 854）。
  - `grep -c 'url\.pathname === '` → 24；`grep -c 'method === '` → 47；`grep -cE 'pathname\.match|match\('` → 18；`if (method === ...)` 形态 22 处。路由分支约 40+（ISSUES "约 42 处"接近）。
  - 文件承担：路由分发 + 部分 DTO 映射 + 校验 schema 调用（`app.ts:387-414` 等），错误处理在 `http/errors.ts`。
- 注意：`http/app.ts` 在 `check-repo-alignment.mjs:70` 的 `DECLARED`（"路由装配差异"），拆分需同步更新声明，并保持 `rq-sys-miaoda` 侧等价结构；现有 HTTP 测试（`apps/api/src/http/*.test.ts`，走真实 handler）不依赖内部结构，拆分不必改断言。
- 建议：按资源拆模块 + 路由表注册，纯机械搬运，单独 PR；不做则风险主要是"改一处要读 866 行"，不影响正确性。

### R-09 repositories.ts 过大且超长行

- **判定：成立（数字需校正），建议在 R-11 格式化之后做。**
- 证据：
  - `wc -l` → **813**（ISSUES 说 771；差异来自近期 scoring v2 新增的 `PostgresRequirementScoringRepository`）。
  - 仓储实现类 **14 个** + 聚合入口 `PostgresRepositories` + 3 个错误类（`ActiveBatchConflict`、`PersonMappingConflict`、`TeamDirectoryConflict`）= 18 个 class 声明（ISSUES "14 个仓储类"按实现类算准确）。
  - `awk 'length>300' | wc -l` → **61** 行；最长行 **2790** 字符——两项与 ISSUES 完全一致；`:104-107`、`:399-408` 确为"整个类写在一行"。
- 注意：该文件在 `DECLARED`（`check-repo-alignment.mjs:50`，理由"驱动差异"），拆分要同步妙搭仓与声明；2900 字符单行格式化会产生巨量 diff，必须与逻辑改动分开提交。
- 建议：R-11 引入 Prettier 先全量格式化（单独提交），再按仓储拆文件，`PostgresRepositories` 保留为聚合入口。

### R-10 panels.tsx 过大

- **判定：成立，建议排期。**
- 证据：`wc -l apps/web/src/panels.tsx` → **1695**（与 ISSUES 一致）；`grep -c '^export (function|const) '` → **12** 个导出面板；`apps/web/src/` 下**没有** `features/` 目录，说明 `CODEBASE-ASSESSMENT.md:21` 的"按 feature 抽出"尚未执行（该行自述"约1405行"，现已增长约 290 行）。
- 风险：panels.tsx 与 `App.tsx`、`workbench-routing.ts`、`api.ts` 状态耦合，拆分会动到路由与列表状态；web 侧 7 个测试文件可作为回归网。
- 建议：先拆体量最大的 3 个面板（需求池/详情/规则或映射），`panels.tsx` 退化为组装入口；不追求一次到位。

### R-11 没有 lint / format

- **判定：成立，建议优先做（是 R-08/R-09/R-10 的前置）。**
- 证据：根与 `apps/api`、`apps/web` 均无 eslint/prettier/biome 配置，无相关 devDependencies，无 `.editorconfig`；三个 `package.json` 都没有 `lint`/`format` script（`grep` 无命中）。妙搭仓有独立的 eslint（`verification-20261026/miaoda-eslint*.log`），不能覆盖根仓。
- 建议：Prettier + ESLint（最小规则集，先不开启噪音大的规则）；根 package.json 加 `lint`/`format`；格式化单独提交；接入 R-02 的 CI。注意：格式化会重写 repositories.ts 的 61 行超长行，**必须在两仓同步窗口内一次完成**，否则对齐脚本会报大量漂移。

### R-12 Teambition 网关密钥为空时不报错

- **判定：不成立（描述与代码相反）；但有两个真实的小残留。**
- 证据：
  - `apps/api/src/adapters/teambition/client.ts:70-73`：`this.apiKey = options.apiKey ?? process.env.GATEWAY_API_KEY ?? DEFAULT_GATEWAY_API_KEY; ... if (!this.apiKey) throw new Error("Teambition gateway API key is not configured");`——**构造即失败，不会发出请求**。
  - 妙搭仓同样：`rq-sys-miaoda/server/rqsys/adapters/teambition/client.ts:71-72` 有相同守卫。两仓行为一致。
  - ISSUES 引用的"第 6、70 行"正是 `DEFAULT_GATEWAY_API_KEY = ""` 与赋值行，但漏读了紧邻的 throw 行。
- 真实残留（可作为小改）：
  1. 启动时吞异常：`apps/api/src/server.ts:42`、`rq-sys-miaoda/server/rqsys/runtime.ts:83` 用 `try { new TeambitionClient() } catch { /* source setup will report the unavailable gateway */ }`，把明确错误降级成后续泛化的"gateway unavailable"，**定位反而变差**。建议启动日志打印缺失的环境变量键名（不打印值）。
  2. 无测试：`client.test.ts` 只测正常构造；缺"缺 key 必须 throw 且 message 含 `GATEWAY_API_KEY`"的用例。
- 建议：把 R-12 改写为上述两条（P2 小改），不要做"空密钥失败"的重复实现。

### R-13 specs 状态类文档重复、mvp 与 v0.2 未归档

- **判定：部分成立，建议整理（P2）。**
- 证据：
  - 数量：`specs/rq-sys-mvp` **23** 份（ISSUES 说约 25）、`specs/rq-sys-v0.2` **12** 份。
  - 重叠且已过时：`LOCAL-AND-TARGET-STATUS.md`（276 行，标题写 "updated 2026-10-19"）与 `RELEASE-CLOSEOUT.md`（171 行，2026-10-19）都含大段"历史验收记录/快照"，且都**早于** 2026-10-22/23 的发布与 10-27/28 的评分 v2 验收——现在读它们会得到过时结论。
  - `NOTIFICATION-CAPABILITY-PLAN`（51 行）/`-RESULTS`（50 行）/`NOTIFICATION-CLOSEOUT-DESIGN`（50 行）是"方案/结果/设计"三种不同用途，重叠有限，**不建议合并**；PLAN 与 CLOSEOUT-DESIGN 有部分重复，可合并。
  - 新增发现（清单未列，但同类）：`.scratch/rq-sys-v0.2/issues/README.md` 头部写"评分v2扩展T19–T22均为target-verified"，同文件「当前状态」却写"T19–T22 为 `ready-for-agent`，尚未实现"——同一文件互相矛盾，比 specs 重复更应立即修。
- 建议：每个版本保留一份"当前状态"文档（更新到 2026-10-28），过时状态文档移入 `specs/archive/`；先修 tickets README 的矛盾句。

### R-14 仓库卫生

- **判定：成立（一条子项不成立），建议尽快做（低成本）。**
- 证据（逐条）：
  - `apps/web/tsconfig.tsbuildinfo` **确实被跟踪**（`git ls-files` 命中）；`.gitignore` 无 `*.tsbuildinfo`。
  - 两个 `generate.py` **完全相同**：md5 均为 `eb55484a3e2d0fbde8faa39d6ea07f17`（`skills/teambition/scripts/generate.py` 与 `skills/teambition/weekly_report/generate.py`）。
  - `.scratch` 已跟踪 **122** 个文件（ISSUES 说 121）；未跟踪验证日志 **140 个、15MB**（`.scratch/rq-sys-v0.2/verification-20261026/`），`.gitignore` 未覆盖 `*.log`/该目录。
  - `.agents/skills` 已提交 **80** 个文件——但**有**来源说明：`.agents/skills/README.md` 写明 `https://github.com/mattpocock/skills @ 5beb35b (MIT)`、安装日期与更新方式。**该子项不成立**，无需再处理。
- 建议：`.gitignore` 加 `*.tsbuildinfo`、`.scratch/**/*.log`、`.scratch/**/verification-*/`；`git rm --cached apps/web/tsconfig.tsbuildinfo`；删一份重复 generate.py；原始日志不入库，结论写 specs。

### R-15 pg-mem 未锁定版本

- **判定：事实成立但归因不成立；应改为"删除未使用依赖"。**
- 证据：
  - `apps/api/package.json:20` → `"pg-mem": "^3.0.14"`（未精确锁定；同文件 `"pg": "8.23.0"` 是精确版本）。
  - `AGENTS.md` 中**没有**"依赖必须锁版本"的规定（全文 grep `锁/pin/精确版本/exact` 无命中），ISSUES 的"与 AGENTS.md 的锁定版本规定不符"属误引。真正的版本规则只针对迁移/构建产物。
  - 更重要的是：**`pg-mem` 在全仓无任何引用**（除 `package.json` 声明），且 `docs/agents/issue-tracker.md:25` 明确写「never use pg-mem as proof of PostgreSQL behavior」。
- 建议：直接移除 `pg-mem` 依赖（比锁版本更彻底）；若未来要保留，则精确锁定并说明用途。成本：一行 + `npm install`。

### R-16 迁移前缀重复只告警、种子数据混放

- **判定：成立，建议修（CI 检查），但绝不能改名已上线迁移。**
- 证据：
  - `database/migrations/` 存在两个 `0002_*`：`0002_person_mapping_idempotency.sql`、`0002_single_source_config.sql`（排序按完整文件名，实际执行顺序依赖文件名）。
  - `apps/api/src/db/migrate.ts:26-38` 对重复前缀只 `Warning`，注释已说明"已应用的迁移文件名绝不能被改写"——与 AGENTS.md「keep migrations additive / never rewrite an applied migration」一致，**设计是有意的**。
  - 种子/修补类混放：`0003_team_directory_seed.sql`、`0017_seed_umsc_rule_v1.sql`、`0008_fix_team_directory_name.sql`（修补种子）。
  - 目前**没有**任何脚本/CI 检查前缀重复（`scripts/` 只有 alignment/contract/maintenance 三个；无 CI）。
- 建议：CI 加"新增重复前缀即失败"的检查，对已上线的两个 `0002_` 加白名单；种子数据从 schema 迁移中拆出（新机制，从 0020 起），**不要动 0003/0017/0008**。注意：线上已执行记录无法从仓库验证（HANDOFF 提到用 `+db-env-migrate`），任何改名都是高风险。

### R-17 HANDOFF 遗留的 P2 体验问题

- **判定：5 条中 2 条成立、2 条部分成立、1 条不成立。**（逐条给证据）
- 1. **需求编号格式不统一：成立。** `apps/web/src/App.tsx:367` 与 `panels.tsx:1493` 渲染 `REQ-{row.sourceRequirementId}`（TB 长 ID）；详情栏 `panels.tsx:1268` 用 `platformRequirementId ?? REQ-${slice(0,8)}`。应统一到 `RQ-000001`。
- 2. **"自动刷新"文案无轮询：部分成立。** 总览有有界轮询：`App.tsx:246-252`（仅批次 running 时 5 秒轮询、页面可见时）。但详情页 push 提示 `panels.tsx:1201,1203`（"完成后状态会自动刷新"）所在的详情视图**没有轮询**（panels.tsx 无 setInterval），文案不实。修法：改文案或给详情加轮询。
- 3. **`.rules-table` 是死 CSS：成立。** `apps/web/src/styles.css:1139-1140` 定义，`grep rules-table` 在 tsx 中无任何使用。
- 4. **Base 直达链接未通过环境变量配置：不成立/已过时。** 现在的实现是 `panels.tsx:915-931` `BaseRecordReference`：只提供"复制记录 ID"，注释明确"凭据不下发浏览器……而不是伪造一个打不开的链接"。既没有硬编码链接，也不存在"未配置环境变量"的链接；这是**有意设计**。P2-10 的原文是"尚未拿到真实样例，建议用环境变量配置"，属于待办设想而非缺陷。
- 5. **列表分页提示缺失：部分成立。** 需求池已有"已加载 N 条，还有更多"（`panels.tsx:906`）与"加载更多"（`:539`、`:910`、`:1494`，映射页为"加载更多待匹配需求"）；但**审计日志固定 `limit: 50`、无 cursor、无提示**（`panels.tsx:1512`）。只需补审计页。

---

## 建议处理顺序（修订版）

**第一档：低风险、防误导、可当天做**
1. R-07（README/AGENTS 口径 + 删 D-08 过时句）+ R-04 一行标注 + R-13 的 tickets README 矛盾句修正。
2. R-14 卫生（.gitignore + `git rm --cached` + 删重复脚本）。
3. R-15 改为删除未使用的 `pg-mem`。
4. R-12 改写为"启动日志明确缺失变量名 + 加单测"，不做重复的 fail-fast。

**第二档：工程基建（1–2 天，价值最高）**
5. R-02 最小 CI；顺手把 R-16 的迁移前缀检查并入 CI。
6. R-01 仓储契约测试（P0 级技术债，唯一真正影响线上正确性的项）。

**第三档：结构性重构（需专门排期、两仓同步窗口）**
7. R-11 Prettier/ESLint + 格式化单独提交。
8. R-09 → R-08 → R-10 机械拆分（每个一个 PR，全程不改行为）。
9. R-06 状态/踩坑入库与脱敏（需你决定 HANDOFF 是否入库、内部 ID 是否保留）。

**从清单移除或降级**
- R-03：改为「已关闭；补 v1 规则可覆盖 v2 的小守卫 + AGENTS 过时句」。
- R-05：不必按原文拆里程碑（已有分批验收；可选开关隐藏 Beta）。
- R-12、R-15：按上文改写，原表述不要采用。
- R-17.4：设计如此，不必改。

## 基线注意

- 核实期间 HEAD 从 `af289b2` 前进到 `15a3bae`（两笔提交：`788a42d` 把 provider/model 等写入 analysis run 完成记录、`15a3bae` 记录自定义模型端点可达性阻塞），本报告结论不受影响。核实后的第一档修复见同目录 `FIX-REPORT.md`。
- `.scratch/rq-sys-mvp/HANDOFF.md` 未跟踪（见 R-06）。
- `rq-sys-miaoda/` 是独立 Git 仓且被根 `.gitignore` 忽略，本报告未逐文件比对，只核对了与本清单相关的 client/drizzle-pool/runtime；两仓一致性结论以 `npm run check:alignment` 为准。
- 本报告未运行测试/build；所有"目标环境"结论均未复核，只做代码与文档层判定。
