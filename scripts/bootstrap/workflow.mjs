// @ts-check
import { networkInterfaces } from 'node:os';

export function configureWorkflow(env, interfaces = networkInterfaces()) {
 env.SAFEHANDOFF_WORKFLOW_ENABLED ??= '1';
 if (env.SAFEHANDOFF_WORKFLOW_ENABLED === '0') return;
 if (!env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN) {
  let host = env.HOST || '127.0.0.1';
  if (['0.0.0.0', '::'].includes(host)) {
   const addresses = Object.values(interfaces).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
   // Prefer the tailnet address when present; otherwise use a host interface.
   host = addresses.find(a => { const [first, second] = a.split('.').map(Number); return first === 100 && second >= 64 && second <= 127; }) || addresses[0] || '127.0.0.1';
  }
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN = `http://${host}:${env.CLIENT_PORT || 5173}`;
 }
 env.SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN ||= env.SERVER_ORIGIN || `http://127.0.0.1:${env.PORT || 8080}`;
}
