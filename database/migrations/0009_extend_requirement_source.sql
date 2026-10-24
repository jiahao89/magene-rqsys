-- 0009 (V02-T02): 扩展统一来源身份。
-- - source_type 默认 teambition，现有 TB 行不动；web_manual 分支允许 TB 身份为空。
-- - TB 身份唯一性改为部分唯一索引（仅 teambition 行）；web_manual 行不受 TB 键约束，
--   也不伪造来源配置或 TB ID（V02-S00）。
-- - source_channel 记录业务来源渠道（销售/售后/运营等），与 source_type（接入方式）分离。
-- - pull_state 增加 collected：手工收录的"已收录"语义；TB 拉取状态不受影响。
-- - requirement_intake_receipts：创建请求幂等回执（V02-T04 启用 HTTP 写入前先建表并落仓储能力）。
BEGIN;

ALTER TABLE requirements ADD COLUMN source_type text NOT NULL DEFAULT 'teambition'
  CHECK (source_type IN ('teambition', 'web_manual'));
ALTER TABLE requirements ADD COLUMN source_channel text;

-- TB 身份唯一约束保留：PostgreSQL 唯一索引对 NULL 判定互异，手工行（两列皆 NULL）互不冲突，
-- TB 行由分支 CHECK 保证非空、唯一语义不变；ON CONFLICT 同步路径不需要改动。
ALTER TABLE requirements ALTER COLUMN source_config_id DROP NOT NULL;
ALTER TABLE requirements ALTER COLUMN teambition_requirement_id DROP NOT NULL;

ALTER TABLE requirements ADD CONSTRAINT requirements_source_branch_check CHECK (
  (source_type = 'teambition' AND source_config_id IS NOT NULL AND teambition_requirement_id IS NOT NULL)
  OR (source_type = 'web_manual' AND source_config_id IS NULL AND teambition_requirement_id IS NULL)
);

ALTER TABLE requirements DROP CONSTRAINT requirements_pull_state_check;
ALTER TABLE requirements ADD CONSTRAINT requirements_pull_state_check
  CHECK (pull_state IN ('pending', 'running', 'synced', 'failed', 'collected'));

CREATE TABLE requirement_intake_receipts (
  idempotency_key text PRIMARY KEY,
  actor_id text NOT NULL,
  request_hash char(64) NOT NULL,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
