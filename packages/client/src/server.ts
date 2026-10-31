import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createClientHandler(serverOrigin: string) {
  const target = new URL(serverOrigin);
  if (target.protocol !== 'http:' || target.username || target.password || target.pathname !== '/') {
    throw new Error('SERVER_ORIGIN must be an HTTP origin');
  }
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    try {
      if (path.startsWith('/api/')) {
        const upstream = await fetch(new URL(path, target), {
          method: request.method,
          headers: { 'Content-Type': request.headers['content-type'] || 'application/json' },
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request as unknown as ReadableStream,
          duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(10000),
        } as RequestInit);
        response.writeHead(upstream.status, {
          'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        });
        response.end(await upstream.text());
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405); response.end(); return;
      }
      let body: string, type: string;
      if (path === '/') {
        body = await readFile(new URL('../public/index.html', import.meta.url), 'utf8'); type = 'text/html';
      } else if (path === '/style.css') {
        body = await readFile(new URL('../public/style.css', import.meta.url), 'utf8'); type = 'text/css';
      } else if (path === '/main.js') {
        const sourceMode = import.meta.url.endsWith('.ts');
        body = await readFile(new URL(sourceMode ? './main.ts' : './main.js', import.meta.url), 'utf8');
        if (sourceMode) body = stripTypeScriptTypes(body);
        type = 'text/javascript';
      } else { response.writeHead(404); response.end(); return; }
      response.writeHead(200, {
        'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
      });
      response.end(body);
    } catch {
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'SERVER_UNAVAILABLE' }));
    }
  };
}
