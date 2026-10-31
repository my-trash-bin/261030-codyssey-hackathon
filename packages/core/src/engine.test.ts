import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CoreError, ModelError } from '@safehandoff/core-interface';
import type { EngineConfig, FactPack, ModelClient, ModelRequest } from '@safehandoff/core-interface';
import { RealCore } from './index.ts';

const config: EngineConfig = {
  provider: { type: 'openai_compatible', base_url_env: 'BASE', model_env: 'MODEL', api_key_env: 'KEY',
    response_mode: 'json', supports_system_role: true, send_temperature: false, output_limit_field: 'max_tokens',
    allow_plain_http: false, temperature: 0, max_output_tokens: 2048, max_input_bytes: 24576,
    request_timeout_seconds: 120, max_attempts_per_step: 2, global_concurrency: 1 },
  workflow: { max_review_repairs: 2, max_model_calls_per_run: 12 }, reproduction: { enabled: false, runner: 'docker' },
};
const pack: FactPack = { schema_version: 'fact_pack.v1', task_revision: 1, template_id: 'support', audience_type: 'vendor',
  output_language: 'ko', approved_brief: 'support', facts: [{ id: 'f_1', kind: 'observation', statement: 'timeout', uncertainty: 'observed' }],
  required_fact_ids: ['f_1'], tables: [], excerpt_slots: [], asset_slots: [], public_tool_results: [] };
const draft = readFileSync(new URL('../../../contracts/examples/draft.valid.json', import.meta.url), 'utf8');
const pass = JSON.stringify({ schema_version: 'review.v1', result: 'pass', issues: [] });
function changes(result = 'needs_changes') {
  return JSON.stringify({ schema_version: 'review.v1', result, issues: [{ target: { kind: 'document' },
    reason_code: 'UNCERTAINTY_REMOVED', action: 'PRIVATE ACTION', approved_fact_ids: ['f_1'], candidate_ids: ['PRIVATE CANDIDATE'],
    internal_explanation: 'PRIVATE EXPLANATION' }] });
}
function setup(responses: (string | Error)[], overrides: Partial<EngineConfig['workflow']> = {}) {
  const requests: ModelRequest[] = [];
  const client: ModelClient = { info: { provider: 'fake', model: 'test', ready: true }, async complete(request) {
    requests.push(request);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.notEqual(response, undefined, 'unexpected model call');
    return { text: response!, model: 'test', usage: { inputTokens: null, outputTokens: null } };
  } };
  return { core: new RealCore(client, { ...config, workflow: { ...config.workflow, ...overrides } }), requests };
}
const code = (expected: string) => (error: unknown) =>
  (error instanceof CoreError || error instanceof ModelError) && error.code === expected;

