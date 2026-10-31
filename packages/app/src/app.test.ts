import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { RealCore } from '@safehandoff/core';
import { createApp, DocumentStore } from '@safehandoff/server';

test('the actual server stores documents while unimplemented generation fails explicitly', async () => {
  const store = new DocumentStore(':memory:');
  const core = new RealCore();
  const server = createServer(createApp(store, core, core));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const saved = await fetch(base + '/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"stored"}' });
    assert.equal(saved.status, 201);
    const result = await fetch(base + '/api/sharing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: 'support', recipient: 'vendor', facts: [{ id: 'a', text: 'approved' }] }) });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error, 'CORE_NOT_IMPLEMENTED');
    const analysis = await fetch(base + '/api/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: { purpose: 'support', recipient: 'vendor' }, sources: [] }) });
    assert.equal(analysis.status, 503);
    assert.equal((await analysis.json()).error, 'CORE_NOT_IMPLEMENTED');
    assert.equal((await fetch(base + '/api/demo/settings')).status, 404);
    assert.equal((await fetch(base + '/__demo')).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
