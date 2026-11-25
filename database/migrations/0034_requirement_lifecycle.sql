-- 0034：需求逻辑删除（「我的需求」/「回收站」）。
-- 为什么不用 processing_state：该列由 0022 的触发器 rq_apply_requirement_resolution 在每次
-- INSERT/UPDATE 时按 requirement_resolutions 重算，没有决策就写回 active；TB 同步 upsert
-- 会把它改回活跃（删除被复活）。而且触发器按 source_config_id 关联，web_manual/base_form 的
-- source_config_id 为 NULL，决策/压制对它们根本不生效。
-- 因此删除状态放独立列：同步链路整条跳过已删除需求，不碰这两列，从数据层杜绝复活。
BEGIN;

ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;

-- 「我的需求」按当前负责人查：人工负责人 / TB 执行人映射；只索引未删除的行。
CREATE INDEX IF NOT EXISTS requirements_active_manual_owner_idx
  ON requirements (manual_owner_feishu_user_id)
  WHERE deleted_at IS NULL AND manual_owner_feishu_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS requirements_active_executor_idx
  ON requirements (executor_user_id)
  WHERE deleted_at IS NULL AND executor_user_id IS NOT NULL;

-- 两列必须同时为空或同时有值，避免出现"半删除"行（有 deleted_at 没有 deleted_by 无法判定还原人）。
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_deleted_pair;
ALTER TABLE requirements ADD CONSTRAINT requirements_deleted_pair
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

COMMIT;
