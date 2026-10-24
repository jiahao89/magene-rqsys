-- 0012 (V02-T07): 手工编辑请求幂等回执。
-- 同幂等键同内容重放返回原结果；同键不同内容明确冲突。与需求更新同事务写入。
BEGIN;

CREATE TABLE requirement_edit_receipts (
  idempotency_key text PRIMARY KEY,
  actor_id text NOT NULL,
  request_hash char(64) NOT NULL,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  outcome text NOT NULL CHECK (outcome IN ('updated', 'unchanged')),
  substantive_changed boolean NOT NULL,
  source_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
