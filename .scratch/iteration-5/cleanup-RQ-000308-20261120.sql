-- 清理 AI 需求评估线上验收数据 RQ-000308（2026-11-20）
-- 范围：只删 requirement_assessments 中该需求的 v1–v4 四行；RQ-000308 本体、AI 分析、Base、通知都不动。
-- 需求 UUID：a2573c66-5887-45f7-a793-7805d54f1e88
-- 删除前已核对：该需求 4 行（v1 succeeded / v2 failed analysis_failure / v3 succeeded / v4 succeeded），
--   requirement_assessments 全表也只有这 4 行、仅 1 个需求。
--
-- 用法（应用库）：
--   lark-cli apps +db-execute --app-id app_17fqkjwyx1u --environment online --file <本文件> --yes

BEGIN;

DELETE FROM requirement_assessments
 WHERE requirement_id = 'a2573c66-5887-45f7-a793-7805d54f1e88';

COMMIT;

-- 执行后复核（应分别返回 0、0、1，本体与其它链路不受影响）：
SELECT count(*)::int AS rq308_assessment_rows
  FROM requirement_assessments
 WHERE requirement_id = 'a2573c66-5887-45f7-a793-7805d54f1e88';
SELECT count(*)::int AS assessment_table_rows FROM requirement_assessments;
SELECT
  (SELECT count(*) FROM requirements WHERE id = 'a2573c66-5887-45f7-a793-7805d54f1e88')::int AS requirement_rows,
  (SELECT count(*) FROM analysis_runs WHERE requirement_id = 'a2573c66-5887-45f7-a793-7805d54f1e88')::int AS analysis_rows;
