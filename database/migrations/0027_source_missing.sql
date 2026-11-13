-- 0027（Q4）：标记「TB 全量同步中已不再出现」的需求。
-- 只做提示：不删除记录、不改变处理/推送状态、不写 Base；需求再次出现时由 upsert 清空标记。
BEGIN;

ALTER TABLE requirements ADD COLUMN source_missing_since timestamptz;

-- 运维/列表按「本来源、已标记」筛选时使用（部分索引只覆盖标记行）。
CREATE INDEX IF NOT EXISTS requirements_source_missing_idx
  ON requirements (source_config_id, source_missing_since)
  WHERE source_missing_since IS NOT NULL;

COMMIT;
