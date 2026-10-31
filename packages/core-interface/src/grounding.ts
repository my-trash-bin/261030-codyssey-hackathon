import { CoreError } from './index.ts';
import { composeFactPack } from './compose.ts';
import type { FactGrounding, FactPack, ReviewGroundingContext, Scope } from './workflow.ts';
function denied(): never { throw new CoreError('INVALID_CORE_INPUT'); }
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + Array.from(value, item => { if (item === undefined) denied(); return canonical(item); }).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const encoded = JSON.stringify(value);
  if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) denied();
  return encoded;
}
function scopeValid(scope: Scope): boolean {
  return Boolean(scope && Object.keys(scope).sort().join(',') === 'audience,project_id,purpose_id,recipient_id,skill_set_hash' &&
    [scope.project_id, scope.purpose_id, scope.recipient_id].every(value => typeof value === 'string' && value.trim()) &&
    ['public', 'named_external'].includes(scope.audience) && /^[a-f0-9]{64}$/.test(scope.skill_set_hash));
}
function active(expires: string | null | undefined, now: number): boolean {
  if (expires === null) return true;
  if (typeof expires !== 'string') return false;
  const matched = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/.exec(expires);
  if (!matched) return false;
  const local = Date.parse(matched[1]! + 'Z'), zone = matched[2]!;
  return Number.isFinite(local) && new Date(local).toISOString().slice(0, 19) === matched[1] &&
    (zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59)) &&
    Number.isFinite(Date.parse(expires)) && Date.parse(expires) > now;
}
const reusableTransforms = new Set(['series_fact_summary.v1', 'series_direction_only.v1', 'series_index_base100.v1',
  'timeline_sequence_only.v1', 'timeline_relative_intervals.v1', 'timeline_shifted_absolute.v1', 'timeline_synthetic_schedule.v1']);

function reusableRepresentation(representation: ReviewGroundingContext['input']['decisions'][number]['representation']): boolean {
  const transform = representation.transform_id ?? '';
  const parameters = representation.parameters ?? {};
  if (!reusableTransforms.has(transform) || !['fact_summary', 'derived_table'].includes(representation.kind)) return false;
  if (representation.kind === 'fact_summary') return transform === 'series_fact_summary.v1' && !Object.keys(parameters).length;
  if (transform === 'series_fact_summary.v1') return false;
  if (transform === 'series_index_base100.v1') return Object.keys(parameters).every(key => key === 'decimal_places') &&
    (parameters.decimal_places === undefined || (typeof parameters.decimal_places === 'number' && Number.isInteger(parameters.decimal_places) && parameters.decimal_places >= 0 && parameters.decimal_places <= 4));
  if (['timeline_shifted_absolute.v1', 'timeline_synthetic_schedule.v1'].includes(transform)) {
    return Object.keys(parameters).length === 1 && Number.isSafeInteger(parameters.base_epoch_seconds);
  }
  return Object.keys(parameters).length === 0;
}

// Summary rows are derived from the effective decision snapshot, never accepted as authority.
export function groundFacts(context: ReviewGroundingContext, pack: FactPack, now: number): FactGrounding[] {
  if (!context || !Number.isFinite(now) || !scopeValid(context.scope) || !/^[a-f0-9]{64}$/.test(context.source_set_hash) ||
    !Array.isArray(context.input?.rules) || !Array.isArray(context.rule_goals) || !Array.isArray(context.approved_tool_results) ||
    !['default', 'observations_only', 'ask_for_diagnostics', 'reproduction_evidence'].includes(context.input.task.goal_variant ?? 'default')) denied();
  const expected = composeFactPack(context.input, now);
  expected.public_tool_results = context.approved_tool_results;
  if (!pack.facts.length || canonical(expected) !== canonical(pack)) denied();
  const decisions = new Map(context.input.decisions.map(decision => [decision.id, decision]));
  const rules = context.input.rules;
  if (new Set(rules.map(rule => `${rule.id}:${rule.version}`)).size !== rules.length) denied();
  const summaries: FactGrounding[] = [];
  for (const fact of pack.facts) {
    const decision = decisions.get(fact.id);
    if (!decision || decision.disposition !== 'allow' || decision.revoked !== false ||
      !active(decision.expires_at ?? null, now) || !scopeValid(decision.scope!) ||
      canonical(decision.scope) !== canonical(context.scope) || decision.source_set_hash !== context.source_set_hash) denied();
    const preview = context.input.previews.find(preview => preview.candidate_id === decision.candidate_id &&
      preview.input_revision === pack.task_revision && preview.projection_sha256 === decision.projection_sha256);
    if (!preview || !/^[a-f0-9]{64}$/.test(preview.projection_sha256) || decision.projection_sha256 !== preview.projection_sha256) denied();
    if (decision.applied_rule_id === '') {
      if (decision.applied_rule_version !== 0) denied();
      summaries.push({ fact_id: fact.id, decision_id: decision.id, source: 'fresh_decision' });
      continue;
    }
    if (!reusableRepresentation(decision.representation)) denied();
    const rule = rules.find(rule => rule.id === decision.applied_rule_id && rule.version === decision.applied_rule_version);
    if (!rule || typeof rule.id !== 'string' || !rule.id.trim() ||
      Object.keys(rule).sort().join(',') !== 'expires_at,id,representation,revoked,scope,selector,version' ||
      !['oss_issue', 'vendor_support', 'operations_advice'].includes(rule.scope?.purpose_id) || !Number.isSafeInteger(rule.version) || rule.version < 1 || rule.revoked !== false ||
      rules.some(other => other.id === rule.id && other.revoked) || !active(rule.expires_at, now) || !scopeValid(rule.scope) ||
      canonical(rule.scope) !== canonical(context.scope) || canonical(rule.representation) !== canonical(decision.representation) ||
      !rule.selector || context.candidate_selectors?.[decision.candidate_id] !== rule.selector) denied();
    const goals = context.rule_goals.filter(binding => binding.rule_id === rule.id && binding.rule_version === rule.version);
    if (goals.length !== 1 || goals[0]!.goal_variant !== (context.input.task.goal_variant ?? 'default')) denied();
    summaries.push({ fact_id: fact.id, decision_id: decision.id, source: 'reused_rule', rule_id: rule.id, rule_version: rule.version });
  }
  return summaries;
}
