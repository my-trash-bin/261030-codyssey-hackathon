import { CoreError } from './index.ts';
import type { ComposeFactPackInput, FactPack } from './workflow.ts';

// Inputs are the server-validated current decision set, not the decision history.
// Expiring grants require an explicit clock value, keeping this transform deterministic.
export function composeFactPack(input: ComposeFactPackInput, now?: number): FactPack {
  const invalid = (): never => { throw new CoreError('INVALID_CORE_INPUT'); };
  const candidates = new Map(input.candidates.map(candidate => [candidate.local_key, candidate]));
  if (candidates.size !== input.candidates.length || !Number.isInteger(input.task_revision)) invalid();
  const seen = new Set<string>();
  const pack: FactPack = {
    schema_version: 'fact_pack.v1', task_revision: input.task_revision,
    template_id: input.template_id, audience_type: input.audience_type,
    output_language: input.task.output_language ?? 'ko', approved_brief: input.task.purpose,
    facts: [], required_fact_ids: [], tables: [], excerpt_slots: [], asset_slots: [], public_tool_results: [],
  };
  for (const decision of input.decisions) {
    if (seen.has(decision.candidate_id)) invalid();
    seen.add(decision.candidate_id);
    const candidate = candidates.get(decision.candidate_id);
    if (!candidate) invalid();
    if (decision.disposition !== 'allow' || decision.revoked) continue;
    if (decision.expires_at != null) {
      const expiry = Date.parse(decision.expires_at);
      if (!Number.isFinite(expiry) || now === undefined || !Number.isFinite(now)) invalid();
      if (expiry <= now!) continue;
    }
    const matches = input.previews.filter(preview => preview.candidate_id === decision.candidate_id &&
      preview.input_revision === input.task_revision && sameRepresentation(preview.representation, decision.representation));
    if (matches.length !== 1) invalid();
    const preview = matches[0]!;
    const id = decision.id;
    if (!id || pack.facts.some(fact => fact.id === id)) invalid();
    // Only the exact preview projection is public. Candidate statements/evidence are private.
    pack.facts.push({ id, kind: candidate!.kind, statement: preview.projection.statement, uncertainty: candidate!.uncertainty });
    if (candidate!.relevance === 'required') pack.required_fact_ids.push(id);
    if (preview.projection.columns.length) {
      if (preview.projection.rows.some(row => row.length !== preview.projection.columns.length)) invalid();
      pack.tables.push({ id, columns: [...preview.projection.columns], rows: preview.projection.rows.map(row => [...row]) });
    }
    if (decision.representation.kind === 'approved_excerpt') {
      // The writer receives a reference only; final byte insertion belongs to the renderer.
      if (preview.projection.excerpt === undefined) invalid();
      pack.excerpt_slots.push({ id });
    }
  }
  return pack;
}

function sameRepresentation(a: ComposeFactPackInput['decisions'][number]['representation'], b: typeof a): boolean {
  const parameters = (value: typeof a) => Object.entries(value.parameters ?? {}).sort(([x], [y]) => x.localeCompare(y));
  return a.kind === b.kind && a.transform_id === b.transform_id &&
    JSON.stringify(parameters(a)) === JSON.stringify(parameters(b));
}
