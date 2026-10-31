import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CoreError, ModelError } from '@safehandoff/core-interface';
import type { AnalyzeRequest, EngineConfig, ModelClient, ModelRequest } from '@safehandoff/core-interface';
import { FileTranscriptSink, RealCore } from './index.ts';
import { parseCandidateProposals } from './validation.ts';
import { parseEvidence } from './evidence-parser.ts';
const config = JSON.parse(readFileSync(new URL('../../../config.example.json', import.meta.url), 'utf8')) as EngineConfig;
const raw = 'RAW_ANALYSIS_SENTINEL 한글';
function request(): AnalyzeRequest {
  return { task: { purpose: 'support', recipient: 'vendor', output_language: 'ko' }, sources: [{
    id: 'version-1', source_id: 'source', version: 1, display_name: 'fictional.log', format: 'log', source_slot: 'input',
    raw_bytes: Buffer.from(raw).toString('base64'), sha256: createHash('sha256').update(raw).digest('hex'), included: true,
  }] };
}
function proposals(id: string) {
  return { schema_version: 'candidate_proposals.v1', candidates: [{ local_key: 'c1', kind: 'observation', uncertainty: 'observed',
    statement: 'MODEL_PRIVATE_SENTINEL', evidence_ids: [id], relevance: 'required', purpose_relevance: 'support' }], conflicts: [] };
}
function model(complete: ModelClient['complete']): ModelClient {
  return { info: { provider: 'fake', model: 'private', ready: true }, complete };
}
const response = (value: unknown) => ({ text: JSON.stringify(value), usage: { inputTokens: 1, outputTokens: 2 }, model: 'private' });

test('candidate example contracts, unknown fields and duplicate JSON keys', () => {
  const evidence = [{ id: 'ev_example' }] as ReturnType<typeof parseEvidence>['evidence'];
  const example = (name: string) => readFileSync(new URL(`../../../contracts/examples/${name}`, import.meta.url), 'utf8');
  assert.equal(parseCandidateProposals(example('candidate.valid.json'), evidence).candidates[0]!.local_key, 'c1');
  for (const name of ['candidate.unknown.invalid.json', 'candidate.duplicate.invalid.json']) {
    assert.throws(() => parseCandidateProposals(example(name), evidence), ModelError);
  }
  assert.deepEqual(parseCandidateProposals('{"schema_version":"candidate_proposals.v1","candidates":null,"conflicts":null}', []),
    { schema_version: 'candidate_proposals.v1', candidates: [], conflicts: [] });
});
test('candidate references, enums, uniqueness and bounds are deterministic', () => {
  const evidence = parseEvidence(request().sources).evidence, id = evidence[0]!.id;
  const good = proposals(id), candidate = good.candidates[0]!;
  const invalid = [
    { ...good, candidates: [{ ...candidate, evidence_ids: ['foreign-task'] }] },
    { ...good, candidates: [candidate, candidate] },
    { ...good, candidates: [{ ...candidate, kind: ['observation'] }] },
    { ...good, candidates: [{ ...candidate, grant_ids: ['approve'] }] },
    { ...good, candidates: [{ ...candidate, statement: 'x'.repeat(8193) }] },
    { ...good, candidates: Array(31).fill(candidate) },
    { ...good, conflicts: [{ local_keys: ['c1', 'missing'], reason: 'conflict' }] },
    { ...good, conflicts: [{ local_keys: ['c1', 'c1'], reason: 'conflict' }] },
  ];
  for (const value of invalid) assert.throws(() => parseCandidateProposals(JSON.stringify(value), evidence), ModelError);
  const two = { ...good, candidates: [candidate, { ...candidate, local_key: 'c2' }],
    conflicts: [{ local_keys: ['c1', 'c2'], reason: 'reported difference' }] };
  assert.equal(parseCandidateProposals(JSON.stringify(two), evidence).conflicts.length, 1);
  assert.throws(() => parseCandidateProposals(JSON.stringify({ ...two, conflicts: [...two.conflicts,
    { local_keys: ['c2', 'c1'], reason: 'duplicate group' }] }), evidence), ModelError);
});
test('analyze uses supplied evidence and only analysis role; invalid response retries without partial result', async () => {
  const calls: ModelRequest[] = [];
  const core = new RealCore(model(async input => {
    calls.push(input);
    if (calls.length === 1) return response(proposals('unknown'));
    const body = JSON.parse(input.input);
    assert.equal(body.sources[0].text, raw);
    assert.equal(body.sources[0].raw_bytes, undefined);
    return response(proposals(body.evidence[0].id));
  }), config);
  const result = await core.analyze(request());
  assert.deepEqual(calls.map(call => call.role), ['analysis', 'analysis']);
  assert.equal(result.proposals.candidates[0]!.evidence_ids[0], result.evidence[0]!.id);
  assert.equal(result.proposals.candidates[0]!.statement, 'MODEL_PRIVATE_SENTINEL');
});
test('bad snapshots and model input budget fail before any model call', async () => {
  let calls = 0;
  const client = model(async () => { calls++; return response({}); });
  const input = request(); input.sources[0]!.sha256 = 'a'.repeat(64);
  await assert.rejects(new RealCore(client, config).analyze(input), CoreError);
  await assert.rejects(new RealCore(client, { ...config, provider: { ...config.provider, max_input_bytes: 10 } }).analyze(request()),
    (error: unknown) => error instanceof ModelError && error.code === 'MODEL_BUDGET_EXCEEDED');
  assert.equal(calls, 0);
});
test('call limit and cancellation before/after response never return partial analysis', async () => {
  let calls = 0;
  const core = new RealCore(model(async () => { calls++; return response({}); }),
    { ...config, workflow: { ...config.workflow, max_model_calls_per_run: 1 } });
  await assert.rejects(core.analyze(request()), (error: unknown) => error instanceof ModelError && error.code === 'MODEL_BUDGET_EXCEEDED');
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(core.analyze(request(), { signal: controller.signal }), CoreError);
  assert.equal(calls, 1);
  const late = new AbortController();
  const cancelled = new RealCore(model(async input => {
    late.abort(); return response(proposals(JSON.parse(input.input).evidence[0].id));
  }), config);
  await assert.rejects(cancelled.analyze(request(), { signal: late.signal }), (error: unknown) => error instanceof CoreError && error.code === 'CORE_CANCELLED');
});
test('analysis content never enters transcript or a later writer request', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'analyze-trace-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const core = new RealCore(model(async input => {
    if (input.role === 'analysis') return response(proposals(JSON.parse(input.input).evidence[0].id));
    assert.equal(input.input.includes(raw), false);
    assert.equal(input.input.includes('MODEL_PRIVATE_SENTINEL'), false);
    return response(input.role === 'writer' ? { schema_version: 'draft.v1', blocks: [{ type: 'paragraph', text: 'PUBLIC', fact_ids: ['f1'] }] }
      : { schema_version: 'review.v1', result: 'pass', issues: [] });
  }), config, undefined, Date.now, new FileTranscriptSink(dir, true));
  await core.analyze(request());
  const trace = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8');
  assert.equal(trace.includes(raw), false); assert.equal(trace.includes('MODEL_PRIVATE_SENTINEL'), false);
  assert.equal(trace.includes('fictional.log'), false);
  assert.deepEqual(trace.trim().split('\n').map(line => JSON.parse(line).event),
    ['run_started', 'analysis_parsed', 'model_started', 'model_completed', 'analysis_completed', 'run_completed']);
  await core.generate({ purpose: 'support', recipient: 'vendor', facts: [{ id: 'f1', text: 'PUBLIC' }] });
});
