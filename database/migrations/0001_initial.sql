CREATE TABLE source_configs (
  id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'teambition' CHECK (provider = 'teambition'),
  external_project_id text NOT NULL,
  external_project_name text NOT NULL,
  requirement_type_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  schedule_enabled boolean NOT NULL DEFAULT false,
  schedule_weekday smallint CHECK (schedule_weekday BETWEEN 1 AND 7),
  schedule_local_time time,
  schedule_timezone text,
  owner_names jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(owner_names) = 'array'),
  field_map jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_map) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_project_id, requirement_type_id),
  CHECK (NOT schedule_enabled OR (schedule_weekday IS NOT NULL AND schedule_local_time IS NOT NULL AND schedule_timezone IS NOT NULL))
);

CREATE TABLE sync_batches (
  id uuid PRIMARY KEY,
  source_config_id uuid NOT NULL REFERENCES source_configs(id),
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  actor_id text,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial_failure', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_config_id, idempotency_key)
);

CREATE TABLE requirements (
  id uuid PRIMARY KEY,
  source_config_id uuid NOT NULL REFERENCES source_configs(id),
  teambition_requirement_id text NOT NULL,
  teambition_unique_id double precision,
  title text NOT NULL DEFAULT '',
  description text,
  scope text,
  acceptance_criteria text,
  proposer_user_id text,
  proposer_name text,
  executor_user_id text,
  executor_name text,
  source_status_id text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_url text,
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachment_refs) = 'array'),
  source_custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_custom_fields) = 'array'),
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_payload) = 'object'),
  source_hash char(64) NOT NULL,
  substantive_hash char(64) NOT NULL,
  source_version integer NOT NULL DEFAULT 1 CHECK (source_version > 0),
  latest_batch_id uuid REFERENCES sync_batches(id),
  base_record_id text,
  last_pushed_at timestamptz,
  pull_state text NOT NULL DEFAULT 'pending' CHECK (pull_state IN ('pending', 'running', 'synced', 'failed')),
  analysis_state text NOT NULL DEFAULT 'pending' CHECK (analysis_state IN ('pending', 'running', 'analyzed', 'failed_retryable')),
  owner_state text NOT NULL DEFAULT 'pending_mapping' CHECK (owner_state IN ('pending_mapping', 'auto_mapped', 'manually_mapped', 'not_required')),
  push_state text NOT NULL DEFAULT 'pending' CHECK (push_state IN ('pending', 'running', 'pushed', 'failed')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_config_id, teambition_requirement_id)
);

CREATE INDEX requirements_pipeline_idx
  ON requirements (pull_state, analysis_state, owner_state, push_state);
CREATE INDEX requirements_title_search_idx
  ON requirements USING gin (to_tsvector('simple', title));
CREATE INDEX requirements_source_status_idx ON requirements (source_status_id);

CREATE TABLE sync_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES sync_batches(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES requirements(id),
  teambition_requirement_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'unchanged')),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error_code text,
  error_detail text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (batch_id, teambition_requirement_id)
);

CREATE TABLE source_snapshots (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  source_version integer NOT NULL CHECK (source_version > 0),
  source_hash char(64) NOT NULL,
  substantive_hash char(64) NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  is_substantive_change boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requirement_id, source_version)
);

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  source_version integer NOT NULL,
  analysis_version integer NOT NULL CHECK (analysis_version > 0),
  status text NOT NULL CHECK (status IN ('running', 'analyzed', 'failed_retryable')),
  module_suggestion text,
  confidence text CHECK (confidence IN ('high', 'medium', 'low')),
  confidence_reason text,
  priority text CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  structured_result jsonb,
  provider text,
  model text,
  prompt_version text,
  module_dictionary_version integer,
  priority_rule_version_id uuid,
  safe_error_code text,
  safe_error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (requirement_id, analysis_version)
);

CREATE TABLE person_mappings (
  id uuid PRIMARY KEY,
  source_config_id uuid NOT NULL REFERENCES source_configs(id),
  teambition_user_id text,
  teambition_display_name text,
  normalized_name text,
  feishu_user_id text NOT NULL,
  feishu_id_type text NOT NULL CHECK (feishu_id_type IN ('open_id', 'user_id', 'union_id')),
  match_method text NOT NULL CHECK (match_method IN ('tb_user_id', 'unique_name', 'manual')),
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX person_mappings_tb_id_idx
  ON person_mappings (source_config_id, teambition_user_id) WHERE active AND teambition_user_id IS NOT NULL;
CREATE INDEX person_mappings_name_idx
  ON person_mappings (source_config_id, normalized_name) WHERE active AND normalized_name IS NOT NULL;

CREATE TABLE pm_snapshots (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  source_version integer NOT NULL,
  base_record_id text NOT NULL,
  pm_values jsonb NOT NULL CHECK (jsonb_typeof(pm_values) = 'object'),
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE base_push_runs (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  source_version integer NOT NULL,
  push_version integer NOT NULL CHECK (push_version > 0),
  status text NOT NULL CHECK (status IN ('running', 'pushed', 'failed')),
  idempotency_key text NOT NULL UNIQUE,
  base_record_id text,
  safe_error_code text,
  safe_error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (requirement_id, push_version)
);

CREATE TABLE module_dictionary_versions (
  version integer PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE TABLE priority_rule_versions (
  id uuid PRIMARY KEY,
  version integer NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  validation_evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_evidence) = 'array'),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

ALTER TABLE analysis_runs
  ADD CONSTRAINT analysis_runs_priority_rule_fk
  FOREIGN KEY (priority_rule_version_id) REFERENCES priority_rule_versions(id);

CREATE TABLE pipeline_jobs (
  id uuid PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('sync', 'analysis', 'base_push')),
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code text,
  last_error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_jobs_claim_idx ON pipeline_jobs (status, available_at, created_at);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id text,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  result text NOT NULL CHECK (result IN ('succeeded', 'failed', 'denied')),
  safe_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id, occurred_at DESC);
