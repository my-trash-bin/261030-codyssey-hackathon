import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CoreError, ModelError } from '@safehandoff/core-interface';
import type { Candidate, EngineConfig, ModelClient, SourceDocument } from '@safehandoff/core-interface';
import { RealCore } from './index.ts';
import { parseEvidence } from './evidence-parser.ts';
import { calculatePreview, validateRepresentation } from './disclosure.ts';
import { parseDisclosureProposal } from './validation.ts';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function setup(raw: string, format: 'csv' | 'json' = 'csv') {
  const sources: SourceDocument[] = [{ id: 'v1', source_id: 's1', version: 1, included: true, source_slot: 'input',
    display_name: 'fictional', format, raw_bytes: Buffer.from(raw).toString('base64'), sha256: sha(raw) }];
  const evidence = parseEvidence(sources).evidence;
  const c: Candidate = { local_key: 'server-candidate', kind: 'observation', statement: '가상 관찰', uncertainty: 'observed',
    relevance: 'optional', purpose_relevance: 'test', evidence_ids: evidence.map(e => e.id) };
  return { sources, evidence, c };
}
const selected = (fields: string[]) => ({ kind: 'selected_fields' as const, transform_id: 'select_fields.v1', parameters: { fields } });
test('selected CSV fields use decoded logical cells only, including quoted commas and newlines', () => {
  const f = setup('secret,label,count\nprivate,"hello,\nworld",2\nhidden,"say ""hi""",5\n');
  const p = calculatePreview(f.c, selected(['label', 'count']), 4, f);
  assert.deepEqual(p.projection, { statement: '', columns: ['label', 'count'], rows: [['hello,\nworld', '2'], ['say "hi"', '5']] });
  assert.equal(p.projection_sha256, sha(JSON.stringify(p.projection)));
  assert.deepEqual(p.raw_grants, []);
  assert.ok(!JSON.stringify(p).includes('private'));
  for (const fields of [['missing'], ['count', 'count'], []]) assert.throws(() => calculatePreview(f.c, selected(fields), 4, f), CoreError);
  const changed = structuredClone(f); changed.sources[0]!.raw_bytes = Buffer.from('changed').toString('base64');
  assert.throws(() => calculatePreview(f.c, selected(['count']), 4, changed), CoreError);
  const foreign = { ...f.c, evidence_ids: ['foreign-task'] };
  assert.throws(() => calculatePreview(foreign, selected(['count']), 4, f), CoreError);
});
test('JSON pointers preserve root, escaping, scalar and empty-container values', () => {
  const f = setup('{"a/b":"한글","empty":{},"count":3}', 'json');
  assert.deepEqual(calculatePreview(f.c, selected(['/empty', '/a~1b']), 1, f).projection.rows, [['{}', '한글']]);
  const root = setup('"root value"', 'json');
  assert.deepEqual(calculatePreview(root.c, selected(['']), 1, root).projection.rows, [['root value']]);
});
test('series transform requires one numeric column, exact value requires one evidence, mixed sources are rejected', () => {
  const f = setup('count\n2\n5\n5\n');
  const p = calculatePreview(f.c, { kind: 'derived_table', transform_id: 'series_direction_only.v1', parameters: {} }, 1, f);
  assert.deepEqual(p.projection.rows, [['1', '기준'], ['2', '증가'], ['3', '동일']]);
  assert.throws(() => calculatePreview(f.c, { kind: 'exact_value' }, 1, f), CoreError);
  const exact = calculatePreview({ ...f.c, evidence_ids: [f.evidence[0]!.id] }, { kind: 'exact_value' }, 1, f);
  assert.deepEqual(exact.projection.rows, [['2']]);
  const sparse = setup('a,b\n1,2\n3,4\n'); sparse.c.evidence_ids = [sparse.evidence[0]!.id, sparse.evidence[3]!.id];
  assert.throws(() => calculatePreview(sparse.c, selected(['a', 'b']), 1, sparse), CoreError);
});
test('disclosure proposal parsing cannot mint permission or accept unrelated candidate references', () => {
  const good = { schema_version: 'disclosure_proposal.v1', candidate_id: 'c', status: 'supported',
    representation: selected(['count']), requires_clarification: false };
  assert.deepEqual(parseDisclosureProposal(JSON.stringify(good), 'c', validateRepresentation), good);
  for (const value of [{ ...good, candidate_id: 'other' }, { ...good, allow: true }, { ...good, status: 'ambiguous' },
    { ...good, representation: { kind: 'approved_excerpt' } }]) {
    assert.throws(() => parseDisclosureProposal(JSON.stringify(value), 'c', validateRepresentation), ModelError);
  }
});
test('RealCore condition interpretation uses disclosure role and bounded model contract', async () => {
  const f = setup('count\n2\n5\n'); let calls = 0;
  const client: ModelClient = { info: { ready: true, provider: 'fake', model: 'fixture' }, complete: async request => {
    calls++; assert.equal(request.role, 'disclosure');
    assert.equal(JSON.parse(request.input).condition, '추이만');
    assert.ok(!request.input.includes(f.sources[0]!.raw_bytes));
    return { text: JSON.stringify({ schema_version: 'disclosure_proposal.v1', candidate_id: f.c.local_key,
      status: 'supported', representation: { kind: 'fact_summary', transform_id: '', parameters: {} }, requires_clarification: false }),
      model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  const config = JSON.parse(readFileSync(new URL('../../../config.example.json', import.meta.url), 'utf8')) as EngineConfig;
  const core = new RealCore(client, config);
  assert.equal((await core.proposeDisclosure(f.c, { purpose: 'test', recipient: 'test' }, { condition: '추이만' })).status, 'supported');
  assert.equal(calls, 1);
});
