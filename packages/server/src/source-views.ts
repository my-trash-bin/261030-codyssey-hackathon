// Read-only views that let the signed-in person compare raw material with what they approved.
// Nothing here feeds a model or an export; the task aggregate still never carries raw_bytes.
import type { TaskStore } from './task-store.ts';
import { deny } from './workflow-session.ts';

const EXCERPT_LIMIT = 2048;

export function excerpt(bytes: Buffer, start: number, end: number): { text: string; truncated: boolean } {
  const stop = Math.min(end, start + EXCERPT_LIMIT, bytes.length);
  // A span or the cap can split a UTF-8 sequence; drop the replacement characters that leaves at the edges.
  const text = bytes.subarray(start, stop).toString('utf8').replace(/^�+|�+$/g, '');
  return { text, truncated: stop < end };
}

export function disclosureComparison(store: TaskStore, id: string) {
  const sources = store.analysis.sources(id), evidence = store.analysis.evidence(id), now = Date.now(), task = store.get(id);
  const artifact = store.workflow.artifacts.current(id), draft = artifact?.revision === task.revision ? artifact.draft : null;
  // A fact id is the id of the decision that approved it, so blocks link back to candidates without the private pack.
  const sentences = (decisionId: string) => (draft?.blocks ?? []).flatMap(block => [
    ...(block.fact_ids?.includes(decisionId) && block.text ? [block.text] : []),
    ...(block.items ?? []).filter(item => item.fact_ids.includes(decisionId)).map(item => item.text),
  ]);
  const bytes = new Map(sources.map(s => [s.id, Buffer.from(s.raw_bytes, 'base64')]));
  const names = new Map(sources.map(s => [s.id, s.display_name]));
  const live = new Map(store.decisions(id)
    .filter(d => d.revoked_at === null && (d.expires_at === null || Date.parse(d.expires_at) > now))
    .map(d => [d.candidate_id, d]));
  return {
    input_revision: task.revision,
    has_draft: draft !== null,
    sources: sources.map(s => ({ id: s.id, display_name: s.display_name, format: s.format, byte_size: bytes.get(s.id)!.length })),
    candidates: store.analysis.candidates(id).map(c => {
      const decision = live.get(c.id);
      const preview = decision?.disposition === 'allow' && decision.preview_id ? store.getPreview(id, decision.preview_id) : null;
      return {
        candidate_id: c.id, kind: c.kind, statement: c.statement, required: c.relevance === 'required',
        disposition: decision?.disposition ?? null,
        representation: preview?.representation ?? null,
        disclosed: preview?.projection ?? null,
        draft_sentences: decision ? sentences(decision.id) : [],
        draft_table: Boolean(decision && draft?.blocks.some(block => block.table_id === decision.id)),
        originals: c.evidence_ids.flatMap(evidenceId => {
          const span = evidence.find(e => e.id === evidenceId), source = span && bytes.get(span.source_version_id);
          if (!span || !source) return [];
          return [{ evidence_id: span.id, source_name: names.get(span.source_version_id)!, locator: span.locator,
            start: span.start, end: span.end, ...excerpt(source, span.start, span.end) }];
        }),
      };
    }),
  };
}

export function sourceContent(store: TaskStore, id: string, versionId: string) {
  const source = store.analysis.sources(id).find(s => s.id === versionId);
  if (!source) deny(404, 'SOURCE_NOT_FOUND');
  return { id: source.id, display_name: source.display_name, format: source.format,
    text: Buffer.from(source.raw_bytes, 'base64').toString('utf8') };
}
