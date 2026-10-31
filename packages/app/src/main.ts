import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp, DocumentStore } from '@safehandoff/server';
import { configuredCore } from './config.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const core = configuredCore(root);
const store = new DocumentStore(resolve(root, process.env.DATABASE_PATH || '.local/data/safehandoff.sqlite'));
const server = createServer(createApp(store, core));
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`server listening on port ${port}`));
function shutdown(): void { server.close(() => { store.close(); process.exit(0); }); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
