import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { Candidate } from '@safehandoff/core-interface';
import { DocumentStore } from './database.ts';
import { TaskStore } from './task-store.ts';

const candidate = (id: string): Candidate => ({ local_key: id, kind: 'observation', uncertainty: 'observed', statement: 'PRIVATE SOURCE',
  evidence_ids: ['evidence'], relevance: 'required', purpose_relevance: 'investigate' });
const context = { purpose: 'support', recipient: 'vendor', output_language: 'ko' as const };
const sha = 'a'.repeat(64);
function setup(clock?: () => Date) {
  const store = new TaskStore(':memory:', clock);
  const task = store.create(context, sha, sha);
  const installed = store.installCandidates(task.id, task.revision, [candidate('c1'), candidate('c2')]);
  return { store, task: installed };
}
test('decision batches validate previews and are atomic idempotent revision transitions', () => {
  const { store, task } = setup();
  try {
    const preview = store.preview(task.id, task.revision, 'c1', 'approved summary');
    const input = { candidate_id: 'c1', disposition: 'allow' as const, preview_id: preview.preview_id, projection_sha256: preview.projection_sha256 };
    assert.throws(() => store.applyDecisionBatch(task.id, task.revision, [input, { candidate_id: 'unknown', disposition: 'exclude' }], 'bad'), /INVALID_DECISION/);
    assert.deepEqual(store.decisions(task.id), []);
    assert.equal(store.get(task.id).revision, task.revision);
    const result = store.applyDecisionBatch(task.id, task.revision, [input], 'once');
    assert.equal(result.revision, task.revision + 1);
    assert.deepEqual(store.applyDecisionBatch(task.id, task.revision, [input], 'once'), result);
    assert.equal(store.effectiveAllows(task.id).length, 1);
    assert.throws(() => store.applyDecisionBatch(task.id, task.revision, [input], 'new'), /REVISION_CONFLICT/);
    assert.throws(() => store.applyDecisionBatch(task.id, task.revision, [{ candidate_id: 'c1', disposition: 'exclude' }], 'once'), /IDEMPOTENCY_CONFLICT/);
  } finally { store.close(); }
});
test('cross-task candidate preview and projection hash substitutions fail closed', () => {
  const { store, task } = setup();
  try {
    const other = store.create(context, sha, sha);
    store.installCandidates(other.id, 1, [candidate('other')]);
    assert.throws(() => store.preview(task.id, task.revision, 'other', 'public'), /INVALID_DECISION/);
    const foreign = store.preview(other.id, 2, 'other', 'public');
    const local = store.preview(task.id, task.revision, 'c1', 'public');
    for (const preview of [foreign, { ...local, projection_sha256: 'b'.repeat(64) }]) {
      assert.throws(() => store.applyDecisionBatch(task.id, task.revision, [{ candidate_id: 'c1', disposition: 'allow',
        preview_id: preview.preview_id, projection_sha256: preview.projection_sha256 }], 'bad'), /INVALID_DECISION/);
    }
    assert.deepEqual(store.decisions(task.id), []);
  } finally { store.close(); }
});
test('expiry revoke exclusion and new candidate sets never restore an old allow', () => {
  let now = new Date('2026-01-01T00:00:00Z');
  const { store, task } = setup(() => now);
  try {
    const preview = store.preview(task.id, task.revision, 'c1', 'public');
    let updated = store.applyDecisionBatch(task.id, 2, [{ candidate_id: 'c1', disposition: 'allow', preview_id: preview.preview_id,
      projection_sha256: preview.projection_sha256, expires_at: '2026-01-02T00:00:00Z' }], 'allow');
    assert.equal(store.effectiveAllows(task.id).length, 1);
    now = new Date('2026-01-02T00:00:00Z');
    assert.equal(store.effectiveAllows(task.id).length, 0);
    updated = store.revoke(task.id, updated.revision, store.decisions(task.id)[0]!.id);
    assert.equal(store.effectiveAllows(task.id).length, 0);
    assert(store.decisions(task.id)[0]!.revoked_at);
    updated = store.applyDecisionBatch(task.id, updated.revision, [{ candidate_id: 'c1', disposition: 'exclude' }], 'exclude');
    assert.equal(store.effectiveAllows(task.id).length, 0);
    updated = store.installCandidates(task.id, updated.revision, [candidate('new')]);
    assert.deepEqual(store.decisions(task.id), []);
    assert.throws(() => store.preview(task.id, updated.revision, 'c1', 'old'), /INVALID_DECISION/);
  } finally { store.close(); }
});
test('migration preserves existing documents and decisions survive reopening; deletion cascades', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safehandoff-tasks-')), path = join(dir, 'test.sqlite');
  try {
    const documents = new DocumentStore(path); const saved = documents.save('existing'); documents.close();
    let store = new TaskStore(path);
    const task = store.create(context, sha, sha);
    store.installCandidates(task.id, 1, [candidate('c1')]);
    const preview = store.preview(task.id, 2, 'c1', 'approved');
    store.applyDecisionBatch(task.id, 2, [{ candidate_id: 'c1', disposition: 'allow', preview_id: preview.preview_id, projection_sha256: preview.projection_sha256 }], 'key');
    store.close(); store = new TaskStore(path);
    assert.equal(store.effectiveAllows(task.id).length, 1);
    const raw = new DatabaseSync(path); raw.exec('PRAGMA foreign_keys=ON');
    assert.throws(() => raw.prepare('UPDATE workflow_snapshots SET snapshot_json=? WHERE task_id=?').run('{}', task.id), /IMMUTABLE/);
    assert.throws(() => raw.prepare('UPDATE workflow_decisions SET disposition=? WHERE task_id=?').run('exclude', task.id), /IMMUTABLE/);
    assert.throws(() => raw.prepare('INSERT INTO workflow_current_decisions VALUES(?,?,?)').run(task.id, 'wrong', store.decisions(task.id)[0]!.id), /FOREIGN KEY/);
    assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM task_store_migrations').get()!.n, 4);
    store.delete(task.id, 3); store.close();
    assert.equal(raw.prepare('SELECT count(*) AS n FROM workflow_decisions').get()!.n, 0);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM workflow_previews').get()!.n, 0);
    raw.close();
    const reopened = new DocumentStore(path); assert.deepEqual(reopened.list().map(row => ({ ...row })), [saved]); reopened.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
