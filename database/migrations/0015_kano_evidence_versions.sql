-- 0015 (V02-T13)：Kano 访谈资料版本。
-- 维护者按批准内容导入版本化去标识化快照；仅 status='approved' 且未标记 PII 的版本可进入模型输入（T14）。
-- 版本不可变：更新=新版本，不改已引用快照。无编辑器/爬虫/向量库（AC02）。
BEGIN;

CREATE TABLE kano_evidence_versions (
  id uuid PRIMARY KEY,
  version integer NOT NULL UNIQUE,
  title text NOT NULL,
  source_url text,
  source_section text,
  summary text NOT NULL,
  evidence_fragments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_fragments) = 'array'),
  coverage_notes text,
  known_audiences jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(known_audiences) = 'array'),
  known_scenes text,
  interview_date text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  pii_flagged boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz
);

COMMIT;
