import { fields, requireInput, sha256 } from './builtin-tools.ts';
export const shortText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
export function deriveSeries(value: unknown): unknown {
  const a = fields(value, ['counts', 'transform'], ['decimal_places']);
  requireInput(Array.isArray(a.counts) && a.counts.length > 0 && a.counts.length <= 100 && a.counts.every((n: unknown) => integer(n) && n >= 0));
  const counts: number[] = a.counts;
  requireInput(['fact_summary', 'direction_only', 'index_base100', 'selected_values'].includes(a.transform));
  const places = a.decimal_places ?? 0;
  requireInput(integer(places) && places >= 0 && places <= 4 && (a.transform === 'index_base100' || a.decimal_places === undefined));
  if (a.transform === 'selected_values') return { columns: ['value'], rows: counts.map(n => [String(n)]) };
  if (a.transform === 'index_base100') {
    requireInput(counts[0] !== 0, 'INDEX_BASELINE_ZERO');
    const baseline = BigInt(counts[0]!);
    const rows = counts.map(n => {
      const numerator = BigInt(n) * 100n * 10n ** BigInt(places);
      const rounded = (2n * numerator + baseline) / (2n * baseline);
      const digits = rounded.toString().padStart(places + 1, '0');
      return [places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits];
    });
    return { columns: ['index'], rows };
  }
  requireInput(counts.length >= 2, 'INSUFFICIENT_OBSERVATIONS');
  const directions = counts.map((n, i) => i === 0 ? '기준' : n > counts[i - 1]! ? '증가' : n < counts[i - 1]! ? '감소' : '동일');
  if (a.transform === 'direction_only') return { columns: ['observation', 'direction'], rows: directions.map((d, i) => [String(i + 1), d]) };
  const allUp = directions.slice(1).every(d => d === '증가'), allDown = directions.slice(1).every(d => d === '감소');
  const statement = allUp ? '관찰된 구간에서 요청량이 증가했습니다.' : allDown ? '관찰된 구간에서 요청량이 감소했습니다.' :
    directions.slice(1).every(d => d === '동일') ? '관찰된 구간에서 요청량의 변화가 없었습니다.' : '관찰된 구간에서 요청량이 일정한 방향으로 변하지 않았습니다.';
  return { statement, columns: [], rows: [] };
}
function timestamp(value: unknown): number {
  requireInput(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value));
  const ms = Date.parse(value); requireInput(Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/(?<!\.\d{3})Z$/, '.000Z'));
  return ms;
}
export function renderTimeline(value: unknown): unknown {
  const a = fields(value, ['events', 'mode'], ['base_epoch_seconds', 'synthetic_interval_seconds']);
  requireInput(Array.isArray(a.events) && a.events.length > 0 && a.events.length <= 100 &&
    ['sequence_only', 'relative_intervals', 'shifted_absolute', 'synthetic_schedule'].includes(a.mode));
  const ids = new Set<string>();
  for (const event of a.events) {
    const e = fields(event, ['id', 'statement'], ['at']);
    requireInput(shortText(e.id) && shortText(e.statement) && !ids.has(e.id)); ids.add(e.id);
  }
  requireInput(a.base_epoch_seconds === undefined || (['shifted_absolute', 'synthetic_schedule'].includes(a.mode) && integer(a.base_epoch_seconds)));
  requireInput(a.synthetic_interval_seconds === undefined || (a.mode === 'synthetic_schedule' && integer(a.synthetic_interval_seconds) && a.synthetic_interval_seconds >= 0));
  if (a.mode === 'sequence_only') return { columns: ['event', 'statement'], rows: a.events.map((e: any, i: number) => [String(i + 1), e.statement]) };
  let offsets: number[];
  if (a.mode === 'synthetic_schedule') offsets = a.events.map((_e: unknown, i: number) => i * (a.synthetic_interval_seconds ?? 5) * 1000);
  else {
    const times: number[] = a.events.map((e: any) => timestamp(e.at));
    requireInput(times.every((n: number, i: number) => !i || n >= times[i - 1]!)); offsets = times.map((n: number) => n - times[0]!);
  }
  if (a.mode === 'relative_intervals') return { columns: ['relative_time', 'statement'], rows: a.events.map((e: any, i: number) => [`T+${offsets[i]! / 1000}초`, e.statement]) };
  requireInput(integer(a.base_epoch_seconds));
  const rows = a.events.map((e: any, i: number) => {
    const time = a.base_epoch_seconds * 1000 + offsets[i]!; requireInput(Number.isSafeInteger(time) && Math.abs(time) <= 8640000000000000);
    return [new Date(time).toISOString(), e.statement];
  });
  return { synthetic: a.mode === 'synthetic_schedule', columns: ['time', 'statement'], rows };
}
export function makeConfigExample(value: unknown): unknown {
  const a = fields(value, ['upstreams', 'route']);
  requireInput(Array.isArray(a.upstreams) && a.upstreams.length > 0 && a.upstreams.length <= 100);
  const ids = new Set<string>();
  const upstreams = a.upstreams.map((value: unknown) => {
    const u = fields(value, ['id', 'address']);
    requireInput(shortText(u.id) && !ids.has(u.id) && typeof u.address === 'string'); ids.add(u.id);
    const parts = u.address.split('.');
    requireInput(parts.length === 4 && parts.every((p: string) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255) &&
      ['192.0.2', '198.51.100', '203.0.113'].includes(parts.slice(0, 3).join('.')), 'NOT_DOCUMENTATION_ADDRESS');
    return { id: u.id, address: u.address };
  });
  const route = fields(a.route, ['upstream_id']); requireInput(ids.has(route.upstream_id), 'INVALID_ROUTE_REFERENCE');
  return { upstreams, route: { upstream_id: route.upstream_id } };
}
export function makeSyntheticInputs(value: unknown): unknown {
  const a = fields(value, ['seed', 'codepoint_count']);
  requireInput(integer(a.seed) && a.seed >= 0 && a.seed <= 0xffffffff && integer(a.codepoint_count) && a.codepoint_count >= 1 && a.codepoint_count <= 8);
  let state: number = a.seed;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ state >>> 15, state | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return (n ^ n >>> 14) >>> 0;
  };
  let ascii = '', multibyte = '';
  for (let i = 0; i < a.codepoint_count; i++) { ascii += String.fromCharCode(65 + next() % 26); multibyte += String.fromCharCode(0xac00 + next() % 11172); }
  return { seed: a.seed, codepoint_count: a.codepoint_count, inputs: { ascii, multibyte } };
}
export function renderApprovedExcerpt(value: unknown): unknown {
  const a = fields(value, ['source_version_id', 'source_sha256', 'raw_bytes', 'start', 'end', 'hidden_ranges', 'rendered_sha256']);
  requireInput(shortText(a.source_version_id) && typeof a.raw_bytes === 'string' && a.raw_bytes.length <= 349528);
  const bytes = Buffer.from(a.raw_bytes, 'base64');
  requireInput(bytes.length <= 262144 && bytes.toString('base64') === a.raw_bytes && sha256(bytes) === a.source_sha256, 'SOURCE_HASH_MISMATCH');
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const boundary = (n: number) => integer(n) && n >= 0 && n <= bytes.length && (n === bytes.length || (bytes[n]! & 0xc0) !== 0x80);
  requireInput(boundary(a.start) && boundary(a.end) && a.start < a.end && Array.isArray(a.hidden_ranges) && a.hidden_ranges.length <= 100, 'INVALID_EXCERPT_RANGE');
  let cursor = a.start; const chunks: Buffer[] = [];
  for (const value of a.hidden_ranges) {
    const range = fields(value, ['start', 'end']);
    requireInput(boundary(range.start) && boundary(range.end) && range.start >= cursor && range.start >= a.start && range.end <= a.end && range.start < range.end, 'INVALID_EXCERPT_RANGE');
    chunks.push(bytes.subarray(cursor, range.start), Buffer.from('[가림]')); cursor = range.end;
  }
  chunks.push(bytes.subarray(cursor, a.end)); const rendered = Buffer.concat(chunks);
  requireInput(sha256(rendered) === a.rendered_sha256, 'RENDERED_HASH_MISMATCH');
  return { excerpt: rendered.toString('utf8'), bytes: rendered.toString('base64'), sha256: sha256(rendered) };
}
