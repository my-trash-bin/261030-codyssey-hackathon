import { readFile } from 'node:fs/promises';
import type { RequestListener } from 'node:http';
import type { FakeCore, FakeCoreScript } from '@safehandoff/fake-core';
import type { SimulatedConnection, ConnectionPlan } from './connection.ts';

export function createDemoHandler(base: RequestListener, core: FakeCore, connector: SimulatedConnection): RequestListener {
  return async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (request.method === 'GET' && (path === '/__demo' || path === '/__demo.js')) {
      const name = path === '/__demo' ? 'index.html' : 'controls.js';
      response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript');
      response.setHeader('Cache-Control', 'no-store');
      response.end(await readFile(new URL('../public/' + name, import.meta.url))); return;
    }
    if (path !== '/api/demo/settings') { base(request, response); return; }
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'PUT') {
      try {
        if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('INVALID_DEMO_SETTINGS');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size <= 32768) chunks.push(Buffer.from(chunk));
        }
        if (size > 32768) throw new Error('INVALID_DEMO_SETTINGS');
        const value = JSON.parse(Buffer.concat(chunks).toString()) as { script?: FakeCoreScript; connection?: ConnectionPlan };
        const script = value?.script, plan = value?.connection;
        if (!script || !plan || typeof script.title !== 'string' || !script.title.trim() ||
            typeof script.opening !== 'string' || typeof script.closing !== 'string' ||
            !Number.isInteger(plan.delayMs) || plan.delayMs < 0 || plan.delayMs > 30000 ||
            !Number.isInteger(plan.failuresRemaining) || plan.failuresRemaining < 0 || plan.failuresRemaining > 10) {
          throw new Error('INVALID_DEMO_SETTINGS');
        }
        core.configure({ title: script.title, opening: script.opening, closing: script.closing });
        connector.configure({ delayMs: plan.delayMs, failuresRemaining: plan.failuresRemaining });
      } catch { response.statusCode = 400; response.end('{"error":"INVALID_DEMO_SETTINGS"}'); return; }
    } else if (request.method !== 'GET') { response.statusCode = 405; response.end('{}'); return; }
    response.end(JSON.stringify({ script: core.settings(), connection: connector.settings() }));
  };
}
