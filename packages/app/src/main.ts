import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp, createWorkflowHandler, validateCatalog, DocumentStore, TaskStore } from '@safehandoff/server';
import { configuredAnalysisOrigin, configuredCore, configuredRuntime, configuredWorkflowCatalog } from './config.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const core = configuredCore(root);
const store = new DocumentStore(resolve(root, process.env.DATABASE_PATH || '.local/data/safehandoff.sqlite'));
// Workflow HTTP is opt-in; it shares the existing SQLite file but owns additive tables.
const enabled = process.env.SAFEHANDOFF_WORKFLOW_ENABLED === '1' || Boolean(process.env.SAFEHANDOFF_WORKFLOW_TOKEN);
const bootstrapToken = enabled ? process.env.SAFEHANDOFF_WORKFLOW_TOKEN || randomBytes(32).toString('hex') : undefined;
const taskStore = enabled ? new TaskStore(resolve(root, process.env.DATABASE_PATH || '.local/data/safehandoff.sqlite')) : undefined;
const workflow = taskStore ? createWorkflowHandler(taskStore, core, {
  token: bootstrapToken!,
  catalog: validateCatalog(configuredWorkflowCatalog(root)),
  runtime: configuredRuntime(root),
  analysisProviderOrigin: configuredAnalysisOrigin(root),
  browserOrigin: process.env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN || 'http://127.0.0.1:5173',
  serverOrigin: process.env.SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN || `http://127.0.0.1:${port}`,
}) : undefined;
const server = createServer(createApp(store, core, core, workflow));
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`server listening on port ${port}`));
if (bootstrapToken && !process.env.SAFEHANDOFF_WORKFLOW_TOKEN) console.log(`workflow bootstrap token (5 minutes, single use): ${bootstrapToken}`);
let closing = false;
function shutdown(): void {
  if (closing) return; closing = true;
  void (async () => { await workflow?.close(); server.close(() => { taskStore?.close(); store.close(); process.exit(0); }); })();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
