import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { CoreError, ModelError } from '@safehandoff/core-interface';
import type { AnalyzeRequest, AnalyzeResult, Core, Engine, GenerateRequest } from '@safehandoff/core-interface';
import { createApp } from './app.ts';
import { DocumentStore } from './database.ts';

test('server shell forwards only the contract to an injected core, and exposes its errors', async () => {
  const requests: GenerateRequest[] = [];
  let unavailable = false;
  const core: Core = {
    info: { implementation: 'real', connection: 'direct', ready: true },
    async generate(input) {
      if (unavailable) throw new CoreError('CORE_NOT_IMPLEMENTED');
      requests.push(input);
      return { document: { title: 'injected', body: input.facts[0]!.text }, provenance: { ...this.info } };
    },
  };
  const store = new DocumentStore(':memory:'), server = createServer(createApp(store, core));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const input = { purpose: 'support', recipient: 'vendor', facts: [{ id: 'a', text: 'approved' }] };
  async function generate(body: unknown) {
    return fetch(base + '/api/sharing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  try {
    assert.deepEqual(await (await fetch(base + '/api/core')).json(), core.info);
    assert.equal((await generate(input)).status, 200);
    assert.deepEqual(requests, [input]);
    assert.equal((await generate({ ...input, sources: ['private'] })).status, 400);
    assert.equal(requests.length, 1);
    unavailable = true;
    const failed = await generate(input);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'CORE_NOT_IMPLEMENTED' });
    assert.deepEqual(store.list(), []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close();
  }
});

function unimplementedEngine(analyze: Engine['analyze']): Engine {
  const notImplemented = async () => { throw new CoreError('CORE_NOT_IMPLEMENTED'); };
  return {
    info: { implementation: 'real', connection: 'direct', ready: true },
    generate: notImplemented, analyze, proposeDisclosure: notImplemented, preview: notImplemented,
    write: notImplemented, writeReviewed: notImplemented, review: notImplemented, reproduce: notImplemented,
  };
}

test('server exposes analysis only when an engine is injected, and forwards its cancellation', async () => {
  const requests: AnalyzeRequest[] = [];
  let aborted = false;
  const result: AnalyzeResult = { evidence: [], proposals: { schema_version: 'candidate_proposals.v1', candidates: [], conflicts: [] } };
  const engine = unimplementedEngine(async (input, options) => {
    requests.push(input);
    if (!input || typeof input !== 'object' || !('sources' in input)) throw new CoreError('INVALID_CORE_INPUT');
    await new Promise<void>((resolveWait, reject) => {
      options?.signal?.addEventListener('abort', () => { aborted = true; reject(new CoreError('CORE_CANCELLED')); });
      setTimeout(resolveWait, 10);
    });
    return result;
  });
  const store = new DocumentStore(':memory:');
  const withoutEngine = createServer(createApp(store, engine));
  const withEngine = createServer(createApp(store, engine, engine));
  await Promise.all([withoutEngine, withEngine].map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))));
  const baseWithout = `http://127.0.0.1:${(withoutEngine.address() as AddressInfo).port}`;
  const baseWith = `http://127.0.0.1:${(withEngine.address() as AddressInfo).port}`;
  const input: AnalyzeRequest = { task: { purpose: 'support', recipient: 'vendor' }, sources: [] };
  async function analyze(base: string, body: unknown, signal?: AbortSignal) {
    return fetch(base + '/api/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  }
  try {
    const missing = await analyze(baseWithout, input);
    assert.equal(missing.status, 503);
    assert.deepEqual(await missing.json(), { error: 'CORE_NOT_IMPLEMENTED' });
    assert.deepEqual(requests, []);
    assert.equal((await analyze(baseWith, { purpose: 'support' })).status, 400);
    requests.length = 0;
    const unavailableEngine = unimplementedEngine(async () => { throw new ModelError('MODEL_INVALID_RESPONSE'); });
    const unavailableServer = createServer(createApp(store, unavailableEngine, unavailableEngine));
    await new Promise<void>(resolve => unavailableServer.listen(0, '127.0.0.1', resolve));
    try {
      const baseUnavailable = `http://127.0.0.1:${(unavailableServer.address() as AddressInfo).port}`;
      const modelFailed = await analyze(baseUnavailable, input);
      assert.equal(modelFailed.status, 503);
      assert.deepEqual(await modelFailed.json(), { error: 'MODEL_INVALID_RESPONSE' });
    } finally {
      await new Promise<void>((resolve, reject) => unavailableServer.close(error => error ? reject(error) : resolve()));
      unavailableServer.closeAllConnections();
    }
    const ok = await analyze(baseWith, input);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), result);
    const controller = new AbortController();
    const cancelled = analyze(baseWith, input, controller.signal).catch(() => 'client-aborted');
    // Give the request time to actually reach the server before aborting it client-side;
    // otherwise the socket may never be dispatched and the server never sees it at all.
    await new Promise(resolveWait => setTimeout(resolveWait, 5));
    controller.abort();
    assert.equal(await cancelled, 'client-aborted');
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
    assert.equal(aborted, true);
  } finally {
    // The earlier requests leave idle keep-alive sockets; closeAllConnections forces them shut
    // instead of letting plain close() wait out the server's keepAliveTimeout.
    await Promise.all([withoutEngine, withEngine].map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
    store.close();
  }
});
