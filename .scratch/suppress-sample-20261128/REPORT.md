# 已排除样本验证 + 评分显示复验（2026-11-28）

Release `7713130426836208920`（妙搭 `8366dc3` / 根仓 `e8ac1e9`，CI `46123991650`）。

本轮唯一一次写：**RQ-000311**（「L508 只能连接迈金助手，需要顽鹿运动支持」，产品池、TB 来源、负责人贾浩、已分析已推送）
忽略 → 验证 → 撤销。全程 1 次可逆写，跑完回到基线。

## 1. 为什么没用原定的 RQ-000316

`requirements-page.tsx:2637` — `duplicateBlock` 只在 `isTbSource` 时渲染：

```ts
const duplicateBlock = isTbSource ? <DuplicateDecisionSection .../> : null;
```

RQ-000316 是 **Web 手工**来源，详情页没有「重复处理」区块，UI 上无法忽略或判定重复（该页 32 个按钮里没有「忽略」）。
手工/聊天粘贴来源目前只有「疑似重复提示不走」的既有口径，**是否能忽略/判定重复没有定论** —— 需要产品确认是不是预期。

改为产品池 TB 来源的 RQ-000311，满足：TB 来源（有重复处理区块）、已分析、已推送、负责人是用户本人（万一有通知只到用户）。

## 2. 忽略（真实 UI 路径）

- 路径：详情页 →「历史与高级」Tab →「重复处理」→「忽略」→ 填「判定理由」→「确认忽略」。
- 该需求没有同标题候选，进入精简态（只保留「忽略」），`重复处理` 区块因此不在默认 Tab 里，而在「历史与高级」Tab。
- 结果：`processing_state = suppressed_ignored`，`requirement_resolutions` 1 行（v1），`updated_at` 16:10:55。
- 审计：`duplicate.reviewed` / `{decision:"ignored", version:1}` / 16:10:55。

## 3. 已排除态的线上证据

| 位置 | 实测 |
|---|---|
| 详情横幅（`role=alert`） | 「该需求已被排除（已忽略） 被排除的需求不会进入 AI 分析、Base 推送与通知；记录仍保留。请在「重复处理」撤销判定后恢复为活跃。」 |
| 重复处理状态 | `已忽略 · 理由：冒烟验收… · 判定版本 v1` |
| 处理状态徽标 | 「撤销判定（恢复活跃）」按钮出现 |
| 写按钮 | 全部 `disabled`：重新分析 / 重试 Base 推送 / 保存定级 / 生成 PRD 提示词 / 保存 / 保存并重新分析 / 设置人工优先级 / 分配·变更负责人（已排除） |
| 需求池「已排除」视图 | 1 行，`is-suppressed`；处理状态列「已忽略」+ sr-only「（已排除：不进入 AI 分析/Base 推送/通知）」；单选项「已排除」为选中态 |
| 总览 | 「已排除 1 条，不参与分析与推送」 |
| 运维 | 「重复：已判定重复 1 · 疑似 27」（忽略也计入该口径，见 §7） |

## 4. 409 文案（服务端路径，UI 按钮按设计禁用）

已排除态下 UI 把写按钮全部禁用（含 title「…请先撤销判定」），**409 点不出来**；用真实部署代码路径直连接口取：

```
PUT /api/requirements/{id}/priority-override → 409 {"code":"CONFLICT","message":"该需求已被排除，请先撤销判定再设置人工优先级。"}
PUT /api/requirements/{id}/analysis-context  → 409 {"code":"CONFLICT","message":"该需求已被排除，请先撤销判定再补充上下文。"}
```

两条都是新文案，无「压制」残留。两条均被守卫拦在仓储层之前，未产生写入。

## 5. 撤销（真实 UI 路径）

- 详情页 →「撤销判定（恢复活跃）」→ 理由预填「撤销判定，恢复为活跃需求」→ 提交。
- 结果：横幅消失、状态回到「未作判定 · 暂无重复候选」、写按钮恢复可点、「忽略」按钮重新出现。
- Resolutions 行已删除，审计 `duplicate.revoked` / `{previous:"suppressed_ignored"}` / 16:12:13。

## 6. 基线复核

| 项 | 开始 | 结束 | 结论 |
|---|---|---|---|
| 需求 live / 已排除 | 527 / 0 | **527 / 0** | 回基线 |
| RQ-000311 状态 | active | **active**（resolutions 0 行） | 回基线 |
| `analysis_runs` | 1631 | **1631** | 未调模型 |
| `base_push_runs` | 2111 | **2111** | 未推送 |
| `audit_events` | 7494 | 7496（+2） | 仅本轮两条判定审计 |
| 产品池 Base | 336 行 | **336 行，added 0 / removed 0 / changed 0** | 0 差异 |

Base 0 差异是结构性结果，不是运气：`base/duplicate-marker.ts:33` 在 `fields.duplicate` 未配置时直接
`return { outcome: "skipped" }`，本轮线上 Base 没有重复标记字段，因此判定/撤销都不会写 Base，也没有
`requirement.duplicate_mark_failed` 审计。
**【未启用 · 未覆盖】**「Base 标记写入 → 清除」这段回环本轮**没有验证**，Base 0 差异不能当作该回环通过；
要覆盖得先给 Base 配标记字段并配置 `duplicate` 映射（PRD-22 保留的可选能力，当前未启用）。

## 7. 顺带发现

1. **手工 / 聊天粘贴来源无法忽略**（§1）：详情页没有「重复处理」区块。**产品已定（PRD-37）**：非 TB 来源本期不扩「忽略 / 判定重复」，重复或无价值的需求由负责人在「我的需求」直接删除进回收站，记录保留可还原；以后要做非 TB 判重另立项。本条按「本期不支持、走删除」归档，不算缺陷。
2. **运维页把「已忽略」计入「已判定重复」**：本轮 0 → 1 是忽略造成，但文案显示「已判定重复 1」。若要与术语方案 A 严格一致，这条指标可能要拆成「已判定重复 N · 已忽略 M」。（待产品确认，不阻塞）

## 8. 评分显示复验（本轮发版修复项）

| 需求 | `.arco-statistic` textContent | innerText | 整数段 / 小数段 | 结论 |
|---|---|---|---|---|
| RQ-000316 | `0.80` | `0.80` | `0` / `.80` | 旧的 `0.80.8` 已消失（`includes("0.80.8") === false`） |
| RQ-000528 | `6.00` | `6.00` | `6` / `.00` | 正常，小数位未丢 |
| RQ-000346 | `4.00` | `4.00` | `4` / `.00` | 正常，小数位未丢 |

`.score-number-line` 的 textContent 为 `0.80P3`（无重复）。视觉见 `evidence/s-06-score-*.png`。

## 证据

- `evidence/s-01-detail-suppressed.png` 已排除详情（横幅 + 禁用写按钮）
- `evidence/s-02-list-suppressed.png` 需求池「已排除」视图（行内「已忽略」）
- `evidence/s-03-overview.png` 总览「已排除 1 条」
- `evidence/s-04-ops.png` 运维「已判定重复 1 · 疑似 27」
- `evidence/s-05-detail-after-revoke.png` 撤销后回到活跃
- `evidence/s-06-score-RQ-000316.png` / `s-06-score-RQ-000528.png` / `s-06-score-RQ-000346.png` 评分显示
- `base-before.json` / `base-after.json` 产品池 Base 全表快照（336 行，0 差异）
