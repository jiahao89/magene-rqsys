-- 0011 (V02-T06): 需求级录入模块与分配版本。
-- intake_module 是 Web 录入的受控词典模块（与 AI 建议、Base PM 确认模块分开，G-MODULE）；
-- manual_owner_assignment_version 每次显式分配/改派递增（现有行回填 1），
-- 用于分配事件按分配版本+身份去重（含 A→B→A）。
BEGIN;

ALTER TABLE requirements ADD COLUMN intake_module text;
ALTER TABLE requirements ADD COLUMN manual_owner_assignment_version integer NOT NULL DEFAULT 1;

COMMIT;
