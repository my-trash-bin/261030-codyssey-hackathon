import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { ModelError } from '@safehandoff/core-interface';
import type { EngineConfig, ModelClient } from '@safehandoff/core-interface';
import { FileTranscriptSink, RealCore } from './index.ts';
import type { TranscriptEvent } from './index.ts';

const config = JSON.parse(readFileSync(new URL('../../../config.example.json', import.meta.url), 'utf8')) as EngineConfig;
const input = { purpose: 'synthetic', recipient: 'test', facts: [{ id: 'f_1', text: 'CONTENT_SENTINEL' }] };
function directory(t: TestContext) {
  const path = mkdtempSync(join(tmpdir(), 'safehandoff-transcript-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function records(path: string): TranscriptEvent[][] {
  return readdirSync(path).filter(name => name.endsWith('.jsonl')).map(name =>
    readFileSync(join(path, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
}
function model(): ModelClient {
  return { info: { provider: 'fake', model: 'PRIVATE_MODEL', ready: true }, async complete(request) {
    return { model: 'PRIVATE_MODEL', usage: { inputTokens: 1, outputTokens: 2 }, text: request.role === 'writer'
      ? JSON.stringify({ schema_version: 'draft.v1', blocks: [{ type: 'paragraph', text: 'CONTENT_SENTINEL', fact_ids: ['f_1'] }] })
      : JSON.stringify({ schema_version: 'review.v1', result: 'pass', issues: [] }) };
  } };
}
test('concurrent runs have isolated ordered replay events and metadata excludes content', async t => {
  const path = directory(t), core = new RealCore(model(), config, undefined, Date.now, new FileTranscriptSink(path));
  await Promise.all([core.generate(input), core.generate(input)]);
  const runs = records(path);
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0]![0]!.run_id, runs[1]![0]!.run_id);
  for (const run of runs) {
    assert.deepEqual(run.map(event => event.event), ['run_started', 'model_started', 'model_completed', 'model_started', 'model_completed', 'review_completed', 'run_completed']);
    assert.deepEqual(run.map(event => event.sequence), run.map((_, i) => i));
    assert.ok(run.every(event => event.run_id === run[0]!.run_id && event.schema_version === 'transcript.v1'));
    assert.equal(JSON.stringify(run).includes('CONTENT_SENTINEL'), false);
    assert.equal(JSON.stringify(run).includes('PRIVATE_MODEL'), false);
  }
  assert.equal(statSync(join(path, readdirSync(path)[0]!)).mode & 0o777, 0o600);
});
test('content opt-in records validated draft and denial needs no model call', async t => {
  const path = directory(t), core = new RealCore(model(), config, undefined, Date.now, new FileTranscriptSink(path, true));
  await core.generate(input);
  assert.ok(records(path)[0]!.some(event => event.event === 'model_completed' && event.content !== undefined));
  const pack = { schema_version: 'fact_pack.v1' as const, task_revision: 1, template_id: 'x', audience_type: 'x', output_language: 'ko', approved_brief: '', facts: [], required_fact_ids: [], tables: [], excerpt_slots: [], asset_slots: [], public_tool_results: [] };
  await core.writeReviewed(pack);
  const denied = records(path).find(run => run.some(event => event.data.grounding === 'denied'))!;
  assert.deepEqual(denied.map(event => event.event), ['run_started', 'review_completed', 'run_completed']);
});
test('failure logs fixed code, never arbitrary error text', async t => {
  const path = directory(t), client = model();
  client.complete = async () => { throw new ModelError('MODEL_CANCELLED'); };
  const core = new RealCore(client, config, undefined, Date.now, new FileTranscriptSink(path, true));
  await assert.rejects(core.generate(input));
  assert.equal(records(path)[0]!.at(-1)!.data.code, 'MODEL_CANCELLED');
});
test('retention removes only old trace filenames and clock supports deterministic elapsed time', t => {
  const path = directory(t), old = join(path, 'transcript-00000000-0000-0000-0000-000000000000.jsonl');
  writeFileSync(old, 'old'); utimesSync(old, 0, 0); writeFileSync(join(path, 'keep.txt'), 'keep');
  let now = 86_400_001;
  const sink = new FileTranscriptSink(path, false, () => now), run = sink.start('test');
  now += 25; run.emit('test'); run.close();
  assert.equal(readdirSync(path).includes('keep.txt'), true);
  assert.equal(readdirSync(path).includes(old.split('/').at(-1)!), false);
  assert.equal(records(path)[0]![0]!.elapsed_ms, 25);
});
