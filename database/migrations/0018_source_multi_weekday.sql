BEGIN;

-- V02 follow-up: weekly sync can run on multiple weekdays.
-- Keep schedule_weekday as the legacy/first-day column for existing readers;
-- schedule_weekdays is the authoritative multi-day list for new code.
ALTER TABLE source_configs ADD COLUMN schedule_weekdays smallint[];

UPDATE source_configs
SET schedule_weekdays = ARRAY[schedule_weekday]::smallint[]
WHERE schedule_weekday IS NOT NULL;

ALTER TABLE source_configs
  ADD CONSTRAINT source_configs_schedule_weekdays_valid
  CHECK (
    schedule_weekdays IS NULL
    OR (
      array_length(schedule_weekdays, 1) BETWEEN 1 AND 7
      AND schedule_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )
  );

COMMIT;
