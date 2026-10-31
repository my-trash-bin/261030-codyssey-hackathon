import { createHash } from 'node:crypto';
import type { AnalyzeResult, SourceDocument } from '@safehandoff/core-interface';
import { TaskStoreError } from './task-error.ts';
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const text = (value: unknown): value is string => typeof value === 'string' && [...value].length <= 8192 && Buffer.from(value).toString() === value;
export function invalid(): never { throw new TaskStoreError('INVALID_ANALYSIS'); }
export function fields(value: unknown, required: string[], optional: string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(key => ![...required, ...optional].includes(key))) invalid();
}
export function validateSources(sources: SourceDocument[]): void {
  if (!Array.isArray(sources) || sources.length > 100) invalid();
  const ids = new Set<string>(), logical = new Set<string>(); let size = 0;
  for (const source of sources) {
    fields(source, ['id', 'source_id', 'version', 'display_name', 'format', 'source_slot', 'raw_bytes', 'sha256', 'included']);
    if (![source.id, source.source_id, source.display_name, source.source_slot].every(text) || !source.id || !source.source_id ||
      ids.has(source.id) || logical.has(source.source_id) || !Number.isSafeInteger(source.version) || source.version < 1 ||
      source.included !== true || !['txt', 'log', 'md', 'csv', 'json'].includes(source.format) ||
      typeof source.raw_bytes !== 'string' || source.raw_bytes.length > 349528 || !sha(source.sha256)) invalid();
    ids.add(source.id); logical.add(source.source_id);
    const bytes = Buffer.from(source.raw_bytes, 'base64'); size += bytes.length;
    if (bytes.length > 262144 || size > 1048576 || bytes.toString('base64') !== source.raw_bytes || hash(bytes) !== source.sha256) invalid();
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { invalid(); }
  }
}
export function sourceSetHash(sources: SourceDocument[]): string {
  return hash(JSON.stringify([...sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(source =>
    [source.id, source.source_id, source.version, source.format, source.source_slot, source.display_name, source.sha256])));
}
export function validateResult(result: AnalyzeResult, sources: SourceDocument[]): void {
  fields(result, ['evidence', 'proposals']);
  if (!Array.isArray(result.evidence) || result.evidence.length > 100) invalid();
  const knownSources = new Map(sources.map(source => [source.id, source])), evidenceIds = new Set<string>();
  for (const evidence of result.evidence) {
    fields(evidence, ['id', 'source_version_id', 'locator', 'start', 'end', 'evidence_sha256']);
    const source = knownSources.get(evidence.source_version_id);
    if (!source || !text(evidence.id) || !evidence.id || evidenceIds.has(evidence.id)) invalid();
    evidenceIds.add(evidence.id);
    const bytes = Buffer.from(source.raw_bytes, 'base64');
    const boundary = (i: number) => i === bytes.length || (bytes[i]! & 0xc0) !== 0x80;
    if (!Number.isSafeInteger(evidence.start) || !Number.isSafeInteger(evidence.end) || evidence.start < 0 || evidence.end < evidence.start ||
      evidence.end > bytes.length || !boundary(evidence.start) || !boundary(evidence.end) || hash(bytes.subarray(evidence.start, evidence.end)) !== evidence.evidence_sha256) invalid();
    const locator = evidence.locator;
    if (locator?.kind === 'byte_range') {
      fields(locator, ['kind']); if (!['txt', 'log', 'md'].includes(source.format)) invalid();
    } else if (locator?.kind === 'csv_cell') {
      fields(locator, ['kind', 'row', 'column', 'value_sha256']);
      if (source.format !== 'csv' || !Number.isSafeInteger(locator.row) || locator.row! < 2 || !text(locator.column) || !locator.column || !sha(locator.value_sha256)) invalid();
    } else if (locator?.kind === 'json_pointer') {
      fields(locator, ['kind', 'pointer', 'value_sha256']);
      if (source.format !== 'json' || !text(locator.pointer) || (locator.pointer !== '' && !locator.pointer.startsWith('/')) ||
        /~(?![01])/.test(locator.pointer) || !sha(locator.value_sha256)) invalid();
    } else invalid();
  }
  const proposals = result.proposals;
  fields(proposals, ['schema_version', 'candidates', 'conflicts']);
  if (proposals.schema_version !== 'candidate_proposals.v1' || !Array.isArray(proposals.candidates) || proposals.candidates.length > 30 ||
    !Array.isArray(proposals.conflicts) || proposals.conflicts.length > 100) invalid();
  const keys = new Set<string>();
  for (const c of proposals.candidates) {
    fields(c, ['local_key', 'kind', 'uncertainty', 'statement', 'evidence_ids', 'relevance', 'purpose_relevance']);
    if (!text(c.local_key) || !c.local_key.trim() || keys.has(c.local_key) || !text(c.statement) || !c.statement.trim() ||
      !text(c.purpose_relevance) || !['observation', 'constraint', 'hypothesis', 'unknown', 'identifier'].includes(c.kind) ||
      !['observed', 'reported', 'inferred', 'unknown'].includes(c.uncertainty) || !['required', 'optional'].includes(c.relevance) ||
      !Array.isArray(c.evidence_ids) || c.evidence_ids.length > 100 || new Set(c.evidence_ids).size !== c.evidence_ids.length ||
      !c.evidence_ids.every(id => evidenceIds.has(id))) invalid();
    keys.add(c.local_key);
  }
  const groups = new Set<string>();
  for (const conflict of proposals.conflicts) {
    fields(conflict, ['local_keys', 'reason']);
    if (!Array.isArray(conflict.local_keys) || conflict.local_keys.length < 2 || conflict.local_keys.length > 100 ||
      new Set(conflict.local_keys).size !== conflict.local_keys.length || !conflict.local_keys.every(key => keys.has(key)) ||
      !text(conflict.reason) || !conflict.reason.trim()) invalid();
    const signature = JSON.stringify([...conflict.local_keys].sort());
    if (groups.has(signature)) invalid(); groups.add(signature);
  }
}
