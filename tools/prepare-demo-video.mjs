// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const sourceRoot = new URL('../docs/presentation/video/', import.meta.url);
const destination = new URL('../.local/demo-video/', import.meta.url);
const hash = data => createHash('sha256').update(data).digest('hex');

async function main() {
  const source = JSON.parse(await readFile(new URL('source.json', sourceRoot), 'utf8'));
  const path = new URL('SafeHandoff-demo.mp4', destination);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  let data;
  try { data = await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      const result = await exec('git', ['show', `${source.source_commit}:${source.video.original}`], {
        cwd: fileURLToPath(root), encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
      });
      data = result.stdout;
    } catch { throw new Error('VIDEO_SOURCE_MISSING: 먼저 git fetch origin feat/cdp-demo-presentation 실행'); }
  }
  if (data.length !== source.video.bytes || hash(data) !== source.video.sha256) throw new Error('VIDEO_DIGEST_MISMATCH');
  // Existing bytes are verified, never silently replaced with a different recording.
  try { await writeFile(path, data, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const poster = await readFile(new URL(source.poster.file, sourceRoot));
  if (hash(poster) !== source.poster.sha256) throw new Error('POSTER_DIGEST_MISMATCH');
  await writeFile(new URL('poster.png', destination), poster, { mode: 0o600 });
  await writeFile(new URL('index.html', destination), await readFile(new URL('player.html', sourceRoot)), { mode: 0o600 });
  console.log(JSON.stringify({ mode: source.mode, source_commit: source.source_commit,
    video: fileURLToPath(path), sha256: source.video.sha256, current_app_compatible: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
