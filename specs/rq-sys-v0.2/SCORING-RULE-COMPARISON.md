# 需求评分规则核对：飞书《需求处理流程》 vs 当前实现

> - **文档来源**：飞书 wiki《需求处理流程》V1.0（更新 2026-09-18；revision 4533；document_id `T6XFd9ZDwocqNQxr6cscRZRjnvb`；<https://aimagene.feishu.cn/wiki/JEyLwBYOziz0bPknDSgcjhuTn9g>）
> - **实现基线**：root HEAD `1ba0bcc`（2026-11-03）；生产规则与评分数据为 2026-11-03 只读核对
> - **核对日期**：2026-11-03。仅核对与比较：未改代码、未改生产数据、未重算存量评分
> - **一句话结论**：综合公式、四维锚点、45/25/10 阈值已与文档第 3 章一致；文档第 5 章「评分预审 Prompt」另有一套互相矛盾的刻度；α 因 VOC 未接入改为服务端归一 1.0/1.5；直通/NPS/U 单维分档未实现；生产评分因旧提示词示例被照抄而 M/S 塌缩，α=0.8 时 P0 数学不可达。

## 1. 公式与四维定义（第 3 章「需求价值判定」）

| 项 | 文档 | 实现 | 结论 |
|---|---|---|---|
| 综合公式 | 展开式 `U×(1+0.6M+0.4S)÷C`；同章 callout 又写作「（用户价值+0.6营销价值+0.4战略价值）/研发成本」，缺 U 乘子/运算符 | `apps/api/src/analysis/scoring.ts:137` 同展开式；`:139` round2 | 展开式一致；callout 歧义见文档批注 c4 |
| U | 痛点强度 1–5 × 场景频次 1–5（1–25） | `scoring.ts:22`、`:131` | 一致 |
| M | 卖点支撑 1–3 × 竞品对标 1–3（1–9） | `scoring.ts:23`、`:132` | 一致 |
| S | Roadmap 匹配 1–3 × 跨部门依赖 1–3（1–9） | `scoring.ts:24`、`:133` | 一致 |
| C | MAX(工作量,技术风险,资源占用) 1–5 | `scoring.ts:25`、`:134` | 一致 |
| 维度锚点 | 第 3 章四张分档表（痛点/频次/卖点/竞品/Roadmap/依赖/成本三项） | `apps/api/src/analysis/provider.ts:223-233` 逐条英文转写 | 一致（`1ba0bcc` 新增锚点） |
| 用户价值单维分档 | P0 16–25 / P1 9–15 / P2 4–8 / P3 1–3（仅 U） | 无 | 未实现（实现只产出综合分 P） |

## 2. 优先级阈值：文档内部两套刻度（需产品定稿）

| 口径 | P0 | P1 | P2 | P3 | 与实现 |
|---|---|---|---|---|---|
| 文档第 3 章「需求优先级-动作」 | ≥45 | 25–44 | 10–24 | <10 | **一致** |
| 文档第 5 章「评分预审 Prompt」 | ≥16.0 或 KANO=M | 3.2–5.0 且「价值高」 | 1.0–15.0 | 0.2–1.6 | 不一致 |
| 代码 | `scoring.ts:83`、`scoring.ts:109-114`：≥45/≥25/≥10/其余 | | | | — |

- 两套刻度互斥：Prompt 内 P2 1.0–15.0 与 P3 1.0–1.6、P1 3.2–5.0 重叠；15.0–16.0 无归属；P1 另附未定义的「价值高」。文档批注 c9 已指出同一冲突，c5 指出 16–25 是 U 单维刻度而非综合分。
- 仓库侧已选定 45/25/10：`specs/rq-sys-v0.2/06-ai-scoring-and-priority.md:263` 明确「原试评文档中的『简单评估办法』和『评分预审 Prompt』阈值不再使用」；生产发布规则 v2 的 payload 只含 `thresholds 45/25/10`（只读查询 `priority_rule_versions`：version 2 `published` / version 1 `retired`）。
- 规则解释器硬校验同一组阈值：`apps/api/src/analysis/priority-rule.ts:42`（`p0!==45||p1!==25||p2!==10` 时规则不可用）。
- 位置更正：任务描述称「第 4 章 评分预审 Prompt」，实际在**第 5 章「多维表+AI 辅助」→「评分预审 Prompt」**；第 4 章是「处理机制（草稿-待更新）」。

## 3. α 修正系数（文档「VOC&NPS评分（待引入）」）

| 文档 | 实现 | 结论 |
|---|---|---|
| `U 修正 = U × α`；α=1.2（反馈≥10条且跨≥3渠道）/1.0（3–9条且跨≥2渠道）/0.8（<3条或单渠道）/1.5（安全/事故，「强制 P0 候选」） | α 乘在 U 上：`scoring.ts:136`；服务端归一：`scoring.ts:124-126` + `service.ts:89-96`，safetyFlag→1.5，否则 1.0；模型返回的 α 仅作参考 | **部分一致** |

