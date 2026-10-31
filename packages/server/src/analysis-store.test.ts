import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { AnalyzeResult, Candidate, SourceDocument } from '@safehandoff/core-interface';
import { CoreError } from '@safehandoff/core-interface';
import { TaskStore } from './task-store.ts';
import { runTaskAnalysis } from './analysis-service.ts';
import { hash } from './analysis-validation.ts';
import { taskSchema } from './task-schema.ts';
import { DocumentStore } from './database.ts';
const context = { purpose: 'support', recipient: 'vendor' };
const source = (id = 's1', value = '한글 log'): SourceDocument => ({ id, source_id: id, version: 1, source_slot: 'log',
  display_name: 'fictional', format: 'txt', included: true, raw_bytes: Buffer.from(value).toString('base64'), sha256: hash(value) });
function result(s = source()): AnalyzeResult {
  const bytes = Buffer.from(s.raw_bytes, 'base64');
  const candidate: Candidate = { local_key: 'model-local', kind: 'observation', uncertainty: 'observed', statement: 'fictional observation',
    evidence_ids: ['e1'], relevance: 'required', purpose_relevance: 'support' };
  return { evidence: [{ id: 'e1', source_version_id: s.id, locator: { kind: 'byte_range' }, start: 0, end: bytes.length, evidence_sha256: hash(bytes) }],
    proposals: { schema_version: 'candidate_proposals.v1', candidates: [candidate, { ...candidate, local_key: 'another' }],
      conflicts: [{ local_keys: ['model-local', 'another'], reason: 'fixture conflict' }] } };
}
function setup() {
  const store = new TaskStore(':memory:');
  const task = store.create(context, 'a'.repeat(64), 'b'.repeat(64));
  return { store, task: store.analysis.replaceSources(task.id, task.revision, [source()]) };
}
const manual = { kind: 'constraint' as const, uncertainty: 'reported' as const, statement: 'manual condition', relevance: 'required' as const, purpose_relevance: 'support' };

