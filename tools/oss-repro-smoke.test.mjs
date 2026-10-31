// @ts-check
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runOssReproSmoke, fixtureModel } from './oss-repro-smoke.mjs';
const config = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url), 'utf8'));
const fakeRunner = status => () => ({ info: { implementation: 'fake', ready: true }, async reproduce(request) {
  return { schema_version: 'repro_result.v1', seed: 42, target_pair_digest: request.target_pair_digest,
    input_set_sha256: request.input_set_digest, inputs: {}, status, reason_code: 'TEST_ONLY',
    runs: status !== 'reproduced' ? [] : ['buggy','fixed'].flatMap(target => ['ascii','multibyte'].map(input => {
      const failure = target === 'buggy' && input === 'multibyte';
      return { target, input, result: { schema_version: 'target_run.v1', status: failure ? 'domain_error' : 'ok',
        stage: failure ? 'encode' : 'persist', code: failure ? 'E_ENCODE_SHORT_BUFFER' : null }, exit_code: failure ? 2 : 0,
        output_exists: !failure, output_matches: !failure };
    })) };
} });
test('offline smoke connects actual builtin composition and writer/review without claiming a Docker run', async () => {
  const events = [];
  const transcripts = { start(operation) {
    assert.equal(operation, 'writeReviewed');
    return { run_id: 'fixture-run', emit(event) { events.push(event); }, close() {} };
  } };
  const result = await runOssReproSmoke({ image: `sha256:${'a'.repeat(64)}`, runnerFactory: fakeRunner('reproduced'), model: fixtureModel(), config, transcripts });
  assert.deepEqual(result.transcript_run_ids, ['fixture-run']);
  assert.equal(events.at(-1), 'run_completed');
  assert.equal(result.completed, true); assert.equal(result.model_mode, 'fixture'); assert.equal(result.runner, 'fake');
  assert.equal(result.review.result, 'pass'); assert.equal(result.source_hashes.length, 4);
  assert.deepEqual(result.execution_summary, { targets: 2, inputs: 2, total_runs: 4, runs_per_combination: 1 });
  assert.equal(result.manual_review_required, true); assert.equal(result.document_status, 'reviewed_draft_not_finalized');
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

test('a reproduced label with missing execution rows cannot count as a successful smoke', async () => {
  const result = runOssReproSmoke({ image: `sha256:${'a'.repeat(64)}`, model: fixtureModel(), config,
    runnerFactory: () => ({ info: { implementation: 'fake', ready: true }, async reproduce() {
      return { status: 'reproduced', runs: [] };
    } }) });
  await assert.rejects(result, /INVALID_REPRO_MATRIX/);
});
