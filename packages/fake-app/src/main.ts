import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp, DocumentStore } from '@safehandoff/server';
import { FakeCore } from '@safehandoff/fake-core';
import { SimulatedConnection } from './connection.ts';
import { createDemoHandler } from './http.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.DEMO_PORT || 8081);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DEMO_PORT must be between 1 and 65535');
const store = new DocumentStore(resolve(root, process.env.DEMO_DATABASE_PATH || '.local/data/demo.sqlite'));
const core = new FakeCore();
const connector = new SimulatedConnection(core);
const server = createServer(createDemoHandler(createApp(store, connector), core, connector));
server.listen(port, process.env.DEMO_HOST || '0.0.0.0', () => console.log(`demo controls: http://127.0.0.1:${port}/__demo`));
function shutdown(): void { server.close(() => { store.close(); process.exit(0); }); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
