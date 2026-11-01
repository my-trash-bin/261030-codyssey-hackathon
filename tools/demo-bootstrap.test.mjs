// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { demoOptions } from '../scripts/demo/bootstrap.mjs';
import { modelEnvironment, prepareReproduction } from '../scripts/bootstrap/app.mjs';

const config = { provider: { base_url_env: 'MODEL_URL', model_env: 'MODEL_ID', api_key_env: 'MODEL_KEY' },
 reproduction: { enabled: true } };

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