- **历史值**：旧提示词示例写死 `alpha: 0.8`（`git show 1ba0bcc^:apps/api/src/analysis/provider.ts`），生产 315 条 current 评分 **α 全部 = 0.8**（`/tmp/rq-scores.json`，导出于 2026-11-02 17:17，早于 `1ba0bcc`），等于对所有需求统一打 8 折。
- **现行**：`provider.ts:234` 要求模型只返回 1.0/1.5；α=1.2/0.8 依赖「反馈条数+跨渠道」VOC 证据，系统拿不到，未实现（`scoring.ts:117-123`）。安全 1.5 已实现，但文档「强制 P0 候选」未实现：安全标记仅提示人工复核、不自动改 P（`apps/web/src/panels.tsx:1187`「安全标记不自动改变 P」）。
- **回放**（当前输入、同公式、α=1.0）：P2 4→21 条（17 条 P3→P2），最高分 20.00，仍无 P1/P0；生产存量未回算（V02-S06 约定不静默回算历史）。
- **残留**：生产规则 payload 仍带 `alpha.defaults.single=0.8`（`database/migrations/0019_scoring_v2.sql:41`），与现行归一冲突，属元数据残留；定稿后应新增迁移更新规则 payload（不修改已应用迁移）。

## 4. 输入可获得性：P0 为何数学不可达

- 生产分布（315 条 current）：U 均值 6.73、M 1.09、S 1.02、C 2.34；M=1 共 299 条、S=1 共 308 条、**M=S=1 共 295 条（93.7%）**；放大因子 `1+0.6M+0.4S` 均值 2.06（设计上限 10.0）、最高 5.00；得分最高 16.00、均值 5.02；P3 311 / P2 4 / P1 0 / P0 0。
- 与旧示例同形：旧 prompt 示例为 pain 3 × freq 4、M=S=1、C=3、α=0.8 → 6.40；生产恰有 **28 条得分 6.40**，其中 11 条输入与示例完全同形。`1ba0bcc` 已把示例改为占位符并加锚点。
- **推导**：M=S=1 → 放大因子 = 2.0；U 最大 25、C 最小 1、α=0.8 → 最高分 = 25×0.8×2/1 = **40 < 45**，即 α=0.8 时 **P0 数学不可达**；实际最高 16.00，P1（≥25）亦不可达。α=1.0 后理论最高 50（仍要求 U=25、C=1、M=S=1），回放实测最高仅 20.00。
- **根因是输入可得性**：M/S 依赖竞品对标、Roadmap、跨部门依赖，TB 需求原文基本没有；`provider.ts:233` 规定无证据取该维最低锚点并标 `assumption=true`。校准样例同样塌缩：`0019_scoring_v2.sql:43-48` 六条样例中 S 全为 1、M 最高 4、四条 M=1，未覆盖 M/S 放大维度。
- 结论：只修 α 不够；要产出 P1/P0，必须给 AI 补业务上下文（版本 Roadmap、竞品对照、战略主题/硬依赖），或由 PM 在评分前提供。

## 5. 文档有、实现没有的规则

| 文档规则 | 状态 | 依据 |
|---|---|---|
| 「需求直通规则」：合规 / 重大质量故障 / 战略硬依赖→强制直通跳过评分（24h 内同步 PM Leader）；已立项变更→跳过再评分 | 未实现 | `apps/api/src` 无直通/override 实现（grep 无命中）；评分链无跳过分支 |
| NPS 触发后「强升一级 P」/专项批次 | 未实现 | 无 NPS 数据源；`scoring.ts:117` 仅注明 VOC/NPS 未接入 |
| KANO=M 强制升 P0、反向型降一级、合规卡点不低于 P1 | 未实现（Kano 为独立 Beta，不参与主评分） | `06-ai-scoring-and-priority.md:209`「RICE/Kano 不参与评分 v2」；Kano 在 `beta/kano.ts` 独立运行 |
| 第 5 章 Prompt 的虚拟用户调研 / KANO 标注 / 四象限矩阵输入 | 未实现（主分析 prompt 无这些输入） | `provider.ts:237` 请求仅含模块、人群、规则、源证据 |

## 6. 待产品定稿清单

1. **阈值口径二选一**：确认 45/25/10 为唯一正式刻度并修订文档第 5 章 Prompt 分档（消除 P1/P2 重叠与 15.0–16.0 断档）；或改用 Prompt 四象限，则需同步改 V02-S06、代码与生产规则。
2. **U 单维分档**（16–25 等）是否保留；保留则注明「仅 U 单维展示，不映射综合 P」。
3. **α 口径**：VOC 未接入期间是否接受「中性 1.0、安全 1.5」；α=1.2/0.8 何时引入、需要哪些 VOC 数据源。
4. **安全类**是否要「强制 P0 候选」；NPS 升 P 是否排期。
5. **直通规则**是否排期实现，还是继续人工流程暂代。
6. **M/S 业务上下文供给**：如何给 AI 提供 Roadmap、竞品对照、战略依赖，否则 P0/P1 长期不可达。
7. **存量 315 条评分**是否用新锚点/α 重算（会改优先级与 Base 投影，需单独授权）。

## 7. 核对命令与文件

- 文档：`lark-cli docs +fetch --doc 'https://aimagene.feishu.cn/wiki/JEyLwBYOziz0bPknDSgcjhuTn9g' --as user --doc-format markdown --detail simple`（revision 4533；批注 c4/c5/c9 为文档内评论）
- 生产规则（只读）：`lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --as user --yes --sql "SELECT version,status,rules FROM priority_rule_versions ORDER BY version DESC LIMIT 2"`
- 生产评分统计：读取 `/tmp/rq-scores.json`（315 条 current；α/U/M/S/C/P 分布与 α=1.0 回放）
- 实现：`apps/api/src/analysis/scoring.ts`、`priority-rule.ts`、`provider.ts`、`service.ts`；`database/migrations/0019_scoring_v2.sql`；`specs/rq-sys-v0.2/06-ai-scoring-and-priority.md`
- 本核对未写库、未改代码、未重算生产数据。
