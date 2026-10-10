-- MVP D-09 allows exactly one Teambition source configuration.
-- provider is constrained to 'teambition' by migration 0001, so a unique provider
-- index enforces the singleton even when concurrent first-time setup requests race.
CREATE UNIQUE INDEX source_configs_singleton_idx ON source_configs (provider);
