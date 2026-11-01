import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { RealCore } from '@safehandoff/core';
import { createWorkflowHandler, TaskStore } from '@safehandoff/server';
import type { EngineConfig, ModelClient } from '@safehandoff/core-interface';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('real engine parses CSV, HTTP adopts server IDs, selected-field preview and human decision remain separate', async t => {
  let analyzeCalls = 0, disclosureCalls = 0;
  const client: ModelClient = { info: { provider: 'fake', model: 'fixture', ready: true }, complete: async request => {
    const input = JSON.parse(request.input);
    if (request.role === 'analysis') {
      analyzeCalls++;
      return { text: JSON.stringify({ schema_version: 'candidate_proposals.v1', conflicts: [], candidates: [{
        local_key: 'proposal', kind: 'observation', uncertainty: 'observed', relevance: 'optional', purpose_relevance: 'test',
        statement: '가상 관찰', evidence_ids: input.evidence.map((e: { id: string }) => e.id),
      }] }), model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
    }
    assert.equal(request.role, 'disclosure'); disclosureCalls++;
    return { text: JSON.stringify({ schema_version: 'disclosure_proposal.v1', candidate_id: input.candidate.local_key,
      status: 'supported', representation: { kind: 'selected_fields', transform_id: 'select_fields.v1', parameters: { fields: ['count'] } },
      requires_clarification: false }), model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  const core = new RealCore(client, JSON.parse(readFileSync(new URL('../../../config.example.json', import.meta.url), 'utf8')) as EngineConfig);
  const store = new TaskStore(':memory:'); let handler: ReturnType<typeof createWorkflowHandler>;
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  handler = createWorkflowHandler(store, core, { browserOrigin: origin, serverOrigin: origin });
  t.after(async () => { await handler.close(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  let cookie = '', csrf = '';
  const call = async (path: string, method = 'GET', input?: unknown, key: string = randomUUID()) => {
    const response = await fetch(origin + '/api/v1' + path, { method, headers: { Origin: origin, Cookie: cookie,
      'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': key }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, body: await response.json() as any, cookie: response.headers.get('set-cookie') };
  };
  const session = await call('/session', 'POST', {});
  cookie = session.cookie!.split(';')[0]!; csrf = session.body.data.csrf_token;
  const created = await call('/tasks', 'POST', { context: { purpose: 'support', recipient: 'fictional' } }, 'create');
  const id = created.body.data.id, base = '/tasks/' + id;
  const raw = 'secret,count\nprivate,2\nhidden,5\n';
  await call(base + '/sources', 'PUT', { expected_revision: 1, sources: [{ id: 'v', source_id: 's', version: 1, display_name: 'fictional.csv',
    format: 'csv', source_slot: 'input', included: true, raw_bytes: Buffer.from(raw).toString('base64'), sha256: sha(raw) }] });
  const started = await call(base + '/jobs', 'POST', { expected_revision: 2, kind: 'analyze' }, 'analyze');
  assert.equal(started.status, 202);
  // Poll only a deterministic local job; no time-based assertions or model-quality judgment.
  let task = (await call(base)).body.data;
  for (let n = 0; n < 20 && task.revision !== 4; n++) task = (await call(base)).body.data;
  assert.equal(task.revision, 4); assert.equal(analyzeCalls, 1);
  const c = task.candidates[0].id;
  assert.deepEqual((await call(base + `/candidates/${c}/fields`)).body.data.fields, ['secret', 'count']);
  const rep = { kind: 'selected_fields', transform_id: 'select_fields.v1', parameters: { fields: ['count'] } };
  const input = { expected_revision: 4, candidate_id: c, representation: rep };
  const preview = await call(base + '/disclosure-previews', 'POST', input, 'preview');
  assert.equal(preview.status, 200); assert.deepEqual(preview.body.data.projection.rows, [['2'], ['5']]);
  assert.ok(!JSON.stringify(preview.body).includes('private')); assert.deepEqual(store.decisions(id), []);
  const bad = await call(base + '/disclosure-previews', 'POST', { ...input, representation: { ...rep, parameters: { fields: ['missing'] } } });
  assert.equal(bad.status, 400);
  const job = await call(base + '/jobs', 'POST', { expected_revision: 4, kind: 'interpret_disclosure', arguments: { candidate_id: c, text: 'count만' } });
  let result = (await call('/jobs/' + job.body.data.id)).body.data;
  for (let n = 0; n < 20 && result.status === 'running'; n++) result = (await call('/jobs/' + job.body.data.id)).body.data;
  assert.equal(result.status, 'succeeded'); assert.equal(disclosureCalls, 1); assert.deepEqual(store.decisions(id), []);
  const operation = { candidate_id: c, disposition: 'allow', representation: rep,
    preview_id: preview.body.data.preview_id, projection_sha256: preview.body.data.projection_sha256, save_reusable_rule: false };
  const batch = { expected_revision: 4, accept_scope_reduction: false, operations: [operation] };
  assert.equal((await call(base + '/decision-batches', 'POST', { ...batch, operations: [{ ...operation, save_reusable_rule: true }] })).status, 422);
  assert.equal((await call(base + '/decision-batches', 'POST', batch)).status, 200);
  assert.equal(store.effectiveAllows(id).length, 1);
  const retry = await call(base + '/disclosure-previews', 'POST', input, 'preview');
  assert.equal(retry.body.data.preview_id, preview.body.data.preview_id);
  assert.equal((await call(base + '/disclosure-previews', 'POST', input)).status, 409);
  assert.equal((await call(base, 'DELETE', { expected_revision: 5, confirmation: 'DELETE', acknowledge_saved_rules_retained: true })).status, 200);
  assert.equal((await call(base)).status, 404);
  const tombstone = await call('/tasks', 'POST', { context: { purpose: 'support', recipient: 'fictional' } }, 'create');
  assert.deepEqual(tombstone.body.data, { id, deleted: true });
});
