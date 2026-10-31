-- SafeHandoff reference schema v1; initial migration design, not an installed app DB.
-- Same-task ownership, immutable-record updates, current pointers and SHA-256 equality
-- require the transaction/domain checks documented in docs/ERD.md and docs/spec.md.
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK(version > 0), applied_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, internal_title TEXT NOT NULL,
  project_id TEXT NOT NULL, purpose_id TEXT NOT NULL CHECK(purpose_id IN ('oss_issue','vendor_support','operations_advice')),
  goal_variant TEXT NOT NULL DEFAULT 'default' CHECK(goal_variant IN ('default','observations_only','ask_for_diagnostics','reproduction_evidence')),
  recipient_id TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('public','named_external')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  phase TEXT NOT NULL CHECK(phase IN ('needs_analysis','needs_decisions','ready_to_generate','processing','needs_attention','ready_to_finalize','finalized')),
  current_job_id TEXT, current_artifact_id TEXT, current_candidate_set_id TEXT,
  output_language TEXT NOT NULL CHECK(output_language IN ('ko','en')),
  skill_ids_json TEXT NOT NULL CHECK(json_valid(skill_ids_json)), skill_set_hash TEXT NOT NULL,
  provider_mode TEXT NOT NULL CHECK(provider_mode IN ('fixture','live')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE task_snapshots (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0), source_set_hash TEXT NOT NULL,
  policy_hash TEXT NOT NULL, skill_set_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  PRIMARY KEY(task_id, revision)
);
CREATE TABLE source_versions (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  source_slot TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('txt','log','md','csv','json')),
  display_name TEXT NOT NULL, raw_bytes BLOB NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0 AND size_bytes = length(raw_bytes)),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64), parser_version TEXT NOT NULL,
  schema_id TEXT, schema_version INTEGER, created_at TEXT NOT NULL,
  UNIQUE(task_id, source_id, version), UNIQUE(task_id, id)
);
CREATE TABLE task_sources (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, current_source_version_id TEXT NOT NULL,
  included INTEGER NOT NULL CHECK(included IN (0,1)), PRIMARY KEY(task_id, source_id),
  FOREIGN KEY(task_id,current_source_version_id) REFERENCES source_versions(task_id,id) ON DELETE CASCADE
);
CREATE TABLE evidence (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL,
  locator_json TEXT NOT NULL CHECK(json_valid(locator_json)),
  evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
  FOREIGN KEY(task_id,source_version_id) REFERENCES source_versions(task_id,id) ON DELETE CASCADE,
  UNIQUE(task_id,id)
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  input_revision INTEGER, kind TEXT NOT NULL CHECK(kind IN ('analyze','interpret_condition','compose','review','reproduce','provider_check')),
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','stale')),
  mode TEXT NOT NULL CHECK(mode IN ('fixture','live')),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  result_ref TEXT, error_code TEXT, stage TEXT, started_at TEXT, finished_at TEXT,
  created_at TEXT NOT NULL,
  CHECK((kind='provider_check' AND task_id IS NULL AND input_revision IS NULL) OR
        (kind!='provider_check' AND task_id IS NOT NULL AND input_revision IS NOT NULL AND input_revision>0)),
  UNIQUE(task_id,id)
);
CREATE TABLE candidate_sets (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  analysis_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  source_set_hash TEXT NOT NULL, created_revision INTEGER NOT NULL CHECK(created_revision>0),
  created_at TEXT NOT NULL, UNIQUE(task_id,id)
);
CREATE TABLE candidates (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  candidate_set_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('observation','constraint','hypothesis','unknown')),
  uncertainty TEXT NOT NULL CHECK(uncertainty IN ('observed','reported','inferred','unknown')),
  relevance TEXT NOT NULL CHECK(relevance IN ('required','optional')),
  origin TEXT NOT NULL CHECK(origin IN ('model','human','parser')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  FOREIGN KEY(task_id,candidate_set_id) REFERENCES candidate_sets(task_id,id) ON DELETE CASCADE,
  UNIQUE(task_id,id)
);
CREATE TABLE disclosure_previews (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0), candidate_id TEXT NOT NULL,
  representation_json TEXT NOT NULL CHECK(json_valid(representation_json)),
  projection_bytes BLOB NOT NULL, projection_sha256 TEXT NOT NULL CHECK(length(projection_sha256)=64),
  internal_bindings_json TEXT NOT NULL CHECK(json_valid(internal_bindings_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(task_id,candidate_id) REFERENCES candidates(task_id,id) ON DELETE CASCADE,
  UNIQUE(task_id,id)
);
CREATE TABLE decisions (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL, created_revision INTEGER NOT NULL CHECK(created_revision>0),
  supersedes_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('allow','exclude','defer')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  applied_rule_id TEXT, applied_rule_version INTEGER,
  expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(task_id,candidate_id) REFERENCES candidates(task_id,id) ON DELETE CASCADE,
  FOREIGN KEY(applied_rule_id,applied_rule_version) REFERENCES rules(id,version),
  UNIQUE(task_id,id)
);
CREATE TABLE current_decisions (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL, decision_id TEXT NOT NULL,
  PRIMARY KEY(task_id,candidate_id),
  FOREIGN KEY(task_id,candidate_id) REFERENCES candidates(task_id,id) ON DELETE CASCADE,
  FOREIGN KEY(task_id,decision_id) REFERENCES decisions(task_id,id) ON DELETE CASCADE
);
CREATE TABLE rules (
  id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  scope_hash TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_from_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_from_decision_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
  expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY(id,version)
);
CREATE TABLE fact_packs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  writer_payload_json TEXT NOT NULL CHECK(json_valid(writer_payload_json)),
  internal_mapping_json TEXT NOT NULL CHECK(json_valid(internal_mapping_json)),
  created_at TEXT NOT NULL, UNIQUE(task_id,id)
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0), artifact_version INTEGER NOT NULL CHECK(artifact_version>0),
  fact_pack_id TEXT NOT NULL, document_json TEXT NOT NULL CHECK(json_valid(document_json)),
  document_hash TEXT NOT NULL CHECK(length(document_hash)=64), artifact_set_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','checking','blocked','ready','finalized','stale')),
  reproduction_json TEXT NOT NULL CHECK(json_valid(reproduction_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(task_id,fact_pack_id) REFERENCES fact_packs(task_id,id),
  UNIQUE(task_id,revision,artifact_version), UNIQUE(task_id,id)
);
CREATE TABLE artifact_files (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL, media_type TEXT NOT NULL, bytes BLOB NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes>=0 AND size_bytes=length(bytes)),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  UNIQUE(artifact_id,relative_path), UNIQUE(artifact_id,id)
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0), artifact_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('document','bundle')),
  target_hash TEXT NOT NULL CHECK(length(target_hash)=64),
  mode TEXT NOT NULL CHECK(mode IN ('model','human')),
  result TEXT NOT NULL CHECK(result IN ('pass','needs_changes','needs_decision','error')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), reviewed_at TEXT NOT NULL,
  FOREIGN KEY(task_id,artifact_id) REFERENCES artifacts(task_id,id) ON DELETE CASCADE
);
CREATE TABLE findings (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  target_hash TEXT NOT NULL, detector_id TEXT NOT NULL, field_path TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','blocking')),
  resolution TEXT NOT NULL CHECK(resolution IN ('open','allowed_exact','allowed_excerpt','allowed_public_asset','allowed_context','removed','needs_decision','error')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TABLE tool_runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0), job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL, version TEXT NOT NULL, input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','not_run','stale')),
  public_result_json TEXT NOT NULL CHECK(json_valid(public_result_json)),
  internal_diagnostics_json TEXT NOT NULL CHECK(json_valid(internal_diagnostics_json)),
  created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE exports (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0), artifact_id TEXT NOT NULL,
  artifact_set_hash TEXT NOT NULL CHECK(length(artifact_set_hash)=64),
  archive_bytes BLOB NOT NULL, archive_sha256 TEXT NOT NULL CHECK(length(archive_sha256)=64),
  confirmed_at TEXT NOT NULL, invalidated_at TEXT, invalidation_reason TEXT,
  FOREIGN KEY(task_id,artifact_id) REFERENCES artifacts(task_id,id) ON DELETE CASCADE,
  UNIQUE(task_id,revision,artifact_id)
);
CREATE TABLE events (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK(seq>0), revision INTEGER NOT NULL CHECK(revision>0),
  type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL, PRIMARY KEY(task_id,seq)
);
CREATE TABLE idempotency_keys (
  method TEXT NOT NULL, path TEXT NOT NULL, key TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL, response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  PRIMARY KEY(method,path,key)
);
CREATE TABLE deletion_receipts (
  task_id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
  deleted_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE run_traces (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  role TEXT NOT NULL, prompt_version TEXT NOT NULL, provider_config_hash TEXT NOT NULL,
  elapsed_ms INTEGER CHECK(elapsed_ms>=0), usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  error_code TEXT, raw_request_payload BLOB, raw_response_payload BLOB,
  raw_payload_expires_at TEXT, created_at TEXT NOT NULL,
  CHECK((raw_request_payload IS NULL AND raw_response_payload IS NULL AND raw_payload_expires_at IS NULL)
     OR raw_payload_expires_at IS NOT NULL)
);
CREATE INDEX tasks_updated_idx ON tasks(updated_at,id);
CREATE INDEX jobs_task_status_idx ON jobs(task_id,status);
CREATE INDEX candidates_set_idx ON candidates(candidate_set_id);
CREATE INDEX decision_expiry_idx ON decisions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX rule_scope_idx ON rules(scope_hash,version);
CREATE INDEX artifact_revision_idx ON artifacts(task_id,revision);
CREATE INDEX trace_expiry_idx ON run_traces(raw_payload_expires_at) WHERE raw_payload_expires_at IS NOT NULL;
