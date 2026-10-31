import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { CoreError } from '@safehandoff/core-interface';
import type { SourceDocument } from '@safehandoff/core-interface';
import { parseEvidence } from './evidence-parser.ts';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function source(text: string, format: SourceDocument['format'] = 'txt', id = 'version-1'): SourceDocument {
  return { id, source_id: 'source', version: 1, display_name: 'fictional', format, source_slot: 'input',
    raw_bytes: Buffer.from(text).toString('base64'), sha256: hash(text), included: true };
}
const invalid = (error: unknown) => error instanceof CoreError && error.code === 'INVALID_CORE_INPUT';
test('text/log/md evidence preserves UTF-8 boundaries and source version identity', () => {
  for (const format of ['txt', 'log', 'md'] as const) {
    const input = source('한글🙂\r\nsecond\n', format);
    const { evidence } = parseEvidence([input]);
    assert.deepEqual(evidence.map(e => [e.start, e.end]), [[0, 10], [12, 18]]);
    assert.equal(evidence[0]!.evidence_sha256, hash('한글🙂'));
    assert.ok(evidence.every(e => e.source_version_id === input.id));
    assert.deepEqual(parseEvidence([input]).evidence, evidence);
    assert.notEqual(parseEvidence([{ ...input, id: 'version-2' }]).evidence[0]!.id, evidence[0]!.id);
  }
});
test('CSV handles quoted multiline values, escaped quotes, CRLF and empty cells with exact byte ranges', () => {
  const text = 'name,note\r\n한글,"a,b\r\n""q"""\r\nx,\r\n';
  const { evidence } = parseEvidence([source(text, 'csv')]);
  const bytes = Buffer.from(text);
  assert.equal(evidence.length, 4);
  assert.deepEqual(evidence.map(e => bytes.subarray(e.start, e.end).toString()), ['한글', '"a,b\r\n""q"""', 'x', '']);
  assert.deepEqual(evidence[1]!.locator, { kind: 'csv_cell', row: 2, column: 'note', value_sha256: hash('a,b\r\n"q"') });
  assert.equal(evidence[3]!.start, evidence[3]!.end);
  for (const e of evidence) assert.equal(e.evidence_sha256, hash(bytes.subarray(e.start, e.end)));
});
test('JSON Pointer escaping, nested arrays, exact numeric lexemes and empty containers', () => {
  const text = '{"a/b":{"~key":["한글\\n",12345678901234567890,null]},"empty":{}}';
  const { evidence } = parseEvidence([source(text, 'json')]);
  assert.deepEqual(evidence.map(e => e.locator.pointer), ['/a~1b/~0key/0', '/a~1b/~0key/1', '/a~1b/~0key/2', '/empty']);
  assert.equal(evidence[0]!.locator.value_sha256, hash('한글\n'));
  assert.equal(evidence[1]!.locator.value_sha256, hash('12345678901234567890'));
  for (const e of evidence) assert.equal(e.evidence_sha256, hash(Buffer.from(text).subarray(e.start, e.end)));
  assert.equal(parseEvidence([source('[]', 'json')]).evidence[0]!.locator.pointer, '');
});
test('malformed CSV/JSON fail closed rather than returning partial evidence', () => {
  for (const text of ['a,a\nx,y', 'a,b\nx', 'a\n"unterminated', 'a\n"x"oops', 'a\nx"y']) {
    assert.throws(() => parseEvidence([source(text, 'csv')]), invalid);
  }
  for (const text of ['{"x":1,"\\u0078":2}', '[1,]', '{"a":}', '{"a":1} trailing', '01', '"\\ud800"', '['.repeat(34) + '0' + ']'.repeat(34)]) {
    assert.throws(() => parseEvidence([source(text, 'json')]), invalid);
  }
});
test('input binding, inclusion, encoding and bounded source/evidence counts are enforced', () => {
  const good = source('abc');
  for (const patch of [{ sha256: 'a'.repeat(64) }, { included: false }, { raw_bytes: 'YWJj\n' }, { version: 0 },
    { raw_bytes: '/w==', sha256: hash(Buffer.from([255])) }, { display_name: '\ud800' }]) {
    assert.throws(() => parseEvidence([{ ...good, ...patch }]), invalid);
  }
  assert.throws(() => parseEvidence([]), invalid);
  assert.throws(() => parseEvidence([good, good]), invalid);
  assert.throws(() => parseEvidence([source('a'.repeat(262145))]), invalid);
  assert.throws(() => parseEvidence([source(Array(101).fill('x').join('\n'))]), invalid);
  assert.equal(parseEvidence([source('')]).evidence.length, 0);
});
