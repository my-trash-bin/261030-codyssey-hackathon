import { createServer } from 'node:http';
import { createClientHandler } from './server.ts';

const port = Number(process.env.CLIENT_PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CLIENT_PORT must be between 1 and 65535');
const server = createServer(createClientHandler(process.env.SERVER_ORIGIN || 'http://127.0.0.1:8080'));
server.listen(port, process.env.CLIENT_HOST || '127.0.0.1', () => console.log(`client listening on port ${port}`));
function shutdown(): void { server.close(() => process.exit(0)); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
