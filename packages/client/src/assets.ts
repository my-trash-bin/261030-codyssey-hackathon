import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

// 정적 자산은 범위 밖 경로를 절대 내보내지 않는다. next()는 "이 미들웨어 담당 아님"이며
// 호출부(server.ts)가 base 404로 마무리한다.
export type ClientAssets = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

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

const BINARY_TYPE = 'application/octet-stream';

// no-store는 기존 동작 유지다(해시 자산 캐시 최적화는 범위 밖). CSP는 빌드 결과에도 그대로 붙는다.
const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
};

// 인코딩된 경로를 먼저 풀고, NUL·상위 이동·루트 이탈을 모두 404로 돌린다.
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

export function createStaticAssets(root: string): ClientAssets {
  const base = resolve(root);
  return (request, response, next) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') { next(); return; }
    const filePath = resolveAssetPath(base, request.url);
    if (filePath === null) { next(); return; }
    void stat(filePath).then((info) => {
      if (!info.isFile()) { next(); return; }
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? BINARY_TYPE,
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
