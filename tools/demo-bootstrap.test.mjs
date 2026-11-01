// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { demoOptions } from '../scripts/demo/bootstrap.mjs';
import { modelEnvironment, prepareReproduction, launchMode } from '../scripts/bootstrap/app.mjs';
import { ask, run, prepare } from '../scripts/bootstrap/common.mjs';
import { PassThrough, Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';

const config = { provider: { base_url_env: 'MODEL_URL', model_env: 'MODEL_ID', api_key_env: 'MODEL_KEY' },
 reproduction: { enabled: true } };

test('app launches both services and explicit recipes select API or web', () => {
 assert.equal(launchMode([]), 'app');
 assert.equal(launchMode(['--api']), 'api');
 assert.equal(launchMode(['--web']), 'web');
 assert.throws(() => launchMode(['--client']), /just app \/ just api \/ just web/);
});

test('terminal prompts keep field labels on a separate line and never echo secrets', async () => {
 for (const secret of [false, true]) {
  const input = new PassThrough(); input.isTTY = true;
  let displayed = '';
  const output = new Writable({ write(chunk, _encoding, done) { displayed += chunk.toString(); done(); } });
  const answer = ask('MODEL_FIELD', secret, input, output);
  assert.match(displayed, /^MODEL_FIELD[^\n]*\n/);
  input.write('test-input\r');
  assert.equal(await answer, 'test-input');
  if (secret) assert(!displayed.includes('test-input'));
  input.destroy(); output.destroy();
 }
});

test('command completion collects output through stream closure', async () => {
 const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
 const result = await run(process.execPath, ['-e', "process.stdout.write('complete')"], env, true);
 assert.equal(result, 'complete');
});

test('preparation writes both output streams to a private log and reports its path on failure', async () => {
 const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
 const path = await prepare(process.execPath, ['-e', "console.log('build stdout'); console.error('build stderr')"], env);
 const text = await readFile(path, 'utf8');
 assert.match(text, /build stdout/); assert.match(text, /build stderr/);
 await assert.rejects(prepare(process.execPath, ['-e', 'process.exit(2)'], env), /준비 로그: .*output\.log/);
});

test('demo only accepts presentation flags and rejects removed execution modes', () => {
 assert.deepEqual(demoOptions([]), []);
 assert.deepEqual(demoOptions(['--headless', '--no-sandbox']), ['--headless', '--no-sandbox']);
 for (const args of [['--live-model'], ['--repro-only'], ['--ui-only'], ['--fast', '--fast']]) {
  assert.throws(() => demoOptions(args), /사용법/);
 }
});

test('actual app prompts for missing configured provider fields and hides the key', async () => {
 const questions = [], answers = ['https://model.invalid/v1', 'test-model', 'test-secret'];
 const env = await modelEnvironment(config, {}, async (key, secret = false) => {
  questions.push([key, secret]); return answers.shift();
 });
 assert.deepEqual(questions, [['MODEL_URL', false], ['MODEL_ID', false], ['MODEL_KEY', true]]);
 assert.equal(env.MODEL_KEY, 'test-secret');
});

test('existing provider settings are preserved and missing required input fails', async () => {
 const env = { MODEL_URL: 'https://model.invalid/v1', MODEL_ID: 'selected', MODEL_KEY: 'existing' };
 assert.equal(await modelEnvironment(config, env, async () => assert.fail('unexpected prompt')), env);
 await assert.rejects(modelEnvironment(config, {}, async () => ''), /MODEL_URL/);
});

test('actual app wires generated registration only when reproduction is enabled and missing', async () => {
 let builds = 0;
 const build = async () => { builds++; return '/local/generated-registration.json'; };
 const env = await prepareReproduction(config, {}, build);
 assert.equal(env.SAFEHANDOFF_REPRO_REGISTRY, '/local/generated-registration.json');
 const existing = { SAFEHANDOFF_REPRO_REGISTRY: '/operator/registration.json' };
 assert.equal(await prepareReproduction(config, existing, build), existing);
 assert.equal(existing.SAFEHANDOFF_REPRO_REGISTRY, '/operator/registration.json');
 assert.deepEqual(await prepareReproduction({ reproduction: { enabled: false } }, {}, build), {});
 assert.equal(builds, 1);
 await assert.rejects(prepareReproduction(config, {}, async () => { throw Error('docker unavailable'); }), /docker unavailable/);
});
