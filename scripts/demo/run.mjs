// @ts-check
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CDP } from './cdp.mjs';
import { browserExecutable } from './browser.mjs';
import { installStage } from './stage.mjs';
import { Playback, Seek } from './playback.mjs';
import { scenes } from './scenes.mjs';
import { Recording, buildEncoder } from './recording.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const headless = process.argv.includes('--headless');
const fast = process.argv.includes('--fast');
const verifyPlayback = process.argv.includes('--verify-playback');
let verificationStep = 0;
let replayCount = 0;
let candidateCount = 0;
const record = process.argv.includes('--record');
const limitMs = 110000;
let recording;
const motionEvidence = [];
let startedAt;
const executable = browserExecutable();
await mkdir(resolve(root, 'var'), { recursive: true });
if (record) await buildEncoder(root);
const freePort = () => new Promise((resolvePort, reject) => {
 const probe = createServer();
 probe.on('error', reject);
 probe.listen(0, '127.0.0.1', () => {
  const selected = probe.address().port;
  probe.close(() => resolvePort(selected));
 });
});
const port = await freePort();
let clientPort = await freePort();
while (clientPort === port) clientPort = await freePort();
const runDir = await mkdtemp(resolve(root, 'var/cdp-demo-'));
const profile = await mkdtemp(resolve(tmpdir(), 'safehandoff-chrome-'));
const server = spawn(process.execPath, [resolve(root, 'packages/fake-app/dist/main.js')], {
 cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
 env: { ...process.env, DEMO_PORT: String(port), DEMO_HOST: '127.0.0.1',
  DEMO_DATABASE_PATH: resolve(runDir, 'demo.sqlite'), DEMO_TASK_DATABASE_PATH: resolve(runDir, 'workflow.sqlite'),
  SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN: `http://127.0.0.1:${clientPort}`,
  SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN: `http://127.0.0.1:${port}` },
});
const client = spawn(process.execPath, [resolve(root, 'packages/client/dist/serve.js')], {
 cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
 env: { ...process.env, CLIENT_PORT: String(clientPort), HOST: '127.0.0.1', SERVER_ORIGIN: `http://127.0.0.1:${port}` },
});
let cdp;
let stopped = false;
const cleanup = () => { server.kill(); client.kill(); cdp?.child.kill(); recording?.encoder?.kill(); };
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
try {
 await new Promise((resolveURL, reject) => {
  const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 20000);
  let log = '';
  server.on('error', reject);
  server.on('exit', () => reject(Error('서버가 종료되었습니다: ' + log)));
  const read = (data) => {
   log += data.toString();
   const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
   if (match) { clearTimeout(timer); resolveURL(match[0]); }
  };
  server.stdout.on('data', read);
 server.stderr.on('data', read);
 });
 const base = await new Promise((resolveURL, reject) => {
  const timer = setTimeout(() => reject(Error('클라이언트 시작 시간 초과')), 20000);
  let log = '';
  client.on('error', reject);
  client.on('exit', () => reject(Error('클라이언트가 종료되었습니다: ' + log)));
  const read = (data) => {
   log += data.toString();
   const match = log.match(/client listening on port (\d+)/);
   if (match) { clearTimeout(timer); resolveURL(`http://127.0.0.1:${match[1]}`); }
  };
  client.stdout.on('data', read);
  client.stderr.on('data', read);
 });
 cdp = new CDP(executable, [
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--window-size=1440,1000', '--start-maximized',
  ...(headless ? ['--headless=new'] : []), 'about:blank',
  ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : []),
 ]);
 const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
 const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
 cdp.session = attached.sessionId;
 await cdp.send('Page.enable', {}, cdp.session);
 await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
 }, cdp.session);
 // Allow the injected presentation styles in this isolated fixture tab only.
 await cdp.send('Page.setBypassCSP', { enabled: true }, cdp.session);
 await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `addEventListener('DOMContentLoaded', ${installStage.toString()});`,
 }, cdp.session);
 const evaluate = (fn, ...args) => cdp.evaluate(`(${fn})(${args.map(JSON.stringify).join(',')})`);
 const playback = new Playback({ fast, publish: async (state) => {
  await evaluate((state) => window.renderDemo?.(state), state);
 } });
 playback.plan = scenes();
 await cdp.send('Runtime.enable', {}, cdp.session);
 await cdp.send('Runtime.addBinding', { name: 'demoCommand' }, cdp.session);
 cdp.onEvent = (message) => {
  if (message.method === 'Page.screencastFrame') { recording?.frame(message.params); return; }
  if (message.method !== 'Runtime.bindingCalled' || message.params.name !== 'demoCommand') return;
  try { playback.command(JSON.parse(message.params.payload)); } catch { /* Ignore malformed UI messages. */ }
 };
 let replayTarget = null;
 async function wait(fn) {
  const deadline = Date.now() + 45000;
  while (!await evaluate(fn)) {
   await playback.check();
   if (Date.now() > deadline) throw Error('화면 대기 시간 초과: ' + fn);
   await delay(150);
  }
 }
 const hold = async (seconds = 4) => {
  if (!replayTarget) await playback.hold(seconds);
 };
 async function scene(id) {
  await playback.check();
  if (replayTarget && replayTarget !== id) {
   await playback.publish({ ...playback.state(), seeking: true });
   return;
  }
  playback.current = id;
  if (replayTarget === id) {
   replayTarget = null;
   playback.paused = true;
  }
  await playback.publish(playback.state());
  const scene = playback.plan.find((entry) => entry.id === id);
  if (id === 'status' && !replayTarget && !startedAt) {
   if (record) { recording = new Recording(cdp, root, runDir); await recording.start(); }
   startedAt = performance.now();
  }
  // Scroll completes before cursor coordinates are measured.
  const motion = await evaluate((selector, ms, paused) => window.demoFocus(selector, ms, paused),
   scene.selector, fast ? 30 : 500, playback.paused);
  motionEvidence.push({ scene: id, ...motion });
  console.log(scene.title);
  if (verifyPlayback) await verifyControls(id);
  await hold(scene.seconds);
 }
 async function verifyControls(id) {
  const expect = (ok, message) => { if (!ok) throw Error(message); };
  if (id !== 'status' || verificationStep !== 0) return;
  expect(await evaluate(() => document.querySelector('#mode-label')?.textContent.includes('실제 모델 실행 아님')), 'fake backend 표시가 없음');
  verificationStep = 1;
  console.log('FakeCore workflow 연결 표시 검증 통과');
 }
 const click = async (selector) => {
  const clicked = await evaluate((selector) => {
   const element = document.querySelector(selector);
   if (!(element instanceof HTMLElement) || element.matches(':disabled')) return false;
   element.click(); return true;
  }, selector);
  if (!clicked) throw Error('누를 수 없는 화면 요소: ' + selector);
 };
 const setValue = async (selector, value) => {
  const changed = await evaluate((selector, value) => {
   const element = document.querySelector(selector);
   if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return false;
   const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
   element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
   return true;
  }, selector, value);
  if (!changed) throw Error('값을 넣을 수 없는 화면 요소: ' + selector);
 };
 const setFiles = async (selector, files) => {
  const documentNode = await cdp.send('DOM.getDocument', {}, cdp.session);
  const found = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector }, cdp.session);
  if (!found.nodeId) throw Error('파일 입력을 찾지 못함: ' + selector);
  await cdp.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files }, cdp.session);
 };
 async function perform() {
 await cdp.send('Page.navigate', { url: base + '/' }, cdp.session);
 await cdp.send('Page.bringToFront', {}, cdp.session);
 await wait(() => !!document.querySelector('#task-submit'));
 if (replayTarget) await playback.publish({ ...playback.state(), seeking: true });
 await scene('status');
 await scene('intake');
 await setValue('#task-title', '가상 운영 자문');
 await setValue('#task-purpose', 'operations_advice');
 await setValue('#task-recipient', '가상 외부 운영 자문사');
 await setValue('#task-audience', 'named_external');
 await setValue('#task-language', 'ko');
 await setFiles('#task-files', [resolve(root, 'fixtures/demo/operations/업무메모.md')]);
 await click('#task-submit');
 await wait(() => document.querySelector('#rail-analysis')?.classList.contains('rail__step--next'));
 await click('#rail-analysis');
 await wait(() => !!document.querySelector('#analyze-start') && !document.querySelector('#analyze-start').disabled);
 await scene('analysis');
 await click('#analyze-start');
 await wait(() => document.querySelector('#rail-analysis')?.classList.contains('rail__step--done'));
 await click('#rail-decision');
 await wait(() => !!document.querySelector('.candidate'));
 candidateCount = await evaluate(() => document.querySelectorAll('.candidate').length);
 await click('[data-role="disposition"][data-disposition="allow"]');
 await click('[data-role="representation-mode"][data-mode="A"]');
 await wait(() => !!document.querySelector('[data-role="preview-result"]'));
 await scene('decision');
 await click('[data-role="apply"]');
 await wait(() => !!document.querySelector('[data-role="saved-state"]'));
 await click('#rail-draft');
 await wait(() => !!document.querySelector('#generate-document') && !document.querySelector('#generate-document').disabled);
 await scene('draft');
 await click('#generate-document');
 await wait(() => document.querySelector('#rail-draft')?.classList.contains('rail__step--done'));
 await click('#rail-review');
 await wait(() => !!document.querySelector('#draft-review'));
 await scene('review');
 await click('#rail-files');
 await wait(() => !!document.querySelector('#finalize-document') && !document.querySelector('#finalize-document').disabled);
 await scene('files');
 await click('#finalize-document');
 await wait(() => document.querySelector('#flow-progress')?.textContent.includes('6 / 6'));
 await scene('complete');
 const count = candidateCount;
 if (verifyPlayback) {
  if (count < 1) throw Error('공개 후보가 생성되지 않음');
  if (!await evaluate(() => document.querySelector('#flow-progress')?.textContent.includes('6 / 6'))) throw Error('사용자 흐름이 완주되지 않음');
  verificationStep = 4;
  console.log('작업 생성부터 최종 확정까지 실제 UI 사용자 흐름 검증 통과');
 }
 await evaluate(() => {
  const panel = document.querySelector('#demo-stage');
  const rect = panel.getBoundingClientRect();
  if (getComputedStyle(panel).position !== 'fixed' || rect.bottom > innerHeight) {
   throw Error('시연 자막이 화면 안에 표시되지 않습니다.');
  }
 });
 const durationMs = Math.round(performance.now() - startedAt);
 const moving = motionEvidence.filter((motion) => motion.distance > 10);
 const transitionChecks = moving.map((motion) => {
  const jumps = motion.samples.slice(1).map((sample, i) => Math.abs(sample.y - motion.samples[i].y) / motion.distance);
  return { target: motion.selector, samples: motion.samples.length, maxNormalizedStep: Math.max(0, ...jumps) };
 });
 const smooth = fast || transitionChecks.every((check) => check.samples >= 10 && check.maxNormalizedStep <= .2);
 const video = recording ? await recording.stop() : null;
 recording = null;
 const withinLimit = durationMs <= limitMs && (!video || video.durationMs <= limitMs);
 await writeFile(resolve(runDir, 'motion.json'), JSON.stringify(motionEvidence, null, 2));
 const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, cdp.session);
 await writeFile(resolve(runDir, 'final.png'), Buffer.from(screenshot.data, 'base64'));
 await writeFile(resolve(runDir, 'run.json'), JSON.stringify({
  status: (withinLimit || fast) && smooth ? 'pass' : 'fail', mode: 'client-with-fake-core', finalization: 'completed', candidateCount: count,
  url: await evaluate(() => location.href), screenshot: 'final.png',
  sceneCount: playback.plan.length, replayCount,
  transitions: { smooth, checks: transitionChecks },
  timing: { durationMs, limitMs, withinLimit, accelerated: fast, interactive: verifyPlayback }, video,
  playbackVerification: verifyPlayback ? (verificationStep === 4 ? 'pass' : 'fail') : 'not_run',
 }, null, 2) + '\n');
 if (!smooth) throw Error('부드러운 스크롤 전환 기준 미달');
 if (!fast && !verifyPlayback && !withinLimit) throw Error('제출 시간 제한 110초 초과');
 console.log(`재생 시간: ${(durationMs / 1000).toFixed(2)}초 / 제한 110초`);
 console.log(`시연 완료. 실행 기록: ${runDir}`);
 }
 while (true) {
  try {
   await perform();
   if (headless) break;
   playback.completed = true;
   playback.paused = true;
   console.log('장면을 선택하면 해당 위치에서 멈춥니다. 창을 닫거나 Ctrl+C로 종료하세요.');
   while (true) {
    await playback.check();
    await playback.publish(playback.state());
    await delay(100);
   }
  } catch (error) {
   if (!(error instanceof Seek)) throw error;
   playback.completed = false;
   replayCount++;
   replayTarget = playback.target;
   playback.target = null;
   await playback.publish({ ...playback.state(), seeking: true });
   // 현재 상태 장면을 다시 열어 선택한 위치에서 멈춘다.
  }
 }

} catch (error) {
 console.error(error.message);
 if (cdp?.session) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, cdp.session).catch(() => null);
  if (shot) await writeFile(resolve(runDir, 'failure.png'), Buffer.from(shot.data, 'base64'));
  console.error('실패 기록: ' + runDir);
 }
 if (!stopped && !error.message.includes('사용자가 시연을 종료')
  && !error.message.includes('Chrome 창이 닫혔습니다')) process.exitCode = 1;
} finally { cleanup(); }
