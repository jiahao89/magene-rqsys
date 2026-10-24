-- 0010 (V02-T05): 手工需求的精简定义上下文（全部可空，TB 行保持 NULL）。
-- 产品/型号、需求类型（固定八类）、边界/限制、补充来源链接。
-- 只存录入人明确提供的值，不自动补造；来源链接不冒充 TB 地址。
BEGIN;

ALTER TABLE requirements ADD COLUMN product_model text;
ALTER TABLE requirements ADD COLUMN requirement_type text
  CHECK (requirement_type IS NULL OR requirement_type IN ('新增功能', '功能扩展', '体验优化', '性能优化', '质量修复', '安全合规', '成本效率', '技术治理'));
ALTER TABLE requirements ADD COLUMN constraint_notes text;
ALTER TABLE requirements ADD COLUMN supplement_url text;

COMMIT;
