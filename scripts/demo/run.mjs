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
  DEMO_DATABASE_PATH: resolve(runDir, 'demo.sqlite') },
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
  expect(await evaluate(() => document.querySelector('#session-status')?.textContent.includes('비활성')), '미구현 workflow 상태가 표시되지 않음');
  expect(await evaluate(() => document.querySelector('#mode-label')?.textContent.includes('실제 모델 실행 아님')), 'fake backend 표시가 없음');
  verificationStep = 4;
  console.log('현재 실제 UI 상태 검증 통과: workflow 비활성 상태를 그대로 표시');
 }
 async function perform() {
 await cdp.send('Page.navigate', { url: base + '/' }, cdp.session);
 await cdp.send('Page.bringToFront', {}, cdp.session);
 await wait(() => !!document.querySelector('#session-status') && !document.querySelector('#session-status').textContent.includes('연결하는 중'));
 if (replayTarget) await playback.publish({ ...playback.state(), seeking: true });
 const count = 0;
 await scene('status');
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
  status: (withinLimit || fast) && smooth ? 'pass' : 'fail', mode: 'client-with-fake-backend', finalization: 'not_implemented', candidateCount: count,
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
