// @ts-check
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, environment, run, ask, prepare } from './common.mjs';
import { ensureEnvFile, saveEnvValues } from './env-file.mjs';
import { runServices } from './services.mjs';
import { configureWorkflow } from './workflow.mjs';

export function launchMode(args) {
 if (!args.length) return 'app';
 if (args.length === 1 && ['--api', '--web'].includes(args[0])) return args[0].slice(2);
 throw Error('사용법: just app / just api / just web');
}

export async function modelEnvironment(config, env, prompt = ask, save = undefined) {
 const entered = {};
 for (const key of [config.provider.base_url_env, config.provider.model_env]) {
  if (!env[key]) env[key] = entered[key] = await prompt(key);
  if (!env[key]) throw Error(`${key} 값이 필요합니다.`);
 }
 const key = config.provider.api_key_env;
 if (!Object.hasOwn(env, key) || (!env[key] && Object.keys(entered).length)) env[key] = entered[key] = await prompt(key, true);
 if (save && Object.keys(entered).length) await save(entered);
 return env;
}

export async function prepareReproduction(config, env, build = buildRegistration) {
 if (config.reproduction.enabled && !env.SAFEHANDOFF_REPRO_REGISTRY) {
  console.log('[app] Docker 재현 환경 준비');
  env.SAFEHANDOFF_REPRO_REGISTRY = await build(env);
 } else console.log(config.reproduction.enabled ? '[app] 지정한 재현 등록 사용' : '[app] 재현 비활성화: Docker 준비 생략');
 return env;
}

async function buildRegistration(env) {
 if (process.platform !== 'linux') throw Error('재현 실행기는 Linux /usr/bin/docker와 /var/run/docker.sock만 지원합니다.');
 console.log('[app] Docker 데몬 확인');
 try { await prepare('/usr/bin/docker', ['info'], env); }
 catch (error) { throw Error(`Docker 설치·데몬 시작·소켓 접근 권한을 확인하세요. ${error.message}`); }
 await mkdir(resolve(root, '.local'), { recursive: true });
 const directory = await mkdtemp(resolve(root, '.local/app-runtime-'));
 const json = async (name, value) => {
  const path = resolve(directory, name);
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return path;
 };
 console.log('[app] Go 재현 실행기 빌드 (최초 실행은 시간이 걸릴 수 있음)');
 await prepare('go', ['build', '-trimpath', '-o', resolve(directory, 'repro'), 'packages/sandbox-runner/image/main.go'],
  { ...env, CGO_ENABLED: '0', GOPROXY: 'off', GOTOOLCHAIN: 'local' });
 console.log('[app] Docker 이미지 빌드');
 await prepare('/usr/bin/docker', ['build', '--pull=false', '--network=none', '-t', 'safehandoff-repro:local',
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
 const mode = launchMode(args);
 await ensureEnvFile(root);
 const env = environment();
 configureWorkflow(env);
 console.log('[app] 의존성 설치');
 await prepare('pnpm', ['install', '--frozen-lockfile'], env);
 console.log('[app] 빌드');
 await prepare('pnpm', ['build'], env);
 const api = { name: 'API 서버', command: process.execPath, args: [resolve(root, 'packages/app/dist/main.js')] };
 const web = { name: '웹 화면', command: process.execPath, args: [resolve(root, 'packages/client/dist/serve.js')] };
 if (mode === 'web') {
  console.log(`[app] 웹 화면 시작: http://${env.HOST || '127.0.0.1'}:${env.CLIENT_PORT || 5173}/`);
  await run(process.execPath, web.args, env);
  return;
 }
 console.log('\n[app] 빌드 완료. 앱 설정 읽기');
 const { loadConfig } = await import('../../packages/app/dist/config.js');
 const config = loadConfig(root, env);
 console.log('[app] 모델 연결 정보 확인 (없는 값은 터미널에서 입력)');
 await modelEnvironment(config, env, ask, async values => {
  await saveEnvValues(root, values);
  console.log('[app] 모델 연결 정보를 .env에 저장했습니다.');
 });
 await prepareReproduction(config, env);
 console.log(`[app] API 서버 시작: http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}/health`);
 if (mode === 'api') await run(process.execPath, api.args, env);
 else {
  console.log(`[app] 웹 화면 시작: http://${env.HOST || '127.0.0.1'}:${env.CLIENT_PORT || 5173}/`);
  console.log('[app] Ctrl+C로 API와 웹을 함께 종료합니다.');
  await runServices([api, web], env);
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
