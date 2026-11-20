-- RQ-000335 人工补跑一次 AI 分析（2026-11-20）
-- 背景：11-20 三次分析均撞上游 HTTP 502，自动重试预算耗尽，停在 failed_retryable。
-- 入口：等价于 POST /api/analysis/a2573c66.../retry（失败重试，非 force），只入队一个 analysis 作业。
-- 需求：5f0c8561-9522-439e-88e0-12f4ed80285a（RQ-000335），sourceVersion=1，priorAnalysisVersion=4。
-- 前置已核对：latest v4 failed_retryable；dedupe key 无既有作业；push_state=pushed。
-- 副作用：分析成功后正常入队 base_push，会写 ai_retry_success 通知字段（无负责人，兜底 PM Leader）。

BEGIN;

INSERT INTO pipeline_jobs (id, job_type, dedupe_key, payload, status, attempt_count, max_attempts, available_at)
VALUES (
  'daae791d-e734-4842-b936-fe0818c86c72',
  'analysis',
  'analysis:5f0c8561-9522-439e-88e0-12f4ed80285a:sv1:after4',
  '{"requirementId":"5f0c8561-9522-439e-88e0-12f4ed80285a","sourceVersion":1,"actorId":"backend-manual-retry"}'::jsonb,
  'queued', 0, 5, now()
);

INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, result, safe_details, occurred_at)
VALUES (
  '11064081-9494-4294-9f7d-f6d7e9237af3',
  'backend-manual-retry',
  'analysis.retry_requested',
  'requirement',
  '5f0c8561-9522-439e-88e0-12f4ed80285a',
  'succeeded',
  '{"sourceVersion":1,"priorAnalysisVersion":4,"analysisStatus":"failed_retryable","manual":true}'::jsonb,
  now()
);

COMMIT;

SELECT id, status, attempt_count, available_at FROM pipeline_jobs
 WHERE dedupe_key = 'analysis:5f0c8561-9522-439e-88e0-12f4ed80285a:sv1:after4';
