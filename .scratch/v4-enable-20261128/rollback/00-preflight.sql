-- 回滚前只读检查（不修改数据）。期望：published_rows=1、published_formula=pragmatic_triage_v4、
-- v3_status=retired。若任何一项不符，不要执行 10-rollback-v4-to-v3.sql。
SELECT
  (SELECT count(*) FROM priority_rule_versions WHERE status = 'published') AS published_rows,
  (SELECT rules->>'formulaType' FROM priority_rule_versions WHERE status = 'published') AS published_formula,
  (SELECT count(*) FROM priority_rule_versions WHERE rules->>'formulaType' = 'pragmatic_triage_v4') AS v4_rows,
  (SELECT status FROM priority_rule_versions WHERE rules->>'formulaType' = 'pragmatic_triage_v4' ORDER BY version DESC LIMIT 1) AS v4_status,
  (SELECT count(*) FROM priority_rule_versions WHERE rules->>'formulaType' = 'umsc_weighted_v3') AS v3_rows,
  (SELECT status FROM priority_rule_versions WHERE rules->>'formulaType' = 'umsc_weighted_v3' ORDER BY version DESC LIMIT 1) AS v3_status;
