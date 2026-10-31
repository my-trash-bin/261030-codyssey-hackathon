// @ts-check
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CDP } from './cdp.mjs';
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
const executable = process.env.CHROME_PATH
 || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await mkdir(resolve(root, 'var'), { recursive: true });
if (record) await buildEncoder(root);
const port = await new Promise((resolvePort, reject) => {
 const probe = createServer();
 probe.on('error', reject);
 probe.listen(0, '127.0.0.1', () => {
  const selected = probe.address().port;
  probe.close(() => resolvePort(selected));
 });
});
const runDir = await mkdtemp(resolve(root, 'var/cdp-demo-'));
const profile = await mkdtemp(resolve(tmpdir(), 'safehandoff-chrome-'));
const server = spawn(process.execPath, [resolve(root, 'packages/fake-app/dist/main.js')], {
 cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
 env: { ...process.env, DEMO_PORT: String(port), DEMO_HOST: '127.0.0.1',
  DEMO_DATABASE_PATH: resolve(runDir, 'demo.sqlite') },
});
let cdp;
let stopped = false;
const cleanup = () => { server.kill(); cdp?.child.kill(); recording?.encoder?.kill(); };
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
try {
 const base = await new Promise((resolveURL, reject) => {
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
 cdp = new CDP(executable, [
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--window-size=1440,1000', '--start-maximized',
  ...(headless ? ['--headless=new'] : []), 'about:blank',
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
 const active = async () => {
  if (replayTarget) { await playback.check(); return; }
  await playback.ready();
 };
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
  if (id === 'purpose' && !replayTarget && !startedAt) {
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
  if (verificationStep === 0 && id === 'draft') {
   verificationStep++;
   await evaluate(() => document.querySelector('#demo-stage nav button').click());
   await delay(100);
   expect(playback.target === 'purpose', '단계 버튼의 이전 장면 이동 실패');
   await playback.check();
  }
  if (verificationStep === 1 && id === 'purpose') {
   expect(playback.paused, '이동 후 일시정지 실패');
   const snapshot = await evaluate(() => document.querySelector('#title').value);
   await delay(300);
   expect(snapshot === await evaluate(() => document.querySelector('#title').value), '일시정지 중 화면 변경');
   verificationStep++;
   await evaluate(() => document.querySelector('#demo-next').click());
   await delay(100);
   expect(playback.target === 'upload', '다음 장면 버튼 실패');
   await playback.check();
  }
  if (verificationStep === 2 && id === 'upload') {
   expect(playback.paused, '다음 장면 정지 실패');
   verificationStep++;
   await evaluate(() => {
    const range = document.querySelector('#demo-timeline');
    range.value = range.max;
    range.dispatchEvent(new Event('input'));
    range.dispatchEvent(new Event('change'));
   });
   await delay(100);
   expect(playback.target === 'final', '타임라인 앞으로 이동 실패');
   await playback.check();
  }
  if (verificationStep === 3 && id === 'final') {
   expect(playback.paused, '마지막 장면 정지 실패');
   expect(await evaluate(() => !document.querySelector('#confirmed').checked), '최종 확정을 자동 선택함');
   await evaluate(() => document.querySelector('#demo-pause').click());
   await delay(100);
   expect(!playback.paused, '재생 버튼 실패');
   verificationStep++;
   console.log('재생 제어 검증 통과: 뒤로 이동, 다음, 타임라인 이동, 도착 후 정지, 재생');
  }
 }
 async function click(selector) {
  await active();
  if (!replayTarget) {
   const motion = await evaluate((selector, ms) => window.demoFocus(selector, ms), selector, fast ? 30 : 500);
   motionEvidence.push({ action: selector, ...motion });
   await active();
  }
  const point = await evaluate((selector, instant) => {
   const el = document.querySelector(selector);
   if (!el || el.disabled) throw Error('클릭할 수 없습니다: ' + selector);
   if (instant) el.scrollIntoView({ block: 'center', behavior: 'instant' });
   const box = el.getBoundingClientRect();
   const x = box.x + box.width / 2, y = box.y + box.height / 2;
   if (document.elementFromPoint(x, y) !== el) throw Error('클릭 대상이 다른 요소에 가려졌습니다: ' + selector);
   document.querySelector('#demo-cursor').style.transform = `translate(${x - 11}px,${y - 11}px)`;
   return { x, y };
  }, selector, !!replayTarget);
  await hold(.55);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, cdp.session);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, cdp.session);
 }
 async function perform() {
 await cdp.send('Page.navigate', { url: base + '/__presentation' }, cdp.session);
 await cdp.send('Page.bringToFront', {}, cdp.session);
 await wait(() => !!document.querySelector('#files'));
 if (replayTarget) await playback.publish({ ...playback.state(), seeking: true });
 await scene('purpose');
 const { root: doc } = await cdp.send('DOM.getDocument', {}, cdp.session);
 const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#files' }, cdp.session);
 await cdp.send('DOM.setFileInputFiles', {
  nodeId, files: ['client-log.txt', 'request-summary.csv', 'support-notes.md']
   .map((file) => resolve(root, 'fixtures/author/b2b-timeout', file)),
 }, cdp.session);
 await scene('upload');
 await click('#create');
 await wait(() => !!document.querySelector('#preview-0'));
 const count = await evaluate(() => document.querySelectorAll('[id^="choice-"]').length);
 const kinds = await evaluate(() => window.presentationKinds);
 playback.plan = scenes(count, kinds);
 for (let i = 0; i < count; i++) {
  await evaluate((i) => {
   const select = document.querySelector('#choice-' + i);
   if ([...select.options].some((o) => o.value === 'direction')) select.value = 'direction';
   select.dispatchEvent(new Event('change', { bubbles: true }));
  }, i);
  await scene('choice-' + i);
  await click('#preview-' + i);
  await wait(new Function(`return document.querySelector('#apply-${i}')?.disabled === false`));
  await scene('projection-' + i);
  await click('#apply-' + i);
  await wait(new Function(`return !!document.querySelector('#revoke-${i}')`));
 }
 await scene('compose');
 await click('#compose');
 await wait(() => document.querySelector('.status')?.textContent.includes('가짜 초안 작성 완료'));
 await scene('draft');
 await evaluate(() => {
  const link = [...document.querySelectorAll('a')].find((a) => a.textContent.includes('최종 파일 확인'));
  if (!link) throw Error('최종 파일 링크가 없습니다.');
  link.id = 'demo-final-link';
 });
 await click('#demo-final-link');
 await wait(() => !!document.querySelector('#confirmed'));
 await evaluate(() => document.querySelectorAll('.file details').forEach((el) => { el.open = true; }));
 await scene('final');
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
  status: (withinLimit || fast) && smooth ? 'pass' : 'fail', mode: 'fake-app', finalization: 'not_implemented_in_current_app', candidateCount: count,
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
   // Re-run real fixture actions in a new task to restore prior server state.
   // Never rewind only the DOM while leaving approvals from a later scene active.
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
