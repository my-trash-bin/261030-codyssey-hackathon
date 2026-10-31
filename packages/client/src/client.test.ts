import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStaticAssets } from './assets.ts';
import { createClientHandler } from './server.ts';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function uiRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'safehandoff-client-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>SafeHandoff</title>');
  await writeFile(join(root, 'style.css'), 'body { margin: 0; }');
  await writeFile(join(root, 'assets', 'app.js'), 'export const ready = true;');
  return root;
}

test('static assets serve the built UI from the root and refuse to leave it', async () => {
  const root = await uiRoot();
  const server = createServer(createClientHandler('http://127.0.0.1:1', createStaticAssets(root)));
  const base = await listen(server);
  try {
    const index = await fetch(base + '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(index.headers.get('cache-control'), 'no-store');
    assert.match(index.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.equal((await fetch(base + '/style.css')).status, 200);
    const script = await fetch(base + '/assets/app.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /^text\/javascript/);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    // 인코딩을 풀기 전 경로로 루트를 벗어나려는 시도는 정규화 뒤 거부한다.
    assert.equal((await fetch(base + '/assets/..%2fserver.ts')).status, 404);
    assert.equal((await fetch(base + '/assets/..%2f..%2fserver.ts')).status, 404);
  } finally { await close(server); }
});

test('client forwards document JSON to the configured server', async () => {
  const forwarded: { method?: string; path?: string; body?: string }[] = [];
  const backend = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    forwarded.push({ method: request.method, path: request.url, body: Buffer.concat(chunks).toString() });
    response.writeHead(request.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
    response.end('{"documents":[]}');
  });
  const serverOrigin = await listen(backend);
  const root = await uiRoot();
  const client = createServer(createClientHandler(serverOrigin, createStaticAssets(root)));
  const base = await listen(client);
  try {
    assert.equal((await fetch(base + '/style.css')).status, 200);
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
  const root = await uiRoot();
  const client = createServer(createClientHandler(serverOrigin, createStaticAssets(root)));
  const base = await listen(client);
  try {
    assert.equal((await fetch(base)).status, 200);
    const response = await fetch(base + '/api/documents');
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'SERVER_UNAVAILABLE' });
  } finally { await close(client); }
});

test('proxy preserves binary download bytes, query cursors and resumable event headers', async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0, 0xff, 0x80, 0x01]); let seen = '';
  const backend = createServer((request, response) => {
    seen = request.url ?? '';
    assert.equal(request.headers['last-event-id'], '42');
    response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="safehandoff.zip"' }); response.end(bytes);
  });
  const origin = await listen(backend), client = createServer(createClientHandler(origin)), base = await listen(client);
  try {
    const response = await fetch(base + '/api/v1/tasks?cursor=fixture', { headers: { 'Last-Event-ID': '42' } });
    assert.equal(seen, '/api/v1/tasks?cursor=fixture');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="safehandoff.zip"');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally { await close(client); await close(backend); }
});
