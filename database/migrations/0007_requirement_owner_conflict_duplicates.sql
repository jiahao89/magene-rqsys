BEGIN;

-- Per-requirement owner (already introduced for TB-ownerless requirements in 0006)
-- is now authoritative for every requirement: one assignment never rewrites the
-- TB-executor mapping shared by other requirements.
ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS last_pushed_owner_feishu_user_id text,
  ADD COLUMN IF NOT EXISTS last_pushed_owner_feishu_id_type text
    CHECK (last_pushed_owner_feishu_id_type IN ('open_id', 'user_id', 'union_id'));

ALTER TABLE requirements
  ADD CONSTRAINT requirements_last_pushed_owner_complete
  CHECK ((last_pushed_owner_feishu_user_id IS NULL) = (last_pushed_owner_feishu_id_type IS NULL));

-- Requirements with the same normalized title are still distinct requirements
-- (identity stays project + TB requirement id). They are imported and linked to
-- the earliest record so the UI can show a suspected-duplicate notice; they never
-- enter the default pool, analysis or Base push.
ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS duplicate_of_requirement_id uuid REFERENCES requirements(id);

CREATE INDEX IF NOT EXISTS requirements_duplicate_of_idx
  ON requirements (duplicate_of_requirement_id);

COMMIT;