test('generate keeps the narrow contract and does exactly one writer/reviewer exchange', async () => {
  const { core, requests } = setup([draft, pass]);
  const result = await core.generate({ purpose: 'support', recipient: 'vendor', facts: [{ id: 'f_1', text: 'approved only' }] });
  assert.equal(result.provenance.ready, true);
  assert.equal(result.document.body, '응답 대기 시간이 초과됐습니다.');
  assert.deepEqual(requests.map(request => request.role), ['writer', 'reviewer']);
  assert.equal(JSON.parse(requests[0]!.input).fact_pack.facts[0].statement, 'approved only');
  const failure = setup([draft, changes()]);
  await assert.rejects(failure.core.generate({ purpose: 'support', recipient: 'vendor', facts: [{ id: 'f_1', text: 'approved' }] }), code('CORE_UNAVAILABLE'));
  assert.equal(failure.requests.length, 2);
});
test('repairs carry only validated IDs and fixed reason codes', async () => {
  const { core, requests } = setup([draft, changes(), draft, pass]);
  const result = await core.writeReviewed(pack);
  assert.equal(result.review.result, 'pass');
  assert.deepEqual(JSON.parse(requests[2]!.input).feedback, [{ reason_code: 'UNCERTAINTY_REMOVED', approved_fact_ids: ['f_1'] }]);
  assert.equal(requests[2]!.input.includes('PRIVATE'), false);
});
test('repair limit returns a nonpassing review; needs_decision never triggers disclosure expansion', async () => {
  const limited = setup([draft, changes(), draft, changes()], { max_review_repairs: 1 });
  assert.equal((await limited.core.writeReviewed(pack)).review.result, 'needs_changes');
  assert.equal(limited.requests.length, 4);
  const decision = setup([draft, changes('needs_decision')]);
  assert.equal((await decision.core.writeReviewed(pack)).review.result, 'needs_decision');
  assert.equal(decision.requests.length, 2);
});
test('model failures and invalid JSON retry within step and total budgets', async () => {
  const retry = setup([new ModelError('MODEL_TIMEOUT'), draft, pass]);
  assert.equal((await retry.core.writeReviewed(pack)).review.result, 'pass');
  assert.equal(retry.requests.length, 3);
  const limited = setup(['{}', draft], { max_model_calls_per_run: 2 });
  await assert.rejects(limited.core.writeReviewed(pack), code('MODEL_BUDGET_EXCEEDED'));
  assert.equal(limited.requests.length, 2);
  const attempts = setup(['{}', '{}', draft]);
  await assert.rejects(attempts.core.write(pack), code('MODEL_INVALID_RESPONSE'));
  assert.equal(attempts.requests.length, 2);
});
test('unknown and duplicate fields and unapproved IDs cannot pass model output validation', async () => {
  const unknown = readFileSync(new URL('../../../contracts/examples/draft.unknown.invalid.json', import.meta.url), 'utf8');
  for (const invalid of [unknown, draft.replace('f_1', 'private'), draft.replace('"blocks":', '"blocks":[],"blocks":'),
    draft.replace('"paragraph"', '"asset_ref"'), '{"schema_version":"draft.v1","blocks":[]}']) {
    await assert.rejects(setup([invalid, invalid]).core.write(pack), code('MODEL_INVALID_RESPONSE'));
  }
  for (const invalid of [changes().replace('UNCERTAINTY_REMOVED', 'PRIVATE_CODE'), changes().replace('"f_1"', '"private"'),
    changes().replace('"kind":"document"', '"kind":"block","block_id":"unknown"'), pass.replace('"issues":[]', '"issues":[],"raw":"secret"')]) {
    await assert.rejects(setup([invalid, invalid]).core.review(JSON.parse(draft), pack), code('MODEL_INVALID_RESPONSE'));
  }
});
test('cancellation does not retry and concurrent runs have independent budgets', async () => {
  const cancelled = setup([new ModelError('MODEL_CANCELLED'), draft]);
  await assert.rejects(cancelled.core.write(pack), code('MODEL_CANCELLED'));
  assert.equal(cancelled.requests.length, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(cancelled.core.generate({ purpose: 'p', recipient: 'r', facts: [] }, { signal: controller.signal }), code('CORE_CANCELLED'));
  const concurrent = setup([draft, draft, pass, pass], { max_model_calls_per_run: 2 });
  const results = await Promise.all([concurrent.core.writeReviewed(pack), concurrent.core.writeReviewed(pack)]);
  assert(results.every(result => result.review.result === 'pass'));
});

test('a model pass cannot bypass deterministic required fact coverage', async () => {
  const noReferences = JSON.stringify({ schema_version: 'draft.v1', blocks: [{ type: 'paragraph', text: 'unsupported' }] });
  const { core, requests } = setup([noReferences, pass, draft, pass]);
  const result = await core.writeReviewed(pack);
  assert.equal(result.review.result, 'pass');
  assert.equal(JSON.parse(requests[2]!.input).feedback[0].reason_code, 'MISSING_REQUIRED_FACT');
  const rejected = setup([noReferences, pass]);
  await assert.rejects(rejected.core.generate({ purpose: 'support', recipient: 'vendor', facts: [{ id: 'f_1', text: 'required' }] }), code('CORE_UNAVAILABLE'));
});
