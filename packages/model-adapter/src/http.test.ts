import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { ProviderConfig } from '@safehandoff/core-interface';
import { ModelError } from '@safehandoff/core-interface';
import { OpenAICompatibleModelClient } from './index.ts';

const config: ProviderConfig = {
  type: 'openai_compatible', base_url_env: 'BASE', model_env: 'MODEL', api_key_env: 'KEY', response_mode: 'json',
  supports_system_role: true, send_temperature: true, output_limit_field: 'max_tokens', allow_plain_http: true,
  temperature: 0, max_output_tokens: 128, max_input_bytes: 4096, request_timeout_seconds: 1,
  max_attempts_per_step: 2, global_concurrency: 1,
};
async function mock(handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (client: OpenAICompatibleModelClient, base: string) => Promise<void>, overrides: Partial<ProviderConfig> = {}) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const client = new OpenAICompatibleModelClient({ ...config, ...overrides }, { BASE: base, MODEL: 'mock', KEY: 'local-secret' });
  try { await run(client, base); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const code = (expected: string) => (error: unknown) => error instanceof ModelError && error.code === expected;

test('HTTP serializes configured messages and returns text/usage', async () => {
  await mock(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer local-secret');
    let body = ''; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { model: 'mock', messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'facts' }],
      max_tokens: 64, temperature: 0, response_format: { type: 'json_object' } });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], model: 'mock-v1', usage: { prompt_tokens: 3, completion_tokens: 4 } }));
  }, async client => {
    assert.equal(client.info.ready, true);
    assert.deepEqual(await client.complete({ role: 'writer', systemPrompt: 'rules', input: 'facts', maxOutputTokens: 64 }),
      { text: '{"ok":true}', model: 'mock-v1', usage: { inputTokens: 3, outputTokens: 4 } });
  });
});
test('provider capability switches change wire fields', async () => {
  await mock(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { model: 'mock', messages: [{ role: 'user', content: 'rules\n\nfacts' }], max_completion_tokens: 128 });
    res.end('{"choices":[{"message":{"content":"ok"}}]}');
  }, async client => { await client.complete({ role: 'writer', systemPrompt: 'rules', input: 'facts' }); },
  { supports_system_role: false, send_temperature: false, response_mode: 'text', output_limit_field: 'max_completion_tokens' });
});
test('HTTP errors malformed responses and oversize bodies fail without disclosing provider text', async () => {
  for (const body of ['secret provider failure', '{"choices":[]}', '{"choices":[{"message":{"content":""}}]}', 'x'.repeat(1024 * 1024 + 1)]) {
    await mock((_req, res) => res.end(body), async client => {
      await assert.rejects(client.complete({ role: 'writer', input: 'facts' }), code('MODEL_INVALID_RESPONSE'));
    });
  }
  let calls = 0;
  await mock((_req, res) => { calls++; res.writeHead(503); res.end('private diagnostics'); }, async client => {
    await assert.rejects(client.complete({ role: 'writer', input: 'facts' }), code('MODEL_UNAVAILABLE'));
    assert.equal(calls, 1);
  });
});
test('timeouts cancellation and concurrency are bounded', async () => {
  await mock(() => {}, async client => {
    const pending = client.complete({ role: 'writer', input: 'facts' });
    await assert.rejects(client.complete({ role: 'writer', input: 'facts' }), code('MODEL_BUDGET_EXCEEDED'));
    await assert.rejects(pending, code('MODEL_TIMEOUT'));
    const controller = new AbortController();
    const cancelled = client.complete({ role: 'writer', input: 'facts' }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, code('MODEL_CANCELLED'));
  }, { request_timeout_seconds: 0.03 });
});
test('plaintext disabled and input limits prevent any network request', async () => {
  await mock(() => assert.fail('no HTTP call expected'), async (client, base) => {
    await assert.rejects(client.complete({ role: 'writer', input: 'facts' }), code('MODEL_BUDGET_EXCEEDED'));
    const blocked = new OpenAICompatibleModelClient({ ...config, allow_plain_http: false }, { BASE: base, MODEL: 'mock', KEY: 'secret' });
    assert.equal(blocked.info.ready, false);
  }, { max_input_bytes: 1 });
});
