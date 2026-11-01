import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { RealCore } from '@safehandoff/core';
import { createApp } from '@safehandoff/server';

test('actual server exposes only task workflow and metadata routes', async () => {
  const server = createServer(createApp(new RealCore()));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    for (const path of ['/api/documents', '/api/sharing', '/api/analysis']) {
      assert.equal((await fetch(base + path)).status, 404);
      assert.equal((await fetch(base + path, { method: 'POST', body: '{}' })).status, 404);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
