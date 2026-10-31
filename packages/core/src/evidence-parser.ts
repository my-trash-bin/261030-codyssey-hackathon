import { createHash } from 'node:crypto';
import { CoreError, csvCells } from '@safehandoff/core-interface';
import type { EvidenceLocator, EvidenceSpan, SourceDocument } from '@safehandoff/core-interface';

const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function invalidSource(): never { throw new CoreError('INVALID_CORE_INPUT'); }
export const wellFormed = (value: string): boolean => Buffer.from(value).toString('utf8') === value;
const short = (value: unknown): value is string => typeof value === 'string' && value.length <= 8192 && wellFormed(value);
export interface ParsedSources { evidence: EvidenceSpan[]; sources: (Omit<SourceDocument, 'raw_bytes'> & { text: string })[] }

// No filesystem reads: sources are the caller's entire immutable included snapshot.
export function parseEvidence(sources: SourceDocument[]): ParsedSources {
  if (!Array.isArray(sources) || !sources.length || sources.length > 100) invalidSource();
  const evidence: EvidenceSpan[] = [], decoded: ParsedSources['sources'] = [], ids = new Set<string>();
  let totalBytes = 0;
  for (const source of sources) {
    if (!source || Object.keys(source).sort().join(',') !== 'display_name,format,id,included,raw_bytes,sha256,source_id,source_slot,version' ||
      ![source.id, source.source_id, source.display_name, source.source_slot].every(short) || !source.id || !source.source_id ||
      ids.has(source.id) || source.included !== true || !Number.isSafeInteger(source.version) || source.version < 1 ||
      !['txt', 'log', 'md', 'csv', 'json'].includes(source.format) || typeof source.raw_bytes !== 'string' ||
      source.raw_bytes.length > 349528 || !/^[a-f0-9]{64}$/.test(source.sha256)) invalidSource();
    ids.add(source.id);
    const bytes = Buffer.from(source.raw_bytes, 'base64');
    totalBytes += bytes.length;
    if (bytes.toString('base64') !== source.raw_bytes || bytes.length > 262144 || totalBytes > 1048576 || sha(bytes) !== source.sha256) invalidSource();
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return invalidSource(); }
    const offset = (index: number) => Buffer.byteLength(text.slice(0, index));
    const emit = (start: number, end: number, locator: EvidenceLocator) => {
      if (evidence.length >= 100 || start > end) invalidSource();
      const from = offset(start), to = offset(end), evidenceHash = sha(bytes.subarray(from, to));
      evidence.push({ id: `ev_${sha(JSON.stringify([source.id, source.sha256, from, to, locator]))}`,
        source_version_id: source.id, start: from, end: to, locator, evidence_sha256: evidenceHash });
    };
    if (source.format === 'csv') parseCSV(text, emit);
    else if (source.format === 'json') parseJSON(text, emit);
    else for (const match of text.matchAll(/[^\r\n]+/gu)) emit(match.index, match.index + match[0].length, { kind: 'byte_range' });
    const { raw_bytes: _raw, ...metadata } = source;
    decoded.push({ ...metadata, text });
  }
  return { evidence, sources: decoded };
}
type Emit = (start: number, end: number, locator: EvidenceLocator) => void;

function parseCSV(text: string, emit: Emit): void {
  for (const cell of csvCells(text)) emit(cell.start, cell.end, { kind: 'csv_cell', row: cell.row, column: cell.column, value_sha256: sha(cell.value) });
}

function parseJSON(text: string, emit: Emit): void {
  let i = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(text[i] ?? '') && i < text.length) i++; };
  const string = (): string => {
    const start = i++;
    let closed = false;
    while (i < text.length) {
      const character = text[i++];
      if (character === '\\') i++;
      else if (character === '"') { closed = true; break; }
    }
    if (!closed) invalidSource();
    try {
      const value: unknown = JSON.parse(text.slice(start, i));
      if (typeof value !== 'string' || !wellFormed(value)) invalidSource();
      return value;
    } catch { return invalidSource(); }
  };
  const value = (pointer: string, depth: number) => {
    if (depth > 32 || pointer.length > 8192) invalidSource();
    whitespace();
    const start = i;
    let decodedString: string | undefined;
    if (text[i] === '{' || text[i] === '[') {
      const object = text[i++] === '{', close = object ? '}' : ']';
      const keys = new Set<string>();
      let index = 0;
      whitespace();
      if (text[i] !== close) {
        while (true) {
          whitespace();
          let key = String(index++);
          if (object) {
            if (text[i] !== '"') invalidSource();
            key = string();
            if (keys.has(key)) invalidSource();
            keys.add(key); whitespace();
            if (text[i++] !== ':') invalidSource();
          }
          value(pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'), depth + 1);
          whitespace();
          if (text[i] !== ',') break;
          i++;
        }
      }
      if (text[i++] !== close) invalidSource();
      if (index) return;
    } else if (text[i] === '"') decodedString = string();
    else {
      const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
      if (!match) invalidSource();
      i += match[0].length;
    }
    emit(start, i, { kind: 'json_pointer', pointer, value_sha256: sha(decodedString ?? text.slice(start, i)) });
  };
  value('', 0); whitespace();
  if (i !== text.length) invalidSource();
}
