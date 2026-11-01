import type { Core } from '@safehandoff/core-interface';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDemoApp } from './legacy-app.ts';
import { DocumentStore } from '@safehandoff/server';

test('saved text survives closing and reopening the SQLite database', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'safehandoff-db-'));
  const path = join(folder, 'test.sqlite');
  try {
    const first = new DocumentStore(path);
    const text = "가상 자료\n' ); DROP TABLE documents; -- <script>alert(1)</script>";
    const saved = first.save(text);
    first.close();
    const reopened = new DocumentStore(path);
    try { assert.deepEqual(reopened.list().map(row => ({ ...row })), [saved]); }
    finally { reopened.close(); }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('HTTP saves and lists documents; invalid input does not create rows', async () => {
  const store = new DocumentStore(':memory:');
  const core: Core = { info: { implementation: 'real', connection: 'direct', ready: false },
    async generate() { throw new Error('must not call core when saving'); } };
  const server = createServer(createDemoApp(store, core));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    const created = await fetch(base + '/api/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '테스트 문서' }),
    });
    assert.equal(created.status, 201);
    const { document } = await created.json();
    assert.equal(document.text, '테스트 문서');
    for (const body of ['{}', '{', '{"text":""}', '{"text":123}', '{"text":"valid","unexpected":true}']) {
      const response = await fetch(base + '/api/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      assert.equal(response.status, 400, body);
    }
    assert.equal((await fetch(base + '/api/documents', { method: 'POST', body: 'not JSON' })).status, 415);
    const oversized = await fetch(base + '/api/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const listed = await (await fetch(base + '/api/documents')).json();
    assert.equal(listed.documents.length, 1);
    assert.equal(listed.documents[0].id, document.id);
    assert.equal((await fetch(base + '/api/v1/tasks')).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});
