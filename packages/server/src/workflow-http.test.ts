import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { AnalyzeResult, Engine } from '@safehandoff/core-interface';
import { excerpt } from './source-views.ts';
import { createWorkflowHandler } from './workflow-http.ts';
import { TaskStore } from './task-store.ts';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const context = { purpose: '가상 테스트', recipient: '가상 수신자' };
const source = { id: 'version', source_id: 'source', version: 1, display_name: 'fictional.txt', format: 'txt', source_slot: 'input',
  included: true, raw_bytes: Buffer.from('fictional').toString('base64'), sha256: sha('fictional') };
const evidence = { id: 'ev', source_version_id: 'version', start: 0, end: 9, evidence_sha256: source.sha256, locator: { kind: 'byte_range' } };
const proposal = { local_key: 'local', kind: 'observation', statement: '가상 사실', uncertainty: 'observed', relevance: 'optional',
  evidence_ids: ['ev'], purpose_relevance: 'test' };
const analysis = { evidence: [evidence], proposals: { schema_version: 'candidate_proposals.v1', candidates: [proposal], conflicts: [] } } as AnalyzeResult;
async function fixture(t: { after(fn: () => Promise<void>): void }, engineOverrides: Partial<Engine> = {}) {
  const store = new TaskStore(':memory:'); let calls = 0;
  const engine = { analyze: async () => { calls++; return analysis; }, preview: async (c, rep, rev) => {
    const projection = { statement: c.statement, columns: [], rows: [] };
    return { schema_version: 'disclosure_preview.v1', candidate_id: c.local_key, input_revision: rev, preview_id: 'from-engine',
      representation: rep, projection, projection_sha256: sha(JSON.stringify(projection)), raw_grants: [] };
  }, ...engineOverrides } as Engine;
  let handler: ReturnType<typeof createWorkflowHandler>;
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  handler = createWorkflowHandler(store, engine, { token: 't'.repeat(32), browserOrigin: origin, serverOrigin: origin });
  t.after(async () => { await handler.close(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  let cookie = '', csrf = '';
  const call = async (path: string, method = 'GET', input?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(origin + '/api/v1' + path, { method, headers: { ...(method === 'GET' ? {} :
      { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'X-CSRF-Token': csrf }), Cookie: cookie, ...headers },
      body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, body: await response.json() as any, headers: response.headers };
  };
  const login = await call('/session', 'POST', { token: 't'.repeat(32) });
  cookie = login.headers.get('set-cookie')!.split(';')[0]!; csrf = login.body.data.csrf_token;
  return { origin, store, call, calls: () => calls, setCookie: (v: string) => { cookie = v; } };
}
test('authenticated HTTP task analysis adopts once, restores permanent mappings and requires exact revision', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/session')).status, 200);
  const create = await f.call('/tasks', 'POST', { context }, { 'Idempotency-Key': 'create' });
  const id = create.body.data.id;
  assert.equal((await f.call('/tasks', 'POST', { context }, { 'Idempotency-Key': 'create' })).body.data.id, id);
  assert.equal((await f.call('/tasks', 'POST', { context: { ...context, purpose: 'other' } }, { 'Idempotency-Key': 'create' })).status, 409);
  assert.equal((await f.call(`/tasks/${id}/sources`, 'PUT', { expected_revision: 1, sources: [source] })).status, 200);
  const job = await f.call(`/tasks/${id}/jobs`, 'POST', { expected_revision: 2, kind: 'analyze' }, { 'Idempotency-Key': 'analyze' });
  assert.equal(job.status, 202);
  assert.equal((await f.call(`/tasks/${id}/jobs`, 'POST', { expected_revision: 2, kind: 'analyze' }, { 'Idempotency-Key': 'analyze' })).status, 202);
  const get = await f.call(`/tasks/${id}`), task = get.body.data;
  assert.equal(task.revision, 4); assert.equal(f.calls(), 1);
  assert.equal(task.candidates[0].local_key, 'local'); assert.notEqual(task.candidates[0].id, 'local');
  assert.deepEqual(task.decisions, {}); assert.equal(task.evidence[0].id, 'ev');
  const state = await f.call(`/tasks/${id}/jobs/${job.body.data.id}`);
  assert.equal(state.body.data.status, 'succeeded'); assert.equal(state.body.data.snapshot, undefined);
  assert.equal((await f.call(`/tasks/${id}/sources`, 'PUT', { expected_revision: 1, sources: [] })).status, 409);
  assert.equal((await f.call(`/tasks/${id}/jobs`, 'POST', { expected_revision: 4, kind: 'unknown' })).status, 422);
});
test('session, csrf and Host/Origin reject unauthorized requests without mutation', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/tasks', 'POST', { context }, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await f.call('/tasks', 'POST', { context }, { Origin: 'http://evil.invalid' })).status, 403);
  const hostStatus = await new Promise<number>(resolve => {
    const req = httpRequest(f.origin + '/api/v1/session', { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode!); });
    req.end();
  });
  assert.equal(hostStatus, 403);
  f.setCookie(''); assert.equal((await f.call('/tasks/unknown')).status, 401);
});
test('preview, atomic batch and revoke support retry and reject foreign/stale references', async t => {
  const f = await fixture(t), task = f.store.create(context, sha('[]'), sha('[]'));
  const updated = f.store.analysis.addManual(task.id, 1, { candidate: { kind: 'observation', statement: 'manual', uncertainty: 'reported', relevance: 'optional', purpose_relevance: 'test' }, user_note: 'note' });
  const c = f.store.analysis.candidates(task.id)[0]!, path = `/tasks/${task.id}`;
  const rep = { kind: 'fact_summary', transform_id: '', parameters: {} };
  const p = await f.call(path + '/disclosure-previews', 'POST', { expected_revision: updated.revision, candidate_id: c.id, representation: rep });
  assert.equal(p.status, 200);
  const op = { candidate_id: c.id, disposition: 'allow', representation: rep, preview_id: p.body.data.preview_id,
    projection_sha256: p.body.data.projection_sha256, save_reusable_rule: false };
  const batch = { expected_revision: updated.revision, accept_scope_reduction: false, operations: [op] };
  const invalid = await f.call(path + '/decision-batches', 'POST', { ...batch, operations: [op, { candidate_id: 'foreign', disposition: 'exclude' }] });
  assert.equal(invalid.status, 400); assert.deepEqual(f.store.decisions(task.id), []);
  assert.equal((await f.call(path + '/decision-batches', 'POST', batch, { 'Idempotency-Key': 'batch' })).status, 200);
  assert.equal((await f.call(path + '/decision-batches', 'POST', batch, { 'Idempotency-Key': 'batch' })).status, 200);
  assert.equal(f.store.get(task.id).revision, updated.revision + 1);
  const decision = f.store.decisions(task.id)[0]!;
  const revoke = { expected_revision: updated.revision + 1 };
  assert.equal((await f.call(path + `/decisions/${decision.id}/revoke`, 'POST', revoke, { 'Idempotency-Key': 'revoke' })).status, 200);
  assert.equal((await f.call(path + `/decisions/${decision.id}/revoke`, 'POST', revoke, { 'Idempotency-Key': 'revoke' })).status, 200);
  assert.deepEqual(f.store.effectiveAllows(task.id), []);
  assert.equal((await f.call(path + '/decision-batches', 'POST', batch)).status, 409);
});
test('comparison and source content show originals only behind the session and follow current decisions', async t => {
  const f = await fixture(t);
  const id = (await f.call('/tasks', 'POST', { context })).body.data.id, path = `/tasks/${id}`;
  await f.call(path + '/sources', 'PUT', { expected_revision: 1, sources: [source] });
  await f.call(path + '/jobs', 'POST', { expected_revision: 2, kind: 'analyze' });
  const task = (await f.call(path)).body.data;
  assert.equal(JSON.stringify(task).includes(source.raw_bytes), false);
  const before = (await f.call(path + '/disclosure-comparison')).body.data;
  assert.equal(before.input_revision, task.revision);
  assert.deepEqual(before.sources, [{ id: 'version', display_name: 'fictional.txt', format: 'txt', byte_size: 9 }]);
  const row = before.candidates[0];
  assert.equal(row.statement, '가상 사실'); assert.equal(row.disposition, null); assert.equal(row.disclosed, null);
  assert.equal(row.originals[0].text, 'fictional'); assert.equal(row.originals[0].truncated, false);
  assert.equal(JSON.stringify(before).includes('raw_bytes'), false);
  assert.equal((await f.call(path + '/sources/version/content')).body.data.text, 'fictional');
  assert.equal((await f.call(path + '/sources/foreign/content')).status, 404);
  const saved = await f.call(path + '/decision-batches', 'POST', { expected_revision: task.revision, accept_scope_reduction: false,
    operations: [{ candidate_id: row.candidate_id, disposition: 'exclude' }] });
  assert.equal(saved.status, 200);
  const after = (await f.call(path + '/disclosure-comparison')).body.data.candidates[0];
  assert.equal(after.disposition, 'exclude'); assert.equal(after.disclosed, null); assert.equal(after.originals[0].text, 'fictional');
  f.setCookie('');
  assert.equal((await f.call(path + '/disclosure-comparison')).status, 401);
  assert.equal((await f.call(path + '/sources/version/content')).status, 401);
});
test('excerpt caps long spans and never ends on a split UTF-8 character', () => {
  const bytes = Buffer.from('가'.repeat(1000));
  const capped = excerpt(bytes, 0, bytes.length);
  assert.equal(capped.truncated, true); assert.equal(capped.text, '가'.repeat(682));
  assert.deepEqual(excerpt(bytes, 0, 3), { text: '가', truncated: false });
});
test('late model completion after HTTP cancellation never creates candidates or permission', async t => {
  let resolve!: (value: AnalyzeResult) => void, signal: AbortSignal | undefined;
  const waiting = new Promise<AnalyzeResult>(r => { resolve = r; });
  const f = await fixture(t, { analyze: async (_request, options) => { signal = options?.signal; return waiting; } });
  const task = (await f.call('/tasks', 'POST', { context })).body.data;
  const base = '/tasks/' + task.id;
  await f.call(base + '/sources', 'PUT', { expected_revision: 1, sources: [source] });
  const started = await f.call(base + '/jobs', 'POST', { expected_revision: 2, kind: 'analyze' });
  const job = started.body.data.id;
  const cancel = await f.call(base + `/jobs/${job}/cancel`, 'POST', { expected_revision: 3 });
  assert.equal(cancel.status, 202); assert.equal(signal?.aborted, true);
  resolve(analysis);
  const status = await f.call(base + `/jobs/${job}`);
  assert.equal(status.body.data.status, 'cancelled');
  assert.deepEqual(f.store.analysis.candidates(task.id), []); assert.deepEqual(f.store.decisions(task.id), []);
});
test('session expiry and duplicate cookies cannot keep authorization alive', async () => {
  const { WorkflowSessions } = await import('./workflow-session.ts');
  let now = 0, cookie = '';
  const sessions = new WorkflowSessions({ token: 'x'.repeat(32), browserOrigin: 'http://127.0.0.1:5173', serverOrigin: 'http://127.0.0.1:8080' }, () => now);
  const request = { headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:5173' } } as import('node:http').IncomingMessage;
  const response = { setHeader: (_name: string, value: string) => { cookie = value; } } as unknown as import('node:http').ServerResponse;
  const data = sessions.open(request, response, 'x'.repeat(32));
  assert.ok(cookie.includes('HttpOnly; SameSite=Strict; Path=/'));
  request.headers.cookie = cookie.split(';')[0];
  request.headers['x-csrf-token'] = data.csrf_token;
  assert.equal(sessions.require(request, true).csrf_token, data.csrf_token);
  request.headers.cookie += '; ' + request.headers.cookie;
  assert.throws(() => sessions.require(request, false), /AUTH_REQUIRED/);
  request.headers.cookie = cookie.split(';')[0]; now = 28800001;
  assert.throws(() => sessions.require(request, false), /AUTH_REQUIRED/);
});
test('disclosure cancellation and confirmed deletion wait for physical exit and reject new task writes', async t => {
  let release!: () => void, aborted!: () => void;
  const waiting = new Promise<void>(r => { release = r; }), stopped = new Promise<void>(r => { aborted = r; });
  const f = await fixture(t, { proposeDisclosure: async (candidate, _task, options) => {
    options?.signal?.addEventListener('abort', aborted, { once: true }); await waiting;
    return { schema_version: 'disclosure_proposal.v1', candidate_id: candidate.local_key, status: 'unsupported', representation: null, requires_clarification: false };
  } });
  const task = f.store.create(context, sha('[]'), sha('[]'));
  const added = f.store.analysis.addManual(task.id, 1, { candidate: { kind: 'observation', statement: 'manual', uncertainty: 'reported', relevance: 'optional', purpose_relevance: 'test' }, user_note: 'note' });
  const candidate = f.store.analysis.candidates(task.id)[0]!;
  const startInput = { expected_revision: added.revision, kind: 'interpret_disclosure', arguments: { candidate_id: candidate.id, text: 'fixture' } };
  const started = await f.call(`/tasks/${task.id}/jobs`, 'POST', startInput); assert.equal(started.status, 202);
  try {
    const deletion = f.call(`/tasks/${task.id}`, 'DELETE', { expected_revision: added.revision, confirmation: 'DELETE', acknowledge_saved_rules_retained: true });
    await stopped; assert.equal(f.store.get(task.id).id, task.id);
    assert.equal((await f.call(`/tasks/${task.id}/jobs`, 'POST', startInput)).status, 409);
    release(); assert.equal((await deletion).status, 200);
    assert.equal((await f.call(`/tasks/${task.id}`)).status, 404);
  } finally { release(); }
});
