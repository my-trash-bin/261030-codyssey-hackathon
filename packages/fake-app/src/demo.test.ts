import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { FakeCore } from '@safehandoff/fake-core';
import { SimulatedConnection } from './connection.ts';
import { createApp, DocumentStore } from '@safehandoff/server';
import { createDemoHandler } from './http.ts';

test('demo control changes fake copy and connection failures without modifying the server shell', async () => {
  const store = new DocumentStore(':memory:'), core = new FakeCore(), connector = new SimulatedConnection(core);
  const server = createServer(createDemoHandler(createApp(store, connector), core, connector));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const input = { purpose: 'support', recipient: 'vendor', facts: [{ id: 'a', text: 'approved' }] };
  const generate = () => fetch(base + '/api/sharing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  try {
    assert.equal((await fetch(base + '/__demo')).status, 200);
    const settings = { script: { title: '개선한 연출', opening: '도입', closing: '마무리' }, connection: { delayMs: 0, failuresRemaining: 1 } };
    const changed = await fetch(base + '/api/demo/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    assert.equal(changed.status, 200);
    assert.equal((await generate()).status, 503);
    const result = await (await generate()).json();
    assert.equal(result.document.title, '개선한 연출');
    assert.deepEqual(result.provenance, { implementation: 'fake', connection: 'simulated', ready: true });
    settings.connection.delayMs = -1;
    assert.equal((await fetch(base + '/api/demo/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })).status, 400);
    assert.equal(connector.settings().delayMs, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
