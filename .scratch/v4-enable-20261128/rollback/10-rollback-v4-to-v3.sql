-- 评分规则回滚：v4 务实初筛退役，v3 U/M/S/C 恢复发布。
-- 授权：用户 2026-11-28 预先授权「v5 端到端验证失败时」执行；未获授权不得执行。
-- 语义：单条 UPDATE，语句本身原子；只在「当前唯一 published 就是 v4」且 v3 处于 retired 时命中。
-- 幂等：已回滚后重跑返回 0 行。绕过审计（无 priority_rule.published 审计行），事后需在验收记录里注明。
UPDATE priority_rule_versions
SET status = CASE
      WHEN rules->>'formulaType' = 'pragmatic_triage_v4' AND status = 'published' THEN 'retired'
      WHEN rules->>'formulaType' = 'umsc_weighted_v3' AND status = 'retired' THEN 'published'
      ELSE status
    END,
    published_at = CASE
      WHEN rules->>'formulaType' = 'umsc_weighted_v3' AND status = 'retired' THEN now()
      ELSE published_at
    END
WHERE rules->>'formulaType' IN ('pragmatic_triage_v4', 'umsc_weighted_v3')
  AND (SELECT count(*) = 1 AND bool_and(rules->>'formulaType' = 'pragmatic_triage_v4')
       FROM priority_rule_versions WHERE status = 'published')
RETURNING version, id, status, rules->>'formulaType' AS formula_type, published_at;
