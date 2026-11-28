-- 反向脚本：误回滚时把 v4 重新发布、v3 退役（同样单条原子 UPDATE）。
-- 仅在「当前唯一 published 就是 v3」时命中；已恢复 v4 后重跑返回 0 行。
UPDATE priority_rule_versions
SET status = CASE
      WHEN rules->>'formulaType' = 'umsc_weighted_v3' AND status = 'published' THEN 'retired'
      WHEN rules->>'formulaType' = 'pragmatic_triage_v4' AND status = 'retired' THEN 'published'
      ELSE status
    END,
    published_at = CASE
      WHEN rules->>'formulaType' = 'pragmatic_triage_v4' AND status = 'retired' THEN now()
      ELSE published_at
    END
WHERE rules->>'formulaType' IN ('pragmatic_triage_v4', 'umsc_weighted_v3')
  AND (SELECT count(*) = 1 AND bool_and(rules->>'formulaType' = 'umsc_weighted_v3')
       FROM priority_rule_versions WHERE status = 'published')
RETURNING version, id, status, rules->>'formulaType' AS formula_type, published_at;
