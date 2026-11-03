-- 0023 (V02-T26)：人工优先级覆盖 + 分析补充上下文。
-- 两者都是应用内人工输入：只影响列表/详情/总览与下一次分析请求，不回写 Base（PM 确认字段仍以 Base 为准）。
-- 人工优先级优先于当前评分版本 priority；无覆盖时回退到当前评分版本（再回退历史分析优先级）。
BEGIN;

ALTER TABLE requirements
  ADD COLUMN priority_override text
    CHECK (priority_override IN ('P0', 'P1', 'P2', 'P3')),
  ADD COLUMN priority_override_reason text,
  ADD COLUMN priority_override_actor_id text,
  ADD COLUMN priority_override_at timestamptz,
  ADD COLUMN analysis_context_note text,
  ADD COLUMN analysis_context_updated_at timestamptz,
  ADD COLUMN analysis_context_updated_by text;

-- 覆盖四字段必须同为 NULL 或同非 NULL：避免“只写了一半”的覆盖状态（清除=四列一起置空）。
ALTER TABLE requirements
  ADD CONSTRAINT requirements_priority_override_complete CHECK (
    (priority_override IS NULL
      AND priority_override_reason IS NULL
      AND priority_override_actor_id IS NULL
      AND priority_override_at IS NULL)
    OR (priority_override IS NOT NULL
      AND priority_override_reason IS NOT NULL
      AND char_length(btrim(priority_override_reason)) BETWEEN 1 AND 500
      AND priority_override_actor_id IS NOT NULL
      AND priority_override_at IS NOT NULL)
  );

-- 补充上下文可单独清除（note/updated_at/updated_by 一起置空），非空时记录更新时间与操作人。
ALTER TABLE requirements
  ADD CONSTRAINT requirements_analysis_context_complete CHECK (
    (analysis_context_note IS NULL
      AND analysis_context_updated_at IS NULL
      AND analysis_context_updated_by IS NULL)
    OR (analysis_context_note IS NOT NULL
      AND char_length(analysis_context_note) BETWEEN 1 AND 4000
      AND analysis_context_updated_at IS NOT NULL
      AND analysis_context_updated_by IS NOT NULL)
  );

COMMIT;
