# 2026-11-06 全量重跑与评分采纳记录

## 结论

- AI 网关订阅额度恢复后，对剩余 Teambition 需求完成 `rq-analysis-v4` 重跑：**265 条 force 重分析，266 条 analyzed，0 失败**（含 1 条冒烟）。
- 通过 `POST /api/requirements/{id}/scoring/apply-ai` 批量采纳 **314 条**（另 1 条 RQ-000010 已提前验证采纳）；全部返回 200。
- 采纳后 Teambition 需求当前评分：**P0=0 / P1=0 / P2=7 / P3=314**（共 321 条），α=1.0（320 条）+ α=1.5（1 条 safety 标记）；旧分布为 P2=4 / P3=312、α=0.8。
- Base 推送：`base_push_runs` 成功 555 / 失败 1（2026-10-29 历史失败，非本轮）；需求 `push_state=pushed 278 / pending 43`（43 条无匹配飞书人员，按业务规则不推送）。

## 执行证据（Miaoda online，只读查询）

```sql
-- 今日分析运行（started_at > 2026-11-06T10:40+08:00）
status=analyzed 270, failed_retryable 0, running 0（运行中残留已清理为 interrupted）
-- 当前 TB 评分
SELECT v.priority, count(*) FROM requirements r
 JOIN requirement_score_versions v ON v.id=r.current_score_version_id
 WHERE r.source_type='teambition' GROUP BY 1;  -- P2=7, P3=314
-- α 分布
ai_applied α=1: 314, α=1.5: 1; ai α=1: 6（11-06 新同步需求首次分析）
-- 队列
pipeline_jobs queued/running = 0
-- 历史失败作业（运维页展示）
pipeline_jobs status='failed' = 1（base_push，RQ-000007，2026-10-29，后续推送已成功）
```

## 过程中处理

- 2 条需求的 force 作业成功写入了分析结果后 handler 重试产生重复作业（RQ-000141 / RQ-000274）：已删除重复 queued 作业并把需求状态恢复为 `analyzed`，不影响其已采纳评分。
- 1 条被中断的 running analysis_run（RQ-000201 av4，已有更新的 av5 analyzed）：标记为 `interrupted`。
- 采纳历史 `ai_suggested` 行保留为版本历史；`current` 已指向新的 `ai_applied` 版本，无 stale 配对。

## 残留与口径

- P0/P1 仍为 0：模型在缺少竞品/路线图/依赖证据时仍给 M/S 最低档，需要 PM 在详情页补充业务上下文后再分析（现有功能）。
- 43 条 `pending_mapping` 属于「无匹配在职飞书人员」的业务预期，不推送。
