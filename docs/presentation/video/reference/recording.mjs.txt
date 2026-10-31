import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

export async function buildEncoder(root) {
 const compiler = spawn('swiftc', ['-module-cache-path', resolve(root, 'var/swift-cache'),
  '-o', resolve(root, 'bin/demo-encoder'), resolve(root, 'scripts/demo/encode.swift')], {
  stdio: ['ignore', 'ignore', 'pipe'],
 });
 let error = '';
 compiler.stderr.on('data', (data) => { error += data; });
 const [code] = await once(compiler, 'close');
 if (code) throw Error('MP4 인코더 빌드 실패: ' + error);
}

// Capture the real CDP viewport and encode a timestamped H.264 MP4 on macOS.
export class Recording {
 constructor(cdp, root, runDir) { Object.assign(this, { cdp, root, runDir, frames: 0, times: [] }); }
 async start() {
  this.encoder = spawn(resolve(this.root, 'bin/demo-encoder'), [resolve(this.runDir, 'submission.mp4')], {
   stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  this.encoder.stdout.on('data', (data) => { output += data; });
  this.encoder.stderr.on('data', (data) => { errors += data; });
  this.done = new Promise((resolveDone, reject) => {
   this.encoder.on('error', reject);
   this.encoder.on('close', (code) => {
    if (code) reject(Error('MP4 저장 실패: ' + errors));
    else { try { resolveDone(JSON.parse(output)); } catch { reject(Error('영상 검사 결과 없음')); } }
   });
  });
  this.done.catch(() => {});
  this.encoder.stdin.on('error', (error) => { this.error = error.message; });
  this.started = performance.now();
  await this.cdp.send('Page.startScreencast', {
   format: 'jpeg', quality: 88, maxWidth: 1440, maxHeight: 1000, everyNthFrame: 1,
  }, this.cdp.session);
 }
 frame(event) {
  if (this.stopping) return;
  const ms = Math.round(performance.now() - this.started);
  this.encoder.stdin.write(JSON.stringify({ ms, data: event.data }) + '\n');
  this.frames++; this.times.push(ms);
  this.cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }, this.cdp.session).catch(() => {});
 }
 async stop() {
  this.stopping = true;
  await this.cdp.send('Page.stopScreencast', {}, this.cdp.session);
  const ms = Math.round(performance.now() - this.started);
  this.encoder.stdin.end(JSON.stringify({ ms }) + '\n');
  const result = await this.done;
  if (this.error || this.frames < 10) throw Error(this.error || '영상 프레임 부족');
  const gaps = this.times.slice(1).map((t, i) => t - this.times[i]);
  return { ...result, capturedFrames: this.frames, maxFrameGapMs: Math.max(...gaps),
   averageFrameGapMs: Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) };
 }
}
