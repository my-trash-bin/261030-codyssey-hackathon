import assert from 'node:assert/strict';
import test from 'node:test';

import { originalLocation, parseComparison } from './source-views-client.ts';
import type { OriginalSpan } from './source-views-client.ts';

const row = {
  candidate_id: 'c1',
  kind: 'identifier',
  statement: '가상 문장',
  required: false,
  disposition: 'exclude',
  representation: null,
  disclosed: null,
  draft_sentences: ['초안 문장'],
  draft_table: true,
  originals: [{
    evidence_id: 'e1',
    source_name: '가상.log',
    locator: { kind: 'byte_range' },
    start: 0,
    end: 4,
    text: '원문',
    truncated: false,
  }],
};
const body = (candidates: unknown[]) => ({
  data: {
    input_revision: 3,
    has_draft: true,
    sources: [{ id: 's1', display_name: '가상.log', format: 'txt', byte_size: 4 }],
    candidates,
  },
});

test('대조 응답은 원문 구간과 결정을 그대로 읽는다', () => {
  const parsed = parseComparison(body([row]));
  assert.equal(parsed?.revision, 3);
  assert.equal(parsed?.sources[0]?.byteSize, 4);
  assert.equal(parsed?.rows[0]?.disposition, 'exclude');
  assert.equal(parsed?.rows[0]?.originals[0]?.text, '원문');
  assert.equal(parsed?.hasDraft, true);
  assert.deepEqual(parsed?.rows[0]?.draftSentences, ['초안 문장']);
  assert.equal(parsed?.rows[0]?.draftTable, true);
});

test('대조 응답의 모양이 틀리면 일부만 그리지 않고 거부한다', () => {
  assert.equal(parseComparison(body([{ ...row, disposition: 'approved' }])), null);
  assert.equal(parseComparison(body([{ ...row, originals: [{ evidence_id: 'e1' }] }])), null);
  assert.equal(parseComparison({ data: { input_revision: 3, sources: [] } }), null);
});

test('원문 위치는 근거 종류에 맞게 표시한다', () => {
  const span: OriginalSpan = { evidenceId: 'e', sourceName: '표.csv', locator: { kind: 'csv_cell', column: 'count', row: 2 }, start: 1, end: 2, text: '9', truncated: false };
  assert.equal(originalLocation(span), '표.csv · count 열 · 2행');
  assert.equal(originalLocation({ ...span, sourceName: '설정.json', locator: { kind: 'json_pointer', pointer: '/a' } }), '설정.json · /a');
  assert.equal(originalLocation({ ...span, sourceName: '메모.md', locator: { kind: 'byte_range' } }), '메모.md · 1–2바이트');
});
