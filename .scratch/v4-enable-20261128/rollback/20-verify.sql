-- 回滚后复核（只读）。期望：v4=retired、v3=published、全表只有 1 行 published。
SELECT version, status, rules->>'formulaType' AS formula_type, published_at
FROM priority_rule_versions
ORDER BY version;
