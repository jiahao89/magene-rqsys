# 评分 v4 回滚 Runbook（v4 → v3）

> **状态：已备好，未执行。** 2026-11-28 由后端开发按 Chief 指示准备，等待用户授权与失败触发。
> **触发条件**：测试执行「第 3 步真实分析」时出现 **没有 `triageScoring`** 或 **没有生成评分行**（不是等 `failed`，缺字段会安静成功），或 v5 输出连续不合格，由 Chief 决定执行。
> **执行人**：Chief（用户授权后）。后端开发只准备脚本，不执行。
> **环境**：`app_17fqkjwyx1u` / `online`。

## 一、为什么需要改库

- `POST /api/rules/priority/{id}/publish` 只接受 `status='draft'`（`apps/api/src/http/app.ts:1113`，仓储 SQL 同样带 `AND status='draft'`）；v1/v2/v3 全是 `retired`，重新发布会 409。
- 发布 v1 草稿覆盖 v4 会被显式拒绝（`apps/api/src/http/app.ts:1120-1126`，判定集合 `CALIBRATED_SCORING_FORMULAS` 含 v4），提示 "A confirmed v2/v3 scoring rule is published; legacy v1 rules cannot be published over it."。
- 界面在 v2/v3/v4 生效期间「创建 v1 草稿」「发布」均为灰（`apps/web/src/App.tsx:1300`、`:1187`）。
- 全服务端没有撤销发布 / retire 端点。→ 唯一的回滚路径是本节 SQL，**会绕过审计**。

## 二、执行前检查（只读，必须通过）

```bash
cd /Volumes/Files/A_Projects/RQ-Sys
env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_APP_SECRET -u LARKSUITE_CLI_TOKEN \
  lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --yes \
  --sql "$(cat .scratch/v4-enable-20261128/rollback/00-preflight.sql)"
```

期望：`published_rows=1`、`published_formula=pragmatic_triage_v4`、`v4_status=published`、`v3_status=retired`、`v3_rows=1`。
任一项不符 **停止**，先查清是谁改过规则版本。2026-11-28 17:2x 实测即为此值。

## 三、回滚（唯一写操作，单条 UPDATE）

```bash
env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_APP_SECRET -u LARKSUITE_CLI_TOKEN \
  lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --yes \
  --sql "$(cat .scratch/v4-enable-20261128/rollback/10-rollback-v4-to-v3.sql)"
```

- 语句自带守卫：只有「当前唯一 published 就是 v4」且 v3 为 `retired` 时才命中；只改 `v3`/`v4` 两行。
- 期望 `RETURNING` 两行：`version=4 status=retired formula_type=pragmatic_triage_v4`、`version=3 status=published formula_type=umsc_weighted_v3`。
- 幂等：已回滚后重跑返回 0 行。
- 单条语句本身原子；**执行前 60 秒内不要有人在规则页发布规则、不要触发同步/分析**（该语句不拿 app 的 advisory lock，靠单语句快照与守卫兜底）。

## 四、回滚后复核

1. 数据库：

```bash
env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_APP_SECRET -u LARKSUITE_CLI_TOKEN \
  lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --yes \
  --sql "$(cat .scratch/v4-enable-20261128/rollback/20-verify.sql)"
```

期望：v4 `retired`、v3 `published`，全表 1 行 `published`；不新增/删除任何 `analysis_runs`、`requirement_score_versions` 行。

2. 应用侧（只读，不跑同步也能确认）：
   - 规则页应显示 `v3 U/M/S/C v3 已发布`、`v4 务实初筛 v4 已退役`。
   - 新分析走旧提示词：prompt body 由 `priorityRule.formulaType` 决定（`apps/api/src/analysis/provider.ts:317-320`），v4 退役后回到九输入 `scoring` 结构；`promptVersion` 标签 = 环境变量 `AI_PROMPT_VERSION`（未设时为 `rq-analysis-v4`）。
   - 已落库的 v4 评分、历史分析结果不会被回滚脚本改写。

3. 在跑/排队中的分析作业：作业启动时才读 published 规则（`requirements/processing.ts:180`），回滚后新作业自动用 v3；回滚瞬间已进入模型调用的那一条可能仍按 v5 落一条 v4 评分，必要时对那一条重分析一次。

## 五、已知代价

- **审计缺失**：本次回滚不会写 `priority_rule.published` 审计；需在验收/事故记录里手工补记（时间、执行人、原因、`RETURNING` 结果）。
- `published_at`：v3 被改成执行时刻（应用发布也是这个语义）；v3 原始发布时间 2026-11-16 10:42:11 已记录在案（dry-run 输出）。
- 旧评分不重算，新旧口径继续并存（与 PRD-39 一致）。

## 六、反向脚本（误回滚时恢复 v4）

```bash
env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_APP_SECRET -u LARKSUITE_CLI_TOKEN \
  lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --yes \
  --sql "$(cat .scratch/v4-enable-20261128/rollback/90-reenable-v4.sql)"
```

守卫对称：只有「当前唯一 published 就是 v3」时命中，改回 v4 published / v3 retired。

## 七、事前证据（2026-11-28 只读 dry-run）

同谓词 SELECT（不写库）返回两行：

| version | status | formula_type | next_status |
|---|---|---|---|
| 3 | retired | umsc_weighted_v3 | published |
| 4 | published | pragmatic_triage_v4 | retired |

即：命中行数、方向、目标版本都符合预期，执行时才做真正的 UPDATE。
