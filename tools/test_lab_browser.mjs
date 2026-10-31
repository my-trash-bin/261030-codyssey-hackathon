// Explicit browser smoke test; uses an installed Chromium and Node's CDP client.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const chrome = process.env.CHROMIUM_BIN;
if (!chrome) throw new Error('CHROMIUM_BIN에 설치된 Chromium 실행 파일 경로를 지정하세요.');
const base = process.env.DEMO_URL || 'http://127.0.0.1:8081';
const temporary = await mkdtemp(join(tmpdir(), 'safehandoff-browser-'));
let browser, socket, messageID = 0;
const pending = new Map(), exceptions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await fn()) return; await delay(50); }
  throw new Error(`timeout: ${label}`);
}
function cdp(method, params = {}) {
  const id = ++messageID;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression, label) { await until(() => evaluate(expression), label); }
const byID = id => `document.getElementById(${JSON.stringify(id)})`;
async function click(id) { await evaluate(`${byID(id)}.click()`); }
async function edit(id, value) {
  await evaluate(`${byID(id)}.value=${JSON.stringify(value)};${byID(id)}.dispatchEvent(new Event('input',{bubbles:true}))`);
}
try {
  browser = spawn(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${temporary}`, 'about:blank',
  ], { stdio: 'ignore' });
  browser.on('error', error => { throw error; });
  let port;
  await until(async () => {
    if (browser.exitCode !== null) throw new Error(`Chromium exited: ${browser.exitCode}`);
    try { port = (await readFile(join(temporary, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; }
    catch { return false; }
  }, 'Chromium startup');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
  });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: temporary });
  await cdp('Page.navigate', { url: base });
  await waitFor(`${byID('mode')}?.textContent.includes('모델 호출 없음')`, 'demo connection');
  const scenarioIDs = await evaluate(`[...${byID('scenario')}.options].map(o=>o.value).filter(Boolean)`);
  assert.equal(scenarioIDs.length, 4);
  for (const id of scenarioIDs) {
    await evaluate(`${byID('scenario')}.value=${JSON.stringify(id)}`); await click('load'); await click('analyze');
    await waitFor(`document.querySelectorAll('.candidate').length >= 3`, `${id} analysis`);
    assert.equal(await evaluate(`document.querySelectorAll('.candidate input:checked').length`), 0);
    await evaluate(`document.querySelectorAll('.candidate input[type=checkbox]').forEach((box,i)=>{if(i<3)box.click()})`);
    await click('generate');
    await waitFor(`!${byID('confirm')}.disabled`, `${id} generation`);
    const body = await evaluate(`${byID('body')}.value`);
    assert(!body.includes('DEMO_ONLY_SECRET_'));
    // Editing invalidates review; exact current bytes must be re-reviewed.
    await edit('title', `${id} 공유본`);
    assert.equal(await evaluate(`${byID('confirm')}.disabled`), true);
    await click('review-again'); await waitFor(`!${byID('confirm')}.disabled`, `${id} review`);
    await click('confirm');
    assert.equal(await evaluate(`${byID('download')}.disabled`), false);
    if (id === scenarioIDs[0]) {
      await click('download');
      await until(async () => (await readdir(temporary)).includes('shared-document.md'), 'download');
      assert.equal(await readFile(join(temporary, 'shared-document.md'), 'utf8'), `# ${id} 공유본\n\n${body}\n`);
    }
    // Removing an approval invalidates the previous result and download.
    await evaluate(`document.querySelector('.candidate input[type=checkbox]').click()`);
    assert.equal(await evaluate(`${byID('download')}.disabled`), true);
    await click('generate'); await waitFor(`!${byID('confirm')}.disabled`, `${id} regeneration`);
    const removed = await evaluate(`document.querySelector('.candidate textarea').value`);
    assert(!(await evaluate(`${byID('body')}.value`)).includes(removed));
    console.log(`PASS browser: ${id} analyze/approve/generate/edit/review/invalidate/regenerate`);
  }
  await click('clear');
  assert.equal(await evaluate(`${byID('download')}.disabled`), true);
  await edit('purpose', '<img src=x onerror="window.untrustedExecuted=true">');
  assert.equal(await evaluate('!!window.untrustedExecuted'), false);
  assert.deepEqual(exceptions, []);
  console.log('PASS browser: download bytes, clear, safe rendering, no uncaught exceptions');
} finally {
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('browser stopped')); }
  socket?.close();
  if (browser && browser.exitCode === null) {
    const stopped = new Promise(resolve => browser.once('exit', resolve)); browser.kill('SIGTERM');
    await Promise.race([stopped, delay(3000)]);
    if (browser.exitCode === null) { browser.kill('SIGKILL'); await stopped; }
  }
  await rm(resolve(temporary), { recursive: true, force: true });
}
