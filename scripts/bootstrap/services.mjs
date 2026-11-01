// @ts-check
import { spawn } from 'node:child_process';
import { root } from './common.mjs';

// Launch the Node servers directly so shutdown reaches the actual servers, not a package-manager wrapper.
export async function runServices(services, env, signals = process) {
 const children = [], closed = [];
 let stopping = false;
 const stop = () => {
  stopping = true;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
 };
 signals.on('SIGINT', stop);
 signals.on('SIGTERM', stop);
 try {
  for (const service of services) {
   const child = spawn(service.command, service.args, { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
   children.push(child);
   closed.push(new Promise(accept => {
    child.once('error', error => accept({ name: service.name, error }));
    child.once('close', (code, signal) => accept({ name: service.name, code, signal }));
   }));
  }
  const result = await Promise.race(closed);
  if (!stopping) throw Error(result.error ? `${result.name} 시작 실패: ${result.error.message}` :
   `${result.name} 종료 (${result.signal || result.code}). 함께 실행한 서버도 종료합니다.`);
 } finally {
  stop();
  await Promise.all(closed);
  signals.off('SIGINT', stop);
  signals.off('SIGTERM', stop);
 }
}
