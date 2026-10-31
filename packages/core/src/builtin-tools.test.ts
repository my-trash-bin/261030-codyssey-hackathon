import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { builtinArgumentsHash, createBuiltinTools } from './builtin-tools.ts';
import type { BuiltinToolId } from './builtin-tools.ts';
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
function execute(id: BuiltinToolId, args: unknown) {
  const tools = createBuiltinTools({ task_id: 'task', revision: 1, grants: [{ id: 'grant', tool_id: id, arguments_sha256: builtinArgumentsHash(args) }] });
  return tools[id].run({ tool_id: id, tool_version: '1.0.0', task_id: 'task', revision: 1, grant_ids: ['grant'], arguments: args });
}
const output = (id: BuiltinToolId, args: unknown): any => {
  const result = execute(id, args); assert.equal(result.status, 'ok', JSON.stringify(result.internal_diagnostics)); return result.public_result;
};
const error = (id: BuiltinToolId, args: unknown, expected?: string) => {
  const result = execute(id, args); assert.equal(result.status, 'error'); assert.equal(result.public_result, null);
  if (expected) assert.equal((result.internal_diagnostics as any).code, expected);
};
test('series transformations preserve approved information boundaries and exact HALF_UP rounding', () => {
  const id = 'derive_series_v1';
  assert.deepEqual(output(id, { counts: [820,1160,1740], transform: 'index_base100' }).rows, [['100'],['141'],['212']]);
  assert.deepEqual(output(id, { counts: [8,9], transform: 'index_base100' }).rows, [['100'],['113']]);
  assert.deepEqual(output(id, { counts: [1,Number.MAX_SAFE_INTEGER], transform: 'index_base100' }).rows, [['100'],['900719925474099100']]);
  assert.deepEqual(output(id, { counts: [8,9], transform: 'index_base100', decimal_places: 2 }).rows, [['100.00'],['112.50']]);
  assert.deepEqual(output(id, { counts: [820,780,1740], transform: 'direction_only' }).rows, [['1','기준'],['2','감소'],['3','증가']]);
  const summary = output(id, { counts: [820,1160,1740], transform: 'fact_summary' });
  assert.equal(summary.statement, '관찰된 구간에서 요청량이 증가했습니다.');
  assert(!/820|1160|1740|141|212/.test(JSON.stringify(summary)));
  assert(!output(id, { counts: [820,780,1740], transform: 'fact_summary' }).statement.includes('증가했습니다'));
  assert.deepEqual(output(id, { counts: [0,3], transform: 'selected_values' }).rows, [['0'],['3']]);
  for (const counts of [[], [-1,1], [1,1.5]]) {
    error(id, { counts, transform: 'direction_only' });
  }
  error(id, { counts: [0,1], transform: 'index_base100' }, 'INDEX_BASELINE_ZERO');
  error(id, { counts: [1], transform: 'fact_summary' }, 'INSUFFICIENT_OBSERVATIONS');
  error(id, { counts: [1,2], transform: 'index_base100', decimal_places: 5 });
});
test('timeline modes expose only approved sequence intervals or explicit synthetic schedule', () => {
  const id = 'render_timeline_v1', events = [{ id: 'a', statement: 'first', at: '2026-01-01T00:00:00Z' }, { id: 'b', statement: 'second', at: '2026-01-01T00:00:05Z' }];
  const sequence = output(id, { events, mode: 'sequence_only' });
  assert(!JSON.stringify(sequence).includes('2026')); assert.deepEqual(sequence.rows, [['1','first'],['2','second']]);
  assert.deepEqual(output(id, { events, mode: 'relative_intervals' }).rows, [['T+0초','first'],['T+5초','second']]);
  assert.equal(output(id, { events, mode: 'shifted_absolute', base_epoch_seconds: 0 }).rows[1][0], '1970-01-01T00:00:05.000Z');
  const synthetic = output(id, { events, mode: 'synthetic_schedule', base_epoch_seconds: 0, synthetic_interval_seconds: 11 });
  assert.equal(synthetic.synthetic, true); assert.equal(synthetic.rows[1][0], '1970-01-01T00:00:11.000Z');
  error(id, { events: [...events].reverse(), mode: 'relative_intervals' });
  error(id, { events: [{ ...events[0], at: '2026-02-30T00:00:00Z' }], mode: 'relative_intervals' });
  error(id, { events, mode: 'sequence_only', base_epoch_seconds: 0 });
});
test('configuration uses documentation addresses and real route references only', () => {
  const id = 'make_config_example_v1';
  for (const address of ['192.0.2.17','198.51.100.88','203.0.113.1']) {
    const args = { upstreams: [{ id: 'primary', address }], route: { upstream_id: 'primary' } };
    assert.deepEqual(output(id, args), args);
  }
  for (const address of ['127.0.0.1','8.8.8.8','192.0.2.256','192.000.2.17','https://example.test']) {
    error(id, { upstreams: [{ id: 'primary', address }], route: { upstream_id: 'primary' } }, 'NOT_DOCUMENTATION_ADDRESS');
  }
  error(id, { upstreams: [{ id: 'primary', address: '192.0.2.17' }], route: { upstream_id: 'missing' } }, 'INVALID_ROUTE_REFERENCE');
});
test('synthetic inputs are new deterministic same-length pairs, not transformations of original data', () => {
  const id = 'make_synthetic_inputs_v1', args = { seed: 42, codepoint_count: 6 };
  const first = output(id, args); assert.deepEqual(output(id, args), first);
  assert.notDeepEqual(output(id, { ...args, seed: 43 }).inputs, first.inputs);
  assert.match(first.inputs.ascii, /^[A-Z]{6}$/); assert.match(first.inputs.multibyte, /^[가-힣]{6}$/);
  for (const count of [1,8]) assert.equal([...output(id, { ...args, codepoint_count: count }).inputs.multibyte].length, count);
  for (const count of [0,9,1.5]) error(id, { ...args, codepoint_count: count });
  error(id, { ...args, original: 'PRIVATE' }); error(id, { ...args, seed: -1 });
});
test('excerpts bind source bytes UTF-8 boundaries masking and final rendered hash', () => {
  const id = 'render_approved_excerpt_v1', source = 'A한글Z';
  const args = { source_version_id: 'v1', source_sha256: hash(source), raw_bytes: Buffer.from(source).toString('base64'),
    start: 1, end: 7, hidden_ranges: [{ start: 1, end: 4 }], rendered_sha256: hash('[가림]글') };
  assert.equal(output(id, args).excerpt, '[가림]글');
  error(id, { ...args, source_sha256: hash('wrong') }, 'SOURCE_HASH_MISMATCH');
  error(id, { ...args, rendered_sha256: hash('wrong') }, 'RENDERED_HASH_MISMATCH');
  for (const patch of [{ start: 2 }, { end: 5 }, { hidden_ranges: [{ start: 0, end: 4 }] },
    { hidden_ranges: [{ start: 1, end: 4 }, { start: 1, end: 4 }] }]) error(id, { ...args, ...patch }, 'INVALID_EXCERPT_RANGE');
});
test('tool envelope and argument digest bind a trusted grant without authorizing request IDs', () => {
  const id = 'make_synthetic_inputs_v1', args = { seed: 1, codepoint_count: 6 };
  const tools = createBuiltinTools({ task_id: 'task', revision: 1, grants: [{ id: 'g', tool_id: id, arguments_sha256: builtinArgumentsHash(args) }] });
  const request = { tool_id: id, tool_version: '1.0.0', task_id: 'task', revision: 1, grant_ids: ['g'], arguments: args };
  for (const patch of [{ task_id: 'other' }, { revision: 2 }, { grant_ids: [] }, { grant_ids: ['invented'] }, { arguments: { ...args, seed: 2 } }]) {
    assert.equal(tools[id].run({ ...request, ...patch }).status, 'denied');
  }
  assert.equal(tools[id].run({ ...request, extra: true } as never).status, 'error');
  assert.equal(tools[id].run({ ...request, arguments: { seed: NaN, codepoint_count: 6 } }).status, 'error');
  assert.equal(builtinArgumentsHash({ seed: 1, codepoint_count: 6 }), builtinArgumentsHash({ codepoint_count: 6, seed: 1 }));
});
