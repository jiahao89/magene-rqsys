BEGIN;

-- Per-requirement owner chosen in Web when Teambition has no executor. It is
-- stored on the requirement, not in person_mappings, so assigning one
-- requirement never rebinds a roster person or affects other requirements.
-- manual_owner_pushed_feishu_user_id records the hand-picked owner last
-- written to Base, so later pushes do not overwrite a Base-side edit.
ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS manual_owner_feishu_user_id text,
  ADD COLUMN IF NOT EXISTS manual_owner_feishu_id_type text
    CHECK (manual_owner_feishu_id_type IN ('open_id', 'user_id', 'union_id')),
  ADD COLUMN IF NOT EXISTS manual_owner_name text,
  ADD COLUMN IF NOT EXISTS manual_owner_assigned_by text,
  ADD COLUMN IF NOT EXISTS manual_owner_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_owner_pushed_feishu_user_id text;

ALTER TABLE requirements
  ADD CONSTRAINT requirements_manual_owner_complete
  CHECK (
    (manual_owner_feishu_user_id IS NULL) = (manual_owner_feishu_id_type IS NULL)
    AND (manual_owner_feishu_user_id IS NULL) = (manual_owner_assigned_at IS NULL)
  );

COMMIT;
