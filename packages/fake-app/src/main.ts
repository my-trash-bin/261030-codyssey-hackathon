import { createDemoApp } from './legacy-app.ts';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DocumentStore } from '@safehandoff/server';
import { FakeCore } from '@safehandoff/fake-core';
import { SimulatedConnection } from './connection.ts';
import { createDemoHandler } from './http.ts';
import type { DemoAssets } from './assets.ts';
import { createStaticAssets } from './assets.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.DEMO_PORT || 8081);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DEMO_PORT must be between 1 and 65535');

// Vite는 개발 실행에서만 필요하다. 정적 import로 두면 배포 실행도 Vite 런타임을 함께 싣는다.
async function devAssets(): Promise<DemoAssets> {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    // Node --watch가 Vite의 임시 설정 번들을 다시 읽고 재시작하지 않게 한다.
    configLoader: 'native',
    appType: 'mpa',
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  return (request, response, next) => { vite.middlewares(request, response, next); };
}

const store = new DocumentStore(resolve(root, process.env.DEMO_DATABASE_PATH || '.local/data/demo.sqlite'));
const core = new FakeCore();
const connector = new SimulatedConnection(core);
const development = import.meta.url.endsWith('.ts');
const assets: DemoAssets = development
  ? await devAssets()
  : createStaticAssets(fileURLToPath(new URL('./static/', import.meta.url)));
const server = createServer(createDemoHandler(createDemoApp(store, connector), core, connector, assets));
server.listen(port, process.env.DEMO_HOST || '0.0.0.0', () => console.log(`demo controls: http://127.0.0.1:${port}/__demo`));
function shutdown(): void { server.close(() => { store.close(); process.exit(0); }); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
