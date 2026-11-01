// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { ensureEnvFile, saveEnvValues } from '../scripts/bootstrap/env-file.mjs';
import { modelEnvironment } from '../scripts/bootstrap/app.mjs';

async function fixture(t, template) {
 const directory = await mkdtemp(resolve(tmpdir(), 'safehandoff-env-'));
 t.after(() => rm(directory, { recursive: true, force: true }));
 await writeFile(resolve(directory, '.env.example'), template);
 return directory;
}

test('missing env is copied from example once and restricted to its owner', async t => {
 const directory = await fixture(t, '# example\nPORT=8080\n');
 const path = await ensureEnvFile(directory);
 assert.equal(await readFile(path, 'utf8'), '# example\nPORT=8080\n');
 assert.equal((await stat(path)).mode & 0o777, 0o600);
 await writeFile(path, '# existing\nPORT=9000\n');
 await ensureEnvFile(directory);
 assert.equal(await readFile(path, 'utf8'), '# existing\nPORT=9000\n');
});

test('saved settings round trip special characters and preserve unrelated lines and comments', async t => {
 const template = '# connection\nMODEL_URL= # endpoint\nMODEL_KEY=\nOTHER="first\nMODEL_KEY=inside another value\nlast"\nPORT=9000\n';
 const directory = await fixture(t, template);
 const values = { MODEL_URL: 'https://example.invalid/v1?q=a#b', MODEL_KEY: ' secret#with"quotes` and \\n ', MODEL_ID: 'test-model' };
 await saveEnvValues(directory, values);
 const path = resolve(directory, '.env'), saved = await readFile(path, 'utf8');
 const parsed = parseEnv(saved);
 for (const [key, value] of Object.entries(values)) assert.equal(parsed[key], value);
 assert(saved.includes('# connection\n'));
 assert(saved.includes('# endpoint\n'));
 assert(saved.includes('OTHER="first\nMODEL_KEY=inside another value\nlast"\nPORT=9000\n'));
 assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('prompted settings are persisted and the next run reuses even an empty API key', async t => {
 const directory = await fixture(t, 'MODEL_URL=\nMODEL_ID=\nMODEL_KEY=\n');
 const config = { provider: { base_url_env: 'MODEL_URL', model_env: 'MODEL_ID', api_key_env: 'MODEL_KEY' } };
 const answers = ['https://example.invalid/v1', 'test-model', ''];
 await modelEnvironment(config, {}, async () => answers.shift(), values => saveEnvValues(directory, values));
 assert.equal(answers.length, 0);
 const env = parseEnv(await readFile(resolve(directory, '.env'), 'utf8'));
 await modelEnvironment(config, env, async () => assert.fail('saved settings must not prompt again'));
 assert.equal(env.MODEL_KEY, '');
});

test('invalid input cannot inject new env assignments or damage existing settings', async t => {
 const directory = await fixture(t, 'PORT=8080\n');
 const path = await ensureEnvFile(directory);
 await assert.rejects(saveEnvValues(directory, { MODEL_KEY: 'secret\nPORT=9000' }), /줄바꿈/);
 assert.equal(await readFile(path, 'utf8'), 'PORT=8080\n');
});
