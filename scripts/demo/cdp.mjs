// @ts-check
import { spawn } from 'node:child_process';

// Chrome's remote-debugging-pipe uses null-delimited JSON on fd 3/4.
export class CDP {
 constructor(executable, args) {
  this.pending = new Map();
  this.sequence = 0;
  this.child = spawn(executable, ['--remote-debugging-pipe', ...args], {
   stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  this.child.stdio[4].on('data', (chunk) => {
   buffer += chunk.toString();
   let index;
   while ((index = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (!message.id) this.onEvent?.(message);
    const request = this.pending.get(message.id);
    if (!request) continue;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Error(message.error.message));
    else request.resolve(message.result);
   }
  });
  const fail = (error) => {
   for (const request of this.pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
   }
   this.pending.clear();
  };
  this.child.on('error', fail);
  this.child.stdio[3].on('error', fail);
  this.child.stdio[4].on('error', fail);
  this.child.on('exit', () => fail(Error('Chrome 창이 닫혔습니다.')));
 }
 send(method, params = {}, sessionId) {
  const id = ++this.sequence;
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => {
    this.pending.delete(id);
    reject(Error(`CDP timeout: ${method}`));
   }, 20000);
   this.pending.set(id, { resolve, reject, timer });
   this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
 }
 async evaluate(expression) {
  const result = await this.send('Runtime.evaluate', {
   expression, awaitPromise: true, returnByValue: true,
  }, this.session);
  if (result.exceptionDetails) {
   throw Error(result.exceptionDetails.exception?.description || '페이지 실행 실패');
  }
  return result.result.value;
 }
}
