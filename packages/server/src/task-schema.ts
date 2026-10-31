// Internal storage subset, deliberately not the complete product task.v1 schema.
export const taskSchema = `
CREATE TABLE IF NOT EXISTS task_store_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_tasks(
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
 phase TEXT NOT NULL CHECK(phase IN ('needs_analysis','needs_decisions','ready_to_generate')),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)), source_set_hash TEXT NOT NULL CHECK(length(source_set_hash)=64),
 skill_set_hash TEXT NOT NULL CHECK(length(skill_set_hash)=64), current_candidate_set_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_snapshots(
 task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision>0),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), PRIMARY KEY(task_id,revision)
);
CREATE TABLE IF NOT EXISTS workflow_candidate_sets(
 task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE, id TEXT NOT NULL,
 created_revision INTEGER NOT NULL CHECK(created_revision>0), PRIMARY KEY(task_id,id)
);
CREATE TABLE IF NOT EXISTS workflow_candidates(
 task_id TEXT NOT NULL, set_id TEXT NOT NULL, id TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), PRIMARY KEY(task_id,id),
 FOREIGN KEY(task_id,set_id) REFERENCES workflow_candidate_sets(task_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workflow_previews(
 task_id TEXT NOT NULL, id TEXT NOT NULL, candidate_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 projection_bytes BLOB NOT NULL, projection_sha256 TEXT NOT NULL CHECK(length(projection_sha256)=64),
 source_set_hash TEXT NOT NULL CHECK(length(source_set_hash)=64), scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64),
 PRIMARY KEY(task_id,id), UNIQUE(task_id,candidate_id,id),
 FOREIGN KEY(task_id,candidate_id) REFERENCES workflow_candidates(task_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workflow_decisions(
 task_id TEXT NOT NULL, id TEXT NOT NULL, candidate_id TEXT NOT NULL, created_revision INTEGER NOT NULL CHECK(created_revision>0),
 disposition TEXT NOT NULL CHECK(disposition IN ('allow','exclude','defer')), preview_id TEXT, supersedes_id TEXT,
 expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL,
 CHECK((disposition='allow' AND preview_id IS NOT NULL) OR (disposition!='allow' AND preview_id IS NULL)),
 PRIMARY KEY(task_id,id), UNIQUE(task_id,candidate_id,id),
 FOREIGN KEY(task_id,candidate_id) REFERENCES workflow_candidates(task_id,id) ON DELETE CASCADE,
 FOREIGN KEY(task_id,candidate_id,preview_id) REFERENCES workflow_previews(task_id,candidate_id,id),
 FOREIGN KEY(task_id,candidate_id,supersedes_id) REFERENCES workflow_decisions(task_id,candidate_id,id)
);
CREATE TABLE IF NOT EXISTS workflow_current_decisions(
 task_id TEXT NOT NULL, candidate_id TEXT NOT NULL, decision_id TEXT NOT NULL, PRIMARY KEY(task_id,candidate_id),
 FOREIGN KEY(task_id,candidate_id,decision_id) REFERENCES workflow_decisions(task_id,candidate_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workflow_decision_batches(
 task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), PRIMARY KEY(task_id,idempotency_key)
);
CREATE TRIGGER IF NOT EXISTS workflow_snapshots_immutable BEFORE UPDATE ON workflow_snapshots
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SNAPSHOT'); END;
CREATE TRIGGER IF NOT EXISTS workflow_previews_immutable BEFORE UPDATE ON workflow_previews
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PREVIEW'); END;
CREATE TRIGGER IF NOT EXISTS workflow_decisions_immutable BEFORE UPDATE ON workflow_decisions
 WHEN NEW.task_id IS NOT OLD.task_id OR NEW.id IS NOT OLD.id OR NEW.candidate_id IS NOT OLD.candidate_id
 OR NEW.created_revision IS NOT OLD.created_revision OR NEW.disposition IS NOT OLD.disposition
 OR NEW.preview_id IS NOT OLD.preview_id OR NEW.supersedes_id IS NOT OLD.supersedes_id
 OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
 OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DECISION'); END;
INSERT OR IGNORE INTO task_store_migrations(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;
