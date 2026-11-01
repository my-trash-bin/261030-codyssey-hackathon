// 원문과 공개 내용을 대조하는 읽기 전용 API. 화면이 값을 계산하지 않고 서버가 준 구간과 표현만 그린다.
import { asInt, asNonEmptyString, asString, isRecord } from './disclosure-contract.ts';
import type { Disposition, EvidenceLocator, Projection, Representation } from './disclosure-contract.ts';
import { requestJson } from './workflow-client.ts';
import type { WorkflowResult } from './workflow-client.ts';

export interface SourceFileView {
  id: string;
  displayName: string;
  format: string;
  byteSize: number;
}

export interface OriginalSpan {
  evidenceId: string;
  sourceName: string;
  locator: EvidenceLocator;
  start: number;
  end: number;
  text: string;
  truncated: boolean;
}

export interface ComparisonRow {
  id: string;
  kind: string;
  statement: string;
  required: boolean;
  disposition: Disposition | null;
  representation: Representation | null;
  disclosed: Projection | null;
  draftSentences: string[];
  draftTable: boolean;
  originals: OriginalSpan[];
}

export interface DisclosureComparison {
  revision: number;
  hasDraft: boolean;
  sources: SourceFileView[];
  rows: ComparisonRow[];
}

export interface SourceContent {
  id: string;
  text: string;
}

const base = '/api/v1/tasks';

function parseFile(value: unknown): SourceFileView | null {
  if (!isRecord(value)) return null;
  const id = asNonEmptyString(value.id);
  const displayName = asString(value.display_name);
  const format = asString(value.format);
  const byteSize = asInt(value.byte_size);
  if (id === null || displayName === null || format === null || byteSize === null) return null;
  return { id, displayName, format, byteSize };
}

function parseSpan(value: unknown): OriginalSpan | null {
  if (!isRecord(value) || !isRecord(value.locator)) return null;
  const evidenceId = asNonEmptyString(value.evidence_id);
  const sourceName = asString(value.source_name);
  const start = asInt(value.start);
  const end = asInt(value.end);
  const text = asString(value.text);
  if (evidenceId === null || sourceName === null || start === null || end === null || text === null) return null;
  return { evidenceId, sourceName, locator: value.locator as unknown as EvidenceLocator, start, end, text, truncated: value.truncated === true };
}

function parseRow(value: unknown): ComparisonRow | null {
  if (!isRecord(value) || !Array.isArray(value.originals)) return null;
  const id = asNonEmptyString(value.candidate_id);
  const kind = asString(value.kind);
  const statement = asString(value.statement);
  const disposition = value.disposition;
  if (id === null || kind === null || statement === null) return null;
  if (disposition !== null && disposition !== 'allow' && disposition !== 'exclude' && disposition !== 'defer') return null;
  const originals = value.originals.map(parseSpan);
  if (originals.some((span) => span === null)) return null;
  return {
    id,
    kind,
    statement,
    required: value.required === true,
    disposition,
    representation: isRecord(value.representation) ? value.representation as unknown as Representation : null,
    disclosed: isRecord(value.disclosed) ? value.disclosed as unknown as Projection : null,
    draftSentences: Array.isArray(value.draft_sentences) ? value.draft_sentences.filter((line): line is string => typeof line === 'string') : [],
    draftTable: value.draft_table === true,
    originals: originals as OriginalSpan[],
  };
}

export function parseComparison(body: unknown): DisclosureComparison | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const data = body.data;
  const revision = asInt(data.input_revision);
  if (revision === null || !Array.isArray(data.sources) || !Array.isArray(data.candidates)) return null;
  const sources = data.sources.map(parseFile);
  const rows = data.candidates.map(parseRow);
  if (sources.some((file) => file === null) || rows.some((row) => row === null)) return null;
  return { revision, hasDraft: data.has_draft === true, sources: sources as SourceFileView[], rows: rows as ComparisonRow[] };
}

function parseContent(body: unknown): SourceContent | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const id = asNonEmptyString(body.data.id);
  const text = asString(body.data.text);
  return id === null || text === null ? null : { id, text };
}

export function readComparison(fetchFn: typeof fetch, taskId: string): Promise<WorkflowResult<DisclosureComparison>> {
  return requestJson(fetchFn, {
    method: 'GET',
    path: `${base}/${encodeURIComponent(taskId)}/disclosure-comparison`,
    parse: parseComparison,
  });
}

export function readSourceContent(fetchFn: typeof fetch, taskId: string, sourceId: string): Promise<WorkflowResult<SourceContent>> {
  return requestJson(fetchFn, {
    method: 'GET',
    path: `${base}/${encodeURIComponent(taskId)}/sources/${encodeURIComponent(sourceId)}/content`,
    parse: parseContent,
  });
}

export function originalLocation(span: OriginalSpan): string {
  const { locator } = span;
  if (locator.kind === 'csv_cell') {
    const parts = [span.sourceName];
    if (locator.column) parts.push(`${locator.column} 열`);
    if (locator.row !== undefined) parts.push(`${locator.row.toString()}행`);
    return parts.join(' · ');
  }
  if (locator.kind === 'json_pointer' && locator.pointer) return `${span.sourceName} · ${locator.pointer}`;
  return `${span.sourceName} · ${span.start.toString()}–${span.end.toString()}바이트`;
}
