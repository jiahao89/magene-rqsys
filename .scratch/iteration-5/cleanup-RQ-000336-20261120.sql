-- 清理全量验收造的 chat_paste 测试需求 RQ-000336（2026-11-20）
-- 目标：App 只删这一条需求及其派生行；Base PM 表删 reczz28bnR1hXvZZ；收集表本来 0 行。
-- 需求 UUID：59278aad-d939-42bd-ad10-f043fe04a8e2；来源 web_manual + intakeOrigin=chat_paste。
-- 删除前已核对：audit 4、analysis_runs 1、score_versions 1、source_snapshots 1、base_push_runs 1、
--   requirement_assessments 2、pipeline_jobs 2、requirement_intake_receipts 1；
--   pm_snapshots / rice_drafts / rice_draft_history / kano_runs / edit_receipts / resolutions 均 0。
-- Base 行已核对：需求平台ID=RQ-000336、来源方式=聊天粘贴、系统通知事件ID=null、推送状态=已推送。
--
-- 用法：
--   lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --file <本文件> --yes

BEGIN;

DELETE FROM audit_events
 WHERE entity_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';

DELETE FROM pipeline_jobs
 WHERE payload->>'requirementId' = '59278aad-d939-42bd-ad10-f043fe04a8e2'
    OR dedupe_key LIKE '%59278aad-d939-42bd-ad10-f043fe04a8e2%';

DELETE FROM requirement_assessments WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM requirement_intake_receipts WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM requirement_edit_receipts WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM base_push_runs WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM analysis_runs WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM pm_snapshots WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM source_snapshots WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM requirement_score_versions WHERE requirement_id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
DELETE FROM requirements WHERE id = '59278aad-d939-42bd-ad10-f043fe04a8e2';

COMMIT;

-- 执行后复核（预期：该需求 0 行；active 334 = TB 333 + 手工 1 + 多维表格 0 + 聊天粘贴 0；评估表 0）
SELECT count(*)::int AS requirement_rows FROM requirements WHERE id = '59278aad-d939-42bd-ad10-f043fe04a8e2';
SELECT
  count(*)::int AS active,
  count(*) FILTER (WHERE source_type = 'teambition')::int AS teambition,
  count(*) FILTER (WHERE source_type = 'web_manual' AND source_payload->>'intakeOrigin' = 'chat_paste')::int AS chat_paste,
  count(*) FILTER (WHERE source_type = 'web_manual' AND COALESCE(source_payload->>'intakeOrigin','') <> 'chat_paste')::int AS web_manual,
  count(*) FILTER (WHERE source_type = 'base_form')::int AS base_form
FROM requirements WHERE processing_state = 'active';
SELECT count(*)::int AS assessments FROM requirement_assessments;
SELECT count(*)::int AS jobs FROM pipeline_jobs WHERE payload->>'requirementId' = '59278aad-d939-42bd-ad10-f043fe04a8e2' OR dedupe_key LIKE '%59278aad-d939-42bd-ad10-f043fe04a8e2%';
