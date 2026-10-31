import { createHash } from 'node:crypto';
import type { FactPack, GenerateRequest, ReviewGroundingContext, Scope } from '@safehandoff/core-interface';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Narrow Core.generate's caller has explicitly supplied approved facts. This adapter
// is not used by review() to invent missing decisions or infer a reuse grant.
export function approvedRequestGrounding(input: GenerateRequest, pack: FactPack): ReviewGroundingContext {
  const scope: Scope = { project_id: 'approved-facts-api', purpose_id: input.purpose, recipient_id: input.recipient,
    audience: 'named_external', skill_set_hash: hash([]) };
  const sourceSetHash = hash(input.facts);
  const candidates = input.facts.map(fact => ({ local_key: fact.id, kind: 'observation' as const, uncertainty: 'reported' as const,
    statement: fact.text, evidence_ids: [], relevance: 'required' as const, purpose_relevance: 'caller-approved facts' }));
  const previews = input.facts.map(fact => {
    const projection = { statement: fact.text, columns: [], rows: [] };
    return { schema_version: 'disclosure_preview.v1' as const, preview_id: `preview-${fact.id}`, candidate_id: fact.id,
      input_revision: pack.task_revision, representation: { kind: 'fact_summary' as const }, projection, projection_sha256: hash(projection) };
  });
  return { scope, source_set_hash: sourceSetHash, candidate_selectors: {}, rule_goals: [], approved_tool_results: [], input: {
    task: { purpose: input.purpose, recipient: input.recipient }, task_revision: pack.task_revision,
    template_id: pack.template_id, audience_type: pack.audience_type, candidates, previews, rules: [],
    decisions: input.facts.map((fact, i) => ({ id: fact.id, candidate_id: fact.id, disposition: 'allow', revoked: false,
      representation: { kind: 'fact_summary' }, expires_at: null, applied_rule_id: '', applied_rule_version: 0,
      scope, source_set_hash: sourceSetHash, projection_sha256: previews[i]!.projection_sha256 })),
  } };
}

export function validateProjectionHashes(context: ReviewGroundingContext): void {
  for (const preview of context.input.previews) {
    if (hash(preview.projection) !== preview.projection_sha256) throw new Error('INVALID_PROJECTION_HASH');
  }
}
