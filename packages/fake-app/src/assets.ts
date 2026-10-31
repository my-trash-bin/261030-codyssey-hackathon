import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

// 연출 화면의 정적 자산. 패키지 경계상 client 구현을 import할 수 없어 같은 규칙을 여기 둔다.
export type DemoAssets = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
};

function resolveAssetPath(root: string, rawUrl: string | undefined): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(rawUrl || '/', 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname.split('/').some((segment) => segment === '..')) return null;
  const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

export function createStaticAssets(root: string): DemoAssets {
  const base = resolve(root);
  return (request, response, next) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') { next(); return; }
    const filePath = resolveAssetPath(base, request.url);
    if (filePath === null) { next(); return; }
    void stat(filePath).then((info) => {
      if (!info.isFile()) { next(); return; }
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(info.size),
        ...SECURITY_HEADERS,
      });
      if (method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(filePath);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    }, () => next());
  };
}
