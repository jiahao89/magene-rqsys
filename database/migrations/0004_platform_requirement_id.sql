BEGIN;

-- Add nullable first so the schema can be migrated to Online before the existing
-- requirements receive their RQ-Sys display IDs.
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS platform_requirement_id text;

COMMIT;
