-- 0032：PRD 提示词（按需生成，独立表，不改 requirements / requirement_assessments）。
-- - 每条需求可有多版提示词；同一需求版本号递增，唯一键防并发撞号。
-- - inputs 存生成时的需求快照、分析摘要、评估版本与 PM 调研结论；output 存结构化提示词。
-- - 失败版本保留 error_code（timeout / provider_error / invalid_output 等），便于追溯与重试。
BEGIN;

CREATE TABLE IF NOT EXISTS requirement_prd_prompts (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  prompt_version text NOT NULL,
  model text,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inputs) = 'object'),
  output jsonb CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (requirement_id, version)
);

CREATE INDEX IF NOT EXISTS requirement_prd_prompts_requirement_idx
  ON requirement_prd_prompts (requirement_id, version DESC);

COMMIT;
