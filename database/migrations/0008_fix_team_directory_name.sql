-- 0008: 修正花名册与模块词典中的姓名错字（兰谊伟 → 兰诣伟）。
-- 0003 种子把「兰诣伟」写成了「兰谊伟」；代码常量（domain/team-directory.ts）与
-- 飞书通讯录实际姓名均为「兰诣伟」。错字会让 PII 掩码名单对不上真人（该成员的姓名
-- 出现在需求正文时不会被掩码），且模块词典 personName 与人员页无法建立关联。
-- 按迁移规则前滚修正：不改写已应用的 0003。
BEGIN;

UPDATE source_configs
SET owner_names = (
  SELECT jsonb_agg(CASE WHEN name = '兰谊伟' THEN to_jsonb('兰诣伟'::text) ELSE to_jsonb(name) END)
  FROM jsonb_array_elements_text(owner_names) AS name
)
WHERE owner_names @> '["兰谊伟"]'::jsonb;

UPDATE module_dictionary_versions
SET entries = (
  SELECT jsonb_agg(
    CASE WHEN entry->>'personName' = '兰谊伟'
      THEN jsonb_set(entry, '{personName}', to_jsonb('兰诣伟'::text))
      ELSE entry END
  )
  FROM jsonb_array_elements(entries) AS entry
)
WHERE entries @> '[{"personName":"兰谊伟"}]'::jsonb;

COMMIT;
