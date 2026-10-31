import { ModelError } from '@safehandoff/core-interface';
import type { CandidateProposals, Draft, EvidenceSpan, FactPack, Review } from '@safehandoff/core-interface';

export function invalid(): never { throw new ModelError('MODEL_INVALID_RESPONSE'); }
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => ![...required, ...optional].includes(key))) invalid();
  return record;
}
function text(value: unknown): value is string { return typeof value === 'string' && [...value].length <= 8192 && Buffer.from(value).toString('utf8') === value; }
function strings(value: unknown, allowed?: Set<string>): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(item => text(item) && (!allowed || allowed.has(item)));
}
function parse(input: string): unknown {
  try {
    const value: unknown = JSON.parse(input);
    // JSON.parse permits duplicate object keys. Reject them, including escaped spellings.
    const stack: (Set<string> | null)[] = [];
    let previous = '';
    for (const token of input.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? []) {
      if (token === '{') stack.push(new Set());
      else if (token === '[') stack.push(null);
      else if (token === '}' || token === ']') stack.pop();
      else if (token === ':') {
        const keys = stack.at(-1);
        const key: string = JSON.parse(previous);
        if (!keys || keys.has(key)) invalid();
        keys.add(key);
      }
      previous = token;
    }
    return value;
  } catch { return invalid(); }
}
export function validateDraft(value: unknown, pack: FactPack): Draft {
  const root = object(value, ['schema_version', 'blocks']);
  if (root.schema_version !== 'draft.v1' || !Array.isArray(root.blocks) || !root.blocks.length || root.blocks.length > 60) invalid();
  const facts = new Set(pack.facts.map(fact => fact.id));
  if (facts.size !== pack.facts.length || pack.required_fact_ids.some(id => !facts.has(id))) invalid();
  const blocks = new Set<string>();
  for (const value of root.blocks) {
    const block = object(value, ['type'], ['block_id', 'text', 'level', 'items', 'table_id', 'excerpt_id', 'asset_id', 'fact_ids']);
    if (block.block_id !== undefined) {
      if (!text(block.block_id) || !block.block_id || blocks.has(block.block_id)) invalid();
      blocks.add(block.block_id);
    }
    if (block.fact_ids !== undefined && !strings(block.fact_ids, facts)) invalid();
    if (block.text !== undefined && !text(block.text)) invalid();
    switch (block.type) {
      case 'heading':
        if (!Number.isInteger(block.level) || Number(block.level) < 1 || Number(block.level) > 6) invalid();
        if (!text(block.text) || !block.text.trim()) invalid();
        break;
      case 'paragraph':
        if (!text(block.text) || !block.text.trim()) invalid();
        break;
      case 'list':
        if (!Array.isArray(block.items) || !block.items.length || block.items.length > 100) invalid();
        for (const value of block.items) {
          const item = object(value, ['text', 'fact_ids']);
          if (!text(item.text) || !strings(item.fact_ids, facts)) invalid();
        }
        break;
      case 'table_ref': if (!pack.tables.some(slot => slot.id === block.table_id)) invalid(); break;
      case 'excerpt_ref': if (!pack.excerpt_slots.some(slot => slot.id === block.excerpt_id)) invalid(); break;
      case 'asset_ref': if (!pack.asset_slots.some(slot => slot.id === block.asset_id)) invalid(); break;
      default: invalid();
    }
    const allowed = ['type', 'block_id', 'fact_ids',
      ...(block.type === 'heading' ? ['text', 'level'] : block.type === 'paragraph' ? ['text'] :
        block.type === 'list' ? ['items'] : block.type === 'table_ref' ? ['table_id'] :
          block.type === 'excerpt_ref' ? ['excerpt_id'] : ['asset_id'])];
    if (Object.keys(block).some(key => !allowed.includes(key))) invalid();
  }
  return value as Draft;
}
export function parseDraft(input: string, pack: FactPack): Draft { return validateDraft(parse(input), pack); }
export const reasonCodes = new Set(['UNAPPROVED_DISCLOSURE', 'UNSUPPORTED_CAUSAL_CLAIM', 'MISSING_REQUIRED_FACT',
  'SOURCE_CONFLICT', 'UNCERTAINTY_REMOVED', 'INCORRECT_PROJECTION', 'UNAPPROVED_REFERENCE', 'NEEDS_DISCLOSURE_DECISION']);
