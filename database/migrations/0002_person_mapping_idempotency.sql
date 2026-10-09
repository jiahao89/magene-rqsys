-- 人工负责人映射幂等性：同键同一时刻至多一条活跃手工映射。
-- 幂等语义：重复提交相同映射返回既有行；更换 feishu 目标时旧行失效后插入新行。

CREATE UNIQUE INDEX person_mappings_manual_tb_unique
  ON person_mappings (source_config_id, teambition_user_id)
  WHERE active AND match_method = 'manual' AND teambition_user_id IS NOT NULL;

CREATE UNIQUE INDEX person_mappings_manual_feishu_unique
  ON person_mappings (source_config_id, feishu_user_id)
  WHERE active AND match_method = 'manual' AND teambition_user_id IS NULL;
