BEGIN;

-- Fill only missing IDs in deterministic first-seen order. The Online rollout
-- applies 0004 first, backfills Online rows, then migrates this constraint phase.
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY first_seen_at, id) AS number
  FROM requirements
  WHERE platform_requirement_id IS NULL
), current_max AS (
  SELECT COALESCE(MAX(SUBSTRING(platform_requirement_id FROM 4)::bigint), 0) AS number
  FROM requirements
  WHERE platform_requirement_id ~ '^RQ-[0-9]+$'
)
UPDATE requirements AS requirement
SET platform_requirement_id = 'RQ-' || lpad((current_max.number + numbered.number)::text, 6, '0')
FROM numbered CROSS JOIN current_max
WHERE requirement.id = numbered.id;

-- New IDs are allocated in the repository under a transaction-scoped advisory
-- lock after this backfill. The unique constraint guards any unexpected race.
ALTER TABLE requirements ALTER COLUMN platform_requirement_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS requirements_platform_requirement_id_key
  ON requirements (platform_requirement_id);

COMMIT;
