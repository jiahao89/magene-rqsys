-- 0017 (V02-T10)：按“简单好用”口径（2026-10-25 确认）种子发布 U/M/S/C 规则 v1。
-- 口径：维持既有求和引擎；每维三档 高=1 / 中=0.5 / 低=0，无法判断=0（fail-closed）；
-- 综合分 = 四维之和（0–4）；阈值 P0≥3 / P1≥2 / P2≥1，否则 P3。
-- 仅当尚无已发布规则时种子（幂等）；发布后新分析/人工重跑确定性产出 P0–P3，不回算历史。
BEGIN;

INSERT INTO priority_rule_versions (id, version, status, rules, validation_evidence, created_by, created_at, published_at)
SELECT gen_random_uuid(), COALESCE(MAX(version), 0) + 1, 'published',
  '{"scoring":{"user":{"高":1,"中":0.5,"低":0,"无法判断":0},"market":{"高":1,"中":0.5,"低":0,"无法判断":0},"business":{"高":1,"中":0.5,"低":0,"无法判断":0},"technology":{"高":1,"中":0.5,"低":0,"无法判断":0}},"thresholds":{"p0":3,"p1":2,"p2":1}}'::jsonb,
  '[
    {"case":"全高","values":{"user":"高","market":"高","business":"高","technology":"高"},"sum":4,"expected":"P0"},
    {"case":"两高两中","values":{"user":"高","market":"中","business":"高","technology":"中"},"sum":3,"expected":"P0"},
    {"case":"全中","values":{"user":"中","market":"中","business":"中","technology":"中"},"sum":2,"expected":"P1"},
    {"case":"一高三低","values":{"user":"高","market":"低","business":"低","technology":"低"},"sum":1,"expected":"P2"},
    {"case":"全无法判断","values":{"user":"无法判断","market":"无法判断","business":"无法判断","technology":"无法判断"},"sum":0,"expected":"P3"}
  ]'::jsonb,
  'system-seed', now(), now()
FROM priority_rule_versions
WHERE NOT EXISTS (SELECT 1 FROM priority_rule_versions WHERE status = 'published');

COMMIT;
