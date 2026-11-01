// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { runServices } from '../scripts/bootstrap/services.mjs';

async function setup(t) {
 const directory = await mkdtemp(resolve(tmpdir(), 'safehandoff-services-'));
 t.after(() => rm(directory, { recursive: true, force: true }));
 const env = { ...process.env, SERVICE_TEST_DIR: directory }; delete env.NODE_TEST_CONTEXT;
 return { directory, env };
}

const worker = `
const {writeFileSync} = require('node:fs');
const {join} = require('node:path');
const path = name => join(process.env.SERVICE_TEST_DIR, name);
process.on('SIGTERM', () => { writeFileSync(path('stopped'), 'yes'); process.exit(0); });
writeFileSync(path('ready'), 'yes');
setInterval(() => {}, 1000);
`;
const service = (name, source) => ({ name, command: process.execPath, args: ['-e', source] });

test('failure of one service terminates the other server', async t => {
 const { directory, env } = await setup(t);
 const failing = `const {existsSync} = require('node:fs'); const {join}=require('node:path');
 setInterval(() => {if(existsSync(join(process.env.SERVICE_TEST_DIR,'ready'))) process.exit(2);}, 10);`;
 await assert.rejects(runServices([service('worker', worker), service('failing', failing)], env), /failing.*2/);
 assert.equal(await readFile(resolve(directory, 'stopped'), 'utf8'), 'yes');
});

test('interrupt stops the servers and removes signal handlers', async t => {
 const { directory, env } = await setup(t);
 const signals = new EventEmitter();
 const completed = runServices([service('worker', worker)], env, signals);
 try {
  const deadline = Date.now() + 5000;
  while (true) {
   try { await access(resolve(directory, 'ready')); break; }
   catch { assert(Date.now() < deadline, 'worker did not start'); await delay(10); }
  }
 } finally { signals.emit('SIGINT'); await completed; }
 assert.equal(await readFile(resolve(directory, 'stopped'), 'utf8'), 'yes');
 assert.equal(signals.listenerCount('SIGINT'), 0);
 assert.equal(signals.listenerCount('SIGTERM'), 0);
});
