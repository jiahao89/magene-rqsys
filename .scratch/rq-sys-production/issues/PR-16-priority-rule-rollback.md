# PR-16 评分规则版本可回退（retired → published）

> **状态**：`draft`（2026-11-28 由后端开发按 Chief 指示开票；**未实现**，用户确认是否立项后转 `ready-for-agent`）
> **优先级**：P1（运维可靠性；当前的静默降级 + 无回退入口在评分规则切换时风险最高）
> **来源**：2026-11-28 评分 v4 正式启用过程中的评审结论；PRD-39。
> **范围**：根仓 `apps/api` + `apps/web` + 妙搭镜像 + `database/migrations/` + `specs/rq-sys-mvp/openapi.yaml`。**不改评分算法、不回算历史评分。**

## 1. 问题

评分规则版本一旦发布，就**没有任何界面或接口路径可以回退**：

- `POST /api/rules/priority/{id}/publish` 仅接受 `status='draft'`（`apps/api/src/http/app.ts:1113`；仓储 SQL 也带 `AND status='draft'`，`adapters/postgres/repositories.ts` 的 `publish()`）。已退役版本直接 409。
- 发布 v1 草稿覆盖已发布的 v2/v3/v4 被显式拒绝（`apps/api/src/http/app.ts:1120-1126`，`CALIBRATED_SCORING_FORMULAS` 守卫），错误文案只提 v2/v3。
- 规则页在 `v2/v3/v4` 生效期间把「创建 v1 草稿」「发布」置灰（`apps/web/src/App.tsx:1300`、`:1187`）。
- 服务端没有 retire / unpublish / rollback 端点。

后果：规则切换出问题（例如 v5 提示词首次上线）时，只能**直接改生产库**（`priority_rule_versions` 两行 UPDATE），绕过审计、依赖人工 SQL，且每次都要临时写脚本。2026-11-28 已备好一次性脚本（`.scratch/v4-enable-20261128/rollback/`），但这属于应急手段，不应成为常态。

## 2. 目标

在规则页提供**受审计的一步回退**：把某个 `retired` 的已校准规则版本重新发布，并把当前 published 版本置为 `retired`。

## 3. 方案要点（建议 A，二选一由产品/研发定）

**A（推荐）**：新增专用端点 `POST /api/rules/priority/{id}/rollback`（或 `restore`）
- 只允许回退到 `status='retired'` 且 `formulaType ∈ CALIBRATED_SCORING_FORMULAS` 的版本（即 v2/v3/v4 形态）；未校准 v1 仍不允许。
- 事务内：当前 published → `retired`；目标版本 → `published`（`published_at=now()`）；写 `priority_rule.published` 审计，`safeDetails` 增加 `rollbackFrom` / `rollbackTo` / 原因。
- 响应返回新 published 版本；若目标不是 retired 或当前 published 不唯一，返回 409。

**B**：放宽既有 `publish` 端点，允许 `status IN ('draft','retired')`，且当目标是已校准版本时跳过 v1 守卫。

A 更容易把「回退」与「发布草稿」在产品语义和审计上区分开，推荐 A。

## 4. 非目标

- 不回算/迁移 1830 条历史评分（PRD-39：新旧口径并存）。
- 不做规则的删除、编辑历史版本内容、跨环境同步。
- 不改提示词选择逻辑（`provider.ts` 按 `formulaType` 选 prompt body，回退后自动切换）。

## 5. 验收标准

1. 规则页对 `retired` 的已校准版本显示「回退到此版本」，点击后二次确认（显示目标版本、阈值、影响：新分析将切换提示词与评分口径），成功后列表状态互换、页面提示。
2. `retired` 的 v1（无 `formulaType`）不可回退；当前 published 不唯一或目标非 retired 时返回 409，不产生半完成状态。
3. 审计存在 `priority_rule.published`，`safeDetails` 含 `rollbackFrom`/`rollbackTo`/`reason`，actor 为操作人。
4. 回退后新分析使用目标版本的提示词与评分字段（v3 → 九输入 `scoring`；v4 → `triageScoring` + `rq-analysis-v5`），历史评分行数不变。
5. 两仓行为与 DTO 镜像一致；`check:alignment` 无未声明漂移；openapi 更新；API/集成/Web 用例覆盖「retired → published」「不得两个 published」「v1 拒绝」。
6. 目标环境真点一次回退并复原（不允许只跑本地用例）。

## 6. 风险与约束

- **单 published 约束**：当前库没有 `status='published'` 的部分唯一索引，靠应用逻辑维护；实现时应同事务先退休再发布，并考虑加部分唯一索引（**新增迁移 0037**；0036 已被 `perf_indexes` 占用，先确认线上无多 published 行）。
- **误回退**：需二次确认 + 审计；是否需要管理员限制沿用现有「全体登录用户可用」策略，不额外引角色矩阵（PRD-16）。
- 回退不修复「缺 `triageScoring` 时静默成功」本身，那是分析输出契约的口径问题，另票评估（PRD 风险项）。

## 7. 测试计划

- 单元：端点参数校验、状态守卫、审计载荷。
- 集成（真库）：draft→published 不受影响；retired→published 成功且旧 published 退役；重复回退 409；目标为 v1 时 409。
- Web：按钮可见性（只对 retired 已校准版本）、二次确认文案、成功后刷新。
- 目标环境：回退 v4→v3 再回 v3→v4，各跑一次真实分析确认 promptVersion 与评分字段。

## 8. 参考

- 回滚脚本与 runbook：`.scratch/v4-enable-20261128/rollback/`（应急手段，本票落地后可退役）。
- 相关决策：`docs/2026-11-06-production-readiness-decisions.md` PRD-34 / PRD-39；PRD §4.2.10。
- 规则发布现有实现：`apps/api/src/http/app.ts`、`apps/api/src/adapters/postgres/repositories.ts`、`apps/web/src/App.tsx`。
