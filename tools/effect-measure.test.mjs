// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { aggregate, parseCsv, renderSlide } from './effect-measure.mjs';

const { cases } = JSON.parse(readFileSync(new URL('../evaluation/effect-compare/cases.json', import.meta.url), 'utf8'));
const ids = ['a', 'b', 'c'];

/** @param {string} method @param {string} id @param {Partial<Record<string, string>>} [extra] */
const row = (method, id, extra = {}) => ({ case_id: id, method, mode: method === 'direct' ? 'none' : 'real',
  participant: 'p1', measured_at: '2026-10-31T10:00:00.000Z', person_seconds: '100', wait_seconds: '0',
  total_seconds: '100', leaks: '0', missing_clues: '0', revisions: '0', status: 'completed', ...extra });

test('the sample set has ten cases with checkable answer keys', () => {
  assert.equal(cases.length, 10);
  for (const item of cases) {
    assert.ok(item.forbidden.length && item.required.length);
    for (const word of item.forbidden) assert.ok(item.log.includes(word), `${item.id}: ${word}`);
    for (const fact of item.candidates) {
      const leaks = item.forbidden.some((/** @type {string} */ word) => fact.text.includes(word));
      assert.equal(leaks, !fact.safe, `${item.id}/${fact.id}`);
    }
  }
});

test('aggregate keeps abandoned runs in the denominator and out of the median', () => {
  const rows = [
    row('direct', 'a', { person_seconds: '100', leaks: '1' }), row('direct', 'b', { person_seconds: '300', missing_clues: '2' }),
    row('direct', 'c', { person_seconds: '900', status: 'abandoned', leaks: '5' }),
    row('safehandoff', 'a', { person_seconds: '40' }), row('safehandoff', 'b', { person_seconds: '60' }),
    row('safehandoff', 'c', { person_seconds: '50' }),
  ];
  const result = aggregate(rows, ids);
  assert.deepEqual([result.direct.completed, result.direct.total, result.direct.medianSeconds], [2, 3, 200]);
  assert.deepEqual([result.direct.leaks, result.direct.missingClues], [1, 2]);
  assert.equal(result.safehandoff.medianSeconds, 50);
});

test('aggregate refuses fake runs and missing cases', () => {
  const full = ids.flatMap(id => [row('direct', id), row('safehandoff', id)]);
  assert.throws(() => aggregate(full.slice(1), ids), /EFFECT_INCOMPLETE:direct/);
  assert.throws(() => aggregate([...full.slice(1), row('direct', 'a', { mode: 'fake' })], ids), /EFFECT_NOT_REAL_MODE/);
});

test('partial aggregation uses only cases measured both ways and labels them', () => {
  const rows = [row('direct', 'a'), row('safehandoff', 'a'), row('direct', 'b'), row('safehandoff', 'b'), row('direct', 'c')];
  const result = aggregate(rows, ids, { partial: true });
  assert.deepEqual([result.cases, result.partial, result.direct.total], [2, true, 2]);
  assert.ok(renderSlide('<!-- EFFECT:time:start -->x<!-- EFFECT:time:end --><!-- EFFECT:leak:start -->x<!-- EFFECT:leak:end -->' +
    '<!-- EFFECT:clue:start -->x<!-- EFFECT:clue:end --><!-- EFFECT:cond:start -->x<!-- EFFECT:cond:end -->', result).includes('예비 측정'));
  assert.throws(() => aggregate(rows.slice(0, 3), ids, { partial: true }), /EFFECT_TOO_FEW_CASES/);
});

test('slide rendering replaces every marked block and the CSV round-trips quotes', () => {
  const blocks = ['time', 'leak', 'clue', 'cond'].map(key => `<!-- EFFECT:${key}:start -->old<!-- EFFECT:${key}:end -->`).join('');
  const data = aggregate(ids.flatMap(id => [row('direct', id), row('safehandoff', id, { person_seconds: '50' })]), ids);
  const output = renderSlide(blocks, data);
  assert.ok(!output.includes('old'));
  assert.ok(output.includes('100초') && output.includes('50초') && output.includes('측정 2026-10-31'));
  assert.deepEqual(parseCsv('"a","b"\n"x ""y""","z"'), [{ a: 'x "y"', b: 'z' }]);
});
