import { createDemoApp } from './legacy-app.ts';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createWorkflowHandler, DocumentStore, TaskStore, WorkflowSessions } from '@safehandoff/server';
import type { WorkflowAccess } from '@safehandoff/server';
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
const taskStore = new TaskStore(resolve(root, process.env.DEMO_TASK_DATABASE_PATH || '.local/data/demo-workflow.sqlite'));
const access: WorkflowAccess = {
  analysisProviderOrigin: null,
  modelStatus: { model_id: 'fake-demo', model_setup: { missing: [] } },
  browserOrigin: process.env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN || 'http://127.0.0.1:5174',
  serverOrigin: process.env.SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN || `http://127.0.0.1:${port}`,
};
const workflow = createWorkflowHandler(taskStore, core, access, new WorkflowSessions(access));
const development = import.meta.url.endsWith('.ts');
const assets: DemoAssets = development
  ? await devAssets()
  : createStaticAssets(fileURLToPath(new URL('./static/', import.meta.url)));
const legacy = createDemoApp(store, connector);
const app = createDemoHandler((request, response) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (path.startsWith('/api/v1/')) void workflow(request, response);
  else void legacy(request, response);
}, core, connector, assets);
const server = createServer(app);
server.listen(port, process.env.DEMO_HOST || '0.0.0.0', () => console.log(`demo controls: http://127.0.0.1:${port}/__demo`));
let closing = false;
function shutdown(): void {
  if (closing) return; closing = true;
  void workflow.close().then(() => server.close(() => { taskStore.close(); store.close(); process.exit(0); }));
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
