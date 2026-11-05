-- 0024（EQ-07）：需求池搜索/分页索引。
--
-- 1) 标题模糊搜索是 ILIKE '%q%'，普通 btree 用不上；用 pg_trgm 的 GIN 索引。
-- 2) 列表游标按「毫秒截断的创建时间 + id」倒序分页。date_trunc('milliseconds', timestamptz)
--    依赖会话时区、是 STABLE，不能直接建表达式索引；统一写成 AT TIME ZONE 'UTC'（IMMUTABLE）。
--    现代时区偏移都是整分钟，毫秒截断结果与原先的会话时区截断一致，分页语义不变。
--
-- pg_trgm 是数据库级对象，只能安装一次。这里固定装到 public 并加事务级 advisory lock，
-- 避免多个 schema / 并发迁移时各自安装（或把 opclass 只建在某个临时 schema 里，搜不到）。
-- 索引的 opclass 按扩展实际所在 schema 动态限定，迁移在任意 search_path 下都能执行。
BEGIN;

SELECT pg_advisory_xact_lock(hashtext('rqsys:pg_trgm'));
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

DO $$
DECLARE
  opclass_schema text;
BEGIN
  SELECT n.nspname INTO opclass_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';
  IF opclass_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm extension is not installed';
  END IF;
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS requirements_title_trgm_idx ON requirements USING gin (title %I.gin_trgm_ops)',
    opclass_schema
  );
END
$$;

CREATE INDEX IF NOT EXISTS requirements_created_at_ms_id_idx
  ON requirements ((date_trunc('milliseconds', created_at AT TIME ZONE 'UTC')) DESC, id DESC);

COMMIT;
