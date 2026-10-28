-- 0019 (V02-S06)：评分 v2 版本、固定公式与九项输入；旧 v1 求和规则退休但历史保留。
BEGIN;

CREATE TABLE requirement_score_versions (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('ai_suggested', 'current', 'confirmed', 'superseded')),
  origin text NOT NULL CHECK (origin IN ('ai', 'manual', 'ai_applied')),
  source_version integer NOT NULL CHECK (source_version > 0),
  analysis_version integer,
  rule_version_id uuid REFERENCES priority_rule_versions(id),
  inputs jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  alpha numeric(3,1) NOT NULL CHECK (alpha >= 0.5 AND alpha <= 2.0),
  score numeric(8,2) NOT NULL CHECK (score >= 0),
  priority text NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  score_confidence text CHECK (score_confidence IN ('高', '中', '低')),
  score_confidence_reason text,
  safety_flag boolean NOT NULL DEFAULT false,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(basis) = 'object'),
  rationale text,
  actor_id text,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requirement_id, version)
);

CREATE UNIQUE INDEX requirement_score_versions_single_current
  ON requirement_score_versions (requirement_id)
  WHERE status IN ('current', 'confirmed');
CREATE INDEX requirement_score_versions_requirement_idx
  ON requirement_score_versions (requirement_id, version DESC);

ALTER TABLE requirements ADD COLUMN current_score_version_id uuid;
ALTER TABLE requirements
  ADD CONSTRAINT requirements_current_score_version_fk
  FOREIGN KEY (current_score_version_id) REFERENCES requirement_score_versions(id) ON DELETE SET NULL;

INSERT INTO priority_rule_versions (id, version, status, rules, validation_evidence, created_by, created_at, published_at)
SELECT gen_random_uuid(), COALESCE(MAX(version), 0) + 1, 'published',
  '{"formulaType":"umsc_weighted_v2","thresholds":{"p0":45,"p1":25,"p2":10},"alpha":{"min":0.5,"max":2.0,"step":0.1,"defaults":{"single":0.8,"multi":1.0,"safety":1.5}},"inputs":{"user":{"pain":[1,5],"frequency":[1,5]},"market":{"sellingPoint":[1,3],"competitor":[1,3]},"strategy":{"roadmap":[1,3],"dependency":[1,3]},"cost":{"workload":[1,5],"technicalRisk":[1,5],"resource":[1,5]}}}'::jsonb,
  '[
    {"case":"车灯模式选择","inputs":{"user":{"pain":3,"frequency":4},"market":{"sellingPoint":1,"competitor":1},"strategy":{"roadmap":1,"dependency":1},"cost":{"workload":3,"technicalRisk":2,"resource":2}},"alpha":0.8,"expectedScore":6.40,"expectedPriority":"P3"},
    {"case":"Di2换挡警示","inputs":{"user":{"pain":4,"frequency":4},"market":{"sellingPoint":1,"competitor":1},"strategy":{"roadmap":1,"dependency":1},"cost":{"workload":3,"technicalRisk":3,"resource":2}},"alpha":0.8,"expectedScore":8.53,"expectedPriority":"P3"},
    {"case":"Di2确认涉安全","inputs":{"user":{"pain":4,"frequency":4},"market":{"sellingPoint":1,"competitor":1},"strategy":{"roadmap":1,"dependency":1},"cost":{"workload":3,"technicalRisk":3,"resource":2}},"alpha":1.5,"expectedScore":16.00,"expectedPriority":"P2"},
    {"case":"C706×GX适配","inputs":{"user":{"pain":4,"frequency":5},"market":{"sellingPoint":2,"competitor":2},"strategy":{"roadmap":1,"dependency":1},"cost":{"workload":4,"technicalRisk":4,"resource":4}},"alpha":0.8,"expectedScore":15.20,"expectedPriority":"P2"},
    {"case":"媒体控制","inputs":{"user":{"pain":4,"frequency":4},"market":{"sellingPoint":2,"competitor":2},"strategy":{"roadmap":1,"dependency":1},"cost":{"workload":3,"technicalRisk":4,"resource":3}},"alpha":0.8,"expectedScore":12.16,"expectedPriority":"P2"},
    {"case":"传感器重命名","inputs":{"user":{"pain":3,"frequency":2},"market":{"sellingPoint":1,"competitor":1},"strategy":{"roadmap":1,"dependency":1},"cost":{"workload":3,"technicalRisk":2,"resource":3}},"alpha":0.8,"expectedScore":3.20,"expectedPriority":"P3"}
  ]'::jsonb,
  'system-scoring-v2', now(), now()
FROM priority_rule_versions
WHERE NOT EXISTS (
  SELECT 1 FROM priority_rule_versions WHERE rules->>'formulaType' = 'umsc_weighted_v2'
);

UPDATE priority_rule_versions
SET status = 'retired'
WHERE status = 'published'
  AND rules->>'formulaType' IS DISTINCT FROM 'umsc_weighted_v2';

COMMIT;
