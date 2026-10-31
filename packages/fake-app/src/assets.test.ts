import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStaticAssets } from './assets.ts';

test('demo assets serve the built entries and refuse paths above the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'safehandoff-demo-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>SafeHandoff 시연 조절</title>');
  await writeFile(join(root, 'presentation.html'), '<!doctype html><title>CDP 가상 시연</title>');
  await writeFile(join(root, 'presentation.css'), '.panel { display: block; }');
  await writeFile(join(root, 'assets', 'demo.js'), 'export const ready = true;');

  const server = createServer((request, response) => {
    createStaticAssets(root)(request, response, () => { response.writeHead(404); response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const index = await fetch(base + '/index.html');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(base + '/presentation.html')).status, 200);
    const css = await fetch(base + '/presentation.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /^text\/css/);
    const bundle = await fetch(base + '/assets/demo.js');
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('content-type') ?? '', /^text\/javascript/);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    // 인코딩된 상위 이동과 NUL은 정규화 전에 거부한다.
    assert.equal((await fetch(base + '/assets/..%2fmain.ts')).status, 404);
    assert.equal((await fetch(base + '/%00')).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
