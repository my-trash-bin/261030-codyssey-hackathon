import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { ModelError } from '@safehandoff/core-interface';
import type { ModelCallOptions, ProviderConfig } from '@safehandoff/core-interface';
import { OpenAICompatibleModelClient } from './index.ts';
const config: ProviderConfig = { type: 'openai_compatible', base_url_env: 'BASE', model_env: 'MODEL', api_key_env: 'KEY',
  response_mode: 'json', supports_system_role: true, send_temperature: false, output_limit_field: 'max_tokens',
  allow_plain_http: true, temperature: 0, max_output_tokens: null, max_input_bytes: 16000, request_timeout_seconds: 2,
  max_attempts_per_step: 2, global_concurrency: 1 };
const output: NonNullable<ModelCallOptions['output']> = { schema: { type: 'object', additionalProperties: false,
  properties: { count: { type: 'integer', minimum: 0, maximum: 10 }, ref: { type: 'string' } }, required: ['count', 'ref'] },
  validate: text => { const data = JSON.parse(text); if (data.ref !== 'approved') throw Error('unknown reference'); return data; } };
const valid = '{"count":2,"ref":"approved"}';
const envelope = (input: string, name = 'submit') => ({ model: 'fixture', usage: { prompt_tokens: 3, completion_tokens: 5 },
  choices: [{ finish_reason: 'tool_calls', message: { content: null,
    tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: input } }] } }] });
async function fixture(t: { after(fn: () => Promise<void>): void }, replies: string[], overrides: Partial<ProviderConfig> = {}, respond: (input: string) => unknown = envelope) {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); requests.push(request);
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    const response = respond(replies[requests.length - 1] ?? valid);
    if (response !== undefined) res.end(JSON.stringify(response));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const client = new OpenAICompatibleModelClient({ ...config, ...overrides }, {
    BASE: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, MODEL: 'fixture', KEY: 'fixture-key' });
  return { client, requests };
}
const request = { role: 'writer' as const, input: 'approved data only', responseFormat: 'json' as const };
const errorCode = (code: string) => (e: unknown) => e instanceof ModelError && e.code === code;
test('typia submission coerces numeric strings and recovers incomplete syntax without another HTTP call', async t => {
  for (const input of ['{"count":"2","ref":"approved"}', '{count:2,ref:"approved",}']) {
    const f = await fixture(t, [input]);
    const result = await f.client.complete(request, { output, onAdditionalCall: () => assert.fail('local correction has no model call') });
    assert.deepEqual(JSON.parse(result.text), JSON.parse(valid)); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].response_format, undefined); assert.equal(f.requests[0].tool_choice.function.name, 'submit');
  }
});
test('SDK repair corrects type and current-reference failures, reports combined usage, and stays in the same role input', async t => {
  for (const invalid of ['{"count":20,"ref":"approved"}', '{"count":2,"ref":"private"}']) {
    const f = await fixture(t, [invalid, valid]); let charged = 0;
    const result = await f.client.complete(request, { output, onAdditionalCall: () => { charged++; } });
    assert.deepEqual(JSON.parse(result.text), JSON.parse(valid)); assert.equal(charged, 1); assert.equal(f.requests.length, 2);
    assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 10 });
    assert.ok(f.requests[1].messages.at(-1).content.startsWith(request.input));
  }
});
test('repair cannot bypass the owning Engine budget and releases concurrency after rejection', async t => {
  const f = await fixture(t, ['{}', valid]);
  await assert.rejects(f.client.complete(request, { output, onAdditionalCall: () => { throw new ModelError('MODEL_BUDGET_EXCEEDED'); } }), errorCode('MODEL_BUDGET_EXCEEDED'));
  assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse((await f.client.complete(request, { output })).text), JSON.parse(valid));
});
test('invalid repairs exhaust the step limit and never return an accepted result', async t => {
  const f = await fixture(t, ['{}', '{}']); let charged = 0;
  await assert.rejects(f.client.complete(request, { output, onAdditionalCall: () => { charged++; } }), errorCode('MODEL_INVALID_RESPONSE'));
  assert.equal(f.requests.length, 2); assert.equal(charged, 1);
});
test('duplicate and escaped duplicate keys are rejected before SDK parsing can erase them', async t => {
  for (const input of ['{"count":1,"count":2,"ref":"approved"}', '{"count":1,"co\\u0075nt":2,"ref":"approved"}', `{"count":1,'co\\u0075nt':2,"ref":"approved"}`]) {
    const f = await fixture(t, [input], { max_attempts_per_step: 1 });
    await assert.rejects(f.client.complete(request, { output }), errorCode('MODEL_INVALID_RESPONSE'));
    assert.equal(f.requests.length, 1);
  }
});

test('plain text and multiple tool calls are rejected without executing a fallback', async t => {
  const text = await fixture(t, [valid], {}, () => ({ choices: [{ message: { content: valid } }] }));
  await assert.rejects(text.client.complete(request, { output }), errorCode('MODEL_INVALID_RESPONSE'));
  assert.equal(text.requests.length, 1);
  const multiple = await fixture(t, [valid], {}, input => {
    const response = envelope(input); response.choices[0]!.message.tool_calls.push({ id: 'second', type: 'function', function: { name: 'submit', arguments: input } }); return response;
  });
  await assert.rejects(multiple.client.complete(request, { output }), errorCode('MODEL_INVALID_RESPONSE'));
  assert.equal(multiple.requests.length, 1);
});
test('an unknown tool name can only be repaired to the local submit tool', async t => {
  const f = await fixture(t, ['{}', valid], {}, input => envelope(input, input === '{}' ? 'invented' : 'submit'));
  assert.deepEqual(JSON.parse((await f.client.complete(request, { output })).text), JSON.parse(valid));
  assert.equal(f.requests.length, 2);
});
test('timeout and cancellation also bound model-backed argument repair', async t => {
  const stalled = await fixture(t, ['{}', 'stall'], { request_timeout_seconds: 0.2 }, input => input === 'stall' ? undefined : envelope(input));
  await assert.rejects(stalled.client.complete(request, { output }), errorCode('MODEL_TIMEOUT'));
  assert.equal(stalled.requests.length, 2);
  const cancelled = await fixture(t, ['{}']); const controller = new AbortController();
  await assert.rejects(cancelled.client.complete(request, { output, signal: controller.signal, onAdditionalCall: () => controller.abort() }), errorCode('MODEL_CANCELLED'));
  assert.equal(cancelled.requests.length, 1);
});
