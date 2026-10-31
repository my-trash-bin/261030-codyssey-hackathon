// @ts-check
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { registerPack } from './pack-register.mjs';
import { selectToyrecordPack, toyrecordAllowlist } from './toyrecord-pack.mjs';
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

test('verified catalog pack is bound to reproduction, grounding, report and transcript', async () => {
  const image = `sha256:${'a'.repeat(64)}`;
  const registered = await registerPack({ packRoot: new URL('../fixtures/skills/toyrecord-repro/', import.meta.url).pathname,
    allowlist: toyrecordAllowlist, catalog: [] });
  const selection = await selectToyrecordPack({ catalog: registered.catalog, version: '1.0.0',
    installation: { schema_version: 'toyrecord_installation.v1', pack: registered.pin,
      target_pair_id: 'toyrecord.sandbox-observation.v1', image } });
  const events = [];
  const transcripts = { start() { return { run_id: 'pack-run', emit(event, data) { events.push({ event, data }); }, close() {} }; } };
  const result = await runOssReproSmoke({ image, selection, runnerFactory: fakeRunner('reproduced'), model: fixtureModel(), config, transcripts });
  assert.equal(result.completed, true);
  assert.equal(result.selected_pack.pack_sha256, registered.pin.pack_sha256);
  assert.equal(result.selected_pack.skill_set_hash, selection.skill_set_hash);
  assert.equal(result.reproduction.target_pair_digest.length, 64);
  assert.deepEqual(events.slice(0, 2).map(item => item.event), ['run_started', 'pack_selected']);
  assert.deepEqual(events[1].data, result.selected_pack);
  assert.equal(JSON.stringify(result.selected_pack).includes('root'), false);
  await assert.rejects(runOssReproSmoke({ image: `sha256:${'b'.repeat(64)}`, selection, config,
    model: { info: fixtureModel().info, complete() { assert.fail('must not call model'); } },
    runnerFactory() { assert.fail('must not start runner'); } }), /TOYRECORD_INSTALLATION_MISMATCH/);
});
