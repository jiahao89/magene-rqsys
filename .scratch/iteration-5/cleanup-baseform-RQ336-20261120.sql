-- 清理全量验收最后一条 base_form 测试需求 RQ-000336（2026-11-20）
-- 需求 UUID：d02816cb-de90-497b-8053-22645693e6ea（收集表 reczz28bokC61kka，PM reczz28bozkpqEg8）
-- 删除前已核对：analysis 2、score 1、snapshot 1、push 1、assessments 0、intake receipts 0、
--   edit receipts 1、audit 6、jobs 3。
-- 收集表行核对：表单内容未被平台编辑改动；变更历史只有 create（贾浩 13:31:54）与
--   intake 写回（固件需求池 13:43:57：同步状态/系统需求 ID/同步时间），13:46 的元数据编辑无写回。
--
-- 用法：lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --file <本文件> --yes

BEGIN;

DELETE FROM audit_events WHERE entity_id = 'd02816cb-de90-497b-8053-22645693e6ea';

DELETE FROM pipeline_jobs
 WHERE payload->>'requirementId' = 'd02816cb-de90-497b-8053-22645693e6ea'
    OR dedupe_key LIKE '%d02816cb-de90-497b-8053-22645693e6ea%';

DELETE FROM requirement_assessments WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM requirement_intake_receipts WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM requirement_edit_receipts WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM base_push_runs WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM analysis_runs WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM pm_snapshots WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM source_snapshots WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM requirement_score_versions WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM rice_drafts WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM rice_draft_history WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM kano_runs WHERE requirement_id = 'd02816cb-de90-497b-8053-22645693e6ea';
DELETE FROM requirements WHERE id = 'd02816cb-de90-497b-8053-22645693e6ea';

COMMIT;

SELECT count(*)::int AS requirements_left FROM requirements WHERE id = 'd02816cb-de90-497b-8053-22645693e6ea';
SELECT
  count(*)::int AS active,
  count(*) FILTER (WHERE source_type='teambition')::int AS teambition,
  count(*) FILTER (WHERE source_type='web_manual' AND COALESCE(source_payload->>'intakeOrigin','')<>'chat_paste')::int AS web_manual,
  count(*) FILTER (WHERE source_type='base_form')::int AS base_form,
  count(*) FILTER (WHERE source_type='web_manual' AND source_payload->>'intakeOrigin'='chat_paste')::int AS chat_paste
FROM requirements WHERE processing_state='active';
SELECT count(*)::int AS assessments FROM requirement_assessments;
