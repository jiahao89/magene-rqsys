-- 0029（5b）：多维表格收集表来源。
-- - 新增来源类型 base_form：由收集表行创建的需求，来源身份是 Base record_id。
-- - 新增 source_external_id：仅 base_form 行使用；唯一索引保证同一行重复读取只建一次。
-- - 扩展身份约束：TB 行仍需来源配置 + TB ID；手工行两者为空；base_form 行前两者为空、外部 ID 非空。
-- - 不改 job_type / 不新增表：收集表同步走现有 automation tick。
BEGIN;

ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_source_type_check;
ALTER TABLE requirements ADD CONSTRAINT requirements_source_type_check
  CHECK (source_type IN ('teambition', 'web_manual', 'base_form'));

ALTER TABLE requirements ADD COLUMN IF NOT EXISTS source_external_id text;

ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_source_branch_check;
ALTER TABLE requirements ADD CONSTRAINT requirements_source_branch_check CHECK (
  (source_type = 'teambition' AND source_config_id IS NOT NULL AND teambition_requirement_id IS NOT NULL AND source_external_id IS NULL)
  OR (source_type = 'web_manual' AND source_config_id IS NULL AND teambition_requirement_id IS NULL AND source_external_id IS NULL)
  OR (source_type = 'base_form' AND source_config_id IS NULL AND teambition_requirement_id IS NULL AND source_external_id IS NOT NULL)
);

-- 同一 Base 行只建一条需求；部分索引让其它来源（外部 ID 为空）不受影响。
CREATE UNIQUE INDEX IF NOT EXISTS requirements_source_external_id_key
  ON requirements (source_external_id)
  WHERE source_external_id IS NOT NULL;

COMMIT;
