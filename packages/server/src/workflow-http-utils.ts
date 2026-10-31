import type { IncomingMessage, ServerResponse } from 'node:http';
import { deny } from './workflow-session.ts';
export function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) deny(400, 'INVALID_TASK_INPUT');
  const v = value as Record<string, unknown>;
  if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => ![...required, ...optional].includes(k))) deny(400, 'INVALID_TASK_INPUT');
  return v;
}
export function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) deny(400, 'INVALID_TASK_INPUT'); return value;
}
export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) deny(400, 'INVALID_TASK_INPUT'); return value;
}
export async function body(request: IncomingMessage): Promise<unknown> {
  if (Object.hasOwn(request, 'workflowBody')) return (request as IncomingMessage & { workflowBody: unknown }).workflowBody;
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') deny(415, 'JSON_REQUIRED');
  let size = 0; const buffers: Buffer[] = [];
  for await (const chunk of request) {
    const b = Buffer.from(chunk); size += b.length; if (size <= 1536 * 1024) buffers.push(b);
  }
  if (size > 1536 * 1024) deny(413, 'BODY_TOO_LARGE');
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); } catch { return deny(400, 'INVALID_TASK_INPUT'); }
}
export function send(response: ServerResponse, status: number, data: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
