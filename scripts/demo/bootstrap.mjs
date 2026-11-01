// @ts-check
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, environment, run, prepare } from '../bootstrap/common.mjs';

export function demoOptions(args) {
 const allowed = new Set(['--headless', '--fast', '--verify-playback', '--record', '--no-sandbox']);
 if (args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length) {
  throw Error('사용법: just demo [--headless] [--fast] [--verify-playback] [--record] [--no-sandbox]');
 }
 return args;
}

export async function main(args = process.argv.slice(2)) {
 const browserArgs = demoOptions(args), env = environment();
 console.log('[demo] 의존성 설치');
 await prepare('pnpm', ['install', '--frozen-lockfile'], env);
 console.log('[demo] 빌드');
 await prepare('pnpm', ['build'], env);
 if (env.CHROME_PATH) await access(env.CHROME_PATH);
 else {
  console.log('[demo] 브라우저 준비 (시스템 의존성 설치에 sudo 인증이 필요할 수 있음)');
  await prepare('pnpm', ['exec', 'playwright', 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], env);
  const { chromium } = await import('playwright');
  env.CHROME_PATH = chromium.executablePath();
 }
 console.log('fake-app 화면 연출을 시작합니다. 실제 모델과 Docker 재현은 just app에서 준비합니다.');
 await run(process.execPath, [resolve(root, 'scripts/demo/run.mjs'), ...browserArgs], env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
