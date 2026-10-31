import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp, DocumentStore } from '@safehandoff/server';
import { configuredCore, configuredTranscripts, loadConfig } from './config.ts';

const root = new URL('../../../', import.meta.url).pathname;
test('public config works without private config and invalid config fails safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safehandoff-config-'));
  try {
    await writeFile(join(dir, 'config.example.json'), await readFile(join(root, 'config.example.json')));
    const config = loadConfig(dir, {});
    assert.equal(config.provider.base_url_env, 'SAFEHANDOFF_LLM_BASE_URL');
    assert.equal(configuredCore(dir, {}).info.ready, false);
    await writeFile(join(dir, 'config.json'), '{"private":"not exposed"}');
    assert.throws(() => loadConfig(dir, {}), /^Error: INVALID_ENGINE_CONFIG$/);
    assert.equal(loadConfig(dir, { SAFEHANDOFF_CONFIG: 'config.example.json' }).provider.type, 'openai_compatible');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('app composition uses example env names for actual HTTP writer/reviewer requests', async () => {
  const model = createServer(async (req, res) => {
    let input = ''; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    assert.equal(req.headers.authorization, 'Bearer local-test');
    const writer = body.messages[0].content.includes('draft.v1');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(writer ?
      { schema_version: 'draft.v1', blocks: [{ type: 'paragraph', text: 'approved', fact_ids: ['f1'] }] } :
      { schema_version: 'review.v1', result: 'pass', issues: [] }) } }] }));
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'safehandoff-compose-'));
  const store = new DocumentStore(':memory:');
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const config = JSON.parse(await readFile(join(root, 'config.example.json'), 'utf8')); config.provider.allow_plain_http = true;
    await writeFile(join(dir, 'config.example.json'), JSON.stringify(config));
    const core = configuredCore(dir, { SAFEHANDOFF_LLM_BASE_URL: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`,
      SAFEHANDOFF_LLM_MODEL: 'mock', SAFEHANDOFF_LLM_API_KEY: 'local-test',
      SAFEHANDOFF_TRANSCRIPT_DIR: 'transcripts', SAFEHANDOFF_TRANSCRIPT_CONTENT: '1' });
    assert.equal(core.info.ready, true);
    server = createServer(createApp(store, core));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sharing`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'support', recipient: 'vendor', facts: [{ id: 'f1', text: 'approved' }] }),
    });
    assert.equal(response.status, 200); assert.equal((await response.json()).document.body, 'approved');
    const files = await readdir(join(dir, 'transcripts'));
    assert.equal(files.length, 1);
    const trace = await readFile(join(dir, 'transcripts', files[0]!), 'utf8');
    assert.equal(trace.includes('local-test'), false);
    assert.equal(trace.includes('127.0.0.1'), false);
    assert.equal(JSON.parse(trace.trim().split('\n').at(-1)!).event, 'run_completed');
  } finally {
    server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve())); store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('transcripts are disabled by default and content requires explicit directory', () => {
  assert.equal(configuredTranscripts(root, {}), undefined);
  assert.throws(() => configuredTranscripts(root, { SAFEHANDOFF_TRANSCRIPT_CONTENT: '1' }), /INVALID_TRANSCRIPT_CONFIG/);
  assert.throws(() => configuredTranscripts(root, { SAFEHANDOFF_TRANSCRIPT_CONTENT: 'true' }), /INVALID_TRANSCRIPT_CONFIG/);
});
