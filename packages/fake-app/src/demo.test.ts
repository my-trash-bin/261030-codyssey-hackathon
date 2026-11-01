import { createDemoApp } from './legacy-app.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FakeCore } from '@safehandoff/fake-core';
import { SimulatedConnection } from './connection.ts';
import { DocumentStore } from '@safehandoff/server';
import { createDemoHandler } from './http.ts';
import { createStaticAssets } from './assets.ts';

async function staticRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'safehandoff-demo-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><html lang="ko"><body><div id="root"></div><p>가짜 코어·연결부 연출 조절</p></body></html>');
  await writeFile(join(root, 'assets', 'demo.js'), 'export const ready = true;');
  return root;
}

test('demo control changes fake copy and connection failures without modifying the server shell', async () => {
  const store = new DocumentStore(':memory:'), core = new FakeCore(), connector = new SimulatedConnection(core);
  const assets = createStaticAssets(await staticRoot());
  const server = createServer(createDemoHandler(createDemoApp(store, connector), core, connector, assets));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const input = { purpose: 'support', recipient: 'vendor', facts: [{ id: 'a', text: 'approved' }] };
  const generate = () => fetch(base + '/api/sharing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  try {
    const demo = await fetch(base + '/__demo');
    assert.equal(demo.status, 200);
    assert.match(demo.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(demo.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await demo.text(), /연출 조절/);
    assert.equal((await fetch(base + '/__presentation')).status, 404);
    assert.equal((await fetch(base + '/assets/demo.js')).status, 200);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    assert.equal((await fetch(base + '/__presentation/../../config.json')).status, 404);
    assert.equal((await fetch(base + '/elsewhere')).status, 404);
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
    assert.equal((await fetch(base + '/api/demo/settings', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'nope' })).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
