-- 0016 (V02-T14)：Kano Beta 假设报告。
-- kano_runs 按需求递增 run_version；固定输入快照（需求源版本/人群确认状态/资料版本/提示词/模型）。
-- pipeline_jobs 增加 kano_run 作业类型：复用既有租约/去重/恢复，但失败不触碰主流程状态。
BEGIN;

ALTER TABLE pipeline_jobs DROP CONSTRAINT pipeline_jobs_job_type_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_job_type_check
  CHECK (job_type IN ('sync', 'analysis', 'base_push', 'kano_run'));

CREATE TABLE kano_runs (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  run_version integer NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  source_version integer NOT NULL,
  audience_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience_snapshot) = 'object'),
  evidence_version integer NOT NULL,
  prompt_version text NOT NULL,
  model text,
  result jsonb,
  safe_error_code text,
  safe_error_summary text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (requirement_id, run_version)
);

COMMIT;
