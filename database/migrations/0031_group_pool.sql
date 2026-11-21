-- 0031（集团需求池 P1）：来源分池、执行人名单、批次过滤计数、RQ 全局序列。
-- - 推翻 D-09（同一 provider 只允许一个来源）：唯一索引由 (provider) 改为 (provider, pool)，
--   产品池与集团池各一条 Teambition 来源。
-- - pool 默认 'product'：现有行零变化，产品池行为不变。
-- - executor_allowlist 存已解析的 [{userId,name}]；为空 + enabled=true 由 API 拒绝（DB 不加硬 CHECK，
--   历史空名单需要能保存为关闭态）。
-- - sync_batches.filtered_count：本次同步因执行人名单被跳过的任务数（运维判断名单是否过窄）。
-- - requirement_platform_id_seq：RQ 编号改为全局单调序列，跨池唯一且不回收；
--   用现有最大值初始化（is_called=false → 下一次 nextval = 当前最大值 + 1）。
BEGIN;

ALTER TABLE source_configs ADD COLUMN IF NOT EXISTS pool text NOT NULL DEFAULT 'product';
ALTER TABLE source_configs DROP CONSTRAINT IF EXISTS source_configs_pool_check;
ALTER TABLE source_configs ADD CONSTRAINT source_configs_pool_check CHECK (pool IN ('product', 'group'));

ALTER TABLE source_configs ADD COLUMN IF NOT EXISTS executor_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE source_configs DROP CONSTRAINT IF EXISTS source_configs_executor_allowlist_check;
ALTER TABLE source_configs ADD CONSTRAINT source_configs_executor_allowlist_check
  CHECK (jsonb_typeof(executor_allowlist) = 'array');

DROP INDEX IF EXISTS source_configs_singleton_idx;
CREATE UNIQUE INDEX IF NOT EXISTS source_configs_provider_pool_idx ON source_configs (provider, pool);

ALTER TABLE sync_batches ADD COLUMN IF NOT EXISTS filtered_count integer NOT NULL DEFAULT 0;
ALTER TABLE sync_batches DROP CONSTRAINT IF EXISTS sync_batches_filtered_count_check;
ALTER TABLE sync_batches ADD CONSTRAINT sync_batches_filtered_count_check CHECK (filtered_count >= 0);

CREATE SEQUENCE IF NOT EXISTS requirement_platform_id_seq;
-- 只在序列尚未使用过时初始化，重复执行迁移不会把已发放的编号往回拨（避免复用历史号码）。
DO $$
DECLARE
  max_number bigint;
BEGIN
  IF (SELECT is_called FROM requirement_platform_id_seq) THEN
    RETURN;
  END IF;
  SELECT COALESCE(MAX(SUBSTRING(platform_requirement_id FROM 4)::bigint), 0)
    INTO max_number
    FROM requirements
   WHERE platform_requirement_id ~ '^RQ-[0-9]+$';
  PERFORM setval('requirement_platform_id_seq', max_number + 1, false);
END $$;

COMMIT;
