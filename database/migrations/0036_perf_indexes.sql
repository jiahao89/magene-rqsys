-- 0036：性能索引补齐（批次元数据/分页、回收站游标、分析/推送统计、审计筛选、执行人归一化筛选）。
-- 所有索引均为幂等创建（IF NOT EXISTS），不修改任何已有表结构与约束。
BEGIN;

-- 批次按来源与状态过滤（并发守卫 / 运行中批次检查）。
CREATE INDEX IF NOT EXISTS sync_batches_source_status_idx
  ON sync_batches (source_config_id, status);

-- 批次列表按毫秒截断的开始时间 + id 倒序游标分页（与 0024 UTC 截断保持 IMMUTABLE 一致）。
CREATE INDEX IF NOT EXISTS sync_batches_started_ms_idx
  ON sync_batches ((date_trunc('milliseconds', started_at AT TIME ZONE 'UTC')) DESC, id DESC);

-- 回收站按删除人与毫秒截断删除时间 + id 倒序游标分页（部分索引仅覆盖已删除行）。
CREATE INDEX IF NOT EXISTS requirements_recycle_bin_idx
  ON requirements (deleted_by, (date_trunc('milliseconds', deleted_at AT TIME ZONE 'UTC')) DESC, id DESC)
  WHERE deleted_at IS NOT NULL;

-- 分析运行按时间倒序统计（总览 AI 调用统计与运维窗口查询）。
CREATE INDEX IF NOT EXISTS analysis_runs_started_idx
  ON analysis_runs (started_at DESC, id DESC);

-- 分析失败计数与额度暂停窗口查询（status + safe_error_code + started_at）。
CREATE INDEX IF NOT EXISTS analysis_runs_status_code_started_idx
  ON analysis_runs (status, safe_error_code, started_at DESC);

-- 推送运行按需求取最新记录与窗口统计。
CREATE INDEX IF NOT EXISTS base_push_runs_req_started_idx
  ON base_push_runs (requirement_id, started_at DESC, id DESC);

-- 审计列表按时间倒序与按事件类型 + 时间倒序查询（告警冷却/审计检索）。
CREATE INDEX IF NOT EXISTS audit_events_occurred_idx
  ON audit_events (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS audit_events_type_occurred_idx
  ON audit_events (event_type, occurred_at DESC);

-- 需求列表按规范化执行人姓名筛选（仅覆盖未删除且有执行人姓名的行）。
CREATE INDEX IF NOT EXISTS requirements_active_executor_norm_idx
  ON requirements (lower(regexp_replace(btrim(executor_name), '\s+', ' ', 'g')))
  WHERE deleted_at IS NULL AND executor_name IS NOT NULL;

COMMIT;
