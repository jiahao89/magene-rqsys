-- 0035：代码审查加固（增补列、单飞唯一索引、外键索引、清理废弃索引、触发器空键短路）。
-- 1. requirement_prd_prompts 补齐 created_by（对齐 requirement_assessments / kano_runs 的创建人追溯）。
-- 2. requirement_assessments 与 requirement_prd_prompts 参照 0021_kano_single_running 增加
--    WHERE status = 'running' 部分唯一索引，先收敛历史并发残留行再建索引。
-- 3. 补齐 pm_snapshots / sync_items / requirements(latest_batch_id) 外键索引。
-- 4. 删除已被 0024/0026 pg_trgm ILIKE 取代的废弃全文索引 requirements_title_search_idx。
-- 5. 优化 0022 触发器函数：web_manual / base_form（source_config_id 或 teambition_requirement_id 为空）
--    直接写回 active 并跳过 requirement_resolutions 查询；TB 行语义与 0022 完全一致。
BEGIN;

ALTER TABLE requirement_prd_prompts
  ADD COLUMN IF NOT EXISTS created_by text;

-- 清理历史并发遗留的多 running 评估行：保留每组最早创建的一条，其余标为 failed。
UPDATE requirement_assessments a
SET status = 'failed',
    error_code = COALESCE(error_code, 'superseded_run'),
    completed_at = COALESCE(completed_at, now())
WHERE a.status = 'running'
  AND EXISTS (
    SELECT 1 FROM requirement_assessments earlier
    WHERE earlier.requirement_id = a.requirement_id
      AND earlier.status = 'running'
      AND (earlier.created_at < a.created_at OR (earlier.created_at = a.created_at AND earlier.id < a.id))
  );

CREATE UNIQUE INDEX IF NOT EXISTS requirement_assessments_single_running
  ON requirement_assessments (requirement_id)
  WHERE status = 'running';

-- 清理历史并发遗留的多 running PRD 提示词行：保留每组最早创建的一条，其余标为 failed。
UPDATE requirement_prd_prompts p
SET status = 'failed',
    error_code = COALESCE(error_code, 'superseded_run'),
    completed_at = COALESCE(completed_at, now())
WHERE p.status = 'running'
  AND EXISTS (
    SELECT 1 FROM requirement_prd_prompts earlier
    WHERE earlier.requirement_id = p.requirement_id
      AND earlier.status = 'running'
      AND (earlier.created_at < p.created_at OR (earlier.created_at = p.created_at AND earlier.id < p.id))
  );

CREATE UNIQUE INDEX IF NOT EXISTS requirement_prd_prompts_single_running
  ON requirement_prd_prompts (requirement_id)
  WHERE status = 'running';

-- 补齐外键查询索引。
CREATE INDEX IF NOT EXISTS pm_snapshots_requirement_idx
  ON pm_snapshots (requirement_id, source_version DESC, captured_at DESC);

CREATE INDEX IF NOT EXISTS sync_items_requirement_idx
  ON sync_items (requirement_id)
  WHERE requirement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS requirements_latest_batch_idx
  ON requirements (latest_batch_id)
  WHERE latest_batch_id IS NOT NULL;

-- 0024/0026 已改用 pg_trgm ILIKE，旧 tsvector GIN 索引无任何查询使用，移除以消除写入放大。
DROP INDEX IF EXISTS requirements_title_search_idx;

-- 0022 触发器优化：非 TB 来源（两键任一为空）不可能命中 requirement_resolutions，直接短路。
-- TB 行仍每次重算 processing_state，保持 decideResolution/clearResolution 靠 UPDATE updated_at 触发重算的契约。
CREATE OR REPLACE FUNCTION rq_apply_requirement_resolution() RETURNS trigger AS $$
DECLARE derived text;
BEGIN
  IF NEW.source_config_id IS NULL OR NEW.teambition_requirement_id IS NULL THEN
    NEW.processing_state := 'active';
    RETURN NEW;
  END IF;
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

COMMIT;
