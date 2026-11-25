-- 0033：需求评估失败子类型（可观测）。
-- 背景（2026-11-25）：评估失配后只有一个笼统的 analysis_failure，线上无法区分
-- 「空内容 / 非 JSON / 契约字段不匹配 / 供应商响应包异常」，排障只能靠猜。
-- 本列只记分类与契约字段路径（如 non_json、contract:feasibility.cost），不含任何模型输出内容。
BEGIN;

ALTER TABLE requirement_assessments ADD COLUMN IF NOT EXISTS error_detail text;

COMMIT;
