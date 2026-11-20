-- 0030：需求评估（按需生成，独立表，不改 requirements）。
-- - 每条需求可有多版评估；同一需求版本号递增，唯一键防并发撞号。
-- - 用户补充的背景/目标/场景只存在 inputs 里，需求本体不动。
-- - output 为结构化评估结论；失败版本保留 error_code，便于追溯与重试。
BEGIN;

CREATE TABLE IF NOT EXISTS requirement_assessments (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  prompt_version text NOT NULL,
  model text,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inputs) = 'object'),
  output jsonb CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
  error_code text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (requirement_id, version)
);

CREATE INDEX IF NOT EXISTS requirement_assessments_requirement_idx
  ON requirement_assessments (requirement_id, version DESC);

COMMIT;
