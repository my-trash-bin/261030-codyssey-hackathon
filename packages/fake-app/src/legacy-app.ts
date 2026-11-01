// Fixture presentation endpoints only. The real application does not expose these routes.
import { CoreError, parseGenerateRequest } from '@safehandoff/core-interface';
import type { Core } from '@safehandoff/core-interface';
import type { DocumentStore } from '@safehandoff/server';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createDemoApp(store: DocumentStore, core: Core) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    try {
      if (request.method === 'GET') {
        if (path === '/health') send(200, { status: 'ok' });
        else if (path === '/api/core') send(200, core.info);
        else if (path === '/api/documents') send(200, { documents: store.list() });
        else send(path.startsWith('/api/v1/') ? 503 : 404, { error: path.startsWith('/api/v1/') ? 'WORKFLOW_API_DISABLED' : 'NOT_FOUND' });
        return;
      }
      if (request.method !== 'POST' || !['/api/sharing', '/api/documents'].includes(path)) { send(404, { error: 'NOT_FOUND' }); return; }
      if (!request.headers['content-type']?.startsWith('application/json')) { send(415, { error: 'JSON_REQUIRED' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size <= 1048576) chunks.push(bytes); }
      if (size > 1048576) { send(413, { error: 'BODY_TOO_LARGE' }); return; }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (path === '/api/documents') {
        if (!input || typeof input !== 'object' || Object.keys(input).join(',') !== 'text' || typeof input.text !== 'string' || !input.text.trim()) {
          send(400, { error: 'INVALID_DOCUMENT' }); return;
        }
        send(201, { document: store.save(input.text) }); return;
      }
      const controller = new AbortController();
      const abort = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', abort);
      try { send(200, await core.generate(parseGenerateRequest(input), { signal: controller.signal })); }
      finally { response.off('close', abort); }
    } catch (error) {
      if (error instanceof CoreError) send(error.code === 'INVALID_CORE_INPUT' ? 400 : 503, { error: error.code });
      else send(error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? 'INVALID_JSON' : 'DEMO_FAILED' });
    }
  };
}
