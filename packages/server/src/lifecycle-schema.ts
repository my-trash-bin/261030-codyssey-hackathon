export const lifecycleSchema = `
CREATE TABLE IF NOT EXISTS workflow_events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_intake(
 task_id TEXT PRIMARY KEY REFERENCES workflow_tasks(id) ON DELETE CASCADE, payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TABLE IF NOT EXISTS workflow_artifact_jobs(
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 result_id TEXT, error_code TEXT
);
CREATE TABLE IF NOT EXISTS workflow_artifacts(
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS workflow_artifacts_immutable BEFORE UPDATE ON workflow_artifacts
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ARTIFACT'); END;
CREATE TABLE IF NOT EXISTS workflow_exports(
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(id) ON DELETE CASCADE,
 set_hash TEXT NOT NULL, zip_bytes BLOB NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS workflow_exports_immutable BEFORE UPDATE ON workflow_exports
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EXPORT'); END;
CREATE TABLE IF NOT EXISTS workflow_rules(
 id TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 revoked_at TEXT, PRIMARY KEY(id,version)
);
CREATE TRIGGER IF NOT EXISTS workflow_rules_immutable BEFORE UPDATE ON workflow_rules
 WHEN NEW.id IS NOT OLD.id OR NEW.version IS NOT OLD.version OR NEW.payload_json IS NOT OLD.payload_json
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RULE'); END;
CREATE TABLE IF NOT EXISTS workflow_rule_decisions(
 task_id TEXT NOT NULL, decision_id TEXT NOT NULL, rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL,
 PRIMARY KEY(task_id,decision_id,rule_id), FOREIGN KEY(task_id,decision_id) REFERENCES workflow_decisions(task_id,id) ON DELETE CASCADE,
 FOREIGN KEY(rule_id,rule_version) REFERENCES workflow_rules(id,version)
);
CREATE TRIGGER IF NOT EXISTS workflow_task_events AFTER UPDATE OF revision ON workflow_tasks
 BEGIN INSERT INTO workflow_events(task_id,revision,kind,created_at) VALUES(NEW.id,NEW.revision,'task_changed',NEW.updated_at); END;
CREATE TRIGGER IF NOT EXISTS workflow_task_created AFTER INSERT ON workflow_tasks
 BEGIN INSERT INTO workflow_events(task_id,revision,kind,created_at) VALUES(NEW.id,NEW.revision,'task_created',NEW.created_at); END;
INSERT OR IGNORE INTO task_store_migrations(version,applied_at) VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;
