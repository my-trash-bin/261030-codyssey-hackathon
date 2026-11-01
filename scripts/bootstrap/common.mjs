// @ts-check
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function environment() {
 try { process.loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
 return { ...process.env };
}

export async function run(command, args, env = process.env, capture = false) {
 const child = spawn(command, args, { cwd: root, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
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
   child.on('exit', (code, signal) => code === 0 ? accept(undefined) : reject(Error(`${command} 실패 (${signal || code})`)));
  });
 } finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
 }
 return output.trim();
}

export async function ask(label, secret = false) {
 if (!process.stdin.isTTY) throw Error(`${label}: 비대화형 실행에서는 .env 또는 환경 변수를 설정하세요.`);
 // Suppress terminal echo without putting credentials in argv, logs, or a file.
 const output = new Writable({ write(chunk, _encoding, callback) { if (!secret) process.stdout.write(chunk); callback(); } });
 const prompt = createInterface({ input: process.stdin, output, terminal: true });
 try {
  process.stdout.write(`${label}${secret ? ' (화면에 표시하지 않음, 없으면 Enter)' : ''}: `);
  return (await prompt.question('')).trim();
 } finally { prompt.close(); if (secret) process.stdout.write('\n'); }
}

