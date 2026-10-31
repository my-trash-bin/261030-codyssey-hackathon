import { createHash } from 'node:crypto';
import type { FactPack, ReviewGroundingContext, Scope } from '@safehandoff/core-interface';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Explicit fictional human approvals for tests; never used as a runtime review fallback.
export function reviewGroundingFixture(pack: FactPack): ReviewGroundingContext {
  const scope: Scope = { project_id: 'fictional-project', purpose_id: 'vendor_support', recipient_id: 'vendor',
    audience: 'named_external', skill_set_hash: hash([]) };
  const previews = pack.facts.map(fact => {
    const projection = { statement: fact.statement, columns: [], rows: [] };
    return { schema_version: 'disclosure_preview.v1' as const, preview_id: `p-${fact.id}`, candidate_id: fact.id,
      input_revision: pack.task_revision, representation: { kind: 'fact_summary' as const }, projection, projection_sha256: hash(projection) };
  });
  const sourceSetHash = hash('fictional source');
  return { scope, source_set_hash: sourceSetHash, candidate_selectors: {}, rule_goals: [], approved_tool_results: [], input: {
    task: { purpose: 'support', recipient: 'vendor', output_language: pack.output_language }, task_revision: pack.task_revision,
    template_id: pack.template_id, audience_type: pack.audience_type, rules: [], previews,
    candidates: pack.facts.map(fact => ({ local_key: fact.id, kind: 'observation', uncertainty: fact.uncertainty ?? 'observed',
      statement: fact.statement, evidence_ids: [], relevance: pack.required_fact_ids.includes(fact.id) ? 'required' : 'optional', purpose_relevance: 'fixture' })),
    decisions: pack.facts.map((fact, i) => ({ id: fact.id, candidate_id: fact.id, disposition: 'allow', revoked: false,
      representation: { kind: 'fact_summary' }, applied_rule_id: '', applied_rule_version: 0, expires_at: null, scope,
      source_set_hash: sourceSetHash, projection_sha256: previews[i]!.projection_sha256 })),
  } };
}
