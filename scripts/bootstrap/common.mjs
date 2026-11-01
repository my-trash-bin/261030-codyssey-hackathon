// @ts-check
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { mkdir, mkdtemp, open } from 'node:fs/promises';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function environment() {
 try { process.loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
 return { ...process.env };
}

export async function run(command, args, env = process.env, capture = false, logFd = undefined) {
 const stdio = logFd !== undefined ? ['ignore', logFd, logFd] : capture ? ['ignore', 'pipe', 'inherit'] : 'inherit';
 const child = spawn(command, args, { cwd: root, env, stdio });
 let output = '';
 child.stdout?.on('data', chunk => { output += chunk.toString(); });
 const forward = signal => child.kill(signal);
 const interrupt = () => forward('SIGINT');
 const terminate = () => forward('SIGTERM');
 process.on('SIGINT', interrupt);
 process.on('SIGTERM', terminate);
 try {
  await new Promise((accept, reject) => {
   child.on('error', reject);
   child.on('close', (code, signal) => code === 0 ? accept(undefined) : reject(Error(`${command} 실패 (${signal || code})`)));
  });
 } finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
 }
 return output.trim();
}

export async function prepare(command, args, env = process.env) {
 await mkdir(resolve(root, '.local'), { recursive: true });
 const directory = await mkdtemp(resolve(root, '.local/bootstrap-log-'));
 const path = resolve(directory, 'output.log');
 const log = await open(path, 'wx', 0o600);
 try { await run(command, args, env, false, log.fd); }
 catch (error) { throw Error(`${error.message}\n준비 로그: ${path}`); }
 finally { await log.close(); }
 return path;
}

export async function ask(label, secret = false, input = process.stdin, target = process.stdout) {
 if (!input.isTTY) throw Error(`${label}: 비대화형 실행에서는 .env 또는 환경 변수를 설정하세요.`);
 // Suppress terminal echo without putting credentials in argv, logs, or a file.
 const output = new Writable({ write(chunk, _encoding, callback) { if (!secret) target.write(chunk); callback(); } });
 const prompt = createInterface({ input, output, terminal: true });
 try {
  target.write(`${label}${secret ? ' (화면에 표시하지 않음, 없으면 Enter)' : ''}\n`);
  return (await prompt.question('> ')).trim();
 } finally { prompt.close(); if (secret) target.write('\n'); }
}

