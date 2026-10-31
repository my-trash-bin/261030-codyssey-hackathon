import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';

// F03 쓰기 요청이 실제로 쓰는 헤더만 upstream으로 전달한다.
// 이 화면은 authorization 계열 자격 증명을 만들지 않으므로 전달하지 않는다.
const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-csrf-token',
  'cookie',
  'origin',
] as const;

// 브라우저에 내보내는 모듈은 정확한 이름만 허용한다.
const MODULES: Record<string, string> = {
  '/main.js': 'main',
  '/analysis-view.js': 'analysis-view',
  '/analysis-state.js': 'analysis-state',
  '/disclosure-view.js': 'disclosure-view',
  '/disclosure-state.js': 'disclosure-state',
};

// 다른 API는 기존 10초 제한을 유지한다. 분석은 모델 응답이 그보다 오래 걸릴 수 있으므로
// Engine/ModelClient의 bounded timeout·call budget에 맡기고, 브라우저 연결이 요청 도중
// 끊길 때만 upstream 호출을 취소한다. 여기에 별도 상한을 두면 정상 분석을 잘라낸다.
const API_TIMEOUT_MS = 10000;
const ANALYSIS_PATH = '/api/analysis';

function forwardedHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
  }
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  return headers;
}

function setUpCookie(headers: Headers): string[] | null {
  const source = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof source.getSetCookie !== 'function') return null;
  const values = source.getSetCookie();
  return values.length > 0 ? values : null;
}

export function createClientHandler(serverOrigin: string) {
  const target = new URL(serverOrigin);
  if (target.protocol !== 'http:' || target.username || target.password || target.pathname !== '/') {
    throw new Error('SERVER_ORIGIN must be an HTTP origin');
  }
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    try {
      if (path.startsWith('/api/')) {
        // upstream은 설정된 서버 origin 하나로 고정한다. 경로만 넘기므로 임의 대상 프록시가 아니다.
        const analysis = path === ANALYSIS_PATH && request.method === 'POST';
        const controller = new AbortController();
        // 요청 본문이 다 온 뒤에도 request의 'close'는 발생하므로 취소 신호로 쓰지 않는다.
        // 응답이 끝나기 전에 연결이 닫힌 경우에만 분석 호출을 취소하고, 정리도 여기서 한다.
        const cancelUpstream = (): void => { if (!response.writableEnded) controller.abort(); };
        if (analysis) response.once('close', cancelUpstream);
        try {
          const upstream = await fetch(new URL(path, target), {
            method: request.method,
            headers: forwardedHeaders(request),
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request as unknown as ReadableStream,
            duplex: 'half', redirect: 'error',
            signal: analysis ? controller.signal : AbortSignal.timeout(API_TIMEOUT_MS),
          } as RequestInit);
          const headers: Record<string, string | string[]> = {
            // upstream 응답 형식을 그대로 보존한다. 세션 쿠키가 오면 같은 브라우저로만 돌려준다.
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          };
          const cookies = setUpCookie(upstream.headers);
          if (cookies) headers['Set-Cookie'] = cookies;
          response.writeHead(upstream.status, headers);
          response.end(await upstream.text());
          return;
        } finally {
          // 분석이 아닌 경로는 listener를 붙이지 않았으므로 정리 대상이 없다.
          if (analysis) response.off('close', cancelUpstream);
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405); response.end(); return;
      }
      let body: string, type: string;
      if (path === '/') {
        body = await readFile(new URL('../public/index.html', import.meta.url), 'utf8'); type = 'text/html';
      } else if (path === '/style.css') {
        body = await readFile(new URL('../public/style.css', import.meta.url), 'utf8'); type = 'text/css';
      } else if (Object.hasOwn(MODULES, path)) {
        // 소스 실행은 .ts를 타입 제거해 그대로, 빌드 실행은 컴파일된 .js를 서빙한다.
        const name = MODULES[path] ?? '';
        const sourceMode = import.meta.url.endsWith('.ts');
        body = await readFile(new URL(sourceMode ? `./${name}.ts` : `./${name}.js`, import.meta.url), 'utf8');
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
      // 브라우저가 끊긴 뒤에는 응답을 쓸 수 없다. 분석 취소로 생긴 오류를 502 응답으로 덧쓰지 않는다.
      if (response.headersSent || response.writableEnded || response.destroyed) {
        if (!response.writableEnded) response.destroy();
        return;
      }
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'SERVER_UNAVAILABLE' }));
    }
  };
}
