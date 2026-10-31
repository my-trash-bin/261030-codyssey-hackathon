import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { composeFactPack, CoreError, judgeReproduction } from './index.ts';
import type { CandidateProposals, ComposeFactPackInput, ReproRun } from './index.ts';

const proposals: CandidateProposals = JSON.parse(readFileSync(new URL('../../../contracts/examples/candidate.valid.json', import.meta.url), 'utf8'));
function input(): ComposeFactPackInput {
  return { task: { purpose: 'support', recipient: 'vendor' }, task_revision: 1, template_id: 'support', audience_type: 'vendor',
    candidates: proposals.candidates, decisions: [{ id: 'f_1', candidate_id: 'c1', disposition: 'allow', revoked: false,
      representation: { kind: 'fact_summary' } }],
    previews: [{ schema_version: 'disclosure_preview.v1', preview_id: 'p1', candidate_id: 'c1', input_revision: 1,
      representation: { kind: 'fact_summary' }, projection_sha256: 'server-validated',
      projection: { statement: '응답 대기 시간이 초과됐습니다.', columns: [], rows: [] } }],
  };
}
test('example candidates become only approved preview facts compatible with the example draft', () => {
  const pack = composeFactPack(input());
  const draft = JSON.parse(readFileSync(new URL('../../../contracts/examples/draft.valid.json', import.meta.url), 'utf8'));
  assert.deepEqual(pack.required_fact_ids, draft.blocks[0].fact_ids);
  assert.equal(pack.facts[0]!.statement, draft.blocks[0].text);
  assert.equal(JSON.stringify(pack).includes('ev_example'), false);
  assert.equal(JSON.stringify(pack).includes(proposals.candidates[0]!.statement), false);
  assert.deepEqual(composeFactPack(input()), pack);
});
test('only current unrevoked unexpired allows enter the pack', () => {
  for (const disposition of ['exclude', 'defer'] as const) {
    const value = input(); value.decisions[0]!.disposition = disposition;
    assert.equal(composeFactPack(value).facts.length, 0);
  }
  const value = input(); value.decisions[0]!.revoked = true;
  assert.equal(composeFactPack(value).facts.length, 0);
  value.decisions[0]!.revoked = false; value.decisions[0]!.expires_at = '2026-01-01T00:00:00Z';
  assert.throws(() => composeFactPack(value), CoreError);
  assert.equal(composeFactPack(value, Date.parse('2026-01-01')).facts.length, 0);
  assert.equal(composeFactPack(value, Date.parse('2025-01-01')).facts.length, 1);
});
test('stale ambiguous mismatched and historical approvals fail closed', () => {
  for (const mutate of [
    (v: ComposeFactPackInput) => { v.previews[0]!.input_revision = 0; },
    (v: ComposeFactPackInput) => { v.previews.push(v.previews[0]!); },
    (v: ComposeFactPackInput) => { v.decisions.push(v.decisions[0]!); },
    (v: ComposeFactPackInput) => { v.previews[0]!.representation.kind = 'exact_value'; },
    (v: ComposeFactPackInput) => { v.candidates = []; },
  ]) { const value = input(); mutate(value); assert.throws(() => composeFactPack(value), CoreError); }
});
test('tables are copied and excerpts remain renderer slots', () => {
  const value = input();
  value.decisions[0]!.representation.kind = 'approved_excerpt';
  value.previews[0]!.representation.kind = 'approved_excerpt';
  value.previews[0]!.projection = { statement: 'approved', columns: ['direction'], rows: [['up']], excerpt: 'approved bytes' };
  const pack = composeFactPack(value);
  assert.deepEqual(pack.excerpt_slots, [{ id: 'f_1' }]);
  value.previews[0]!.projection.rows[0]![0] = 'private';
  assert.deepEqual(pack.tables[0]!.rows, [['up']]);
});
function matrix(): ReproRun[] {
  return ['buggy', 'fixed'].flatMap(target => ['ascii', 'multibyte'].map(input => ({ target, input,
    result: { schema_version: 'target_run.v1' as const, status: 'ok' as const, stage: 'persist' as const, code: null },
    exit_code: 0, output_exists: true, output_matches: true })));
}
test('four-run oracle distinguishes success, target symptom, controls, domain errors and timeout', () => {
  const runs = matrix();
  assert.equal(judgeReproduction(runs).status, 'not_reproduced');
  runs[1] = { ...runs[1]!, result: { schema_version: 'target_run.v1', status: 'domain_error', stage: 'encode', code: 'E_ENCODE_SHORT_BUFFER' },
    exit_code: 2, output_exists: false, output_matches: false };
  assert.equal(judgeReproduction(runs).status, 'reproduced');
  runs[1]!.result.stage = 'validate';
  assert.equal(judgeReproduction(runs).reason_code, 'UNEXPECTED_TARGET_OUTCOME');
  runs[0]!.output_matches = false;
  assert.equal(judgeReproduction(runs).reason_code, 'CONTROL_FAILED');
  runs[3]!.exit_code = 124;
  assert.equal(judgeReproduction(runs).reason_code, 'REPRO_TIMEOUT');
});
test('incomplete duplicate malformed and unexpected fixed outcomes cannot reproduce', () => {
  assert.equal(judgeReproduction(matrix().slice(0, 3)).status, 'inconclusive');
  assert.equal(judgeReproduction([...matrix(), matrix()[0]!]).status, 'error');
  const runs = matrix(); runs[3]!.output_matches = false;
  assert.equal(judgeReproduction(runs).status, 'inconclusive');
  runs[3]!.exit_code = 2;
  assert.equal(judgeReproduction(runs).status, 'error');
});
