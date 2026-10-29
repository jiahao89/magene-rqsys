-- 0022 (review 2026-10-29)：重复处理持久化。
-- 目的：把“判定为重复/忽略”从需求行上的普通字段升级为独立决策，按稳定身份
-- (source_config_id, teambition_requirement_id) 保存。TB 全量/增量重同步、应用内删除记录
-- 后重新导入时，决策仍然生效，避免二次 AI 分析 / Base 推送 / 通知。
BEGIN;

ALTER TABLE requirements
  ADD COLUMN processing_state text NOT NULL DEFAULT 'active'
  CHECK (processing_state IN ('active', 'suppressed_duplicate', 'suppressed_ignored'));

CREATE INDEX requirements_processing_state_idx
  ON requirements (processing_state)
  WHERE processing_state <> 'active';

CREATE TABLE requirement_resolutions (
  id uuid PRIMARY KEY,
  source_config_id uuid NOT NULL REFERENCES source_configs(id),
  teambition_requirement_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('duplicate', 'ignored', 'confirmed_unique')),
  canonical_requirement_id uuid NULL REFERENCES requirements(id) ON DELETE SET NULL,
  canonical_tb_requirement_id text NULL,
  fingerprint text NULL,
  review_state text NOT NULL CHECK (review_state IN ('suspected', 'confirmed')),
  reason text NULL,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_config_id, teambition_requirement_id)
);

CREATE INDEX requirement_resolutions_fingerprint_idx
  ON requirement_resolutions (fingerprint)
  WHERE fingerprint IS NOT NULL AND review_state = 'confirmed';

-- processing_state 是由决策表派生的只读状态：每次写入 requirements 都按决策重算，
-- 防止 sync upsert / 人工更新留下与决策不一致的状态（单一事实源）。
CREATE OR REPLACE FUNCTION rq_apply_requirement_resolution() RETURNS trigger AS $$
DECLARE derived text;
BEGIN
  SELECT CASE rr.decision
           WHEN 'duplicate' THEN 'suppressed_duplicate'
           WHEN 'ignored' THEN 'suppressed_ignored'
           ELSE 'active'
         END
    INTO derived
    FROM requirement_resolutions rr
   WHERE rr.source_config_id = NEW.source_config_id
     AND rr.teambition_requirement_id = NEW.teambition_requirement_id
     AND rr.review_state = 'confirmed'
     AND rr.decision <> 'confirmed_unique'
   LIMIT 1;
  NEW.processing_state := COALESCE(derived, 'active');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER requirements_derive_processing_state
  BEFORE INSERT OR UPDATE ON requirements
  FOR EACH ROW EXECUTE FUNCTION rq_apply_requirement_resolution();

COMMIT;
