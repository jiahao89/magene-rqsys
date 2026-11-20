-- 清理 5b 线上验收测试数据 RQ-000334（2026-11-19）
-- 目标：应用库（online）只删这一条需求及其派生行；收集表行与 PM 表行另行通过 Base 删除。
-- 需求 id：3760aa2e-afd0-450d-9e5c-c54356054425
-- 外部 id：reczz28bV06qZinH（BASE_INTAKE_TABLE= tbliQ1fQPFzQHkEM）
-- 删除前已核对的派生行：analysis_runs 1、base_push_runs 1、source_snapshots 1、
--   requirement_score_versions 1（FK CASCADE，仍显式删）、pipeline_jobs 2、audit_events 4；
--   pm_snapshots / rice_drafts / rice_draft_history / kano_runs / 两类 receipt / sync_items /
--   requirement_resolutions / 被引用为 duplicate_of 的行均为 0。
-- 审计 4 行：analysis.terminal、base.push、intake.created、scoring.suggested。
--
-- 用法（应用库，先确认证据已留档）：
--   lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --file <本文件> --yes

BEGIN;

DELETE FROM audit_events
 WHERE entity_id = '3760aa2e-afd0-450d-9e5c-c54356054425';

DELETE FROM pipeline_jobs
 WHERE payload->>'requirementId' = '3760aa2e-afd0-450d-9e5c-c54356054425'
    OR dedupe_key LIKE '%3760aa2e-afd0-450d-9e5c-c54356054425%'
    OR dedupe_key LIKE '%RQ-000334%';

DELETE FROM base_push_runs WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425';
DELETE FROM analysis_runs  WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425';
DELETE FROM pm_snapshots   WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425';
DELETE FROM source_snapshots WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425';
DELETE FROM requirement_score_versions WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425';
DELETE FROM requirements WHERE id = '3760aa2e-afd0-450d-9e5c-c54356054425';

COMMIT;

-- 执行后复核（应分别返回 333、332/0/1/0、0 行）：
SELECT count(*)::int AS total_requirements FROM requirements;
SELECT
  COUNT(*) FILTER (WHERE source_type = 'teambition')::int AS teambition,
  COUNT(*) FILTER (WHERE source_type = 'web_manual' AND COALESCE(source_payload->>'intakeOrigin','') <> 'chat_paste')::int AS web_manual,
  COUNT(*) FILTER (WHERE source_type = 'base_form')::int AS base_form,
  COUNT(*) FILTER (WHERE source_type = 'web_manual' AND source_payload->>'intakeOrigin' = 'chat_paste')::int AS chat_paste,
  COUNT(*)::int AS total
FROM requirements WHERE processing_state = 'active';
SELECT
  (SELECT count(*) FROM analysis_runs WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425') AS analysis_runs,
  (SELECT count(*) FROM base_push_runs WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425') AS base_push_runs,
  (SELECT count(*) FROM source_snapshots WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425') AS source_snapshots,
  (SELECT count(*) FROM requirement_score_versions WHERE requirement_id = '3760aa2e-afd0-450d-9e5c-c54356054425') AS score_versions,
  (SELECT count(*) FROM pipeline_jobs WHERE payload->>'requirementId' = '3760aa2e-afd0-450d-9e5c-c54356054425' OR dedupe_key LIKE '%RQ-000334%') AS jobs,
  (SELECT count(*) FROM audit_events WHERE entity_id = '3760aa2e-afd0-450d-9e5c-c54356054425') AS audit_rows;
