-- 0014 (V02-T11)：RICE Beta 人工草稿。
-- 四项输入与依据在量纲配置获批前以自由文本草稿保存（T12 才有正式分数/排名）；
-- edit_version 做乐观并发，每次保存追加历史（rice_draft_history）。
-- 与主流程完全隔离：无触发器、无作业、不影响分析/推送/通知。
BEGIN;

CREATE TABLE rice_drafts (
  requirement_id uuid PRIMARY KEY REFERENCES requirements(id),
  reach_input text,
  impact_input text,
  confidence_input text,
  effort_input text,
  notes text,
  source_version integer NOT NULL,
  edit_version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rice_draft_history (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  edit_version integer NOT NULL,
  snapshot jsonb NOT NULL,
  actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rice_draft_history_requirement_idx ON rice_draft_history (requirement_id, edit_version DESC);

COMMIT;
