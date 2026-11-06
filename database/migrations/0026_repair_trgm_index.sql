-- 0026：修复 pg_trgm GIN 索引在妙搭线上未落地的问题。
--
-- 背景：0024 的 trgm 索引用 DO 块 + 动态 EXECUTE 创建，妙搭 changelog 没有捕获这条 DDL；
-- 发布到 online 时平台按表结构重建语句，把 opclass 写成未限定的 gin_trgm_ops，而线上会话
-- search_path 只有 workspace schema（扩展安装在 public），DDL 实际失败，但平台元数据仍标记
-- 为已应用，导致 dev/online 索引漂移且无法再次发布。
--
-- 修复策略：用新的索引名 + 显式 public.gin_trgm_ops 重建，语句是静态可捕获的，平台可以
-- 正常记录并发布到 online。0024 仍在全新数据库上创建旧名索引，本迁移随后把它替换为 v2。
BEGIN;

DROP INDEX IF EXISTS requirements_title_trgm_idx;
CREATE INDEX requirements_title_trgm_idx_v2
  ON requirements USING gin (title public.gin_trgm_ops);

COMMIT;
