// @ts-check
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, environment, run, ask } from './common.mjs';

export async function modelEnvironment(config, env, prompt = ask) {
 for (const key of [config.provider.base_url_env, config.provider.model_env]) {
  if (!env[key]) env[key] = await prompt(key);
  if (!env[key]) throw Error(`${key} 값이 필요합니다.`);
 }
 const key = config.provider.api_key_env;
 if (!Object.hasOwn(env, key) || (process.stdin.isTTY && !env[key])) env[key] = await prompt(key, true);
 return env;
}

export async function prepareReproduction(config, env, build = buildRegistration) {
 if (config.reproduction.enabled && !env.SAFEHANDOFF_REPRO_REGISTRY) {
  env.SAFEHANDOFF_REPRO_REGISTRY = await build(env);
 }
 return env;
}

async function buildRegistration(env) {
 if (process.platform !== 'linux') throw Error('재현 실행기는 Linux /usr/bin/docker와 /var/run/docker.sock만 지원합니다.');
 try { await run('/usr/bin/docker', ['info'], env, true); }
 catch { throw Error('Docker 설치·데몬 시작·소켓 접근 권한을 확인하세요.'); }
 await mkdir(resolve(root, '.local'), { recursive: true });
 const directory = await mkdtemp(resolve(root, '.local/app-runtime-'));
 const json = async (name, value) => {
  const path = resolve(directory, name);
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return path;
 };
 await run('go', ['build', '-trimpath', '-o', resolve(directory, 'repro'), 'packages/sandbox-runner/image/main.go'],
  { ...env, CGO_ENABLED: '0', GOPROXY: 'off', GOTOOLCHAIN: 'local' });
 await run('/usr/bin/docker', ['build', '--pull=false', '--network=none', '-t', 'safehandoff-repro:local',
  '-f', 'packages/sandbox-runner/image/Dockerfile', directory], env);
 const image = await run('/usr/bin/docker', ['image', 'inspect', 'safehandoff-repro:local', '--format={{.Id}}'], env, true);
 const { createBuiltinTools, builtinArgumentsHash } = await import('../../packages/core/dist/index.js');
 const args = { seed: 42, codepoint_count: 6 }, tool = 'make_synthetic_inputs_v1';
 const authority = { task_id: 'demo-synthetic', revision: 1,
  grants: [{ id: 'demo-synthetic', tool_id: tool, arguments_sha256: builtinArgumentsHash(args) }] };
 const result = createBuiltinTools(authority)[tool].run({ tool_id: tool, tool_version: '1.0.0',
  task_id: authority.task_id, revision: 1, grant_ids: ['demo-synthetic'], arguments: args });
 if (result.status !== 'ok') throw Error('합성 입력 생성 실패');
 const generated = result.public_result;
 const registry = await json('repro-registration.json', { image, target_pair_id: 'toyrecord.sandbox-observation.v1',
  synthetic_input_set_id: 'synthetic-42-6', inputs: generated.inputs, seed: 42 });
 console.log(`앱 재현 등록: ${registry}`);
 return registry;
}

export async function main(args = process.argv.slice(2)) {
 if (args.length && (args.length !== 1 || args[0] !== '--client')) throw Error('사용법: just app / just client');
 const env = environment();
 await run('pnpm', ['install', '--frozen-lockfile'], env);
 await run('pnpm', ['build'], env);
 if (args[0] === '--client') {
  await run('pnpm', ['--filter', '@safehandoff/client', 'start'], env);
  return;
 }
 const { loadConfig } = await import('../../packages/app/dist/config.js');
 const config = loadConfig(root, env);
 await modelEnvironment(config, env);
 await prepareReproduction(config, env);
 await run('pnpm', ['--filter', '@safehandoff/app', 'start'], env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
