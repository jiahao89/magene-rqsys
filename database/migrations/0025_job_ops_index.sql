-- 0025：作业运维视图索引。
-- 失败作业按 status='failed' 过滤并按更新时间倒序；卡住的运行中作业按 status='running' 过滤。
BEGIN;

CREATE INDEX IF NOT EXISTS pipeline_jobs_status_updated_idx
  ON pipeline_jobs (status, updated_at DESC, id DESC);

COMMIT;
