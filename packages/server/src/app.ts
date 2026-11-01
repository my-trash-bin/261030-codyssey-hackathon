import { CoreError, ModelError, parseGenerateRequest } from '@safehandoff/core-interface';
import type { AnalyzeRequest, Core, Engine } from '@safehandoff/core-interface';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DocumentStore } from './database.ts';
import { WorkflowHTTPError } from './workflow-session.ts';
import type { WorkflowSessions } from './workflow-session.ts';

const MAX_BODY_BYTES = 1024 * 1024;
// analyze() budgets 1 MiB of decoded source bytes (packages/core/src/evidence-parser.ts); the
// base64 encoding of that plus the task/sources JSON envelope needs headroom above 1 MiB, not
// the same cap as the other routes' much smaller bodies.
const ANALYSIS_MAX_BODY_BYTES = 1536 * 1024;
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function readJSON(request: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size <= maxBytes) chunks.push(buffer);
  }
  if (size > maxBytes) throw new Error('BODY_TOO_LARGE');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
function documentText(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('INVALID_DOCUMENT');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 1 || typeof fields.text !== 'string' || !fields.text.trim()) {
    throw new Error('INVALID_DOCUMENT');
  }
  return fields.text;
}

// Routes that touch raw material, call the model, or persist state share the exact same
// session/CSRF/Host/Origin boundary as /api/v1/* (packages/server/src/workflow-session.ts),
// whenever an operator has turned that boundary on (`sessions` present). docs/features/
// 10-runtime-boundary.md's access rules are not scoped to the workflow API specifically --
// see docs/product/decisions.md's "두 신뢰 경계" entry and core.test.ts's
// "legacy routes share the session boundary once an operator enables it" test for the
// regression this guards against.
// `/health` and `/api/core` stay unguarded: they return no raw material and no model output.
const GUARDED_PATHS = new Set(['/api/sharing', '/api/analysis', '/api/documents']);

export function createApp(store: DocumentStore, core: Core, engine?: Engine,
  workflow?: (request: IncomingMessage, response: ServerResponse) => Promise<void>, sessions?: WorkflowSessions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    try {
      if (sessions && GUARDED_PATHS.has(path)) sessions.require(request, request.method !== 'GET');
      if (path.startsWith('/api/v1/')) {
        if (workflow) await workflow(request, response);
        else json(response, 503, { error: 'WORKFLOW_API_DISABLED' });
      } else if (request.method === 'GET' && path === '/api/core') {
        json(response, 200, core.info);
      } else if (request.method === 'POST' && path === '/api/sharing') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          json(response, 415, { error: 'JSON_REQUIRED' }); return;
        }
        const input = parseGenerateRequest(await readJSON(request));
        const controller = new AbortController();
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        response.once('close', cancel);
        try { json(response, 200, await core.generate(input, { signal: controller.signal })); }
        finally { response.off('close', cancel); }
      } else if (request.method === 'POST' && path === '/api/analysis') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          json(response, 415, { error: 'JSON_REQUIRED' }); return;
        }
        if (!engine) throw new CoreError('CORE_NOT_IMPLEMENTED');
        // analyze() itself strictly validates the whole shape before any model call; the route
        // does not duplicate a separate wire-parser the way parseGenerateRequest does.
        const input = await readJSON(request, ANALYSIS_MAX_BODY_BYTES) as AnalyzeRequest;
        const controller = new AbortController();
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        response.once('close', cancel);
        try { json(response, 200, await engine.analyze(input, { signal: controller.signal })); }
        finally { response.off('close', cancel); }
      } else if (request.method === 'GET' && path === '/health') {
        json(response, 200, { status: 'ok' });
      } else if (request.method === 'GET' && path === '/api/documents') {
        json(response, 200, { documents: store.list() });
      } else if (request.method === 'POST' && path === '/api/documents') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          json(response, 415, { error: 'JSON_REQUIRED' }); return;
        }
        const text = documentText(await readJSON(request));
        json(response, 201, { document: store.save(text) });
      } else {
        json(response, 404, { error: 'NOT_FOUND' });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (error instanceof WorkflowHTTPError) {
        json(response, error.status, { error: error.message });
      } else if (error instanceof CoreError) {
        json(response, error.code === 'INVALID_CORE_INPUT' ? 400 : 503, { error: error.code });
      // analyze() (unlike generate()) does not wrap ModelError as CoreError -- the HTTP
      // boundary maps it the same way generate()'s own ModelError-to-CoreError conversion
      // would, instead of letting it fall through to a misleading 500 STORAGE_FAILED.
      } else if (error instanceof ModelError) {
        json(response, 503, { error: error.code });
      } else if (code === 'BODY_TOO_LARGE') json(response, 413, { error: code });
      else if (code === 'INVALID_DOCUMENT' || error instanceof SyntaxError) json(response, 400, { error: 'INVALID_DOCUMENT' });
      else json(response, 500, { error: 'STORAGE_FAILED' });
    }
  };
}
