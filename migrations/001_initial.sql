CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
-- Aggregates are persisted atomically; immutable task snapshots retain every revision.
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), phase TEXT NOT NULL CHECK(phase IN ('needs_analysis','needs_decisions','ready_to_generate','processing','needs_attention','ready_to_finalize','finalized')), payload_json BLOB NOT NULL CHECK(json_valid(payload_json)));
CREATE TABLE IF NOT EXISTS task_snapshots(task_id TEXT NOT NULL REFERENCES tasks(id), revision INTEGER NOT NULL CHECK(revision>0), snapshot_json BLOB NOT NULL CHECK(json_valid(snapshot_json)), PRIMARY KEY(task_id,revision));
CREATE TABLE IF NOT EXISTS rules(id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), payload_json BLOB NOT NULL CHECK(json_valid(payload_json)), PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS idempotency_keys(method TEXT NOT NULL,path TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,response_status INTEGER NOT NULL,response_json BLOB NOT NULL,PRIMARY KEY(method,path,key));
CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('project','recipient')),display_name TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%SZ','now'));
