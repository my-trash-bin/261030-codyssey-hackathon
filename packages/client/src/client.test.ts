import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createClientHandler } from './server.ts';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('client serves its own UI and forwards document JSON to the configured server', async () => {
  const forwarded: { method?: string; path?: string; body?: string }[] = [];
  const backend = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    forwarded.push({ method: request.method, path: request.url, body: Buffer.concat(chunks).toString() });
    response.writeHead(request.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
    response.end('{"documents":[]}');
  });
  const serverOrigin = await listen(backend);
  const client = createServer(createClientHandler(serverOrigin));
  const base = await listen(client);
  try {
    assert.equal((await fetch(base + '/style.css')).status, 200);
    for (const path of ['/disclosure.css', '/disclosure-contract.js', '/disclosure-dom.js', '/disclosure-evidence.js']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    const stateModule = await (await fetch(base + '/disclosure-state.js')).text();
    assert.ok(stateModule.includes("from './disclosure-contract.js'"));
    assert.ok(!stateModule.includes("from './disclosure-contract.ts'"));
    const body = JSON.stringify({ text: '가상 문서' });
    const saved = await fetch(base + '/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(saved.status, 201);
    await fetch(base + '/api/documents');
    assert.deepEqual(forwarded, [
      { method: 'POST', path: '/api/documents', body },
      { method: 'GET', path: '/api/documents', body: '' },
    ]);
    assert.equal((await fetch(base + '/private-file')).status, 404);
  } finally { await close(client); await close(backend); }
});

test('the client page remains available when the backend is stopped', async () => {
  const backend = createServer(); const serverOrigin = await listen(backend); await close(backend);
  const client = createServer(createClientHandler(serverOrigin)); const base = await listen(client);
  try {
    assert.equal((await fetch(base)).status, 200);
    const response = await fetch(base + '/api/documents');
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'SERVER_UNAVAILABLE' });
  } finally { await close(client); }
});
