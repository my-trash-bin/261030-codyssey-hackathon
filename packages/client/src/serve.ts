import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import { createClientHandler } from './server.ts';
import { createStaticAssets } from './assets.ts';
import type { ClientAssets } from './assets.ts';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
};

// 개발 실행에서도 운영과 같은 CSP를 먼저 붙인다. hmr: false라 WebSocket 허용 지시문은 넣지 않는다.
function wrapVite(vite: ViteDevServer): ClientAssets {
  return (request, response, next) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (!path.startsWith('/api/')) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    }
    vite.middlewares(request, response, () => {
      // appType: 'mpa'는 '/'를 문서로 해석하지 않으므로 index.html로 넘긴다.
      if (path === '/') {
        request.url = '/index.html';
        vite.middlewares(request, response, next);
        return;
      }
      next();
    });
  };
}

// Vite는 개발 실행에서만 필요하다. 정적 import로 두면 배포 실행도 Vite 런타임을 함께 싣는다.
async function devAssets(): Promise<ClientAssets> {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    // Node --watch가 Vite의 임시 설정 번들을 다시 읽고 재시작하지 않게 한다.
    configLoader: 'native',
    appType: 'mpa',
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  return wrapVite(vite);
}

const port = Number(process.env.CLIENT_PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CLIENT_PORT must be between 1 and 65535');
const development = import.meta.url.endsWith('.ts');
const assets = development
  ? await devAssets()
  : createStaticAssets(fileURLToPath(new URL('./static/', import.meta.url)));
const server = createServer(createClientHandler(process.env.SERVER_ORIGIN || 'http://127.0.0.1:8080', assets));
server.listen(port, process.env.CLIENT_HOST || '0.0.0.0', () => console.log(`client listening on port ${port}`));
function shutdown(): void { server.close(() => process.exit(0)); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
