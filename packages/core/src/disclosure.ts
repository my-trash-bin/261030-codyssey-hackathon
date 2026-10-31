import { createHash, randomUUID } from 'node:crypto';
import { CoreError } from '@safehandoff/core-interface';
import type { Candidate, DisclosurePreview, EvidenceSpan, Representation, SourceDocument } from '@safehandoff/core-interface';
import { invalidSource, parseEvidence } from './evidence-parser.ts';
import { deriveSeries } from './transforms.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function validateRepresentation(value: unknown): Representation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidSource();
  const rep = value as Representation;
  if (Object.keys(rep).some(key => !['kind', 'transform_id', 'parameters'].includes(key)) ||
    (rep.transform_id !== undefined && typeof rep.transform_id !== 'string') ||
    (rep.parameters !== undefined && (!rep.parameters || typeof rep.parameters !== 'object' || Array.isArray(rep.parameters)))) invalidSource();
  const p = rep.parameters ?? {}, transform = rep.transform_id ?? '';
  if (rep.kind === 'fact_summary' && transform === '' && !Object.keys(p).length) return rep;
  if (rep.kind === 'selected_fields' && transform === 'select_fields.v1' && Object.keys(p).join(',') === 'fields' &&
    Array.isArray(p.fields) && p.fields.length > 0 && p.fields.length <= 100 && p.fields.every(f => typeof f === 'string') &&
    new Set(p.fields).size === p.fields.length) return rep;
  if (rep.kind === 'exact_value' && transform === '' && !Object.keys(p).length) return rep;
  if (rep.kind === 'derived_table' && transform === 'series_direction_only.v1' && !Object.keys(p).length) return rep;
  if (rep.kind === 'derived_table' && transform === 'series_index_base100.v1' &&
    Object.keys(p).every(k => k === 'decimal_places') && (p.decimal_places === undefined ||
      (typeof p.decimal_places === 'number' && Number.isInteger(p.decimal_places) && p.decimal_places >= 0 && p.decimal_places <= 4))) return rep;
  throw new CoreError('CORE_NOT_IMPLEMENTED');
}
export function calculatePreview(candidate: Candidate, representation: Representation, revision: number,
  context?: { sources: SourceDocument[]; evidence: EvidenceSpan[] }): DisclosurePreview {
  const rep = validateRepresentation(representation);
  if (!candidate || typeof candidate.statement !== 'string' || !candidate.statement.trim() ||
    candidate.statement.length > 8192 || !Number.isSafeInteger(revision) || revision < 1) invalidSource();
  let projection: DisclosurePreview['projection'] = { statement: candidate.statement, columns: [], rows: [] };
  if (rep.kind !== 'fact_summary') {
    if (!context || !candidate.evidence_ids.length || new Set(candidate.evidence_ids).size !== candidate.evidence_ids.length) invalidSource();
    const parsed = parseEvidence(context.sources);
    const refs = candidate.evidence_ids.map(id => {
      const e = context.evidence.find(e => e.id === id);
      if (!e || !parsed.evidence.some(p => p.source_version_id === e.source_version_id && p.start === e.start && p.end === e.end &&
        p.evidence_sha256 === e.evidence_sha256 && JSON.stringify(p.locator) === JSON.stringify(e.locator))) invalidSource();
      return e;
    });
    if (new Set(refs.map(e => e.source_version_id)).size !== 1) invalidSource();
    const source = context.sources.find(s => s.id === refs[0]!.source_version_id)!;
    const bytes = Buffer.from(source.raw_bytes, 'base64');
    const value = (e: EvidenceSpan): string => {
      const raw = bytes.subarray(e.start, e.end).toString('utf8');
      if (e.locator.kind === 'csv_cell') return raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw;
      if (e.locator.kind === 'json_pointer') {
        const v: unknown = JSON.parse(raw); return typeof v === 'string' ? v : raw;
      }
      return raw;
    };
    if (rep.kind === 'exact_value') {
      if (refs.length !== 1 || !['csv', 'json'].includes(source.format)) invalidSource();
      projection = { statement: '', columns: ['value'], rows: [[value(refs[0]!)]] };
    } else if (rep.kind === 'selected_fields') {
      const fields = rep.parameters!.fields as string[];
      if (!['csv', 'json'].includes(source.format)) invalidSource();
      const key = (e: EvidenceSpan) => source.format === 'csv' ? e.locator.column! : e.locator.pointer!;
      if (fields.some(f => !refs.some(e => key(e) === f))) invalidSource();
      let rows: string[][];
      if (source.format === 'csv') {
        const numbers = [...new Set(refs.map(e => e.locator.row!))].sort((a, b) => a - b);
        rows = numbers.map(row => fields.map(field => {
          const cells = refs.filter(e => e.locator.row === row && key(e) === field);
          if (cells.length !== 1) invalidSource(); return value(cells[0]!);
        }));
      } else rows = [fields.map(field => { const cells = refs.filter(e => key(e) === field);
        if (cells.length !== 1) invalidSource(); return value(cells[0]!); })];
      projection = { statement: '', columns: fields, rows };
    } else {
      if (source.format !== 'csv' || refs.some(e => e.locator.kind !== 'csv_cell') ||
        new Set(refs.map(e => e.locator.column)).size !== 1 || new Set(refs.map(e => e.locator.row)).size !== refs.length) invalidSource();
      const counts = refs.sort((a, b) => a.locator.row! - b.locator.row!).map(e => {
        const v = value(e); if (!/^(0|[1-9]\d*)$/.test(v) || !Number.isSafeInteger(Number(v))) invalidSource(); return Number(v);
      });
      const table = deriveSeries({ counts, transform: rep.transform_id === 'series_direction_only.v1' ? 'direction_only' : 'index_base100',
        ...(rep.parameters?.decimal_places !== undefined ? { decimal_places: rep.parameters.decimal_places } : {}) }) as { columns: string[]; rows: string[][] };
      projection = { statement: '', ...table };
    }
  }
  return { schema_version: 'disclosure_preview.v1', preview_id: randomUUID(), candidate_id: candidate.local_key,
    input_revision: revision, representation: structuredClone(rep), projection, projection_sha256: hash(JSON.stringify(projection)), raw_grants: [] };
}
