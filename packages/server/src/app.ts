import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DocumentStore } from './database.ts';

const MAX_BODY_BYTES = 1024 * 1024;
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function readText(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size <= MAX_BODY_BYTES) chunks.push(buffer);
  }
  if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('INVALID_DOCUMENT');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 1 || typeof fields.text !== 'string' || !fields.text.trim()) {
    throw new Error('INVALID_DOCUMENT');
  }
  return fields.text;
}

export function createApp(store: DocumentStore) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    try {
      if (request.method === 'GET' && path === '/health') {
        json(response, 200, { status: 'ok' });
      } else if (request.method === 'GET' && path === '/api/documents') {
        json(response, 200, { documents: store.list() });
      } else if (request.method === 'POST' && path === '/api/documents') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          json(response, 415, { error: 'JSON_REQUIRED' }); return;
        }
        const text = await readText(request);
        json(response, 201, { document: store.save(text) });
      } else {
        json(response, 404, { error: 'NOT_FOUND' });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'BODY_TOO_LARGE') json(response, 413, { error: code });
      else if (code === 'INVALID_DOCUMENT' || error instanceof SyntaxError) json(response, 400, { error: 'INVALID_DOCUMENT' });
      else json(response, 500, { error: 'STORAGE_FAILED' });
    }
  };
}
