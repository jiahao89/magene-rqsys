-- 清理全量验收 A12 的 5 条 chat_paste 需求 RQ-000336–340（2026-11-20）
-- 范围：只删这 5 条需求及其派生行 + Base PM 5 行；base_form 的 reczz28bokC61kka 及其需求保留到下一批。
-- 删除前计数（13:39）：requirements 5、analysis 5、scores 5、snapshots 5、pushes 5、
--   assessments 4（A01 v2 生成后会变 5）、intake receipts 5、audit 20、jobs 10。
--
-- UUID：RQ-000336 dddd77dd-859f-4e13-9c5a-87ee1088f651
--       RQ-000337 4c0f2519-f990-476c-86af-836438aaab20
--       RQ-000338 3e69bdcb-c738-47b3-bcd2-a3dbfaace63a
--       RQ-000339 828cae1f-2077-40fc-a36a-655735b81059
--       RQ-000340 9cf310e9-d7e1-4731-9d49-b19203dddf06
--
-- 用法：
--   lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --file <本文件> --yes

BEGIN;

DELETE FROM audit_events
 WHERE entity_id IN (
   'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
   '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
   '9cf310e9-d7e1-4731-9d49-b19203dddf06'
 );

DELETE FROM pipeline_jobs
 WHERE payload->>'requirementId' IN (
   'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
   '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
   '9cf310e9-d7e1-4731-9d49-b19203dddf06'
 )
    OR dedupe_key LIKE '%dddd77dd-859f-4e13-9c5a-87ee1088f651%'
    OR dedupe_key LIKE '%4c0f2519-f990-476c-86af-836438aaab20%'
    OR dedupe_key LIKE '%3e69bdcb-c738-47b3-bcd2-a3dbfaace63a%'
    OR dedupe_key LIKE '%828cae1f-2077-40fc-a36a-655735b81059%'
    OR dedupe_key LIKE '%9cf310e9-d7e1-4731-9d49-b19203dddf06%';

DELETE FROM requirement_assessments WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM requirement_intake_receipts WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM requirement_edit_receipts WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM base_push_runs WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM analysis_runs WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM pm_snapshots WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM source_snapshots WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM requirement_score_versions WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM rice_drafts WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM rice_draft_history WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM kano_runs WHERE requirement_id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
DELETE FROM requirements WHERE id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);

COMMIT;

-- 执行后复核（预期：全 0；总量回到 334/333/0/1/0、评估 0）
SELECT count(*)::int AS requirements_left FROM requirements WHERE id IN (
  'dddd77dd-859f-4e13-9c5a-87ee1088f651','4c0f2519-f990-476c-86af-836438aaab20',
  '3e69bdcb-c738-47b3-bcd2-a3dbfaace63a','828cae1f-2077-40fc-a36a-655735b81059',
  '9cf310e9-d7e1-4731-9d49-b19203dddf06'
);
SELECT
  count(*)::int AS active,
  count(*) FILTER (WHERE source_type='teambition')::int AS teambition,
  count(*) FILTER (WHERE source_type='web_manual' AND COALESCE(source_payload->>'intakeOrigin','')<>'chat_paste')::int AS web_manual,
  count(*) FILTER (WHERE source_type='base_form')::int AS base_form,
  count(*) FILTER (WHERE source_type='web_manual' AND source_payload->>'intakeOrigin'='chat_paste')::int AS chat_paste
FROM requirements WHERE processing_state='active';
SELECT count(*)::int AS assessments FROM requirement_assessments;
