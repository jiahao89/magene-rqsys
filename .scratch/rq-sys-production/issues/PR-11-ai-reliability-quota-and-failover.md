# PR-11 AI 可靠性 / 额度告警 / 降级与切换

> 批次：2026-11-06 生产就绪（PR）
> **Status**：`ready-for-agent`
> **优先级**：P1
> **创建**：2026-11-06；基线：root `5490d75`

## 背景 / 目标

生产发生过 AI 配额耗尽约 2 天（`auth_error 660`、`failed_retryable 767`、批量重跑 27/286 后 `403 Subscription quota is insufficient`），靠人工审计才发现；系统没有额度/错误率/耗时监控告警，没有耗尽暂停、批量限速、双 provider 切换 SOP，也没有 AI 不可用时的产品级降级提示；调度迟到 43 分钟无告警。目标：AI 依赖出问题时系统能自保、有人知道、可回滚。

## 范围

- 指标与告警：AI 失败率、配额/用量、耗时、重试次数；阈值 + 收件人（可与 PR-09 复用通道）。
- 配额保护：批量重跑限速与配额预检；额度耗尽自动暂停分析队列并提示，恢复后受控补跑（不无限重试）。
- 双 provider：至少两套 provider 配置（key/网关/模型）+ 切换/回滚 SOP；key 备份与轮换（不覆盖原值，历史教训：10-28 换网关后原 key 未留存）。
- 调度可靠性：周同步/恢复触发器迟到 >15 分钟告警；错窗恢复演练。
- 产品级降级：AI 不可用时详情/列表横幅提示「评分暂不可用」，不伪造 P。
- 涉及：`apps/api/src/analysis/provider.ts`、worker/调度、`scripts/rqsys-maintenance.mjs`、env/SOP 文档、`openapi.yaml`（如新增状态字段）。

## 验收标准（未取得目标环境证据前不得宣称完成）

- [ ] 配额/失败率/耗时告警配置完成，并完成一次真实告警演练（含送达证据）。
- [ ] 模拟配额耗尽/限流：分析队列暂停、不产生大量失败 run；恢复后受控补跑有记录。
- [ ] 至少两套 provider 配置可用，完成一次切换与回滚演练（含 key 备份/恢复，不泄露）。
- [ ] 调度迟到 >15 分钟告警演练通过；错窗恢复（人为错过窗口）验证。
- [ ] AI 不可用时的产品降级提示在目标环境可见，优先级不伪造。
- [ ] 目标环境验证；未取得证据不得标完成。

## 不在范围

- 成本分摊/月度预算报表（可并入 PR-10 或 PR-13）；模型采购与合同；更换供应商本身的商务决策。
- 优先级规则/α 口径（PR-02）。

## 依赖 / 阻塞

- ready-for-agent；告警通道建议与 PR-09 共用（先定通道再实现本票告警）。
- 配额是供应商外部事实，阈值需按实际订阅额度确认。

## 证据引用

- `/tmp/rq-verify/pm-gaps.md` P1-7（第 166–171 行）；`/tmp/rq-verify/ops-readiness-gaps.md` P0-2/P0-3（第 18–26 行）。
- `/tmp/rq-verify/pipeline-verifier.md` §2.4–2.5（`auth_error 660`、767 failed、403 quota、23 条 `retry_budget_exhausted`）。
- `.scratch/rq-sys-v0.2/verification-20261026/VERIFICATION-REPORT.md` §5F（首轮 scheduled 迟到 43 分钟）、§5I/§5J（网关切换/原 key 未留存）。
- `specs/rq-sys-mvp/AI-ANALYSIS-POC.md:90-101`（429 限流样例）。
