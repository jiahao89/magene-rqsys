-- 清理 R8 验收用的 base_form 测试需求 RQ-000336（2026-11-20，v4）
-- 需求 UUID：d5a1ce84-e574-4446-b378-e15cb84edb3c；收集表 reczz28brpbYLNdy；PM reczz28brz00SUAx
-- 删除前核对：analysis 4、score 4、snapshot 4、push 4、assessments 0、edit receipts 3、
--   intake receipts 0、audit 16、jobs 8。
-- 收集表历史：create（贾浩）+ intake 写回（固件需求池，写 模块未识别/系统需求 ID/同步状态/同步时间）；
--   多次平台编辑（含实质长标题）均无写回记录。
--
-- 用法：lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --file <本文件> --yes

BEGIN;

DELETE FROM audit_events WHERE entity_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';

DELETE FROM pipeline_jobs
 WHERE payload->>'requirementId' = 'd5a1ce84-e574-4446-b378-e15cb84edb3c'
    OR dedupe_key LIKE '%d5a1ce84-e574-4446-b378-e15cb84edb3c%';

DELETE FROM requirement_assessments WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM requirement_intake_receipts WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM requirement_edit_receipts WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM base_push_runs WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM analysis_runs WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM pm_snapshots WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM source_snapshots WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM requirement_score_versions WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM rice_drafts WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM rice_draft_history WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM kano_runs WHERE requirement_id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
DELETE FROM requirements WHERE id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';

COMMIT;

SELECT count(*)::int AS requirements_left FROM requirements WHERE id = 'd5a1ce84-e574-4446-b378-e15cb84edb3c';
SELECT
  count(*)::int AS active,
  count(*) FILTER (WHERE source_type='teambition')::int AS teambition,
  count(*) FILTER (WHERE source_type='web_manual' AND COALESCE(source_payload->>'intakeOrigin','')<>'chat_paste')::int AS web_manual,
  count(*) FILTER (WHERE source_type='base_form')::int AS base_form,
  count(*) FILTER (WHERE source_type='web_manual' AND source_payload->>'intakeOrigin'='chat_paste')::int AS chat_paste
FROM requirements WHERE processing_state='active';
SELECT count(*)::int AS assessments FROM requirement_assessments;
