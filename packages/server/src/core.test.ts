import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { CoreError } from '@safehandoff/core-interface';
import type { Core, GenerateRequest } from '@safehandoff/core-interface';
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
