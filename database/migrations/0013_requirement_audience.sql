-- 0013 (V02-T09): 人工人群标签与确认状态。
-- audience_tags 是 PM 当前值（L1–L6 多选，可为已确认空集）；audience_confirmed 区分
-- 未确认与已确认空集；audience_version 每次人工修改递增（乐观并发 + 历史审计版本号）。
-- AI 建议保存在 analysis_runs.structured_result.audience，两者互不覆盖。
BEGIN;

ALTER TABLE requirements ADD COLUMN audience_tags jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(audience_tags) = 'array');
ALTER TABLE requirements ADD COLUMN audience_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE requirements ADD COLUMN audience_version integer NOT NULL DEFAULT 0;

COMMIT;
