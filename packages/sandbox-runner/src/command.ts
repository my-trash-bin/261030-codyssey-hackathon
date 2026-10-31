import { spawn } from 'node:child_process';
import { ReproError } from '@safehandoff/core-interface';

export interface CommandOptions { signal?: AbortSignal; timeoutMs: number; input?: string }
export interface CommandResult { stdout: string; stderr: string; exitCode: number }
export type DockerCommand = (args: string[], options: CommandOptions) => Promise<CommandResult>;

export const dockerCommand: DockerCommand = (args, options) => new Promise((resolve, reject) => {
  if (options.signal?.aborted) { reject(new ReproError('REPRO_CANCELLED')); return; }
  // Local socket only; ignore inherited Docker contexts, proxies, credentials and model keys.
  const child = spawn('/usr/bin/docker', ['--host=unix:///var/run/docker.sock', '--config=/dev/null', ...args], {
    env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
  });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let outSize = 0, errSize = 0;
  let failure: ReproError | undefined;
  const stop = (code: 'REPRO_CANCELLED' | 'REPRO_TIMEOUT' | 'REPRO_UNAVAILABLE') => {
    failure ??= new ReproError(code); child.kill('SIGKILL');
  };
  const cancel = () => stop('REPRO_CANCELLED');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => stop('REPRO_TIMEOUT'), Math.max(1, options.timeoutMs));
  child.stdout.on('data', (data: Buffer) => { outSize += data.length; if (outSize > 65536) stop('REPRO_UNAVAILABLE'); else stdout.push(data); });
  child.stderr.on('data', (data: Buffer) => { errSize += data.length; if (errSize > 65536) stop('REPRO_UNAVAILABLE'); else stderr.push(data); });
  child.on('error', () => { failure ??= new ReproError('REPRO_UNAVAILABLE'); });
  child.stdin.on('error', () => { /* Early container failure is reported by close. */ });
  child.on('close', code => {
    clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
    if (failure) reject(failure);
    else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code ?? -1 });
  });
  child.stdin.end(options.input ?? '');
});
