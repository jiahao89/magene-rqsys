-- 0021 (review 2026-10-29)：同一需求只允许一个 running Kano 运行。
-- 应用层已加按需求的 advisory lock；本索引作为数据库层兜底，防止多实例/并发绕过应用锁。
BEGIN;

-- 清理历史并发遗留的多 running 行：保留每组最早创建的一条，其余标为 failed。
UPDATE kano_runs k
SET status = 'failed',
    safe_error_code = 'KANO_SUPERSEDED_RUN',
    safe_error_summary = 'Superseded by a concurrent run during the single-running guard migration.',
    completed_at = now()
WHERE k.status = 'running'
  AND EXISTS (
    SELECT 1 FROM kano_runs earlier
    WHERE earlier.requirement_id = k.requirement_id
      AND earlier.status = 'running'
      AND (earlier.created_at < k.created_at OR (earlier.created_at = k.created_at AND earlier.id < k.id))
  );

CREATE UNIQUE INDEX kano_runs_single_running
  ON kano_runs (requirement_id)
  WHERE status = 'running';

COMMIT;