export function parseReview(input: string, draft: Draft, pack: FactPack): Review {
  const root = object(parse(input), ['schema_version', 'result', 'issues']);
  if (root.schema_version !== 'review.v1' || !['pass', 'needs_changes', 'needs_decision', 'error'].includes(String(root.result)) ||
    !Array.isArray(root.issues) || root.issues.length > 100 ||
    (root.result === 'pass' && root.issues.length !== 0) ||
    (['needs_changes', 'needs_decision'].includes(String(root.result)) && !root.issues.length)) invalid();
  const facts = new Set(pack.facts.map(fact => fact.id));
  for (const value of root.issues) {
    const issue = object(value, ['target', 'reason_code', 'action', 'approved_fact_ids', 'candidate_ids', 'internal_explanation']);
    const target = object(issue.target, ['kind'], ['block_id', 'artifact_file_id']);
    if (!reasonCodes.has(String(issue.reason_code)) || (issue.action !== null && !text(issue.action)) ||
      !text(issue.internal_explanation) || !strings(issue.approved_fact_ids, facts) || !strings(issue.candidate_ids)) invalid();
    // This stage reviews a document, not artifact files that have not been rendered yet.
    if (target.kind === 'block') {
      if (!text(target.block_id) || !draft.blocks.some(block => block.block_id === target.block_id)) invalid();
    } else if (target.kind !== 'document' || target.block_id !== undefined) invalid();
    if (target.artifact_file_id !== undefined) invalid();
  }
  if (root.result === 'pass') {
    const covered = new Set(draft.blocks.flatMap(block => [...(block.fact_ids ?? []),
      ...(block.items ?? []).flatMap(item => item.fact_ids)]));
    const missing = pack.required_fact_ids.filter(id => !covered.has(id));
    if (missing.length) return { schema_version: 'review.v1', result: 'needs_changes', issues: [{
      target: { kind: 'document' }, reason_code: 'MISSING_REQUIRED_FACT', action: null,
      approved_fact_ids: missing, candidate_ids: [], internal_explanation: 'Required approved fact references are missing.',
    }] };
  }
  return root as unknown as Review;
}

// Normalize wire-level nullable arrays to the Engine's array-only projection.
export function parseCandidateProposals(input: string, evidence: EvidenceSpan[]): CandidateProposals {
  const root = object(parse(input), ['schema_version', 'candidates', 'conflicts']);
  const candidates = root.candidates === null ? [] : root.candidates;
  const conflicts = root.conflicts === null ? [] : root.conflicts;
  if (root.schema_version !== 'candidate_proposals.v1' || !Array.isArray(candidates) || candidates.length > 30 ||
    !Array.isArray(conflicts) || conflicts.length > 100) invalid();
  const known = new Set(evidence.map(item => item.id)), keys = new Set<string>();
  const normalized = candidates.map(value => {
    const candidate = object(value, ['local_key', 'kind', 'uncertainty', 'statement', 'evidence_ids', 'relevance', 'purpose_relevance']);
    const refs = candidate.evidence_ids === null ? [] : candidate.evidence_ids;
    if (!text(candidate.local_key) || !candidate.local_key.trim() || keys.has(candidate.local_key) ||
      !text(candidate.statement) || !candidate.statement.trim() || !text(candidate.purpose_relevance) ||
      typeof candidate.kind !== 'string' || !['observation', 'constraint', 'hypothesis', 'unknown', 'identifier'].includes(candidate.kind) ||
      typeof candidate.uncertainty !== 'string' || !['observed', 'reported', 'inferred', 'unknown'].includes(candidate.uncertainty) ||
      typeof candidate.relevance !== 'string' || !['required', 'optional'].includes(candidate.relevance) || !strings(refs, known) || new Set(refs).size !== refs.length) invalid();
    keys.add(candidate.local_key);
    return { ...candidate, evidence_ids: refs };
  });
  const groups = new Set<string>();
  const normalizedConflicts = conflicts.map(value => {
    const conflict = object(value, ['local_keys', 'reason']);
    const refs = conflict.local_keys === null ? [] : conflict.local_keys;
    if (!strings(refs, keys) || refs.length < 2 || new Set(refs).size !== refs.length || !text(conflict.reason) || !conflict.reason.trim()) invalid();
    const signature = JSON.stringify([...refs].sort());
    if (groups.has(signature)) invalid();
    groups.add(signature);
    return { local_keys: refs, reason: conflict.reason };
  });
  return { schema_version: 'candidate_proposals.v1', candidates: normalized,
    conflicts: normalizedConflicts } as CandidateProposals;
}
