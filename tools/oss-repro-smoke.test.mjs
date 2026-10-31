// @ts-check
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runOssReproSmoke, fixtureModel } from './oss-repro-smoke.mjs';
const config = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url), 'utf8'));
const fakeRunner = status => () => ({ info: { implementation: 'fake', ready: true }, async reproduce(request) {
  return { schema_version: 'repro_result.v1', seed: 42, target_pair_digest: request.target_pair_digest,
    input_set_sha256: request.input_set_digest, inputs: {}, status, reason_code: 'TEST_ONLY', runs: [] };
} });
test('offline smoke connects actual builtin composition and writer/review without claiming a Docker run', async () => {
  const result = await runOssReproSmoke({ image: `sha256:${'a'.repeat(64)}`, runnerFactory: fakeRunner('reproduced'), model: fixtureModel(), config });
  assert.equal(result.completed, true); assert.equal(result.model_mode, 'fixture'); assert.equal(result.runner, 'fake');
  assert.equal(result.review.result, 'pass'); assert.equal(result.source_hashes.length, 4);
  assert.deepEqual(result.calls.map(call => call.role), ['writer', 'reviewer']);
  assert(!JSON.stringify(result.document).includes('DEMO_ONLY_SECRET'));
});
test('missing target evidence cannot turn into successful documentation or call the writer', async () => {
  for (const status of ['not_run', 'error', 'inconclusive', 'not_reproduced']) {
    const model = { info: fixtureModel().info, async complete() { assert.fail('must not call model'); } };
    const result = await runOssReproSmoke({ image: `sha256:${'a'.repeat(64)}`, runnerFactory: fakeRunner(status), model, config });
    assert.equal(result.completed, false); assert.equal(result.document, null); assert.equal(result.reproduction.status, status);
  }
});
