import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { RealCore } from '@safehandoff/core';
import { createWorkflowHandler, TaskStore } from '@safehandoff/server';
import { ModelError } from '@safehandoff/core-interface';
import type { EngineConfig, ModelClient, ModelRequest } from '@safehandoff/core-interface';
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
async function fixture(t: { after(fn: () => Promise<void>): void }, databasePath = ':memory:') {
  let now = Date.parse('2026-10-31T12:00:00Z'), mode = 'pass';
  let writerGate: Promise<void> | undefined; const calls: ModelRequest[] = [];
  const client: ModelClient = { info: { provider: 'fake', model: 'fixture', ready: true }, complete: async request => {
    calls.push(request);
    if (request.role === 'writer' && writerGate) await writerGate;
    const v = JSON.parse(request.input); let value: unknown;
    if (request.role === 'analysis') value = { schema_version: 'candidate_proposals.v1', conflicts: [], candidates: [{ local_key: 'counts',
      kind: 'observation', uncertainty: 'observed', relevance: 'required', purpose_relevance: 'fixture', statement: '가상 요청량',
      evidence_ids: v.evidence.map((e: { id: string }) => e.id) }] };
    else if (request.role === 'writer') value = { schema_version: 'draft.v1', blocks: v.fact_pack.tables.length ?
      v.fact_pack.tables.map((table: { id: string }) => ({ type: 'table_ref', table_id: table.id, fact_ids: [table.id] })) :
      v.fact_pack.facts.map((f: { id: string; statement: string }) => ({ type: 'paragraph', text: f.statement, fact_ids: [f.id] })) };
    else {
      assert.equal(request.role, 'reviewer');
      if (mode === 'unavailable') throw new ModelError('MODEL_UNAVAILABLE');
      value = { schema_version: 'review.v1', result: mode, issues: mode === 'pass' ? [] : [{ target: { kind: 'document' },
        reason_code: 'UNAPPROVED_DISCLOSURE', action: null, approved_fact_ids: [], candidate_ids: [], internal_explanation: 'fixture rejection' }] };
    }
    return { text: JSON.stringify(value), model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  const config = JSON.parse(readFileSync(new URL('../../../config.example.json', import.meta.url), 'utf8')) as EngineConfig;
  const core = new RealCore(client, config, undefined, () => now), store = new TaskStore(databasePath, () => new Date(now));
  let handler: ReturnType<typeof createWorkflowHandler>;
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  handler = createWorkflowHandler(store, core, { token: 'x'.repeat(32), browserOrigin: origin, serverOrigin: origin,
    catalog: { projects: [{ id: 'fixture-project', display_name: '가상 프로젝트' }], recipients: [{ id: 'fixture-vendor', display_name: '가상 공급사' }] } });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await handler.close(); await new Promise<void>(r => server.close(() => r())); store.close(); };
  t.after(close);
  let cookie = '', csrf = '';
  const raw = (path: string, method = 'GET', input?: unknown, key: string = randomUUID(), headers: Record<string, string> = {}) => fetch(origin + '/api/v1' + path, {
    method, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers }, body: input === undefined ? undefined : JSON.stringify(input) });
  const call = async (path: string, method = 'GET', input?: unknown, key?: string) => {
    const r = await raw(path, method, input, key); return { status: r.status, body: await r.json() as any };
  };
  const login = await raw('/session', 'POST', { token: 'x'.repeat(32) }); cookie = login.headers.get('set-cookie')!.split(';')[0]!; csrf = (await login.json() as any).data.csrf_token;
  const poll = async (path: string) => { for (let n = 0; n < 50; n++) { const r = await call(path); if (!['running', 'cancel_requested'].includes(r.body.data?.status)) return r.body.data; } throw Error('local job did not settle'); };
  const intake = { internal_title: 'PRIVATE_INTERNAL_TITLE', project_id: 'fixture-project', purpose_id: 'vendor_support', recipient_id: 'fixture-vendor', audience: 'named_external', skill_ids: [] };
  const create = async (counts = [20, 30, 40]) => {
    const task = (await call('/tasks', 'POST', { intake })).body.data, bytes = 'count\n' + counts.join('\n') + '\n';
    assert.equal((await call(`/tasks/${task.id}/sources`, 'PUT', { expected_revision: 1, sources: [{ id: 'v', source_id: 's', version: 1,
      source_slot: 'requests', format: 'csv', included: true, display_name: 'PRIVATE_SOURCE_NAME.csv', raw_bytes: Buffer.from(bytes).toString('base64'), sha256: sha(bytes) }] })).status, 200);
    const started = await call(`/tasks/${task.id}/jobs`, 'POST', { expected_revision: 2, kind: 'analyze' });
    assert.equal(started.status, 202); await poll(`/tasks/${task.id}/jobs/${started.body.data.id}`);
    return (await call('/tasks/' + task.id)).body.data;
  };
  const allow = async (task: any, reusable = false, expires_at?: string) => {
    const c = task.candidates[0], rep = { kind: 'derived_table', transform_id: 'series_direction_only.v1', parameters: {} };
    const p = (await call(`/tasks/${task.id}/disclosure-previews`, 'POST', { expected_revision: task.revision, candidate_id: c.id, representation: rep })).body.data;
    const r = await call(`/tasks/${task.id}/decision-batches`, 'POST', { expected_revision: task.revision, accept_scope_reduction: false,
      operations: [{ candidate_id: c.id, disposition: 'allow', representation: rep, preview_id: p.preview_id, projection_sha256: p.projection_sha256,
        save_reusable_rule: reusable, ...(expires_at ? { expires_at } : {}) }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const updated = (await call('/tasks/' + task.id)).body.data;
    assert.equal(updated.phase, 'ready_to_generate'); return updated;
  };
  const compose = async (task: any) => {
    const start = await call(`/tasks/${task.id}/jobs`, 'POST', { expected_revision: task.revision, kind: 'compose' });
    assert.equal(start.status, 202, JSON.stringify(start.body)); const job = await poll('/jobs/' + start.body.data.id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job)); return (await call('/artifacts/' + job.artifact_id)).body.data;
  };
  const finalize = (task: any, artifact: any, key?: string) => call(`/tasks/${task.id}/finalize`, 'POST', { expected_revision: artifact.revision,
    artifact_id: artifact.id, expected_artifact_set_hash: artifact.artifact_set_hash, confirmed: true }, key);
  return { close, intake, call, raw, poll, create, allow, compose, finalize, store, core, calls, origin,
    pauseWriter: () => { let release!: () => void; writerGate = new Promise<void>(r => { release = r; }); return () => { writerGate = undefined; release(); }; },
    setMode: (v: string) => { mode = v; }, advanceTime: (ms: number) => { now += ms; } };
}
test('approved-pack composition reviews actual files, finalizes immutable bytes and invalidates export on revoke', async t => {
  const f = await fixture(t), task = await f.allow(await f.create()), artifact = await f.compose(task);
  assert.equal(artifact.hard_errors.length, 0, JSON.stringify({ review: artifact.review, calls: f.calls.map(c => c.role) })); assert.equal(artifact.review_target_hash, artifact.artifact_set_hash);
  assert.equal((await f.call('/tasks/' + task.id)).body.data.phase, 'ready_to_finalize');
  const writers = f.calls.filter(c => c.role === 'writer'); assert.equal(writers.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(writers[0]!.input)), ['fact_pack']);
  assert.ok(!writers[0]!.input.includes('PRIVATE_'));
  assert.ok(f.calls.some(c => c.role === 'reviewer' && JSON.parse(c.input).rendered_files?.length > 0));
  const before = Buffer.from(await (await f.raw(`/artifacts/${artifact.id}/files/support-request.md`)).arrayBuffer());
  const finalized = await f.finalize(task, artifact, 'finalize'); assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  assert.deepEqual((await f.finalize(task, artifact, 'finalize')).body, finalized.body);
  const exported = finalized.body.data;
  const file = await f.raw(`/exports/${exported.id}/files/support-request.md`);
  assert.equal(file.status, 200); assert.deepEqual(Buffer.from(await file.arrayBuffer()), before);
  const zip = Buffer.from(await (await f.raw(`/exports/${exported.id}/archive`)).arrayBuffer());
  assert.equal(sha(zip), exported.archive_sha256); assert.ok(!zip.includes(Buffer.from('PRIVATE_')));
  assert.deepEqual(Buffer.from(await (await f.raw(`/exports/${exported.id}/archive`)).arrayBuffer()), zip);
  const current = (await f.call('/tasks/' + task.id)).body.data;
  assert.equal(current.phase, 'finalized'); assert.equal(current.sources[0].raw_bytes, undefined);
  const decision = Object.values(current.decisions)[0] as any;
  assert.equal((await f.call(`/tasks/${task.id}/decisions/${decision.id}/revoke`, 'POST', { expected_revision: current.revision })).status, 200);
  const invalid = await f.call(`/exports/${exported.id}/archive`); assert.equal(invalid.status, 409); assert.equal(invalid.body.error, 'EXPORT_INVALIDATED');
});
test('reusable transforms recompute from new numeric bytes, version conflicts and revoke affect dependent tasks', async t => {
  const f = await fixture(t); await f.allow(await f.create(), true);
  const rule = (await f.call('/rules')).body.data.rules[0];
  assert.equal(rule.version, 1); assert.ok(!JSON.stringify(rule).includes('PRIVATE_')); assert.deepEqual(Object.keys(JSON.parse(rule.selector)), ['schema_id', 'source_slot', 'column']);
  const task = await f.create([820, 780, 1740]), decision = Object.values(task.decisions)[0] as any;
  assert.equal(decision.applied_rule_id, rule.id);
  const preview = f.store.getPreview(task.id, decision.preview_id);
  assert.deepEqual(preview.projection.rows, [['1', '기준'], ['2', '감소'], ['3', '증가']]);
  const artifact = await f.compose(task), finalized = await f.finalize(task, artifact);
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  const update = { expected_rule_version: 1, representation: rule.representation, expires_at: null };
  assert.equal((await f.call(`/rules/${rule.id}/versions`, 'POST', update)).status, 200);
  assert.equal((await f.call(`/rules/${rule.id}/versions`, 'POST', update)).status, 409);
  assert.equal((await f.call(`/rules/${rule.id}/revoke`, 'POST', { expected_rule_version: 2 })).status, 200);
  assert.equal((await f.call(`/exports/${finalized.body.data.id}/archive`)).body.error, 'EXPORT_INVALIDATED');
  const fresh = await f.create(); assert.deepEqual(fresh.decisions, {});
});
test('edits require a new review, manual review cannot override model rejection, fallback binds the current file hash', async t => {
  const f = await fixture(t), task = await f.allow(await f.create()), artifact = await f.compose(task);
  const edited = await f.call(`/artifacts/${artifact.id}/edit`, 'PUT', { expected_revision: artifact.revision, expected_document_hash: artifact.document_hash, draft: artifact.draft });
  assert.equal(edited.status, 200, JSON.stringify(edited.body)); const a = edited.body.data; assert.ok(a.revision > artifact.revision);
  assert.equal((await f.finalize(task, a)).status, 409);
  assert.equal((await f.call(`/artifacts/${a.id}/edit`, 'PUT', { expected_revision: a.revision, expected_document_hash: a.document_hash,
    draft: { schema_version: 'draft.v1', blocks: [{ type: 'table_ref', table_id: 'unapproved' }] } })).status, 400);
  const human = { expected_revision: a.revision, target_hash: a.artifact_set_hash, checklist: { reviewed_all_files: true, approved_facts_only: true, uncertainty_preserved: true }, fallback_reason: 'fixture only' };
  assert.equal((await f.call(`/artifacts/${a.id}/human-review`, 'POST', human)).status, 400);
  f.setMode('unavailable');
  const start = await f.call(`/tasks/${task.id}/jobs`, 'POST', { expected_revision: a.revision, kind: 'review', arguments: { artifact_id: a.id, expected_artifact_set_hash: a.artifact_set_hash } });
  assert.equal(start.status, 202); const job = await f.poll('/jobs/' + start.body.data.id); assert.equal(job.status, 'failed');
  const fallback = (await f.call(`/tasks/${task.id}/bundle`)).body.data;
  assert.equal(fallback.review_error_code, 'MODEL_UNAVAILABLE');
  const approved = await f.call(`/artifacts/${fallback.id}/human-review`, 'POST', { ...human, expected_revision: fallback.revision, target_hash: fallback.artifact_set_hash });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal((await f.finalize(task, approved.body.data)).status, 200);
});
test('expiry blocks stored downloads without rerunning the model, metadata endpoints expose no original bytes', async t => {
  const f = await fixture(t), task = await f.allow(await f.create(), false, '2026-10-31T12:00:10Z');
  const artifact = await f.compose(task), finalized = await f.finalize(task, artifact); assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  const count = f.calls.length; f.advanceTime(10001);
  assert.equal((await f.call(`/exports/${finalized.body.data.id}/archive`)).body.error, 'EXPORT_INVALIDATED'); assert.equal(f.calls.length, count);
  assert.equal((await f.call(`/tasks/${task.id}`)).body.data.phase, 'needs_attention');
  const catalog = await f.call('/catalog'); assert.equal(catalog.body.data.projects[0].id, 'fixture-project');
  assert.equal((await f.call('/tasks')).body.data.tasks.length, 1);
  const events = (await f.call(`/tasks/${task.id}/events`)).body.data.events;
  assert.ok(events.length > 0); assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
  const runtime = (await f.call('/runtime')).body.data; assert.ok(!JSON.stringify(runtime).includes(f.origin));
  assert.equal((await f.call('/session', 'POST', { token: 'x'.repeat(32) })).status, 401);
  assert.equal((await f.call('/session', 'DELETE')).status, 200);
  assert.equal((await f.call('/tasks')).status, 401);
});
test('conflicting rule results stay undecided and explicit conflicting application rolls back atomically', async t => {
  const f = await fixture(t); await f.allow(await f.create(), true);
  const second = await f.create(), c = second.candidates[0], rep = { kind: 'derived_table', transform_id: 'series_index_base100.v1', parameters: {} };
  const p = (await f.call(`/tasks/${second.id}/disclosure-previews`, 'POST', { expected_revision: second.revision, candidate_id: c.id, representation: rep })).body.data;
  const saved = await f.call(`/tasks/${second.id}/decision-batches`, 'POST', { expected_revision: second.revision, accept_scope_reduction: false,
    operations: [{ candidate_id: c.id, disposition: 'allow', representation: rep, preview_id: p.preview_id, projection_sha256: p.projection_sha256, save_reusable_rule: true }] });
  assert.equal(saved.status, 200);
  const rules = (await f.call('/rules')).body.data.rules; assert.equal(rules.length, 2);
  const fresh = await f.create(); assert.deepEqual(fresh.decisions, {});
  assert.ok((await f.call(`/tasks/${fresh.id}/events`)).body.data.events.some((e: any) => e.kind === 'rule_conflict'));
  const conflict = await f.call(`/tasks/${fresh.id}/rules/apply`, 'POST', { expected_revision: fresh.revision, rule_refs: rules.map((r: any) => ({ id: r.id, version: r.version })) });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'RULE_CONFLICT');
  assert.equal(f.store.get(fresh.id).revision, fresh.revision); assert.deepEqual(f.store.decisions(fresh.id), []);
});
test('latest expired rules never fall back and zero-baseline auto application leaves candidates for a new decision', async t => {
  const f = await fixture(t); await f.allow(await f.create(), true);
  const rule = (await f.call('/rules')).body.data.rules[0], rep = { kind: 'derived_table', transform_id: 'series_index_base100.v1', parameters: {} };
  assert.equal((await f.call(`/rules/${rule.id}/versions`, 'POST', { expected_rule_version: 1, representation: rep, expires_at: '2026-10-31T12:00:01Z' })).status, 200);
  f.advanceTime(1001); const expired = await f.create(); assert.deepEqual(expired.decisions, {});
  assert.equal((await f.call(`/tasks/${expired.id}/rules/apply`, 'POST', { expected_revision: expired.revision, rule_refs: [{ id: rule.id, version: 1 }] })).status, 409);
  assert.equal((await f.call(`/rules/${rule.id}/versions`, 'POST', { expected_rule_version: 2, representation: rep, expires_at: null })).status, 200);
  const zero = await f.create([0, 1, 2]); assert.equal(zero.candidates.length, 1); assert.deepEqual(zero.decisions, {});
  assert.ok((await f.call(`/tasks/${zero.id}/events`)).body.data.events.some((e: any) => e.kind === 'rule_transform_failed'));
  const applied = await f.call(`/tasks/${zero.id}/rules/apply`, 'POST', { expected_revision: zero.revision, rule_refs: [{ id: rule.id, version: 3 }] });
  assert.equal(applied.status, 422); assert.equal(f.store.get(zero.id).revision, zero.revision);
});
test('late composition after source replacement cannot become the current artifact', async t => {
  const f = await fixture(t), task = await f.allow(await f.create()), release = f.pauseWriter();
  try {
    const job = await f.call(`/tasks/${task.id}/jobs`, 'POST', { expected_revision: task.revision, kind: 'compose' });
    assert.equal(job.status, 202);
    const revision = f.store.get(task.id).revision;
    assert.equal((await f.call(`/tasks/${task.id}/sources`, 'PUT', { expected_revision: revision, sources: [] })).status, 200);
    release(); assert.equal((await f.poll('/jobs/' + job.body.data.id)).status, 'stale');
    assert.equal((await f.call(`/tasks/${task.id}/bundle`)).status, 404);
  } finally { release(); }
});
test('composition cancellation reports requested until the worker exits and never adopts a result', async t => {
  const f = await fixture(t), task = await f.allow(await f.create()), release = f.pauseWriter();
  try {
    const job = await f.call(`/tasks/${task.id}/jobs`, 'POST', { expected_revision: task.revision, kind: 'compose' });
    const rev = f.store.get(task.id).revision;
    const cancel = await f.call(`/tasks/${task.id}/jobs/${job.body.data.id}/cancel`, 'POST', { expected_revision: rev });
    assert.equal(cancel.status, 202); assert.equal((await f.call('/jobs/' + job.body.data.id)).body.data.status, 'cancel_requested');
    assert.equal((await f.call('/tasks/' + task.id)).body.data.phase, 'processing');
    release(); assert.equal((await f.poll('/jobs/' + job.body.data.id)).status, 'cancelled');
    assert.equal((await f.call(`/tasks/${task.id}/bundle`)).status, 404);
  } finally { release(); }
});
test('source exclusion, metadata-only source listing and confirmed deletion preserve saved rules', async t => {
  const f = await fixture(t), task = await f.allow(await f.create(), true);
  const listed = (await f.call(`/tasks/${task.id}/sources`)).body.data.sources;
  assert.equal(listed[0].raw_bytes, undefined); assert.equal(listed[0].byte_size, Buffer.byteLength('count\n20\n30\n40\n'));
  assert.equal((await f.call(`/tasks/${task.id}/sources/s`, 'DELETE', { expected_revision: task.revision })).status, 200);
  const current = (await f.call('/tasks/' + task.id)).body.data;
  assert.deepEqual(current.candidates, []); assert.deepEqual(current.decisions, {});
  assert.equal((await f.call(`/tasks/${task.id}/sources`)).body.data.sources[0].included, false);
  assert.equal((await f.call('/tasks/' + task.id, 'DELETE', { expected_revision: current.revision })).status, 400);
  const input = { expected_revision: current.revision, confirmation: 'DELETE', acknowledge_saved_rules_retained: true };
  assert.equal((await f.call('/tasks/' + task.id, 'DELETE', input, 'delete')).status, 200);
  assert.equal((await f.call('/tasks/' + task.id, 'DELETE', input, 'delete')).status, 200);
  const rules = (await f.call('/rules')).body.data.rules; assert.equal(rules.length, 1); assert.ok(!JSON.stringify(rules).includes('PRIVATE_'));
});
test('event streams resume after Last-Event-ID and source selection does not echo original bytes', { timeout: 5000 }, async t => {
  const f = await fixture(t), task = await f.create(), sources = f.store.analysis.sources(task.id);
  const events = (await f.call(`/tasks/${task.id}/events`)).body.data.events, last = events.at(-1).seq;
  const stream = await f.raw(`/tasks/${task.id}/events`, 'GET', undefined, undefined, { Accept: 'text/event-stream', 'Last-Event-ID': String(last) });
  assert.equal(stream.status, 200); const reader = stream.body!.getReader();
  try {
    const first = new TextDecoder().decode((await reader.read()).value); assert.ok(!first.includes('id:'));
    const replaced = await f.call(`/tasks/${task.id}/sources`, 'PUT', { expected_revision: task.revision, sources: sources.map(s => ({ ...s, included: false })) });
    assert.equal(replaced.status, 200); assert.deepEqual(f.store.analysis.sources(task.id), []);
    let received = first;
    while (!received.includes('event: workflow')) received += new TextDecoder().decode((await reader.read()).value);
    assert.ok(received.includes('task_changed')); assert.ok(!received.includes('PRIVATE_'));
    const resumed = (await f.call(`/tasks/${task.id}/events?after=${last}`)).body.data.events;
    assert.ok(resumed.every((e: any) => e.seq > last));
    const selected = await f.call(`/tasks/${task.id}/sources`, 'PUT', { expected_revision: replaced.body.data.revision, sources });
    assert.equal(selected.status, 200); assert.equal(f.store.analysis.sources(task.id).length, 1);
  } finally { await reader.cancel(); }
});
test('human approval cannot override a failed semantic review even when hard checks pass', async t => {
  const f = await fixture(t), task = await f.allow(await f.create()), prior = await f.compose(task); f.setMode('needs_changes');
  const started = await f.call(`/tasks/${task.id}/jobs`, 'POST', { expected_revision: prior.revision, kind: 'review',
    arguments: { artifact_id: prior.id, expected_artifact_set_hash: prior.artifact_set_hash } });
  const job = await f.poll('/jobs/' + started.body.data.id), artifact = (await f.call('/artifacts/' + job.artifact_id)).body.data;
  assert.equal(artifact.review.result, 'needs_changes'); assert.deepEqual(artifact.hard_errors, []);
  const human = await f.call(`/artifacts/${artifact.id}/human-review`, 'POST', { expected_revision: artifact.revision, target_hash: artifact.artifact_set_hash,
    checklist: { reviewed_all_files: true, approved_facts_only: true, uncertainty_preserved: true }, fallback_reason: 'cannot bypass fixture rejection' });
  assert.equal(human.status, 400); assert.equal((await f.finalize(task, artifact)).status, 409);
});
test('a partial evidence list cannot certify an all-rows reusable selector', async t => {
  const f = await fixture(t), original = await f.allow(await f.create(), true);
  const created = (await f.call('/tasks', 'POST', { intake: f.intake })).body.data;
  const sources = f.store.analysis.sources(original.id);
  const replaced = f.store.analysis.replaceSources(created.id, 1, sources), job = f.store.analysis.start(created.id, replaced.revision);
  const analyzed = await f.core.analyze({ task: job.snapshot.task, sources });
  analyzed.evidence = analyzed.evidence.slice(0, 2);
  analyzed.proposals.candidates[0]!.evidence_ids = analyzed.evidence.map(e => e.id);
  assert.equal(f.store.analysis.complete(created.id, job.id, analyzed).adopted, true);
  assert.deepEqual(f.store.decisions(created.id), []);
  const task = (await f.call('/tasks/' + created.id)).body.data;
  assert.equal(task.candidates[0].selector, null);
});
test('rule-bound finalized files and their exact archive survive reopening SQLite', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'safehandoff-export-')), path = join(directory, 'workflow.sqlite');
  const f = await fixture(t, path);
  try {
    await f.allow(await f.create(), true);
    const task = await f.create([2, 1, 3]), artifact = await f.compose(task), finalized = await f.finalize(task, artifact);
    assert.equal(finalized.status, 200); const exportId = finalized.body.data.id;
    const bytes = Buffer.from(await (await f.raw('/exports/' + exportId + '/archive')).arrayBuffer()), count = f.calls.length;
    await f.close();
    const reopened = new TaskStore(path, () => new Date('2026-10-31T12:00:00Z'));
    try {
      const result = reopened.workflow.artifacts.exported(exportId);
      assert.deepEqual(result.zip, bytes); assert.equal(result.sha256, sha(bytes));
      assert.equal(reopened.workflow.rules.bindings(task.id).length, 1); assert.equal(f.calls.length, count);
    } finally { reopened.close(); }
  } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
});