test('snapshots and server candidate IDs/conflict groups are adopted atomically', () => {
  const { store, task } = setup();
  try {
    const job = store.analysis.start(task.id, task.revision);
    assert.equal(job.revision, task.revision + 1);
    assert.equal(store.get(task.id).current_candidate_set_id, null);
    const adopted = store.analysis.complete(task.id, job.id, result());
    assert.equal(adopted.adopted, true); assert.equal(adopted.task.revision, job.revision + 1);
    const candidates = store.analysis.candidates(task.id);
    assert.equal(candidates.length, 2);
    assert.ok(candidates.every(c => c.id !== c.local_key && c.origin === 'model' && c.selector === null));
    assert.equal(candidates[0]!.conflicts[0]!.id, candidates[1]!.conflicts[0]!.id);
    assert.deepEqual(store.decisions(task.id), []);
    assert.equal(store.analysis.complete(task.id, job.id, result()).adopted, false);
    assert.equal(store.get(task.id).revision, adopted.task.revision);
  } finally { store.close(); }
});
test('manual user note creates evidence/source and clones candidates with no carried decisions', () => {
  const { store, task } = setup();
  try {
    const job = store.analysis.start(task.id, task.revision);
    let current = store.analysis.complete(task.id, job.id, result()).task;
    const old = store.analysis.candidates(task.id);
    const preview = store.preview(task.id, current.revision, old[0]!.id, 'approved');
    current = store.applyDecisionBatch(task.id, current.revision, [{ candidate_id: old[0]!.id, disposition: 'allow',
      preview_id: preview.preview_id, projection_sha256: preview.projection_sha256 }], 'allow');
    const before = current.revision;
    current = store.analysis.addManual(task.id, before, { candidate: manual, user_note: '새 내부 메모' });
    assert.equal(current.revision, before + 1); assert.equal(current.phase, 'needs_decisions');
    assert.equal(store.analysis.sources(task.id).length, 2);
    const candidates = store.analysis.candidates(task.id);
    assert.equal(candidates.length, 3);
    assert.ok(candidates.every(c => !old.some(previous => previous.id === c.id)));
    assert.equal(candidates.filter(c => c.origin === 'manual').length, 1);
    assert.deepEqual(store.decisions(task.id), []); assert.deepEqual(store.effectiveAllows(task.id), []);
    assert.throws(() => store.preview(task.id, current.revision, old[0]!.id, 'old'), /INVALID_DECISION/);
    const noteCandidate = candidates.find(c => c.origin === 'manual')!;
    const next = store.analysis.addManual(task.id, current.revision, { candidate: manual, evidence_ids: noteCandidate.evidence_ids });
    assert.equal(next.revision, current.revision + 1);
    assert.equal(store.analysis.sources(task.id).length, 2);
  } finally { store.close(); }
});
test('manual candidates need neither an Engine nor prior model candidates', () => {
  const store = new TaskStore(':memory:');
  try {
    const task = store.create(context, 'a'.repeat(64), 'b'.repeat(64));
    const next = store.analysis.addManual(task.id, task.revision, { candidate: manual, user_note: 'manual only' });
    assert.equal(next.revision, 2); assert.equal(store.analysis.candidates(task.id)[0]!.origin, 'manual');
  } finally { store.close(); }
});
test('source immutability, invalid note rollback and removal invalidate current candidates', () => {
  const { store, task } = setup();
  try {
    assert.throws(() => store.analysis.replaceSources(task.id, task.revision, [source('s1', 'changed')]), /INVALID_ANALYSIS/);
    assert.equal(store.get(task.id).revision, task.revision);
    assert.throws(() => store.analysis.addManual(task.id, task.revision,
      { candidate: { ...manual, kind: 'invalid' as Candidate['kind'] }, user_note: 'must roll back' }), /INVALID_ANALYSIS/);
    assert.equal(store.analysis.sources(task.id).length, 1); assert.equal(store.get(task.id).revision, task.revision);
    assert.throws(() => store.analysis.addManual(task.id, task.revision, { candidate: manual, evidence_ids: ['foreign'] }), /INVALID_ANALYSIS/);
    const job = store.analysis.start(task.id, task.revision);
    const next = store.analysis.replaceSources(task.id, job.revision, [source('s2')]);
    const late = store.analysis.complete(task.id, job.id, result());
    assert.equal(late.adopted, false); assert.equal(late.job.status, 'stale');
    assert.equal(late.task.revision, next.revision); assert.equal(late.task.current_candidate_set_id, null);
  } finally { store.close(); }
});
test('cross-task substitution and malformed ranges/references cannot leave partial evidence', () => {
  const { store, task } = setup();
  try {
    const other = store.create(context, 'a'.repeat(64), 'b'.repeat(64));
    const job = store.analysis.start(task.id, task.revision);
    assert.throws(() => store.analysis.complete(other.id, job.id, result()), /ANALYSIS_NOT_FOUND/);
    for (const change of ['range', 'source', 'hash', 'reference', 'conflict']) {
      const bad = result();
      if (change === 'range') { bad.evidence[0]!.start = 1; bad.evidence[0]!.evidence_sha256 = hash(Buffer.from('한글 log').subarray(1)); }
      if (change === 'source') bad.evidence[0]!.source_version_id = 'other-task';
      if (change === 'hash') bad.evidence[0]!.evidence_sha256 = 'a'.repeat(64);
      if (change === 'reference') bad.proposals.candidates[0]!.evidence_ids = ['unknown'];
      if (change === 'conflict') bad.proposals.conflicts[0]!.local_keys = ['missing', 'another'];
      assert.throws(() => store.analysis.complete(task.id, job.id, bad), /INVALID_ANALYSIS/);
      assert.deepEqual(store.analysis.evidence(task.id), []);
      assert.equal(store.get(task.id).revision, job.revision);
    }
  } finally { store.close(); }
});
test('model calls hold no transaction: replacement, cancellation, deletion and reanalysis reject late responses', async () => {
  for (const action of ['replace', 'cancel', 'delete', 'reanalysis']) {
    const { store, task } = setup();
    let resolve!: (value: AnalyzeResult) => void;
    const pending = new Promise<AnalyzeResult>(done => { resolve = done; });
    const controller = new AbortController();
    const running = runTaskAnalysis(store, { analyze: async () => pending }, task.id, task.revision, { signal: controller.signal });
    try {
      const current = store.get(task.id);
      if (action === 'replace') store.analysis.replaceSources(task.id, current.revision, [source('new')]);
      if (action === 'cancel') controller.abort();
      if (action === 'delete') store.delete(task.id, current.revision);
      if (action === 'reanalysis') store.analysis.start(task.id, current.revision);
      resolve(result());
      if (action === 'cancel') await assert.rejects(running, CoreError);
      else if (action === 'delete') await assert.rejects(running, /ANALYSIS_NOT_FOUND/);
      else assert.equal((await running).adopted, false);
      if (action === 'delete') assert.throws(() => store.get(task.id), /TASK_NOT_FOUND/);
      else { assert.equal(store.get(task.id).current_candidate_set_id, null); assert.deepEqual(store.decisions(task.id), []); }
    } finally { store.close(); }
  }
});
test('model exceptions save fixed codes and leave no candidate result', async () => {
  const { store, task } = setup();
  try {
    await assert.rejects(runTaskAnalysis(store, { async analyze() { throw new Error('PRIVATE_RAW_ERROR'); } }, task.id, task.revision));
    assert.equal(store.get(task.id).current_candidate_set_id, null);
    assert.equal(store.get(task.id).phase, 'needs_analysis');
  } finally { store.close(); }
});
test('v1 migration preserves documents/old candidates; v2 snapshot/evidence survive reopening and deletion cascades', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f02-store-')), path = join(dir, 'db.sqlite');
  try {
    const documents = new DocumentStore(path); const doc = documents.save('preserve document'); documents.close();
    const old = new DatabaseSync(path); old.exec('PRAGMA foreign_keys=ON;'+taskSchema);
    old.prepare("INSERT INTO workflow_tasks VALUES('old',1,'needs_analysis',?,?,?,NULL,'now','now')")
      .run(JSON.stringify(context), 'a'.repeat(64), 'b'.repeat(64)); old.close();
    let store = new TaskStore(path);
    assert.equal(store.get('old').revision, 1);
    let task = store.create(context, 'a'.repeat(64), 'b'.repeat(64));
    task = store.analysis.replaceSources(task.id, task.revision, [source()]);
    const job = store.analysis.start(task.id, task.revision); store.analysis.complete(task.id, job.id, result());
    store.close(); store = new TaskStore(path);
    assert.equal(store.analysis.job(task.id, job.id).status, 'succeeded');
    assert.equal(store.analysis.candidates(task.id).length, 2); assert.equal(store.analysis.evidence(task.id).length, 1);
    const raw = new DatabaseSync(path); raw.exec('PRAGMA foreign_keys=ON');
    assert.throws(() => raw.prepare('UPDATE workflow_source_versions SET payload_json=? WHERE task_id=?').run('{}', task.id), /IMMUTABLE/);
    assert.throws(() => raw.prepare('UPDATE workflow_analysis_jobs SET snapshot_json=? WHERE id=?').run('{}', job.id), /IMMUTABLE/);
    store.delete(task.id, store.get(task.id).revision);
    for (const table of ['workflow_source_versions', 'workflow_source_selections', 'workflow_evidence', 'workflow_analysis_jobs', 'workflow_candidate_provenance']) {
      assert.equal(raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE task_id=?`).get(task.id)!.n, 0);
    }
    raw.close(); store.close();
    const reopened = new DocumentStore(path); assert.ok(reopened.list().some(d => d.id === doc.id)); reopened.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
