import type { Core } from '@safehandoff/core-interface';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createApp(core: Core, workflow?: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (path.startsWith('/api/v1/') && workflow) { await workflow(request, response); return; }
    const value = request.method === 'GET' && path === '/health' ? { status: 'ok' }
      : request.method === 'GET' && path === '/api/core' ? core.info : null;
    const status = value ? 200 : path.startsWith('/api/v1/') && !workflow ? 503 : 404;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value ?? { error: status === 503 ? 'WORKFLOW_API_DISABLED' : 'NOT_FOUND' }));
  };
}
